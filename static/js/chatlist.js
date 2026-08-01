/* ═══════════════════════════════════════════════
   NekoChat — chatlist.js: 聊天列表 & 联系人视图
   ═══════════════════════════════════════════════ */

function renderChatList(filter = '') {
  const container = document.getElementById('chat-list-container');
  const tab = AppState.currentTab;

  if (tab === 'chats') {
    renderChats(container, filter);
  } else if (tab === 'stories') {
    renderStories(container, filter);
  } else {
    renderContacts(container, filter);
  }
}

// ── Stories View ─────────────────────────────────
function renderStories(container, filter) {
  let chats = [...AppState.chats].filter(c => c.type === 'story').sort((a, b) =>
    (b.last_time || '').localeCompare(a.last_time || '')
  );

  if (filter) {
    const q = filter.toLowerCase();
    chats = chats.filter(c => {
      const name = c.title || c.chat_id;
      return name.toLowerCase().includes(q) || (c.last_message || '').toLowerCase().includes(q);
    });
  }

  if (chats.length === 0) {
    container.innerHTML = `<div style="text-align:center;padding:40px 20px;color:var(--text-secondary);">
      ${filter ? '没有匹配的故事nya~' : '还没有故事nya~<br>点击 ✨ → 📖 新建故事吧！'}
    </div>`;
    return;
  }

  container.innerHTML = chats.map(c => {
    const isActive = c.chat_id === AppState.activeChat.chat_id;
    const time = formatTime(c.last_time);
    const title = c.title || '未命名故事';
    const storyAv = c.story_avatar;
    const avatarHtml = (storyAv && (storyAv.startsWith('/') || storyAv.startsWith('http')))
      ? getCharAvatar({ id: 'story', avatar: storyAv }) : '📖';
    return `
      <div class="chat-item ${isActive ? 'active' : ''}" data-chat-id="${c.chat_id}"
           onclick="openExistingChat('${c.chat_id}')">
        <div class="chat-item-avatar">${avatarHtml}</div>
        <div class="chat-item-info">
          <div class="chat-item-name"><span class="story-icon">📖</span> ${escapeHtml(title)}</div>
          <div class="chat-item-preview">${escapeHtml(c.last_message || '')}</div>
        </div>
        <div class="chat-item-time">${time}</div>
      </div>
    `;
  }).join('');
}

// ── Chats View ──────────────────────────────────
function renderChats(container, filter) {
  let chats = [...AppState.chats].filter(c => c.type !== 'story').sort((a, b) =>
    (b.last_time || '').localeCompare(a.last_time || '')
  );

  if (filter) {
    const q = filter.toLowerCase();
    chats = chats.filter(c => {
      const target = getChatTarget(c);
      const name = target?.name || c.chat_id;
      return name.toLowerCase().includes(q) || (c.last_message || '').toLowerCase().includes(q);
    });
  }

  if (chats.length === 0) {
    container.innerHTML = `<div style="text-align:center;padding:40px 20px;color:var(--text-secondary);">
      ${filter ? '没有匹配的聊天nya~' : '还没有聊天记录nya~<br>点击 ✨ 开始对话吧！'}
    </div>`;
    return;
  }

  container.innerHTML = chats.map(c => {
    const target = getChatTarget(c);
    const isStory = c.type === 'story';
    const isGroup = c.type === 'group';
    const avatar = getChatAvatar(c);
    const name = isStory ? (c.title || '故事') : (target?.name || '未知');
    const storyIcon = isStory ? '<span class="story-icon">📖</span>' : '';
    const groupIcon = isGroup ? '👥 ' : '';
    const preview = isGroup
      ? (c.last_message || '')
      : (c.last_message || '');
    const time = formatTime(c.last_time);
    const isActive = c.chat_id === AppState.activeChat.chat_id;

    return `
      <div class="chat-item ${isActive ? 'active' : ''}" data-chat-id="${c.chat_id}"
           onclick="openExistingChat('${c.chat_id}')">
        <div class="chat-item-avatar">${avatar}</div>
        <div class="chat-item-info">
          <div class="chat-item-name">${storyIcon}${groupIcon}${escapeHtml(name)}</div>
          <div class="chat-item-preview">${escapeHtml(preview)}</div>
        </div>
        <div class="chat-item-time">${time}</div>
      </div>
    `;
  }).join('');
}

function getChatTarget(chat) {
  if (chat.type === 'group') {
    return AppState.groups.find(g => g.id === chat.target_id);
  }
  return AppState.characters.find(c => c.id === chat.target_id);
}

function formatTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff/60000)}分钟前`;
    if (diff < 86400000) {
      return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    }
    if (diff < 604800000) {
      const days = ['日','一','二','三','四','五','六'];
      return `周${days[d.getDay()]}`;
    }
    return `${d.getMonth()+1}/${d.getDate()}`;
  } catch { return ''; }
}

// ── Contacts View ───────────────────────────────
function renderContacts(container, filter) {
  let chars = AppState.characters;
  let groups = AppState.groups;

  if (filter) {
    const q = filter.toLowerCase();
    chars = chars.filter(c => c.name.toLowerCase().includes(q));
    groups = groups.filter(g => g.name.toLowerCase().includes(q));
  }

  let html = '';

  // Characters
  html += `<div class="contact-section-title">🤖 AI 角色 (${chars.length})</div>`;
  chars.forEach(c => {
    html += `
      <div class="contact-item">
        <div class="contact-item-avatar">${getCharAvatar(c)}</div>
        <div class="contact-item-info">
          <div class="contact-item-name">${escapeHtml(c.name)}</div>
          <div class="contact-item-desc">${escapeHtml((c.system_prompt || '').substring(0, 25))}...</div>
        </div>
        <button class="contact-item-action" onclick="startPrivateChat('${c.id}');event.stopPropagation();">💬 私聊</button>
      </div>
    `;
  });

  // Groups
  html += `<div class="contact-section-title">👥 群聊 (${groups.length})</div>`;
  groups.forEach(g => {
    html += `
      <div class="contact-item" onclick="openExistingChat('group_${g.id}')">
        <div class="contact-item-avatar">${g.avatar ? getCharAvatar({id:g.id,avatar:g.avatar}) : '👥'}</div>
        <div class="contact-item-info">
          <div class="contact-item-name">${escapeHtml(g.name)}</div>
          <div class="contact-item-desc">${(g.members || []).length} 个成员</div>
        </div>
        <button class="contact-item-action" onclick="openExistingChat('group_${g.id}');event.stopPropagation();">💬 进入</button>
      </div>
    `;
  });

  if (!chars.length && !groups.length) {
    html = `<div style="text-align:center;padding:40px 20px;color:var(--text-secondary);">
      没有找到联系人或群组nya~
    </div>`;
  }

  container.innerHTML = html;
}

// ── Open Existing Chat ─────────────────────────
async function openExistingChat(chatId) {
  let chat = AppState.chats.find(c => c.chat_id === chatId);

  // If chat doesn't exist in index yet (new group/story with no history),
  // create it on the fly from chatId pattern
  if (!chat) {
    if (chatId.startsWith('group_')) {
      const groupId = chatId.replace('group_', '');
      const group = AppState.groups.find(g => g.id === groupId);
      if (group) {
        await switchToChat(chatId, 'group', 'chat', group);
        return;
      }
    } else if (chatId.startsWith('private_')) {
      const charId = chatId.replace('private_', '');
      const char = AppState.characters.find(c => c.id === charId);
      if (char) {
        await switchToChat(chatId, 'private', 'chat', char);
        return;
      }
    }
    showToast('对话不存在nya~', 'error');
    return;
  }

  const type = chat.type;
  const mode = chat.mode || 'chat';
  let target;

  if (type === 'group') {
    target = AppState.groups.find(g => g.id === chat.target_id);
  } else if (type === 'story') {
    // Restore story characters from saved ids, fallback to all if missing
    const savedChars = (chat.story_chars || []).map(sc =>
      AppState.characters.find(c => c.id === sc.id)
    ).filter(Boolean);
    target = {
      id: chatId, name: chat.title || '故事',
      _storyBackground: chat.story_background || '',
      _narrativeStyle: chat.narrative_style || '',
      _storyTitle: chat.title || chatId,
      _storyBg: chat.chat_background || '',
      _storyAvatar: chat.story_avatar || '',
      _storyChars: savedChars.length > 0 ? savedChars : AppState.characters
    };
  } else {
    target = AppState.characters.find(c => c.id === chat.target_id);
  }

  if (!target) {
    showToast('角色或群组已不存在', 'error');
    return;
  }

  await switchToChat(chatId, type, mode, target);
}
