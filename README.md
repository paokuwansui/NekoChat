# 🐱 NekoChat — 可爱猫娘多角色 AI 聊天器

一个画风可爱、功能丰富的 AI 聊天 Web 应用。支持多角色私聊、群聊互动、故事模式叙事、AI 日记自动生成、相册、背景音乐等。

纯前端原生 HTML/CSS/JS，后端 Flask + JSON 文件存储，零数据库依赖，开箱即用。


（角色定义提示词，头像图片，聊天背景，相册都可以自定义哦，具体玩法请自己探索）

## ✨ 功能概览

### 💬 三种聊天模式

| 模式 | 说明 |
|------|------|
| **私聊** | 与单个 AI 角色一对一对话，SSE 打字机流式效果 |
| **群聊** | 多角色同框，@指定回复或全员参与，逐人顺序回复（模拟真实群聊节奏） |
| **故事** | 多角色叙事模式，融合场景/动作/心理/对话，适合互动小说 |

### 🤖 角色系统

- 预设 4 个可爱角色：**Neko酱** 🐱、**狐仙大人** 🦊、**兔兔** 🐰、**小白** 🐶
- 自定义角色：名称、头像（上传+裁剪）、性格 System Prompt、Temperature、专属聊天背景

### 👥 群组管理

- 创建/编辑/删除群聊，拉人/踢人
- 群头像、群聊天背景
- 预设 "猫咖闲聊群"（Neko酱 + 狐仙大人 + 兔兔）

### 📖 故事模式

- 选择多个角色参与叙事
- 自定义故事标题、头像、世界观设定
- 6 种叙事风格：自然流畅、轻松欢快、史诗奇幻、温馨日常、悬疑惊悚、浪漫唯美
- 统一叙述者视角，自动编排角色对话和动作

### 📔 AI 日记

- 每 N 轮对话自动生成日记（以角色第一人称口吻，150-300 字）
- 可配置触发轮数：基础轮数 + 随机额外轮数（默认 40~60 轮）
- 手动生成日记
- 每篇日记可设独立背景图片 + 透明度 + 可见角色
- 分享日记到私聊或群聊（自动预填消息）

### 📷 相册

- 每个聊天独立相册（支持图片、视频、音频）
- 上传照片 + 配文
- 点击放大 + 滚轮缩放 + 键盘左右翻页
- 批量上传

### 🎵 背景音乐

- 上传本地音频文件（mp3/wav/ogg/flac/m4a）
- 播放列表，三种循环模式（全部/单首/不循环）
- 音量调节

### 🎨 外观自定义

| 设置 | 说明 |
|------|------|
| 聊天背景 | 全局背景 / 角色专属背景 / 故事背景，上传+裁剪定位 |
| 背景透明度 | 0-95% 滑块 |
| 气泡颜色 | AI 气泡 + 用户气泡颜色选择器 |
| 气泡透明度 | 20-100% 滑块 |
| 字体大小 | 12-20px 滑块 |

### 📥 导入/导出

- 对话历史导出为 .txt 文件
- 从 .txt 文件导入恢复对话
- 聊天菜单：导出、导入、清空聊天、删除对话

### 🔄 撤销 & 还原

- **撤销上轮对话**：删去刚才的用户消息 + AI 回复，日记计数器回退
- **一键还原**：三层确认 → 重置所有设置/角色/群组/历史/日记/相册到初始状态

### 🌸 视觉特效

- 樱花粒子飘落 Canvas 特效
- 圆角气泡 + 滑入动画
- 头像/相册图片点击放大 + 滚轮缩放
- 响应式布局（桌面/平板/手机）

---

### 初始界面展示
#### 私聊界面
<img width="2553" height="1151" alt="屏幕截图 2026-08-01 233254" src="https://github.com/user-attachments/assets/5dbf2367-f177-45ad-b4d1-92cb7fcfc1ba" />
#### 群聊界面
<img width="2541" height="1155" alt="屏幕截图 2026-08-01 233400" src="https://github.com/user-attachments/assets/b048dbb9-006a-40f8-a12b-c7d1d3591c80" />

#### 相册
<img width="917" height="729" alt="屏幕截图 2026-08-01 233417" src="https://github.com/user-attachments/assets/e059c355-b88a-4943-8372-ea06da3d1ed3" />

#### 日记
<img width="1657" height="983" alt="屏幕截图 2026-08-01 233436" src="https://github.com/user-attachments/assets/1b6d0a64-6cc3-4dc5-9172-cdaab87cd989" />


## 🚀 快速开始

### 环境要求

- Python 3.8+
- pip

### 安装 & 运行

```bash
cd NekoChat
pip install flask requests
python app.py
```

访问 **http://localhost:5000**

### 首次使用

1. 点击右上角 ⚙️ → **设置**
2. 填入 DeepSeek API Key（或任何 OpenAI 兼容 API）
3. 确认 Base URL 和模型名称
4. 点击 🧪 测试连接
5. 💾 保存，开始聊天！

> 默认 Base URL: `https://api.deepseek.com/v1`，模型: `deepseek-chat`

---

## 📁 项目结构

```
NekoChat/
├── app.py                      # Flask 后端（所有 API，1365 行）
├── requirements.txt            # Python 依赖
├── static/
│   ├── templates/
│   │   └── index.html          # 单页 HTML（聊天区+设置面板+全部模态框）
│   ├── css/
│   │   └── style.css           # 全局样式（樱花粉主题，773 行）
│   └── js/
│       ├── app.js              # 全局状态、初始化、API 封装、设置生效
│       ├── chat.js             # 聊天核心：SSE 流式处理（私聊/群聊/故事）
│       ├── chatlist.js         # 聊天列表 + 故事列表 + 联系人视图
│       ├── contacts.js         # 角色/群组/故事 CRUD、拉人进群
│       ├── diary.js            # 日记自动生成、查看、设置、分享
│       ├── gallery.js          # 图片选择器 + 相册管理（支持视频/音频）
│       ├── settings.js         # 设置面板、音乐播放器、角色/群组/故事管理
│       ├── crop.js             # 图片裁剪定位工具
│       └── particles.js        # Canvas 樱花粒子特效
├── data/
│   ├── settings.json           # 全局设置（API key、外观等）
│   ├── user_profile.json       # 用户资料（昵称）
│   ├── characters.json         # 角色定义
│   ├── groups.json             # 群组定义
│   ├── chats_index.json        # 聊天列表索引
│   ├── diary_counters.json     # 日记自动生成计数器
│   ├── diaries/                # 日记数据（按 chat_id 分文件）
│   └── albums/                 # 相册数据（按 chat_id/char_id 分文件）
├── history/                    # 聊天记录 .txt 文件
├── music/                      # 用户上传的音频文件
└── uploads/
    ├── avatars/                # 上传的头像图片
    └── backgrounds/            # 上传的背景图片
```

---

## 🔧 API 端点

### 聊天

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/chat/private` | POST | 私聊 / 故事模式 SSE 流式 |
| `/api/chat/group` | POST | 群聊多角色顺序 SSE（非流式→逐人推送） |
| `/api/chats/register` | POST | 注册新聊天索引（不触发 AI） |

### 角色 & 群组

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/characters` | GET / POST | 角色列表 / 创建 |
| `/api/characters/<id>` | PUT / DELETE | 角色编辑 / 删除 |
| `/api/groups` | GET / POST | 群组列表 / 创建 |
| `/api/groups/<id>` | PUT / DELETE | 群组编辑 / 删除 |
| `/api/groups/<id>/members` | GET | 获取群组成员详情 |

### 聊天管理

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/chats` | GET | 聊天列表（按最后消息时间排序） |
| `/api/chats/<id>` | GET / PUT / DELETE | 分页获取历史 / 更新元数据 / 删除（含历史文件+相册+日记计数器） |
| `/api/chats/<id>/undo` | POST | 撤销上轮对话 |
| `/api/chats/import` | POST | 从 txt 内容导入聊天 |

### 日记

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/diaries/<chat_id>` | GET / POST | 日记列表 / 手动添加 |
| `/api/diaries/<chat_id>/<diary_id>` | PUT / DELETE | 编辑日记设置 / 删除 |
| `/api/diaries/<chat_id>/generate` | POST | AI 生成一篇日记 |
| `/api/diaries/tick/<chat_id>` | POST | 计数器 +1，达到阈值自动生成 |
| `/api/diaries/visible/<char_id>` | GET | 获取某角色可见的所有日记（跨聊天） |

### 相册

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/albums/<id>` | GET / POST | 获取相册 / 添加照片 |
| `/api/albums/<id>/<idx>` | DELETE | 删除指定照片 |

### 上传 & 音乐

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/upload` | POST | 上传图片/文件（10MB 限制） |
| `/api/uploads/list` | GET | 图片库列表（按类型过滤） |
| `/api/uploads/cleanup` | POST | 清理未被引用的上传文件 |
| `/api/music` | GET / POST | 音乐列表 / 上传音乐 |

### 设置

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/settings` | GET / POST | 全局设置（API key 脱敏返回） |
| `/api/user_profile` | GET / POST | 用户资料 |
| `/api/test_connection` | POST | 测试 API 连接 |
| `/api/reset` | POST | 一键还原所有数据 |

---

## 🎯 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Python 3 + Flask（单文件） |
| 前端 | 原生 HTML/CSS/JS，零框架依赖 |
| AI API | DeepSeek API（OpenAI 兼容格式，可替换为其他兼容提供商） |
| 通信 | SSE（Server-Sent Events）流式响应 |
| 存储 | JSON 文件（配置/数据） + TXT 文件（聊天历史） |
| 字体 | ZCOOL XiaoWei（正文）+ ZCOOL KuaiLe（展示），Google Fonts |
| 特效 | Canvas 2D 粒子系统 |

## ⚙️ 配置说明

所有数据存储在 `data/` 目录下，纯 JSON 文本格式，可直接手动编辑：

- `settings.json` — API Key、Base URL、模型、外观设置
- `characters.json` — 角色定义（id/name/avatar/system_prompt/temperature）
- `groups.json` — 群组（id/name/members/avatar）
- `user_profile.json` — 用户昵称

聊天历史在 `history/` 下以 `{chat_id}.txt` 格式存储，格式为：
```
=== NekoChat Private Chat (聊天模式): 我 & Neko酱 ===
[12:34:56] 我: 你好呀
[12:35:02] Neko酱: 主人好呀 nya~ (=^･ω･^=)
```
