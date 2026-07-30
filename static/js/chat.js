/* ═══════════════════════════════════════════════
   NekoChat — chat.js: 聊天核心 + SSE 流式处理
   ═══════════════════════════════════════════════ */

const inputEl = document.getElementById('message-input');
const sendBtn = document.getElementById('btn-send');
const atBtn = document.getElementById('btn-at-mention');

// ── Send Message ────────────────────────────────
inputEl.addEventListener('keydown', async (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    await sendMessage();
  }
  // Auto-resize
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
});

sendBtn.addEventListener('click', sendMessage);

async function sendMessage() {
  const message = inputEl.value.trim();
  if (!message) return;

  const ac = AppState.activeChat;
  if (!ac.target) {
    showToast('请先选择一个对话nya~', 'error');
    return;
  }
  if (!AppState.settings.api_key) {
    openSettings();
    showToast('请先设置API Key nya~', 'error');
    return;
  }

  // Clear input
  inputEl.value = '';
  inputEl.style.height = 'auto';
  sendBtn.disabled = true;

  // Hide welcome
  document.getElementById('welcome-screen').classList.add('hidden');

  // Add user message to DOM
  addMessageToDom('user', message);
  // Sync to state array
  ac.messages.push({ role: 'user', content: message });

  // Create new chat if needed
  if (!ac.chat_id) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    if (ac.type === 'group') {
      ac.chat_id = `group_${ac.target.id}`;
    } else if (ac.type === 'story') {
      ac.chat_id = `story_${ac.target.id}_${Date.now()}`;
    } else {
      ac.chat_id = `private_${ac.target.id}`;
    }
    updateChatHeader();
  }

  if (ac.type === 'group') {
    await sendGroupMessage(message);
  } else if (ac.type === 'story') {
    await sendStoryMessage(message);
  } else {
    await sendPrivateMessage(message);
  }

  sendBtn.disabled = false;
  inputEl.focus();
}

// ── Private Chat / Story SSE ────────────────────
async function sendPrivateMessage(message) {
  const ac = AppState.activeChat;
  const isStory = ac.mode === 'story';

  // Create streaming bubble
  const { row: streamRow, contentEl: streamContent } = createStreamingBubble(null, 'main');
  streamContent.innerHTML = '<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>';

  // Build context messages
  const contextMessages = ac.messages.slice(-20).map(m => ({
    role: m.role,
    content: m.content
  }));
  contextMessages.push({ role: 'user', content: message });

  try {
    const resp = await fetch('/api/chat/private', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        character_id: ac.target.id,
        chat_id: ac.chat_id,
        mode: ac.mode,
        messages: contextMessages,
        api_key: AppState.settings.api_key,
        base_url: AppState.settings.base_url,
        model: AppState.settings.model,
        story_background: ac.target._storyBackground,
        narrative_style: ac.target._narrativeStyle,
        title: ac.target._storyTitle,
        temperature: ac.target.temperature || 0.9
      })
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: '请求失败' }));
      streamContent.innerHTML = `<span style="color:var(--error)">${err.error || '请求失败，请检查API设置nya~'}</span>`;
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullResponse = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const dataStr = line.slice(6);
          if (dataStr.trim() === '[DONE]') continue;
          try {
            const data = JSON.parse(dataStr);
            if (data.error) {
              streamContent.innerHTML = `<span style="color:var(--error)">${data.error}</span>`;
              return;
            }
            if (data.delta) {
              fullResponse += data.delta;
              streamContent.textContent = fullResponse;
              scrollToBottom();
            }
          } catch (e) { /* skip partial chunks */ }
        }
      }
    }

    // Update time
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
    streamRow.querySelector('.msg-time').textContent = time;

    // Sync AI response to state
    ac.messages.push({ role: 'assistant', content: fullResponse || '(空回复)' });

    // Remove typing dots if empty
    if (!fullResponse) {
      streamContent.innerHTML = '<span style="color:var(--text-secondary)">(空回复)</span>';
    }

    // Refresh chat list
    refreshChatList();

    // Auto diary check
    if (ac.mode !== 'story' && typeof checkDiaryAutoGenerate === 'function') {
      checkDiaryAutoGenerate(ac.chat_id, ac.messages);
    }

  } catch (err) {
    streamContent.innerHTML = `<span style="color:var(--error)">网络错误: ${err.message}</span>`;
  }
}

// ── Group Chat SSE (multi-character) ────────────
async function sendGroupMessage(message) {
  const ac = AppState.activeChat;
  const group = ac.target;

  // Determine responders (will be handled by backend @ detection)
  const history = ac.messages.slice(-10);

  // Create streaming bubbles for each potential responder
  const memberIds = group.members || [];
  const streamingRows = {};

  try {
    const resp = await fetch('/api/chat/group', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        group_id: group.id,
        chat_id: ac.chat_id,
        message: message,
        chat_history: history,
        api_key: AppState.settings.api_key,
        base_url: AppState.settings.base_url,
        model: AppState.settings.model
      })
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: '请求失败' }));
      addMessageToDom('assistant', `群聊请求失败: ${err.error || '未知错误'}`, null, false);
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const responses = {};  // charId -> full text

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const dataStr = line.slice(6);
          if (dataStr.trim() === '[DONE]') continue;
          try {
            const data = JSON.parse(dataStr);
            if (data.error) {
              const char = AppState.characters.find(c => c.id === data.character_id);
              addMessageToDom('assistant', `[${char?.name || 'AI'}] 错误: ${data.error}`, char?.name, false);
              continue;
            }
            if (data.delta && data.character_id) {
              if (!streamingRows[data.character_id]) {
                const char = AppState.characters.find(c => c.id === data.character_id);
                const result = createStreamingBubble(char?.name || data.character_name, data.character_id);
                streamingRows[data.character_id] = { row: result.row, contentEl: result.contentEl };
                result.contentEl.textContent = '';
              }
              responses[data.character_id] = (responses[data.character_id] || '') + data.delta;
              const sr = streamingRows[data.character_id];
              if (sr && sr.contentEl) sr.contentEl.textContent = responses[data.character_id];
              scrollToBottom();
            }
          } catch (e) { /* skip */ }
        }
      }
    }

    // Update times
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
    Object.keys(streamingRows).forEach(cid => {
      const sr = streamingRows[cid];
      if (sr && sr.row) sr.row.querySelector('.msg-time').textContent = time;
    });

    // Sync all group responses to state
    Object.entries(responses).forEach(([cid, text]) => {
      const char = AppState.characters.find(c => c.id === cid);
      ac.messages.push({
        role: 'assistant',
        content: text || '(空回复)',
        character_name: char?.name || cid
      });
    });

    refreshChatList();

  } catch (err) {
    addMessageToDom('assistant', `网络错误: ${err.message}`, null, false);
  }
}

// ── Story Chat (multi-character, single bubble) ──
async function sendStoryMessage(message) {
  const ac = AppState.activeChat;
  const chars = (ac.target && ac.target._storyChars) || [];
  const bg = ac.target._storyBackground || '';
  const style = ac.target._narrativeStyle || '自然流畅';

  if (chars.length === 0) {
    await sendPrivateMessage(message);
    return;
  }

  // Build combined system prompt for all characters
  const charDescriptions = chars.map(c =>
    `【${c.name}】\n性格：${c.system_prompt}\n`
  ).join('\n');
  
  const systemPrompt = `你是一个多角色故事叙述AI。你需要同时扮演以下角色，用他们的口吻回复：

${charDescriptions}

【故事设定】${bg}
【叙事风格】${style}

【格式要求】
- 用以下格式回复，每个角色一段话：
${chars.map(c => `${c.name}：（角色动作/心理描写 + 对话）`).join('\n')}
- 角色之间可以有互动，前面角色说的话可以被后面角色接住
- 整体是叙事风格，包括场景描写和动作描写
- 每个角色2-4句话为宜`;

  const contextMessages = ac.messages.slice(-20).map(m => ({
    role: m.role, content: m.content
  }));
  contextMessages.push({ role: 'user', content: message });

  // Combined avatar + name display
  const avatarsHtml = chars.map(c => getCharAvatar(c)).join('');
  const namesStr = chars.map(c => c.name).join('、');

  // Create ONE streaming bubble with combined header
  const container = document.getElementById('messages-list');
  const row = document.createElement('div');
  row.className = 'message-row';
  
  const avatarDiv = document.createElement('div');
  avatarDiv.className = 'msg-avatar-group';
  avatarDiv.innerHTML = avatarsHtml;
  
  const bodyDiv = document.createElement('div');
  bodyDiv.className = 'msg-body';
  bodyDiv.innerHTML = `
    <div class="msg-sender">${namesStr}</div>
    <div class="msg-bubble bubble-story" id="story-content"></div>
    <div class="msg-time"></div>
  `;
  
  row.appendChild(avatarDiv);
  row.appendChild(bodyDiv);
  container.appendChild(row);
  scrollToBottom();

  const storyContent = document.getElementById('story-content');
  storyContent.innerHTML = '<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>';

  try {
    const resp = await fetch('/api/chat/private', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        character_id: chars[0].id, chat_id: ac.chat_id, mode: 'chat',
        messages: contextMessages,
        api_key: AppState.settings.api_key,
        base_url: AppState.settings.base_url, model: AppState.settings.model,
        temperature: 0.9,
        _system_override: systemPrompt
      })
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: '请求失败' }));
      storyContent.innerHTML = `<span style="color:var(--error)">${err.error}</span>`;
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', fullResponse = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (line.startsWith('data: ') && !line.includes('[DONE]')) {
          try {
            const d = JSON.parse(line.slice(6));
            if (d.delta) { fullResponse += d.delta; storyContent.textContent = fullResponse; scrollToBottom(); }
          } catch (e) {}
        }
      }
    }

    const now = new Date();
    row.querySelector('.msg-time').textContent =
      `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
    if (!fullResponse) storyContent.innerHTML = '<span style="color:var(--text-secondary)">(空回复)</span>';

    ac.messages.push({
      role: 'assistant',
      content: fullResponse || '(空回复)',
      character_name: namesStr
    });

  } catch (err) {
    storyContent.innerHTML = `<span style="color:var(--error)">${err.message}</span>`;
  }

  refreshChatList();
}

// ── Build story prompt helper ───────────────────
function buildStoryPrompt(char, background, style) {
  return `你是${char.name}，${char.system_prompt}

【重要：叙事模式】
你正在参与一个互动故事。请用小说叙事的方式回复，包括：
- 环境描写：场景、氛围、光线、声音等
- 动作描写：角色的肢体动作、表情变化、细节行为
- 心理描写：角色的内心感受和情绪变化
- 对话描写：自然地融入对话，但对话只是叙事的一部分

【背景故事】
${background}

【叙事风格】
${style}

请注意：
- 每次回复控制在2-4段
- 对话和叙事自然地交织在一起
- 保持角色个性，不要OOC
- 用户输入的是"故事中发生的事"，请据此推进剧情`;
}

async function refreshChatList() {
  try {
    AppState.chats = await apiGet('/api/chats');
    renderChatList();
  } catch (e) { /* ignore */ }
}

// ── @mention for group chat ────────────────────
let mentionPopover = null;

// ── Undo last round ─────────────────────────────
document.getElementById('btn-undo').addEventListener('click', undoLastRound);

async function undoLastRound() {
  const ac = AppState.activeChat;
  if (!ac.chat_id) { showToast('没有活跃对话', 'error'); return; }

  try {
    const url = `/api/chats/${ac.chat_id}/undo`;
    const resp = await fetch(url, { method: 'POST' });
    
    let data;
    try {
      data = await resp.json();
    } catch {
      // Not JSON — probably HTML error page
      const text = await resp.text().catch(() => '');
      showToast(`撤销失败: 服务器返回非JSON (${resp.status}) ${text.substring(0,100)}`, 'error');
      return;
    }

    if (data.status !== 'ok') {
      showToast(`撤销失败: ${data.error || '未知错误'} (${resp.status})`, 'error');
      return;
    }

    // Reload from server
    await loadMessages(0);
    
    if (ac.messages.length === 0) {
      document.getElementById('welcome-screen').classList.remove('hidden');
      AppState.activeChat.chat_id = null;
    }
    
    refreshChatList();
    showToast(`已撤销 ${data.removed || ''} 条消息 ↩️`);
  } catch (e) {
    showToast('撤销失败', 'error');
  }
}

atBtn.addEventListener('click', () => {
  showMentionPopover();
});

inputEl.addEventListener('input', () => {
  const val = inputEl.value;
  const cursorPos = inputEl.selectionStart;
  const textBeforeCursor = val.substring(0, cursorPos);
  const atMatch = textBeforeCursor.match(/@([^\s@]*)$/);

  if (atMatch) {
    showMentionPopover(atMatch[1]);
  } else {
    hideMentionPopover();
  }
});

function showMentionPopover(filter = '') {
  const ac = AppState.activeChat;
  if (ac.type !== 'group' || !ac.target) return;

  const members = (ac.target.members || [])
    .map(cid => AppState.characters.find(c => c.id === cid))
    .filter(Boolean);

  const filtered = filter
    ? members.filter(c => c.name.toLowerCase().includes(filter.toLowerCase()))
    : members;

  if (filtered.length === 0) { hideMentionPopover(); return; }

  if (!mentionPopover) {
    mentionPopover = document.createElement('div');
    mentionPopover.className = 'mention-popover';
    document.getElementById('input-area').appendChild(mentionPopover);
  }

  mentionPopover.innerHTML = filtered.map(c => `
    <div class="mention-item" data-char-name="${c.name}">
      <span class="mention-avatar">${getCharAvatar(c)}</span>
      <span>${escapeHtml(c.name)}</span>
    </div>
  `).join('');

  mentionPopover.style.display = 'block';

  mentionPopover.querySelectorAll('.mention-item').forEach(item => {
    item.addEventListener('click', () => {
      const name = item.dataset.charName;
      const val = inputEl.value;
      const cursorPos = inputEl.selectionStart;
      const textBeforeCursor = val.substring(0, cursorPos);
      const atIndex = textBeforeCursor.lastIndexOf('@');
      const newVal = val.substring(0, atIndex) + `@${name} ` + val.substring(cursorPos);
      inputEl.value = newVal;
      const newPos = atIndex + name.length + 2;
      inputEl.setSelectionRange(newPos, newPos);
      inputEl.focus();
      hideMentionPopover();
    });
  });
}

function hideMentionPopover() {
  if (mentionPopover) mentionPopover.style.display = 'none';
}

document.addEventListener('click', (e) => {
  if (mentionPopover && !mentionPopover.contains(e.target) && e.target !== inputEl && e.target !== atBtn) {
    hideMentionPopover();
  }
});
