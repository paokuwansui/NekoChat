# 🐱 NekoChat — 可爱猫娘多角色AI聊天器

一个画风可爱、功能丰富的AI聊天Web应用。支持多角色私聊、群聊互动、故事模式、日记自动生成、相册朋友圈等。

## ✨ 功能

### 💬 聊天
- **私聊** — 与单个AI角色一对一对话，支持流式打字机效果
- **群聊** — 多个AI角色同框，@指定回复或全员参与，角色间自然互动
- **故事模式** — 多角色叙事，场景描写+动作+心理+对话，适合互动小说

### 🤖 角色管理
- 预设4个可爱角色：Neko酱🐱、狐仙大人🦊、兔兔🐰、小白🐶
- 自定义角色：名称、头像（上传+裁剪定位）、性格Prompt、温度
- 每个角色可设置专属聊天背景

### 👥 群组
- 创建群聊，拉人/踢人
- 预设"猫咖闲聊群"（Neko酱+狐仙大人+兔兔）

### 🎨 外观自定义
- 全局/角色专属聊天背景（上传+裁剪定位）
- 背景透明度调节
- AI/用户气泡颜色自定义
- 字体大小调节

### 📔 日记
- 每20-40轮对话自动生成日记（以角色口吻）
- 支持手动生成
- 每篇日记可设独立背景+可见角色
- 📤 分享日记到私聊或群聊

### 📷 相册（朋友圈）
- 每个角色独立相册
- 上传照片+配文
- 点击放大+滚轮缩放

### 📥 导入/导出
- 对话历史导出为 .txt
- 从 .txt 文件导入恢复对话

### 🔄 一键还原
- 三层确认 → 重置所有设置到初始状态

### 🌸 视觉
- 樱花粒子飘落特效
- 圆角气泡+滑入动画
- 头像点击放大+滚轮缩放
- 响应式布局（桌面/平板/手机）

## 🚀 快速开始

```bash
cd NekoChat
pip install flask requests
python app.py
```

访问 **http://localhost:5000**

首次使用：点右上角 ⚙️ 设置 → 填入 DeepSeek API Key

## 📁 项目结构

```
NekoChat/
├── app.py                  # Flask 后端（所有API）
├── data/                   # 数据文件
│   ├── settings.json       # 全局设置
│   ├── user_profile.json   # 用户信息
│   ├── characters.json     # 角色定义
│   ├── groups.json         # 群组定义
│   ├── chats_index.json    # 聊天列表索引
│   ├── diaries/            # 日记数据
│   └── albums/             # 相册数据
├── history/                # 聊天记录 .txt 文件
├── uploads/                # 上传图片
│   ├── avatars/
│   └── backgrounds/
└── static/
    ├── templates/index.html
    ├── css/style.css
    └── js/
        ├── app.js          # 全局状态+初始化
        ├── chat.js         # 聊天SSE流式+群聊+故事
        ├── chatlist.js     # 聊天列表+联系人视图
        ├── contacts.js     # 角色/群组/故事管理
        ├── settings.js     # 设置面板
        ├── gallery.js      # 图片选择器+相册
        ├── diary.js        # 日记生成+查看+分享
        ├── crop.js         # 图片裁剪定位器
        └── particles.js    # 樱花粒子特效
```

## 🔧 API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/chat/private` | POST | 私聊/故事 SSE流式 |
| `/api/chat/group` | POST | 群聊多角色顺序SSE |
| `/api/characters` | GET/POST | 角色列表/创建 |
| `/api/characters/<id>` | PUT/DELETE | 角色编辑/删除 |
| `/api/groups` | GET/POST | 群组列表/创建 |
| `/api/groups/<id>` | PUT/DELETE | 群组编辑/删除 |
| `/api/settings` | GET/POST | 全局设置 |
| `/api/chats` | GET | 聊天列表 |
| `/api/chats/<id>` | GET/DELETE | 聊天历史/删除 |
| `/api/chats/import` | POST | 导入对话 |
| `/api/diaries/<id>` | GET/POST | 日记列表/创建 |
| `/api/diaries/<id>/generate` | POST | AI生成日记 |
| `/api/albums/<id>` | GET/POST | 相册列表/添加 |
| `/api/upload` | POST | 上传图片 |
| `/api/uploads/list` | GET | 图片库列表 |
| `/api/reset` | POST | 一键还原 |
| `/api/test_connection` | POST | 测试API连接 |

## 🎯 技术栈

- Python 3 + Flask
- 原生 HTML/CSS/JS（无前端框架）
- DeepSeek API（OpenAI兼容格式）
- SSE 流式响应
- JSON + TXT 本地存储
