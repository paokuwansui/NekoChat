#!/usr/bin/env python3
"""NekoChat — 可爱猫娘多角色聊天器后端"""

import json
import os
import re
import random
import time
import threading
import uuid
from datetime import datetime
from pathlib import Path

from flask import Flask, jsonify, request, Response, send_from_directory, stream_with_context
import requests

app = Flask(__name__, static_folder="static", static_url_path="/static")
BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
HISTORY_DIR = BASE_DIR / "history"
UPLOADS_DIR = BASE_DIR / "uploads"

# 确保目录存在
for d in [DATA_DIR, HISTORY_DIR, UPLOADS_DIR, UPLOADS_DIR / "avatars", UPLOADS_DIR / "backgrounds"]:
    d.mkdir(parents=True, exist_ok=True)


# ─── helpers ────────────────────────────────────────────────────

def read_json(path, default=None):
    """读取JSON文件，不存在则返回default并写入"""
    path = Path(path)
    if not path.exists():
        if default is not None:
            write_json(path, default)
        return default
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def write_json(path, data):
    """写入JSON文件"""
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def get_character(char_id):
    """按ID查找角色"""
    chars = read_json(DATA_DIR / "characters.json", [])
    for c in chars:
        if c["id"] == char_id:
            return c
    return None


def get_group(group_id):
    """按ID查找群组"""
    groups = read_json(DATA_DIR / "groups.json", [])
    for g in groups:
        if g["id"] == group_id:
            return g
    return None


def get_chat_index(chat_id):
    """获取聊天索引条目"""
    chats = read_json(DATA_DIR / "chats_index.json", [])
    for c in chats:
        if c["chat_id"] == chat_id:
            return c
    return None


def upsert_chat_index(chat_entry):
    """插入或更新聊天索引"""
    chats = read_json(DATA_DIR / "chats_index.json", [])
    for i, c in enumerate(chats):
        if c["chat_id"] == chat_entry["chat_id"]:
            chats[i] = chat_entry
            write_json(DATA_DIR / "chats_index.json", chats)
            return
    chats.insert(0, chat_entry)
    write_json(DATA_DIR / "chats_index.json", chats)


def get_history_path(chat_id):
    """获取聊天历史文件路径"""
    return HISTORY_DIR / f"{chat_id}.txt"


def get_user_name():
    """Get the user's display name from profile."""
    profile = read_json(DATA_DIR / "user_profile.json", {"name": "我", "avatar": ""})
    return profile.get("name", "我")


def read_history(chat_id):
    """读取聊天历史消息列表"""
    user_name = get_user_name()
    chars = read_json(DATA_DIR / "characters.json", [])
    name_to_id = {c["name"]: c["id"] for c in chars}
    path = get_history_path(chat_id)
    if not path.exists():
        return []
    messages = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("===") or line.startswith("角色:") or line.startswith("背景:") or line.startswith("风格:") or line.startswith("成员:"):
                continue
            # 格式: [HH:MM:SS] 发言人: 内容
            match = re.match(r"\[(\d{2}:\d{2}:\d{2})\]\s+(.+?):\s+(.*)", line)
            if match:
                timestamp, speaker, content = match.groups()
                content = content.replace("\\n", "\n")  # 还原转义的换行
                role = "user" if speaker in (user_name, "我") else "assistant"
                msg = {"role": role, "content": content, "timestamp": timestamp}
                if role == "assistant" and speaker != "AI":
                    msg["character_name"] = speaker
                    cid = name_to_id.get(speaker)
                    if cid:
                        msg["character_id"] = cid
                messages.append(msg)
    return messages


def append_to_history(chat_id, message_text, speaker, timestamp=None):
    """追加一条消息到历史文件"""
    path = get_history_path(chat_id)
    if timestamp is None:
        timestamp = datetime.now().strftime("%H:%M:%S")

    # 如果是新文件，写入头部
    is_new = not path.exists()
    with open(path, "a", encoding="utf-8") as f:
        if is_new:
            chat = get_chat_index(chat_id)
            if chat:
                ctype = chat.get("type", "private")
                if ctype == "story":
                    char = get_character(chat.get("target_id", ""))
                    char_name = char["name"] if char else "AI"
                    f.write(f"=== NekoChat Story (故事模式): {chat.get('title', chat_id)} ===\n")
                    f.write(f"角色: {char_name}\n")
                    f.write(f"背景: {chat.get('story_background', '未设定')}\n")
                    bg = chat.get("narrative_style", "")
                    if bg:
                        f.write(f"风格: {bg}\n")
                    f.write("\n")
                elif ctype == "group":
                    group = get_group(chat.get("target_id", ""))
                    if group:
                        chars = read_json(DATA_DIR / "characters.json", [])
                        names = []
                        for mid in group.get("members", []):
                            c = get_character(mid)
                            names.append(c["name"] if c else mid)
                        f.write(f"=== NekoChat Group: {group['name']} ===\n")
                        f.write(f"成员: {', '.join(names)}\n\n")
                else:
                    char = get_character(chat.get("target_id", ""))
                    char_name = char["name"] if char else "AI"
                    f.write(f"=== NekoChat Private Chat (聊天模式): 我 & {char_name} ===\n\n")

        safe = message_text.replace("\n", "\\n")
        f.write(f"[{timestamp}] {speaker}: {safe}\n")


def extract_mentions(message, group):
    """从消息中提取@的角色ID列表"""
    chars = read_json(DATA_DIR / "characters.json", [])
    name_to_id = {c["name"]: c["id"] for c in chars}

    # 匹配 @角色名
    mentioned_ids = []
    for name, cid in name_to_id.items():
        if cid in group.get("members", []) and f"@{name}" in message:
            mentioned_ids.append(cid)

    return mentioned_ids


def build_story_prompt(character, story_background, narrative_style):
    """构造故事模式的 system prompt"""
    narrative = narrative_style or "自然流畅"
    return f"""你是{character['name']}，{character['system_prompt']}

【重要：叙事模式】
你正在参与一个互动故事。请用小说叙事的方式回复，包括：
- 环境描写：场景、氛围、光线、声音等
- 动作描写：角色的肢体动作、表情变化、细节行为
- 心理描写：角色的内心感受和情绪变化
- 对话描写：自然地融入对话，但对话只是叙事的一部分

【背景故事】
{story_background}

【叙事风格】
{narrative}

请注意：
- 每次回复控制在2-4段
- 对话和叙事自然地交织在一起
- 保持角色个性，不要OOC（脱离角色设定）
- 用户输入的是"故事中发生的事"，请据此推进剧情"""


def stream_ai_response(messages, api_key, base_url, model, system_prompt, temperature=0.9):
    """调用AI API并流式返回"""
    url = f"{base_url.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": model,
        "messages": [{"role": "system", "content": system_prompt}] + messages,
        "temperature": temperature,
        "stream": True
    }

    resp = requests.post(url, headers=headers, json=payload, stream=True, timeout=(10, 120))
    resp.raise_for_status()

    def generate():
        try:
            for line in resp.iter_lines(decode_unicode=True):
                if line and line.startswith("data: "):
                    data_str = line[6:]
                    if data_str.strip() == "[DONE]":
                        yield "data: [DONE]\n\n"
                        break
                    try:
                        data = json.loads(data_str)
                        delta = data.get("choices", [{}])[0].get("delta", {}).get("content", "")
                        if delta:
                            yield f"data: {json.dumps({'delta': delta}, ensure_ascii=False)}\n\n"
                    except json.JSONDecodeError:
                        pass
        except GeneratorExit:
            resp.close()

    return generate()


# ─── static serve ───────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory(BASE_DIR / "static" / "templates", "index.html")


@app.route("/uploads/<path:filename>")
def serve_upload(filename):
    return send_from_directory(str(UPLOADS_DIR), filename)

@app.route("/music/<path:filename>")
def serve_music(filename):
    return send_from_directory(str(MUSIC_DIR), filename)


# ─── settings ───────────────────────────────────────────────────

@app.route("/api/settings", methods=["GET", "POST"])
def settings():
    if request.method == "GET":
        s = read_json(DATA_DIR / "settings.json", {
            "api_key": "", "base_url": "https://api.deepseek.com/v1",
            "model": "deepseek-chat", "chat_background": "",
            "ai_bubble_color": "#EDE4FF", "user_bubble_color": "#FFB6C1",
            "font_size": 15, "messages_per_page": 20
        })
        # 脱敏 API key
        if s.get("api_key") and len(s["api_key"]) > 8:
            s["api_key_masked"] = s["api_key"][:4] + "****" + s["api_key"][-4:]
        else:
            s["api_key_masked"] = s.get("api_key", "")
        return jsonify(s)
    else:
        data = request.get_json(force=True)
        existing = read_json(DATA_DIR / "settings.json", {})
        if data.get("api_key") == "":
            data["api_key"] = existing.get("api_key", "")
        existing.update(data)
        write_json(DATA_DIR / "settings.json", existing)
        return jsonify({"status": "ok"})


# ─── user profile ───────────────────────────────────────────────

@app.route("/api/user_profile", methods=["GET", "POST"])
def user_profile():
    if request.method == "GET":
        return jsonify(read_json(DATA_DIR / "user_profile.json", {"name": "我", "avatar": ""}))
    else:
        data = request.get_json(force=True)
        write_json(DATA_DIR / "user_profile.json", data)
        return jsonify({"status": "ok"})


# ─── characters CRUD ────────────────────────────────────────────

@app.route("/api/characters", methods=["GET", "POST"])
def characters():
    if request.method == "GET":
        return jsonify(read_json(DATA_DIR / "characters.json", []))
    else:
        data = request.get_json(force=True)
        chars = read_json(DATA_DIR / "characters.json", [])
        data["id"] = data.get("id") or f"char_{uuid.uuid4().hex[:8]}"
        chars.append(data)
        write_json(DATA_DIR / "characters.json", chars)
        return jsonify(data)


@app.route("/api/characters/<char_id>", methods=["PUT", "DELETE"])
def character_detail(char_id):
    chars = read_json(DATA_DIR / "characters.json", [])
    if request.method == "PUT":
        data = request.get_json(force=True)
        for i, c in enumerate(chars):
            if c["id"] == char_id:
                chars[i].update(data)
                chars[i]["id"] = char_id
                write_json(DATA_DIR / "characters.json", chars)
                return jsonify(chars[i])
        return jsonify({"error": "not found"}), 404
    else:
        chars = [c for c in chars if c["id"] != char_id]
        write_json(DATA_DIR / "characters.json", chars)
        return jsonify({"status": "ok"})


# ─── groups CRUD ────────────────────────────────────────────────

@app.route("/api/groups", methods=["GET", "POST"])
def groups():
    if request.method == "GET":
        return jsonify(read_json(DATA_DIR / "groups.json", []))
    else:
        data = request.get_json(force=True)
        groups = read_json(DATA_DIR / "groups.json", [])
        data["id"] = data.get("id") or f"group_{uuid.uuid4().hex[:8]}"
        data.setdefault("type", "group")
        groups.append(data)
        write_json(DATA_DIR / "groups.json", groups)
        return jsonify(data)


@app.route("/api/groups/<group_id>", methods=["PUT", "DELETE"])
def group_detail(group_id):
    groups = read_json(DATA_DIR / "groups.json", [])
    if request.method == "PUT":
        data = request.get_json(force=True)
        for i, g in enumerate(groups):
            if g["id"] == group_id:
                groups[i].update(data)
                groups[i]["id"] = group_id
                write_json(DATA_DIR / "groups.json", groups)
                return jsonify(groups[i])
        return jsonify({"error": "not found"}), 404
    else:
        groups = [g for g in groups if g["id"] != group_id]
        write_json(DATA_DIR / "groups.json", groups)
        return jsonify({"status": "ok"})


@app.route("/api/groups/<group_id>/members", methods=["GET"])
def group_members(group_id):
    group = get_group(group_id)
    if not group:
        return jsonify({"error": "not found"}), 404
    chars = read_json(DATA_DIR / "characters.json", [])
    members = [c for c in chars if c["id"] in group.get("members", [])]
    return jsonify(members)


# ─── chats list & history ───────────────────────────────────────

@app.route("/api/chats", methods=["GET"])
def chats_list():
    """获取聊天列表（按最后消息时间排序）"""
    chats = read_json(DATA_DIR / "chats_index.json", [])
    chats.sort(key=lambda x: x.get("last_time", ""), reverse=True)
    return jsonify(chats)


@app.route("/api/chats/<chat_id>", methods=["GET", "DELETE", "PUT"])
def chat_detail(chat_id):
    if request.method == "DELETE":
        # 删除聊天索引
        chats = read_json(DATA_DIR / "chats_index.json", [])
        chats = [c for c in chats if c["chat_id"] != chat_id]
        write_json(DATA_DIR / "chats_index.json", chats)
        # 删除历史文件
        hist_path = get_history_path(chat_id)
        if hist_path.exists():
            hist_path.unlink()
        # 删除相册文件
        ALBUMS_DIR.mkdir(parents=True, exist_ok=True)
        album_path = ALBUMS_DIR / f"{chat_id}.json"
        if album_path.exists():
            album_path.unlink()
        # 删除日记计数器
        counters = read_json(DIARY_COUNTERS, {})
        if chat_id in counters:
            del counters[chat_id]
            write_json(DIARY_COUNTERS, counters)
        return jsonify({"status": "ok"})
    elif request.method == "PUT":
        # 更新聊天元数据（故事/群聊设置）
        data = request.get_json(force=True)
        entry = get_chat_index(chat_id)
        if not entry:
            return jsonify({"error": "not found"}), 404
        for key in ("title", "story_background", "narrative_style",
                     "chat_background", "story_avatar", "story_chars"):
            if key in data:
                entry[key] = data[key]
        upsert_chat_index(entry)
        return jsonify({"status": "ok", "chat": entry})
    else:
        # 分页加载历史消息
        offset = request.args.get("offset", 0, type=int)
        limit = request.args.get("limit", 20, type=int)
        messages = read_history(chat_id)
        total = len(messages)
        start = max(0, total - offset - limit)
        end = total - offset
        page = messages[start:end]
        has_more_before = start > 0
        has_more_after = end < total
        chat = get_chat_index(chat_id)
        return jsonify({
            "chat_id": chat_id,
            "chat": chat,
            "messages": page,
            "total": total,
            "offset": offset,
            "has_more_before": has_more_before,
            "has_more_after": has_more_after
        })


# ─── clear chat history (keep metadata) ──────────────────────────

@app.route("/api/chats/<chat_id>/clear", methods=["POST"])
def clear_chat_history(chat_id):
    """清空聊天记录，保留故事/群聊元数据"""
    hist_path = get_history_path(chat_id)
    if hist_path.exists():
        hist_path.unlink()
    # Update chat index: clear last_message
    entry = get_chat_index(chat_id)
    if entry:
        entry["last_message"] = ""
        entry["last_time"] = datetime.now().isoformat()
        entry["message_count"] = 0
        upsert_chat_index(entry)
    return jsonify({"status": "ok"})


# ─── undo last round ────────────────────────────────────────────

@app.route("/api/chats/<chat_id>/undo", methods=["POST"])
def undo_last_round(chat_id):
    """Remove the last round of conversation (user msg + AI response(s))."""
    hist_path = get_history_path(chat_id)
    if not hist_path.exists():
        return jsonify({"error": "no history"}), 404

    lines = hist_path.read_text(encoding="utf-8").strip().split("\n")
    # Remove header lines (===, 成员:, 角色:, 背景:, 风格:)
    while lines and (lines[-1].startswith("===") or lines[-1].startswith("成员:")
                     or lines[-1].startswith("角色:") or lines[-1].startswith("背景:")
                     or lines[-1].startswith("风格:") or lines[-1].strip() == ""):
        lines.pop()

    # Find the last user message (any name that's not a known character)
    user_name = get_user_name()
    chars = read_json(DATA_DIR / "characters.json", [])
    char_names = {c["name"] for c in chars}
    last_user_idx = -1
    for i in range(len(lines) - 1, -1, -1):
        line = lines[i].strip()
        if line.startswith("["):
            match = re.match(r"\[(\d{2}:\d{2}:\d{2})\]\s+(.+?):\s+", line)
            if match:
                speaker = match.group(2)
                if speaker not in char_names and speaker != "AI":  # not character → user
                    last_user_idx = i
                    break

    if last_user_idx < 0:
        return jsonify({"error": "no user message found"}), 400

    # Remove from last user message to end (user + all AI responses after)
    removed = len(lines) - last_user_idx
    lines = lines[:last_user_idx]

    # If nothing left, remove file
    if not lines or all(l.strip() == "" or l.startswith("===") for l in lines):
        hist_path.unlink()
        # Remove from index
        chats = read_json(DATA_DIR / "chats_index.json", [])
        chats = [c for c in chats if c["chat_id"] != chat_id]
        write_json(DATA_DIR / "chats_index.json", chats)
    else:
        hist_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        # Update index
        msgs = read_history(chat_id)
        entry = get_chat_index(chat_id)
        if entry:
            entry["message_count"] = len(msgs)
            if msgs:
                entry["last_message"] = msgs[-1]["content"][:80]
            upsert_chat_index(entry)

    # Decrement diary counter on undo (one round removed)
    counters = read_json(DIARY_COUNTERS, {})
    if chat_id in counters:
        counters[chat_id]["counter"] = max(0, counters[chat_id]["counter"] - 1)
        write_json(DIARY_COUNTERS, counters)

    return jsonify({"status": "ok", "removed": removed})


# ─── chat registration (no AI call) ────────────────────────────

@app.route("/api/chats/register", methods=["POST"])
def chat_register():
    """Register a new chat in the index without triggering AI."""
    data = request.get_json(force=True)
    chat_id = data.get("chat_id", "")
    chat_type = data.get("type", "private")
    mode = data.get("mode", "chat")
    target_id = data.get("target_id", "")
    
    if not chat_id:
        return jsonify({"error": "缺少chat_id"}), 400

    entry = {
        "chat_id": chat_id,
        "type": chat_type,
        "mode": mode,
        "target_id": target_id,
        "last_message": "",
        "last_time": datetime.now().isoformat(),
        "message_count": 0
    }
    if chat_type == "story" or mode == "story":
        entry["title"] = data.get("title", chat_id)
        entry["story_background"] = data.get("story_background", "")
        entry["narrative_style"] = data.get("narrative_style", "")
        entry["chat_background"] = data.get("chat_background", "")
        entry["story_avatar"] = data.get("story_avatar", "")
        entry["story_chars"] = data.get("story_chars", [])
    upsert_chat_index(entry)
    return jsonify({"status": "ok", "chat_id": chat_id})


# ─── chat (private + story) ─────────────────────────────────────

@app.route("/api/chat/private", methods=["POST"])
def chat_private():
    data = request.get_json(force=True)
    character_id = data["character_id"]
    chat_id = data["chat_id"]
    mode = data.get("mode", "chat")
    messages = data.get("messages", [])
    api_key = data.get("api_key", "")
    base_url = data.get("base_url", "https://api.deepseek.com/v1")
    model = data.get("model", "deepseek-chat")

    character = get_character(character_id)
    if not character:
        return jsonify({"error": "角色不存在"}), 404

    # 构造 system prompt
    override = data.get("_system_override", "")
    if override:
        system_prompt = override
    elif mode == "story":
        story_bg = data.get("story_background", "")
        narrative_style = data.get("narrative_style", "自然流畅")
        system_prompt = build_story_prompt(character, story_bg, narrative_style)
    else:
        system_prompt = f"你是{character['name']}，{character['system_prompt']}"

    temperature = data.get("temperature", character.get("temperature", 0.9))

    # 保存用户消息到历史
    if messages and messages[-1]["role"] == "user":
        last_msg = messages[-1]["content"]
        append_to_history(chat_id, last_msg, get_user_name())

    def generate():
        full_response = ""
        try:
            gen = stream_ai_response(messages, api_key, base_url, model, system_prompt, temperature)
            for chunk in gen:
                if chunk.startswith("data: ") and "[DONE]" not in chunk:
                    try:
                        d = json.loads(chunk[6:].strip())
                        full_response += d.get("delta", "")
                    except json.JSONDecodeError:
                        pass
                yield chunk
            # 保存 AI 回复到历史
            char_name = character["name"]
            if full_response:
                append_to_history(chat_id, full_response, char_name)
            # 始终更新聊天索引（包括空回复/初始化）
            chat_entry = {
                "chat_id": chat_id,
                "type": "story" if mode == "story" else "private",
                "mode": mode,
                "target_id": character_id,
                "last_message": full_response[:80] if full_response else "",
                "last_time": datetime.now().isoformat(),
                "message_count": len(read_history(chat_id))
            }
            if mode == "story":
                chat_entry["title"] = data.get("title", chat_id)
                chat_entry["story_background"] = data.get("story_background", "")
                chat_entry["narrative_style"] = data.get("narrative_style", "")
                chat_entry["chat_background"] = data.get("chat_background", "")
                chat_entry["story_avatar"] = data.get("story_avatar", "")
                chat_entry["story_chars"] = data.get("story_chars", [])
            upsert_chat_index(chat_entry)
        except requests.exceptions.RequestException as e:
            yield f"data: {json.dumps({'error': str(e)}, ensure_ascii=False)}\n\n"
        except GeneratorExit:
            pass

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive"
        }
    )


# ─── group chat ─────────────────────────────────────────────────

def _call_ai_nonstream(api_key, base_url, model, messages, temperature=0.9):
    """调用AI API，非流式，返回完整文本"""
    url = f"{base_url.rstrip('/')}/chat/completions"
    resp = requests.post(url,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={"model": model, "messages": messages, "temperature": temperature},
        timeout=(10, 120))
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def _extract_json(text):
    """从AI回复中提取JSON对象"""
    text = text.strip()
    # 去掉可能的 markdown code block
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:]) if len(lines) > 1 else text
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()
    # 找到第一个 { 和对应的 }
    start = text.find("{")
    if start < 0:
        raise ValueError("No JSON found in response")
    depth = 0
    for i in range(start, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return json.loads(text[start:i+1])
    raise ValueError("Unmatched braces in response")


@app.route("/api/chat/group", methods=["POST"])
def chat_group():
    data = request.get_json(force=True)
    group_id = data["group_id"]
    chat_id = data["chat_id"]
    message = data["message"]
    api_key = data.get("api_key", "")
    base_url = data.get("base_url", "https://api.deepseek.com/v1")
    model = data.get("model", "deepseek-chat")
    history = data.get("chat_history", [])

    group = get_group(group_id)
    if not group:
        return jsonify({"error": "群组不存在"}), 404

    # 保存用户消息
    append_to_history(chat_id, message, get_user_name())

    # 检测 @ → 确定回复者
    mentioned = extract_mentions(message, group)
    responder_ids = mentioned if mentioned else group.get("members", [])
    responders = [c for cid in responder_ids if (c := get_character(cid))]
    if not responders:
        return jsonify({"error": "没有可回复的角色"}), 400

    # 构建成员描述 + 历史文本
    all_chars_desc = "\n".join(
        f"- {c['name']} (id: {c['id']})：{c['system_prompt']}" for c in responders
    )
    names = "、".join(c["name"] for c in responders)

    history_text = ""
    for h in history[-10:]:
        speaker = h.get("character_name", "我" if h.get("role") == "user" else "AI")
        history_text += f"{speaker}：{h['content']}\n"
    history_text += f"我：{message}\n"

    # 构建一次性 prompt
    prompt = (
        f"【群聊信息】\n"
        f"群名：{group['name']}\n\n"
        f"【成员角色设定】\n"
        f"{all_chars_desc}\n"
        f"【群聊规则】\n"
        f"- 用各自角色身份自然参与讨论，回复简短（2-4句话）\n"
        f"- 可以直接对话，也可以用 @名字 来点名某人\n\n"
        f"【本次需要回复的成员】（共{len(responders)}人）\n"
        f"{names}\n\n"
        f"【聊天记录】\n"
        f"{history_text}\n"
        f"【输出要求】\n"
        f"请以JSON格式一次性输出所有成员的回复。回复顺序要随机（不要按名字字母序）。\n"
        f"严格按照以下JSON格式，只输出JSON，不要输出其他内容：\n"
        f'{{"replies": ['
        + ",".join(f'{{"id": "{c["id"]}", "content": "...（{c["name"]}的回复，不要带角色名前缀）"}}' for c in responders)
        + f']}}'
    )

    msg_count = len(read_history(chat_id))

    def generate():
        all_replies = []
        try:
            # 第1步：调用AI（非流式，一次性拿JSON）
            full = _call_ai_nonstream(api_key, base_url, model,
                [{"role": "user", "content": prompt}], 0.9)
            parsed = _extract_json(full)
            raw_replies = parsed.get("replies", [])
        except Exception as e:
            yield f"data: {json.dumps({'error': f'AI回复解析失败: {e}'}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
            return

        # 第2步：随机打乱顺序
        random.shuffle(raw_replies)

        # 第3步：逐条推送（带延时，模拟逐人回复）
        for r in raw_replies:
            char = get_character(r.get("id", ""))
            content = (r.get("content") or "").strip()
            if not char or not content:
                continue

            # 去除AI可能带的名字前缀
            for prefix in [f"[{char['name']}]:", f"{char['name']}：", f"{char['name']}:"]:
                if content.startswith(prefix):
                    content = content[len(prefix):].strip()
                    break

            # 随机延时 1~2.5s
            time.sleep(random.uniform(1.0, 2.5))

            yield f"data: {json.dumps({'character_id': char['id'], 'character_name': char['name'], 'delta': content}, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({'character_id': char['id'], 'done': True}, ensure_ascii=False)}\n\n"

            append_to_history(chat_id, content, char["name"])
            all_replies.append({"id": char["id"], "name": char["name"], "content": content})

        # 第4步：检测@提及 → 二次请求
        chars_all = read_json(DATA_DIR / "characters.json", [])
        name_to_id = {c["name"]: c["id"] for c in chars_all}
        for reply in all_replies:
            for name, cid in name_to_id.items():
                if f"@{name}" in reply["content"] and cid != reply["id"]:
                    target = get_character(cid)
                    if not target:
                        continue
                    at_prompt = (
                        f"【上文】\n"
                        f"{reply['name']}：{reply['content']}\n\n"
                        f"【被@的人】\n"
                        f"{name} 被 @了，请以 {name} 的身份简短回复（2-3句话，不要带角色名前缀）\n\n"
                        f"只输出JSON：{{\"content\": \"回复内容\"}}"
                    )
                    try:
                        at_full = _call_ai_nonstream(api_key, base_url, model,
                            [{"role": "user", "content": at_prompt}], 0.9)
                        at_json = _extract_json(at_full)
                        at_content = (at_json.get("content") or "").strip()
                        if at_content:
                            time.sleep(random.uniform(1.0, 2.5))
                            yield f"data: {json.dumps({'character_id': cid, 'character_name': name, 'delta': at_content}, ensure_ascii=False)}\n\n"
                            yield f"data: {json.dumps({'character_id': cid, 'done': True}, ensure_ascii=False)}\n\n"
                            append_to_history(chat_id, at_content, name)
                    except Exception:
                        pass

        # 更新聊天索引
        last = all_replies[-1] if all_replies else None
        chat_entry = {
            "chat_id": chat_id, "type": "group", "mode": "chat",
            "target_id": group_id,
            "last_message": f"{last['name']}: {last['content'][:50]}" if last else message[:80],
            "last_time": datetime.now().isoformat(),
            "message_count": msg_count + sum(1 for _ in all_replies)
        }
        upsert_chat_index(chat_entry)
        yield "data: [DONE]\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"}
    )


# ─── upload ─────────────────────────────────────────────────────

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".webm", ".mp4", ".mp3", ".wav", ".ogg"}
MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10MB


@app.route("/api/upload", methods=["POST"])
def upload_file():
    if "file" not in request.files:
        return jsonify({"status": "error", "message": "没有文件"}), 400

    file = request.files["file"]
    if not file.filename:
        return jsonify({"status": "error", "message": "文件名为空"}), 400

    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        return jsonify({"status": "error", "message": f"仅支持 {', '.join(ALLOWED_EXTENSIONS)} 格式nya~"}), 400

    # 检查文件大小
    file.seek(0, 2)
    size = file.tell()
    file.seek(0)
    if size > MAX_UPLOAD_SIZE:
        return jsonify({"status": "error", "message": "文件太大了nya~ 请选择10MB以内的图片"}), 400

    # 生成唯一文件名
    upload_type = request.form.get("type", "backgrounds")
    if upload_type not in ("avatars", "backgrounds"):
        upload_type = "backgrounds"

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{timestamp}_{uuid.uuid4().hex[:6]}{ext}"
    save_path = UPLOADS_DIR / upload_type / filename
    file.save(str(save_path))

    return jsonify({
        "status": "ok",
        "path": f"/uploads/{upload_type}/{filename}"
    })


# ─── image gallery list ─────────────────────────────────────────

@app.route("/api/uploads/list")
def uploads_list():
    """List uploaded images for gallery picker."""
    img_type = request.args.get("type", "backgrounds")
    if img_type not in ("avatars", "backgrounds"):
        img_type = "backgrounds"
    folder = UPLOADS_DIR / img_type
    images = []
    if folder.exists():
        for f in sorted(folder.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
            if f.suffix.lower() in ALLOWED_EXTENSIONS:
                images.append({
                    "path": f"/uploads/{img_type}/{f.name}",
                    "name": f.name,
                    "size": f.stat().st_size
                })
    return jsonify(images)


@app.route("/api/uploads/cleanup", methods=["POST"])
def uploads_cleanup():
    """Delete unreferenced uploaded files."""
    # Collect all referenced paths from data files
    import glob as _glob
    refs = set()

    # Scan all JSON data files for /uploads/ references
    for json_file in _glob.glob(str(DATA_DIR / "*.json")):
        try:
            content = Path(json_file).read_text(encoding="utf-8")
            for match in re.finditer(r'"/uploads/([^"]+)"', content):
                refs.add(f"/uploads/{match.group(1)}")
            # Also match single-quoted
            for match in re.finditer(r"'/uploads/([^']+)'", content):
                refs.add(f"/uploads/{match.group(1)}")
        except Exception:
            pass

    # Also scan all album and diary JSONs
    for subdir in ("albums", "diaries"):
        subpath = DATA_DIR / subdir
        if subpath.exists():
            for f in subpath.glob("*.json"):
                try:
                    content = f.read_text(encoding="utf-8")
                    for match in re.finditer(r'"/uploads/([^"]+)"', content):
                        refs.add(f"/uploads/{match.group(1)}")
                    for match in re.finditer(r"'/uploads/([^']+)'", content):
                        refs.add(f"/uploads/{match.group(1)}")
                except Exception:
                    pass

    # Collect all uploaded files
    deleted = 0
    for folder_name in ("avatars", "backgrounds"):
        folder = UPLOADS_DIR / folder_name
        if not folder.exists():
            continue
        for f in folder.iterdir():
            if f.is_file():
                file_path = f"/uploads/{folder_name}/{f.name}"
                if file_path not in refs:
                    f.unlink()
                    deleted += 1

    return jsonify({"status": "ok", "deleted": deleted})


# ─── photo album CRUD ───────────────────────────────────────────

ALBUMS_DIR = DATA_DIR / "albums"


@app.route("/api/albums/<char_id>", methods=["GET", "POST"])
def album(char_id):
    ALBUMS_DIR.mkdir(parents=True, exist_ok=True)
    path = ALBUMS_DIR / f"{char_id}.json"

    if request.method == "GET":
        return jsonify(read_json(path, []))

    # POST: add photo
    data = request.get_json(force=True)
    album = read_json(path, [])
    album.append({
        "url": data.get("url", ""),
        "caption": data.get("caption", ""),
        "date": datetime.now().isoformat()
    })
    write_json(path, album)
    return jsonify({"status": "ok", "album": album})


@app.route("/api/albums/<char_id>/<int:idx>", methods=["DELETE"])
def album_delete(char_id, idx):
    path = ALBUMS_DIR / f"{char_id}.json"
    album = read_json(path, [])
    if 0 <= idx < len(album):
        album.pop(idx)
        write_json(path, album)
        return jsonify({"status": "ok"})
    return jsonify({"error": "index out of range"}), 400


# ─── music ───────────────────────────────────────────────────────

MUSIC_DIR = BASE_DIR / "music"

@app.route("/api/music", methods=["GET"])
def list_music():
    """List all music files in the music folder."""
    MUSIC_DIR.mkdir(parents=True, exist_ok=True)
    music_exts = {".mp3", ".wav", ".ogg", ".flac", ".m4a", ".webm"}
    files = []
    for f in sorted(MUSIC_DIR.iterdir()):
        if f.suffix.lower() in music_exts:
            files.append({"name": f.name, "url": f"/music/{f.name}"})
    return jsonify(files)

@app.route("/api/music", methods=["POST"])
def upload_music():
    """Upload music file to the music folder."""
    MUSIC_DIR.mkdir(parents=True, exist_ok=True)
    if "file" not in request.files:
        return jsonify({"status": "error", "message": "没有文件"}), 400
    file = request.files["file"]
    if not file.filename:
        return jsonify({"status": "error", "message": "文件名为空"}), 400
    ext = Path(file.filename).suffix.lower()
    if ext not in {".mp3", ".wav", ".ogg", ".flac", ".m4a"}:
        return jsonify({"status": "error", "message": "不支持的音频格式"}), 400
    file.save(MUSIC_DIR / file.filename)
    return jsonify({"status": "ok", "url": f"/music/{file.filename}"})


# ─── diary CRUD ─────────────────────────────────────────────────

DIARIES_DIR = DATA_DIR / "diaries"


@app.route("/api/diaries/<chat_id>", methods=["GET", "POST"])
def diaries(chat_id):
    DIARIES_DIR.mkdir(parents=True, exist_ok=True)
    path = DIARIES_DIR / f"{chat_id}.json"

    if request.method == "GET":
        return jsonify(read_json(path, []))

    # POST: add diary entry
    data = request.get_json(force=True)
    diary_list = read_json(path, [])
    entry = {
        "id": f"diary_{uuid.uuid4().hex[:10]}",
        "date": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "content": data.get("content", ""),
        "background": data.get("background", ""),
        "bg_opacity": data.get("bg_opacity", 85),
        "visible_to": data.get("visible_to", []),
        "message_count": data.get("message_count", 0)
    }
    diary_list.append(entry)
    write_json(path, diary_list)
    return jsonify({"status": "ok", "entry": entry})


@app.route("/api/diaries/<chat_id>/<diary_id>", methods=["PUT", "DELETE"])
def diary_detail(chat_id, diary_id):
    path = DIARIES_DIR / f"{chat_id}.json"
    diary_list = read_json(path, [])

    if request.method == "PUT":
        data = request.get_json(force=True)
        for d in diary_list:
            if d["id"] == diary_id:
                if "background" in data:
                    d["background"] = data["background"]
                if "bg_opacity" in data:
                    d["bg_opacity"] = data["bg_opacity"]
                if "visible_to" in data:
                    d["visible_to"] = data["visible_to"]
                write_json(path, diary_list)
                return jsonify({"status": "ok", "entry": d})
        return jsonify({"error": "not found"}), 404

    # DELETE
    diary_list = [d for d in diary_list if d["id"] != diary_id]
    write_json(path, diary_list)
    return jsonify({"status": "ok"})


@app.route("/api/diaries/visible/<char_id>", methods=["GET"])
def diaries_visible(char_id):
    """Return all diary entries visible to the given character across all chats."""
    DIARIES_DIR.mkdir(parents=True, exist_ok=True)
    results = []
    for f in sorted(DIARIES_DIR.glob("*.json")):
        entries = read_json(f, [])
        chat_id = f.stem
        # Find the owner character name
        char = get_character(chat_id.replace("private_", ""))
        owner_name = char["name"] if char else chat_id
        for entry in entries:
            if char_id in entry.get("visible_to", []):
                results.append({
                    "chat_id": chat_id,
                    "owner_name": owner_name,
                    "date": entry.get("date", ""),
                    "content": entry.get("content", "")
                })
    return jsonify(results)


@app.route("/api/diaries/<chat_id>/generate", methods=["POST"])
def diary_generate(chat_id):
    """AI generates a diary entry from recent conversation."""
    data = request.get_json(force=True)
    messages = data.get("messages", [])
    api_key = data.get("api_key", "")
    base_url = data.get("base_url", "https://api.deepseek.com/v1")
    model = data.get("model", "deepseek-chat")
    char_name = data.get("character_name", "AI")

    if not messages or not api_key:
        return jsonify({"error": "缺少必要参数"}), 400

    system_prompt = (
        f"你是{char_name}。请以{char_name}的第一人称视角，"
        f"根据今天的聊天记录写一篇日记（150-300字）。\n"
        f"日记风格要完全符合{char_name}的性格和说话方式，"
        f"像{char_name}本人写的日记一样。\n"
        f"内容包括：今天和主人/朋友聊了什么、有什么有趣的事、{char_name}自己的想法和感受。\n"
        f"用中文写，保持{char_name}一贯的语气和风格。"
    )

    ctx = [{"role": "system", "content": system_prompt}]
    for m in messages[-30:]:
        role = "user" if m["role"] == "user" else "assistant"
        speaker = "主人" if role == "user" else char_name
        ctx.append({"role": "user", "content": f"[{speaker}]: {m['content']}"})

    ctx.append({"role": "user", "content": f"请以{char_name}的口吻，根据以上对话写一篇今天的日记。"})

    try:
        full = ""
        gen = stream_ai_response(ctx, api_key, base_url, model, system_prompt, 0.8)
        for chunk in gen:
            if chunk.startswith("data: ") and "[DONE]" not in chunk:
                try:
                    d = json.loads(chunk[6:].strip())
                    full += d.get("delta", "")
                except json.JSONDecodeError:
                    pass

        if not full:
            return jsonify({"error": "生成失败"}), 500

        # Save diary
        DIARIES_DIR.mkdir(parents=True, exist_ok=True)
        path = DIARIES_DIR / f"{chat_id}.json"
        diary_list = read_json(path, [])
        entry = {
            "id": f"diary_{uuid.uuid4().hex[:10]}",
            "date": datetime.now().strftime("%Y-%m-%d %H:%M"),
            "content": full.strip(),
            "background": "",
            "bg_opacity": 85,
            "visible_to": [],
            "message_count": len(messages)
        }
        diary_list.append(entry)
        write_json(path, diary_list)
        return jsonify({"status": "ok", "entry": entry})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ─── diary auto counter ──────────────────────────────────────────

DIARY_COUNTERS = DATA_DIR / "diary_counters.json"

def _get_diary_counter(chat_id):
    counters = read_json(DIARY_COUNTERS, {})
    if chat_id not in counters:
        settings = read_json(DATA_DIR / "settings.json", {})
        base = settings.get("diary_base", 40)
        extra = settings.get("diary_random", 20)
        threshold = base + random.randint(0, max(0, extra))
        counters[chat_id] = {"counter": 0, "threshold": threshold}
        write_json(DIARY_COUNTERS, counters)
    return counters

def _save_diary_counter(chat_id, counter, threshold):
    counters = read_json(DIARY_COUNTERS, {})
    counters[chat_id] = {"counter": counter, "threshold": threshold}
    write_json(DIARY_COUNTERS, counters)


@app.route("/api/diaries/tick/<chat_id>", methods=["POST"])
def diary_tick(chat_id):
    """Increment diary counter. Auto-generate if threshold reached."""
    data = request.get_json(force=True) or {}
    counters = _get_diary_counter(chat_id)
    c = counters[chat_id]
    c["counter"] += 1

    if c["counter"] >= c["threshold"] and data.get("api_key"):
        # Generate diary via AI
        messages = data.get("messages", [])
        char_name = data.get("character_name", "AI")
        api_key = data["api_key"]
        base_url = data.get("base_url", "https://api.deepseek.com/v1")
        model = data.get("model", "deepseek-chat")

        system_prompt = (
            f"你是{char_name}。请以{char_name}的第一人称视角，"
            f"根据今天的聊天记录写一篇日记（150-300字）。\n"
            f"日记风格要完全符合{char_name}的性格和说话方式，"
            f"像{char_name}本人写的日记一样。\n"
            f"内容包括：今天和主人/朋友聊了什么、有什么有趣的事、{char_name}自己的想法和感受。\n"
            f"用中文写，保持{char_name}一贯的语气和风格。"
        )

        ctx = [{"role": "system", "content": system_prompt}]
        for m in messages[-30:]:
            role = "user" if m.get("role") == "user" else "assistant"
            speaker = "主人" if role == "user" else char_name
            ctx.append({"role": "user", "content": f"[{speaker}]: {m.get('content', '')}"})
        ctx.append({"role": "user", "content": f"请以{char_name}的口吻，根据以上对话写一篇今天的日记。"})

        try:
            full = ""
            gen = stream_ai_response(ctx, api_key, base_url, model, system_prompt, 0.8)
            for chunk in gen:
                if chunk.startswith("data: ") and "[DONE]" not in chunk:
                    try:
                        d = json.loads(chunk[6:].strip())
                        full += d.get("delta", "")
                    except json.JSONDecodeError:
                        pass

            if full:
                DIARIES_DIR.mkdir(parents=True, exist_ok=True)
                path = DIARIES_DIR / f"{chat_id}.json"
                diary_list = read_json(path, [])
                entry = {
                    "id": f"diary_{uuid.uuid4().hex[:10]}",
                    "date": datetime.now().strftime("%Y-%m-%d %H:%M"),
                    "content": full.strip(),
                    "background": "",
                    "bg_opacity": 85,
                    "visible_to": [],
                    "message_count": len(messages)
                }
                diary_list.append(entry)
                write_json(path, diary_list)

                # Reset counter + new random threshold
                settings = read_json(DATA_DIR / "settings.json", {})
                base = settings.get("diary_base", 40)
                extra = settings.get("diary_random", 20)
                new_threshold = base + random.randint(0, max(0, extra))
                _save_diary_counter(chat_id, 0, new_threshold)
                return jsonify({"generated": True, "entry": entry,
                                "counter": 0, "threshold": new_threshold})
        except Exception:
            pass

    # Not yet triggered — save counter
    _save_diary_counter(chat_id, c["counter"], c["threshold"])
    return jsonify({"generated": False, "counter": c["counter"],
                    "threshold": c["threshold"]})


# ─── reset to defaults ──────────────────────────────────────────

@app.route("/api/reset", methods=["POST"])
def reset_all():
    """Reset all settings, characters, groups to defaults."""
    import shutil

    # Reset settings
    write_json(DATA_DIR / "settings.json", {
        "api_key": "", "base_url": "https://api.deepseek.com/v1",
        "model": "deepseek-chat", "chat_background": "",
        "ai_bubble_color": "#EDE4FF", "user_bubble_color": "#FFB6C1",
        "font_size": 15, "messages_per_page": 20
    })

    # Reset characters to presets
    write_json(DATA_DIR / "characters.json", [
        {"id": "neko-chan", "name": "Neko酱", "avatar": "",
         "system_prompt": "你是一只可爱的猫娘，名字叫Neko酱。你活泼可爱，喜欢对主人撒娇。说话时必须带\"nya~\"口癖，经常使用颜文字如 (=^･ω･^=)、ฅ^•ﻌ•^ฅ 等。你好奇心旺盛，像猫一样对什么都感兴趣。回答要温暖可爱，偶尔调皮。",
         "model": None, "temperature": 0.9},
        {"id": "kitsune", "name": "狐仙大人", "avatar": "",
         "system_prompt": "你是一位优雅的千年狐仙，名为狐仙大人。你博学多识，说话带有古风韵味但不晦涩。你表面上高冷，内心其实很关心人。偶尔会露出腹黑的一面捉弄对方。会自称\"本仙\"。",
         "model": None, "temperature": 0.85},
        {"id": "usagi", "name": "兔兔", "avatar": "",
         "system_prompt": "你是一只温柔的兔娘，名字叫兔兔。你性格害羞内向，很容易脸红。说话轻声细语，喜欢用\"...\"和\"那个...\"开头。你很会照顾人，会温柔地关心对方。说话结尾偶尔用\"ぴょん~\"。",
         "model": None, "temperature": 0.85},
        {"id": "shiro", "name": "小白", "avatar": "",
         "system_prompt": "你是一只元气满满的犬系少女，名叫小白。你忠诚直率，充满热情，看到主人会摇尾巴（比喻）。你有点天然呆，经常理解错意思但很可爱。说话直来直去，经常用\"汪！\"结尾。",
         "model": None, "temperature": 0.9}
    ])

    # Reset groups
    write_json(DATA_DIR / "groups.json", [
        {"id": "cat-cafe", "name": "猫咖闲聊群", "avatar": "",
         "type": "group", "members": ["neko-chan", "kitsune", "usagi"]}
    ])

    # Reset user profile
    write_json(DATA_DIR / "user_profile.json", {"name": "我", "avatar": ""})

    # Clear chats index
    write_json(DATA_DIR / "chats_index.json", [])

    # Clear history
    if HISTORY_DIR.exists():
        shutil.rmtree(HISTORY_DIR)
        HISTORY_DIR.mkdir()

    # Clear diaries
    diaries_dir = DATA_DIR / "diaries"
    if diaries_dir.exists():
        shutil.rmtree(diaries_dir)
        diaries_dir.mkdir()

    # Clear albums
    albums_dir = DATA_DIR / "albums"
    if albums_dir.exists():
        shutil.rmtree(albums_dir)
        albums_dir.mkdir()

    return jsonify({"status": "ok"})


# ─── import chat history ────────────────────────────────────────

@app.route("/api/chats/import", methods=["POST"])
def import_chat():
    """导入聊天记录：追加记忆消息到指定对话"""
    data = request.get_json(force=True)
    chat_id = data.get("chat_id", "")
    content = data.get("content", "")

    if not chat_id or not content:
        return jsonify({"error": "缺少必要字段"}), 400

    entry = get_chat_index(chat_id)
    if not entry:
        # 对话尚未创建（没有历史文件），自动建立
        chat_type = data.get("type", "private")
        mode = data.get("mode", "chat")
        entry = {
            "chat_id": chat_id,
            "type": chat_type,
            "mode": mode,
            "target_id": data.get("target_id", ""),
            "last_message": "",
            "last_time": datetime.now().isoformat(),
            "message_count": 0
        }
        upsert_chat_index(entry)

    # 构建记忆消息
    prefix = "【以下是导入的历史对话记忆，请在后续对话中参考这些内容】\n\n"
    memory_content = prefix + content

    # 写入历史文件
    append_to_history(chat_id, memory_content, "📥导入记忆", "00:00:00")

    # 更新索引
    messages = read_history(chat_id)
    last_msg = messages[-1]["content"][:80] if messages else ""
    entry = get_chat_index(chat_id)
    if entry:
        entry["last_message"] = last_msg
        entry["last_time"] = datetime.now().isoformat()
        entry["message_count"] = len(messages)
        upsert_chat_index(entry)

    return jsonify({
        "status": "ok", "chat_id": chat_id,
        "message_count": len(messages),
        "messages": messages[-20:],  # 返回最近 20 条，前端直接渲染
        "chats": read_json(DATA_DIR / "chats_index.json", [])  # 返回更新后的聊天列表
    })


# ─── test connection ────────────────────────────────────────────

@app.route("/api/test_connection", methods=["POST"])
def test_connection():
    data = request.get_json(force=True)
    api_key = data.get("api_key", "")
    base_url = data.get("base_url", "https://api.deepseek.com/v1")

    try:
        resp = requests.get(
            f"{base_url.rstrip('/')}/models",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=10
        )
        if resp.status_code == 200:
            return jsonify({"status": "ok", "message": "连接成功nya~ ✨"})
        else:
            return jsonify({"status": "error", "message": f"API返回错误: {resp.status_code}"})
    except requests.exceptions.RequestException as e:
        return jsonify({"status": "error", "message": f"连接失败: {str(e)}"})


# ─── main ───────────────────────────────────────────────────────

if __name__ == "__main__":
    print("🐱 NekoChat 启动中nya~")
    print(f"   访问: http://localhost:5000")
    app.run(host="0.0.0.0", port=5000, debug=False, threaded=True)
