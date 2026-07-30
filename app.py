#!/usr/bin/env python3
"""NekoChat — 可爱猫娘多角色聊天器后端"""

import json
import os
import re
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
    path = get_history_path(chat_id)
    if not path.exists():
        return []
    messages = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("==="):
                continue
            # 格式: [HH:MM:SS] 发言人: 内容
            match = re.match(r"\[(\d{2}:\d{2}:\d{2})\]\s+(.+?):\s+(.*)", line)
            if match:
                timestamp, speaker, content = match.groups()
                role = "user" if speaker in (user_name, "我") else "assistant"
                msg = {"role": role, "content": content, "timestamp": timestamp}
                if role == "assistant" and speaker != "AI":
                    msg["character_name"] = speaker
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

        f.write(f"[{timestamp}] {speaker}: {message_text}\n")


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


@app.route("/api/chats/<chat_id>", methods=["GET", "DELETE"])
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
        return jsonify({"status": "ok"})
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

    return jsonify({"status": "ok", "removed": removed})


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
            if full_response:
                char_name = character["name"]
                append_to_history(chat_id, full_response, char_name)
                # 更新聊天索引
                chat_entry = {
                    "chat_id": chat_id,
                    "type": "story" if mode == "story" else "private",
                    "mode": mode,
                    "target_id": character_id,
                    "last_message": full_response[:80],
                    "last_time": datetime.now().isoformat(),
                    "message_count": len(read_history(chat_id))
                }
                if mode == "story":
                    chat_entry["title"] = data.get("title", chat_id)
                    chat_entry["story_background"] = data.get("story_background", "")
                    chat_entry["narrative_style"] = data.get("narrative_style", "")
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

    # 检测 @
    mentioned = extract_mentions(message, group)

    # 确定回复者
    if mentioned:
        responder_ids = mentioned
    else:
        responder_ids = group.get("members", [])[:3]

    responders = [c for cid in responder_ids if (c := get_character(cid))]
    if not responders:
        return jsonify({"error": "没有可回复的角色"}), 400

    # Clean deleted members from group
    valid_ids = {c["id"] for c in responders}
    if set(group.get("members", [])) != valid_ids & set(group.get("members", [])):
        # Some members deleted — update group
        group["members"] = [m for m in group.get("members", []) if m in valid_ids or get_character(m)]
        groups = read_json(DATA_DIR / "groups.json", [])
        for i, g in enumerate(groups):
            if g["id"] == group_id:
                groups[i] = group
                write_json(DATA_DIR / "groups.json", groups)
                break

    # Build member names for prompt
    member_names = ", ".join(c["name"] for c in responders)

    # Shared context — grows as each character replies
    shared_context = []
    for h in history[-10:]:
        role = "assistant" if h.get("role") == "assistant" else "user"
        speaker = h.get("character_name", "我" if role == "user" else "AI")
        shared_context.append({"role": role, "content": f"{speaker}：{h['content']}"})
    shared_context.append({"role": "user", "content": f"我：{message}"})

    # Sequential processing — each character sees previous replies
    import queue as qmod
    result_queue = qmod.Queue()
    all_responses = {}

    def process_sequential():
        for idx, char in enumerate(responders):
            # Build system prompt with interaction awareness
            others = [c["name"] for c in responders if c["id"] != char["id"]]
            others_str = "、".join(others) if others else "其他人"
            system_prompt = (
                f"你是{char['name']}，{char['system_prompt']}\n\n"
                f"你正在一个名叫\"{group['name']}\"的群聊中。群里还有：{others_str}。\n"
                f"群聊规则：\n"
                f"- 用你的角色身份自然地参与群聊讨论\n"
                f"- 可以回应群友说的话，也可以接话、吐槽、赞同或反驳\n"
                f"- 像真实群聊一样互动，不要只回复用户一个人\n"
                f"- 回复要简短自然（2-4句话为宜）\n"
                f"- 如果有人@你，要认真回复"
            )

            # Build context including previous responders' messages
            ctx = [{"role": "system", "content": system_prompt}]
            ctx.extend(shared_context)

            temperature = char.get("temperature", 0.9)
            full = ""
            try:
                gen = stream_ai_response(ctx, api_key, base_url, model, system_prompt, temperature)
                for chunk in gen:
                    if chunk.startswith("data: ") and "[DONE]" not in chunk:
                        try:
                            d = json.loads(chunk[6:].strip())
                            delta = d.get("delta", "")
                            full += delta
                            result_queue.put({
                                "character_id": char["id"],
                                "character_name": char["name"],
                                "delta": delta
                            })
                        except json.JSONDecodeError:
                            pass
                result_queue.put({"character_id": char["id"], "done": True})
            except Exception as e:
                result_queue.put({"character_id": char["id"], "error": str(e), "done": True})

            all_responses[char["id"]] = full

            # Strip any accidental name prefix the AI imitated
            for prefix in [f"[{char['name']}]:", f"{char['name']}：", f"{char['name']}:"]:
                if full.startswith(prefix):
                    full = full[len(prefix):].strip()
                    all_responses[char["id"]] = full
                    break

            # Add this character's response to shared context
            if full:
                shared_context.append({
                    "role": "assistant",
                    "content": f"{char['name']}：{full}"
                })

        # Save all responses to history
        for char in responders:
            full = all_responses.get(char["id"], "")
            if full:
                append_to_history(chat_id, full, char["name"])

        # Update chat index
        last_msg = next(
            (all_responses.get(c["id"], "") for c in responders if all_responses.get(c["id"], "")),
            message
        )
        chat_entry = {
            "chat_id": chat_id,
            "type": "group",
            "mode": "chat",
            "target_id": group_id,
            "last_message": f"{responders[0]['name']}: {last_msg[:50]}" if responders else last_msg[:80],
            "last_time": datetime.now().isoformat(),
            "message_count": len(read_history(chat_id))
        }
        upsert_chat_index(chat_entry)
        result_queue.put({"done_all": True})

    # Run sequential processing in background thread
    thread = threading.Thread(target=process_sequential, daemon=True)
    thread.start()

    def generate():
        while True:
            item = result_queue.get()
            if item.get("done_all"):
                yield "data: [DONE]\n\n"
                break
            elif item.get("done"):
                pass  # individual character done — just continue
            elif item.get("error"):
                yield f"data: {json.dumps({'character_id': item['character_id'], 'error': item['error']}, ensure_ascii=False)}\n\n"
            else:
                yield f"data: {json.dumps(item, ensure_ascii=False)}\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive"
        }
    )


# ─── upload ─────────────────────────────────────────────────────

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
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
                if "visible_to" in data:
                    d["visible_to"] = data["visible_to"]
                write_json(path, diary_list)
                return jsonify({"status": "ok", "entry": d})
        return jsonify({"error": "not found"}), 404

    # DELETE
    diary_list = [d for d in diary_list if d["id"] != diary_id]
    write_json(path, diary_list)
    return jsonify({"status": "ok"})


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
            "visible_to": [],
            "message_count": len(messages)
        }
        diary_list.append(entry)
        write_json(path, diary_list)
        return jsonify({"status": "ok", "entry": entry})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


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
    """Parse a pasted/uploaded chat txt and create a new chat entry."""
    data = request.get_json(force=True)
    chat_id = data.get("chat_id", "")
    chat_type = data.get("type", "private")
    mode = data.get("mode", "chat")
    target_id = data.get("target_id", "")
    content = data.get("content", "")  # raw txt content

    if not chat_id or not content:
        return jsonify({"error": "缺少必要字段"}), 400

    # Write the txt file
    path = HISTORY_DIR / f"{chat_id}.txt"
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

    # Parse messages for the index
    messages = read_history(chat_id)
    last_msg = ""
    if messages:
        last_msg = messages[-1]["content"][:80]

    entry = {
        "chat_id": chat_id,
        "type": chat_type,
        "mode": mode,
        "target_id": target_id,
        "last_message": last_msg,
        "last_time": datetime.now().isoformat(),
        "message_count": len(messages)
    }
    upsert_chat_index(entry)

    # If story type, also save metadata
    if chat_type == "story":
        entry["title"] = data.get("title", "")
        entry["story_background"] = data.get("story_background", "")
        entry["narrative_style"] = data.get("narrative_style", "")
        upsert_chat_index(entry)

    return jsonify({"status": "ok", "chat_id": chat_id, "message_count": len(messages)})


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
