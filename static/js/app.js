/* ═══════════════════════════════════════════════
   NekoChat — app.js: 全局状态 & 初始化
   ═══════════════════════════════════════════════ */

// ── Global State ─────────────────────────────────
const AppState = {
  user: { name: '我', avatar: '' },
  settings: {
    api_key: '', base_url: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat', chat_background: '',
    ai_bubble_color: '#EDE4FF', user_bubble_color: '#FFB6C1',
    font_size: 15, messages_per_page: 20, bg_opacity: 0.85
  },
  characters: [],
  groups: [],
  chats: [],
  activeChat: {
    chat_id: null,
    type: null,       // 'private' | 'story' | 'group'
    mode: null,       // 'chat' | 'story'
    target: null,     // character or group object
    messages: [],
    offset: 0,
    hasMore: false,
    isLoading: false,
    streamingBubbles: {}
  },
  currentTab: 'chats'  // 'chats' | 'contacts'
};

// ── API Helpers ──────────────────────────────────
async function apiGet(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

async function apiPost(url, data) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return resp;
}

async function apiPut(url, data) {
  const resp = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return resp.json();
}

async function apiDelete(url) {
  await fetch(url, { method: 'DELETE' });
}

// ── Style Application ────────────────────────────
function applySettings() {
  const s = AppState.settings;
  document.documentElement.style.setProperty('--user-bubble', s.user_bubble_color);
  document.documentElement.style.setProperty('--ai-bubble', s.ai_bubble_color);
  document.documentElement.style.setProperty('--font-size-base', s.font_size + 'px');
  document.documentElement.style.setProperty('--bg-opacity', (s.bg_opacity || 0.85));

  const chatArea = document.getElementById('chat-area');
  // Per-character or story background overrides global
  const ac = AppState.activeChat;
  const charBg = (ac && ac.target && (ac.target.chat_background || ac.target._storyBg)) || s.chat_background;
  if (charBg) {
    chatArea.style.backgroundImage = `url(${charBg})`;
    chatArea.style.backgroundSize = 'cover';
    chatArea.style.backgroundPosition = 'center';
  } else {
    chatArea.style.backgroundImage = '';
    chatArea.style.backgroundPosition = '';
  }
}

// Apply background with position support
// ── Toast ────────────────────────────────────────
function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast ${type} show`;
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => { toast.className = 'toast hidden'; }, 2500);
}

// ── Modal Helpers ────────────────────────────────
function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
  document.getElementById('overlay').classList.remove('hidden');
}
function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
  document.getElementById('overlay').classList.add('hidden');
}
function closeAllModals() {
  document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
  document.getElementById('overlay').classList.add('hidden');
  document.getElementById('chat-menu-dropdown').classList.add('hidden');
}

// ── Avatar Helpers ───────────────────────────────
function getCharAvatar(char) {
  if (char && char.avatar) {
    // If it looks like a URL path, return img HTML
    if (char.avatar.startsWith('/') || char.avatar.startsWith('http')) {
      return `<img src="${char.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" loading="lazy">`;
    }
    // Return as emoji/text
    return char.avatar;
  }
  const defaults = {
    'neko-chan': '🐱', 'kitsune': '🦊', 'usagi': '🐰', 'shiro': '🐶'
  };
  return (char && defaults[char.id]) || '🤖';
}

// ── Avatar Preview ──────────────────────────────
let _avatarZoom = 1;

function showAvatarPreview(avatarHtml) {
  const overlay = document.getElementById('avatar-preview-overlay');
  const content = document.getElementById('avatar-preview-content');
  _avatarZoom = 1;
  content.innerHTML = avatarHtml;
  content.style.transform = 'scale(1)';
  content.classList.remove('image-preview');
  overlay.classList.remove('hidden');
}

function hideAvatarPreview() {
  document.getElementById('avatar-preview-overlay').classList.add('hidden');
  document.getElementById('avatar-preview-content').classList.remove('image-preview');
}

// Full image preview for album photos
function showImagePreview(url) {
  const overlay = document.getElementById('avatar-preview-overlay');
  const content = document.getElementById('avatar-preview-content');
  _avatarZoom = 1;
  content.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:contain;">`;
  content.style.transform = 'scale(1)';
  content.classList.add('image-preview');
  overlay.classList.remove('hidden');
}

// Wheel zoom on avatar preview
document.addEventListener('wheel', (e) => {
  const overlay = document.getElementById('avatar-preview-overlay');
  if (overlay.classList.contains('hidden')) return;
  e.preventDefault();
  _avatarZoom += e.deltaY < 0 ? 0.15 : -0.15;
  _avatarZoom = Math.max(0.5, Math.min(3, _avatarZoom));
  const content = document.getElementById('avatar-preview-content');
  content.style.transform = `scale(${_avatarZoom})`;
}, { passive: false });

function getChatAvatar(chat) {
  if (chat.type === 'group') {
    const group = AppState.groups.find(g => g.id === chat.target_id);
    if (group && group.avatar) {
      return getCharAvatar({ id: group.id, avatar: group.avatar });
    }
    return '👥';
  }
  const char = AppState.characters.find(c => c.id === chat.target_id);
  return getCharAvatar(char);
}

// ── Init ─────────────────────────────────────────
async function initApp() {
  try {
    const [settings, user, chars, groups, chats] = await Promise.all([
      apiGet('/api/settings'),
      apiGet('/api/user_profile'),
      apiGet('/api/characters'),
      apiGet('/api/groups'),
      apiGet('/api/chats')
    ]);

    AppState.settings = { ...AppState.settings, ...settings };
    AppState.user = user;
    AppState.characters = chars;
    AppState.groups = groups;
    AppState.chats = chats;

    applySettings();
    renderChatList();
    renderWelcomeChars();
    initParticles();

    // If no chats, show welcome
    if (chats.length === 0) {
      document.getElementById('welcome-screen').classList.remove('hidden');
    } else {
      document.getElementById('welcome-screen').classList.add('hidden');
    }

  } catch (err) {
    console.error('Init failed:', err);
    showToast('加载失败，请刷新页面nya~', 'error');
  }
}

function renderWelcomeChars() {
  const container = document.getElementById('welcome-chars');
  container.innerHTML = AppState.characters.map(c => `
    <button class="welcome-char-btn" onclick="startPrivateChat('${c.id}')">
      <span class="wca">${getCharAvatar(c)}</span>
      <span class="wcn">${c.name}</span>
    </button>
  `).join('');
}

// ── Start Private Chat ──────────────────────────
async function startPrivateChat(charId) {
  const char = AppState.characters.find(c => c.id === charId);
  if (!char) return;
  const chatId = `private_${charId}`;
  await switchToChat(chatId, 'private', 'chat', char);
}

// ── Switch Chat ─────────────────────────────────
async function switchToChat(chatId, type, mode, target) {
  AppState.activeChat = {
    chat_id: chatId, type, mode, target,
    messages: [], offset: 0, hasMore: false,
    isLoading: false, streamingBubbles: {}
  };

  // Update header
  updateChatHeader();

  // Clear messages
  document.getElementById('messages-list').innerHTML = '';
  document.getElementById('welcome-screen').classList.add('hidden');
  document.getElementById('load-more-area').classList.add('hidden');

  // Hide @mention button for non-group chats
  const atBtn = document.getElementById('btn-at-mention');
  atBtn.classList.toggle('hidden', type !== 'group');

  // Update chat list active state
  document.querySelectorAll('.chat-item').forEach(el => {
    el.classList.toggle('active', el.dataset.chatId === chatId);
  });

  // Load messages
  await loadMessages(0);

  // Focus input
  document.getElementById('message-input').focus();
  applySettings(); // update background per character
}

function updateChatHeader() {
  const ac = AppState.activeChat;
  const titleEl = document.getElementById('chat-title');
  const subtitleEl = document.getElementById('chat-subtitle');
  const avatarEl = document.getElementById('chat-avatar');
  const badge = document.getElementById('chat-mode-badge');

  if (!ac.target) {
    titleEl.textContent = 'NekoChat';
    subtitleEl.textContent = '';
    avatarEl.innerHTML = '🐱';
    badge.classList.add('hidden');
    document.getElementById('btn-album').classList.add('hidden');
    document.getElementById('btn-diary').classList.add('hidden');
    return;
  }

  if (ac.type === 'group') {
    titleEl.textContent = ac.target.name || '群聊';
    const memberNames = (ac.target.members || [])
      .map(cid => AppState.characters.find(c => c.id === cid)?.name)
      .filter(Boolean).join('、');
    subtitleEl.textContent = memberNames || `${ac.target.members?.length || 0} 个成员`;
    avatarEl.innerHTML = (ac.target.avatar && ac.target.avatar.startsWith('/'))
      ? getCharAvatar({ id: 'group', avatar: ac.target.avatar })
      : '👥';
    badge.classList.add('hidden');
    document.getElementById('btn-invite-member').classList.remove('hidden');
    document.getElementById('btn-album').classList.add('hidden');
  } else if (ac.type === 'story') {
    titleEl.textContent = ac.target.name || '故事';
    subtitleEl.textContent = AppState.activeChat.chat_id ? '故事模式' : '';
    avatarEl.innerHTML = getCharAvatar(ac.target);
    badge.textContent = '📖 故事';
    badge.classList.remove('hidden');
    document.getElementById('btn-invite-member').classList.add('hidden');
    document.getElementById('btn-album').classList.add('hidden');
  } else {
    titleEl.textContent = ac.target.name || 'AI';
    subtitleEl.textContent = '在线';
    avatarEl.innerHTML = getCharAvatar(ac.target);
    badge.classList.add('hidden');
    document.getElementById('btn-invite-member').classList.add('hidden');
    document.getElementById('btn-album').classList.remove('hidden');
    document.getElementById('btn-diary').classList.remove('hidden');
  }
}

// ── Load Messages ───────────────────────────────
async function loadMessages(offset) {
  const ac = AppState.activeChat;
  if (!ac.chat_id) return;

  const limit = AppState.settings.messages_per_page || 20;
  try {
    const data = await apiGet(`/api/chats/${ac.chat_id}?offset=${offset}&limit=${limit}`);
    ac.messages = data.messages;
    ac.hasMore = data.has_more_before;
    renderMessages();
    document.getElementById('load-more-area').classList.toggle('hidden', !ac.hasMore);
  } catch (err) {
    // New chat — no history yet
    ac.messages = [];
    ac.hasMore = false;
  }
}

// ── Render Messages ─────────────────────────────
function renderMessages() {
  const container = document.getElementById('messages-list');
  const ac = AppState.activeChat;

  container.innerHTML = ac.messages.map((msg, i) => {
    const isUser = msg.role === 'user';
    const charName = msg.character_name || (ac.target?.name || 'AI');
    const isStory = ac.mode === 'story';
    const bubbleClass = isUser
      ? 'bubble-user'
      : (isStory ? 'bubble-story' : 'bubble-ai');

    let avatarHtml = '';
    let senderHtml = '';
    if (isUser) {
      senderHtml = `<div class="msg-sender msg-sender-user">${AppState.user.name || '我'}</div>`;
    } else {
      const av = (ac.type === 'group')
        ? getCharAvatar(AppState.characters.find(c => c.name === charName))
        : getCharAvatar(ac.target);
      avatarHtml = `<div class="msg-avatar">${av}</div>`;
      if (ac.type === 'group' || ac.type === 'private') {
        senderHtml = `<div class="msg-sender">${charName}</div>`;
      }
      if (isStory) {
        senderHtml = `<span class="msg-sender-story">${charName}</span>`;
      }
    }
    return `
      <div class="message-row ${isUser ? 'user' : ''}">
        ${avatarHtml}
        <div class="msg-body">
          ${senderHtml}
          <div class="msg-bubble ${bubbleClass}">${escapeHtml(msg.content)}</div>
          <div class="msg-time">${msg.timestamp || ''}</div>
        </div>
      </div>
    `;
  }).join('');

  scrollToBottom();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function scrollToBottom() {
  const container = document.getElementById('messages-container');
  setTimeout(() => { container.scrollTop = container.scrollHeight; }, 50);
}

// ── Add message to DOM ──────────────────────────
function addMessageToDom(role, content, charName, isStory) {
  const container = document.getElementById('messages-list');
  const ac = AppState.activeChat;
  const isUser = role === 'user';
  const bubbleClass = isUser
    ? 'bubble-user'
    : (isStory ? 'bubble-story' : 'bubble-ai');

  let avatarHtml = '';
  let senderHtml = '';
  if (isUser) {
    senderHtml = `<div class="msg-sender msg-sender-user">${AppState.user.name || '我'}</div>`;
  } else {
    const av = charName
      ? getCharAvatar(AppState.characters.find(c => c.name === charName))
      : getCharAvatar(ac.target);
    avatarHtml = `<div class="msg-avatar">${av}</div>`;
    if ((ac.type === 'group' || ac.type === 'private') && charName) {
      senderHtml = `<div class="msg-sender">${charName}</div>`;
    }
    if (isStory) {
      senderHtml = `<span class="msg-sender-story">${charName || ac.target?.name || 'AI'}</span>`;
    }
  }

  const now = new Date();
  const time = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;

  const row = document.createElement('div');
  row.className = `message-row ${isUser ? 'user' : ''}`;
  row.innerHTML = `
    ${avatarHtml}
    <div class="msg-body">
      ${senderHtml}
      <div class="msg-bubble ${bubbleClass}">${escapeHtml(content)}</div>
      <div class="msg-time">${time}</div>
    </div>
  `;
  container.appendChild(row);
  scrollToBottom();
  return row;
}

// ── Create Streaming Bubble ─────────────────────
let _streamCounter = 0;
function createStreamingBubble(charName, charId) {
  const container = document.getElementById('messages-list');
  const sid = charId || 'main';
  const ac = AppState.activeChat;
  const isStory = ac.mode === 'story';
  const bubbleClass = isStory ? 'bubble-story' : 'bubble-ai';

  const av = charName
    ? getCharAvatar(AppState.characters.find(c => c.name === charName))
    : getCharAvatar(ac.target);

  let senderHtml = '';
  if ((ac.type === 'group' || ac.type === 'private') && charName) {
    senderHtml = `<div class="msg-sender">${charName}</div>`;
  }
  if (isStory) {
    senderHtml = `<span class="msg-sender-story">${charName || ac.target?.name}</span>`;
  }

  const row = document.createElement('div');
  row.className = 'message-row';
  const uid = `${sid}-${++_streamCounter}`;
  row.id = `stream-${uid}`;
  row.innerHTML = `
    <div class="msg-avatar">${av}</div>
    <div class="msg-body">
      ${senderHtml}
      <div class="msg-bubble ${bubbleClass}" id="stream-content-${uid}"></div>
      <div class="msg-time"></div>
    </div>
  `;
  container.appendChild(row);
  scrollToBottom();
  return { row, contentEl: row.querySelector('.msg-bubble'), uid };
}

function updateStreamingBubble(contentEl, content) {
  if (contentEl) { contentEl.textContent = content; scrollToBottom(); }
}

// ── Event Bindings ──────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initApp();

  // Overlay click
  document.getElementById('overlay').addEventListener('click', closeAllModals);

  // Panel tabs
  document.querySelectorAll('.panel-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      AppState.currentTab = tab.dataset.tab;
      renderChatList();
    });
  });

  // Search
  document.getElementById('search-input').addEventListener('input', (e) => {
    renderChatList(e.target.value);
  });

  // New chat
  document.getElementById('btn-new-chat').addEventListener('click', () => openModal('modal-new-chat'));
  document.getElementById('btn-toggle-sidebar').addEventListener('click', toggleSidebar);

  // New chat options
  document.querySelector('[data-action="new-private"]').addEventListener('click', () => {
    closeModal('modal-new-chat');
    openPrivatePicker();
  });
  document.querySelector('[data-action="new-story"]').addEventListener('click', () => {
    closeModal('modal-new-chat');
    openStoryCreate();
  });
  document.querySelector('[data-action="new-group"]').addEventListener('click', () => {
    closeModal('modal-new-chat');
    openGroupCreate();
  });

  // Modal close buttons
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });

  // Settings
  document.getElementById('btn-settings').addEventListener('click', openSettings);
  document.getElementById('btn-close-settings').addEventListener('click', closeSettings);

  // Invite member button
  document.getElementById('btn-invite-member').addEventListener('click', openInviteMember);

  // Chat menu
  document.getElementById('btn-chat-menu').addEventListener('click', (e) => {
    e.stopPropagation();
    const dd = document.getElementById('chat-menu-dropdown');
    dd.classList.toggle('hidden');
  });
  document.addEventListener('click', () => {
    document.getElementById('chat-menu-dropdown').classList.add('hidden');
  });

  // Export chat
  document.querySelector('[data-action="export-chat"]').addEventListener('click', async () => {
    const ac = AppState.activeChat;
    if (!ac.chat_id) { showToast('没有可导出的对话', 'error'); return; }
    try {
      const resp = await fetch(`/api/chats/${ac.chat_id}?offset=0&limit=99999`);
      const data = await resp.json();
      const messages = data.messages || [];
      if (messages.length === 0) { showToast('对话为空', 'error'); return; }

      // Build txt content
      const chat = data.chat || {};
      let txt = '';
      if (ac.type === 'story') {
        txt += `=== NekoChat Story: ${chat.title || ac.chat_id} ===\n`;
        txt += `角色: ${ac.target?.name || 'AI'}\n`;
        txt += `背景: ${chat.story_background || ''}\n\n`;
      } else if (ac.type === 'group') {
        txt += `=== NekoChat Group: ${ac.target?.name || '群聊'} ===\n\n`;
      } else {
        txt += `=== NekoChat Private Chat: 我 & ${ac.target?.name || 'AI'} ===\n\n`;
      }
      for (const m of messages) {
        const speaker = m.role === 'user' ? '我' : (m.character_name || ac.target?.name || 'AI');
        txt += `[${m.timestamp || ''}] ${speaker}: ${m.content}\n`;
      }

      const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${ac.chat_id}.txt`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('导出成功nya~ 📥');
    } catch (e) {
      showToast('导出失败: ' + e.message, 'error');
    }
  });

  // Import chat
  document.querySelector('[data-action="import-chat"]').addEventListener('click', () => {
    document.getElementById('import-file-input').click();
  });
  document.getElementById('import-file-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const content = await file.text();
      // Build chat_id from filename
      const chatId = file.name.replace(/\.txt$/i, '') + '_imported_' + Date.now();

      // Determine type from content
      let chatType = 'private';
      let targetId = '';
      const firstLine = content.split('\n')[0] || '';
      if (firstLine.includes('Story')) chatType = 'story';
      else if (firstLine.includes('Group')) chatType = 'group';

      // Find target character from content
      const nameMatch = firstLine.match(/我 & (.+?)===/) || firstLine.match(/角色: (.+)/);
      if (nameMatch && chatType !== 'group') {
        const found = AppState.characters.find(c => c.name === nameMatch[1].trim());
        if (found) targetId = found.id;
      }

      await apiPost('/api/chats/import', {
        chat_id: chatId,
        type: chatType,
        mode: chatType === 'story' ? 'story' : 'chat',
        target_id: targetId,
        content: content
      });

      AppState.chats = await apiGet('/api/chats');
      renderChatList();
      showToast('导入成功nya~ 📤');
    } catch (err) {
      showToast('导入失败: ' + err.message, 'error');
    }
    e.target.value = '';
  });

  document.querySelector('[data-action="clear-chat"]').addEventListener('click', async () => {
    const ac = AppState.activeChat;
    if (ac.chat_id) {
      await apiDelete(`/api/chats/${ac.chat_id}`);
      document.getElementById('messages-list').innerHTML = '';
      ac.messages = [];
      document.getElementById('welcome-screen').classList.remove('hidden');
      showToast('聊天已清空');
    }
  });
  document.querySelector('[data-action="delete-chat"]').addEventListener('click', async () => {
    const ac = AppState.activeChat;
    if (ac.chat_id) {
      await apiDelete(`/api/chats/${ac.chat_id}`);
      AppState.chats = AppState.chats.filter(c => c.chat_id !== ac.chat_id);
      AppState.activeChat = { chat_id: null, type: null, mode: null, target: null,
        messages: [], offset: 0, hasMore: false, isLoading: false, streamingBubbles: {} };
      document.getElementById('messages-list').innerHTML = '';
      document.getElementById('welcome-screen').classList.remove('hidden');
      updateChatHeader();
      renderChatList();
      showToast('对话已删除');
    }
  });

  // Load more
  document.getElementById('btn-load-more').addEventListener('click', async () => {
    const ac = AppState.activeChat;
    const newOffset = ac.offset + AppState.settings.messages_per_page;
    const data = await apiGet(`/api/chats/${ac.chat_id}?offset=${newOffset}&limit=${AppState.settings.messages_per_page}`);
    ac.messages = [...data.messages, ...ac.messages];
    ac.offset = newOffset;
    ac.hasMore = data.has_more_before;
    document.getElementById('load-more-area').classList.toggle('hidden', !ac.hasMore);
    renderMessages();
  });
});

// ── Avatar click: show preview ──────────────────
document.addEventListener('click', (e) => {
  // Close preview overlay on click
  const overlay = document.getElementById('avatar-preview-overlay');
  if (!overlay.classList.contains('hidden') && e.target === overlay) {
    hideAvatarPreview();
    return;
  }

  // Avatar click: find the closest msg-avatar, chat-avatar, or chat-item-avatar
  const avatar = e.target.closest('.msg-avatar, .chat-avatar, .chat-item-avatar');
  if (avatar) {
    // Get the HTML content of the avatar (emoji or img)
    const inner = avatar.innerHTML.trim();
    if (inner) {
      showAvatarPreview(inner);
    }
  }
});

function toggleSidebar() {
  const panel = document.getElementById('left-panel');
  panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
}
