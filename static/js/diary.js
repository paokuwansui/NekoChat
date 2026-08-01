/*  NekoChat — diary.js: 日记自动生成 + 查看器 + 设置  */

let _diaryList = [];  // current loaded diaries for sharing by index

// ── Auto-generate check (backend counter) ────────
async function checkDiaryAutoGenerate(chatId, messages) {
  const ac = AppState.activeChat;
  try {
    const resp = await fetch(`/api/diaries/tick/${chatId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: messages || ac.messages,
        api_key: AppState.settings.api_key,
        base_url: AppState.settings.base_url,
        model: AppState.settings.model,
        character_name: ac.target?.name || 'AI'
      })
    });
    const data = await resp.json();
    if (data.generated) {
      showToast('📔 自动生成了一篇新日记！点📔查看');
    }
  } catch {}
}

// ── Generate Diary ──────────────────────────────
async function generateDiary(chatId, messages, silent = false) {
  const ac = AppState.activeChat;
  const charName = ac.target?.name || 'AI';

  if (!silent) showToast('正在生成日记... ✍️');

  try {
    const resp = await fetch('/api/diaries/' + chatId + '/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: messages || ac.messages,
        api_key: AppState.settings.api_key,
        base_url: AppState.settings.base_url,
        model: AppState.settings.model,
        character_name: charName
      })
    });
    const data = await resp.json();
    if (data.status === 'ok') {
      showToast(silent ? '📔 自动生成了一篇新日记！点📔查看' : '日记生成成功nya~ 📔');
    } else {
      showToast('日记生成失败: ' + (data.error || '未知错误'), 'error');
    }
  } catch (e) {
    showToast('日记生成失败: ' + e.message, 'error');
  }
}

// ── Open Diary Viewer ───────────────────────────
async function openDiary() {
  const ac = AppState.activeChat;
  if (!ac.chat_id) return;

  const list = document.getElementById('diary-list');
  const empty = document.getElementById('diary-empty');

  try {
    const diaries = await apiGet('/api/diaries/' + ac.chat_id);
    _diaryList = diaries;  // store for share by index
    if (diaries.length === 0) {
      list.innerHTML = '';
      empty.style.display = 'block';
    } else {
      empty.style.display = 'none';
      list.innerHTML = diaries.map((d, i) => {
        const bgStyle = d.background
          ? `background-image:url(${d.background});background-size:cover;background-position:center;`
          : '';
        const hasBg = !!d.background;
        const bgAlpha = (d.bg_opacity != null ? d.bg_opacity : 85) / 100;
        const visibleNames = (d.visible_to || [])
          .map(cid => AppState.characters.find(c => c.id === cid)?.name)
          .filter(Boolean);

        return `
          <div class="diary-card" style="${bgStyle}">
            ${hasBg ? `<div style="position:absolute;inset:0;background:rgba(255,255,255,${bgAlpha});border-radius:14px;z-index:0;"></div>` : ''}
            <div style="position:relative;z-index:1;">
              <div class="diary-date">
                📅 ${d.date}
                ${visibleNames.length > 0
                  ? `<span class="diary-visible-badge">👁️ ${visibleNames.join(', ')}</span>`
                  : '<span class="diary-visible-badge" style="background:#eee;color:#999;">🔒 仅自己</span>'}
              </div>
              <div class="diary-content">${escapeHtml(d.content)}</div>
              <div class="diary-actions">
                <button onclick="shareDiary(${i})">📤 分享</button>
                <button onclick="openDiarySettings('${d.id}','${escapeHtml(d.background || '')}',${d.bg_opacity != null ? d.bg_opacity : 85},'${(d.visible_to||[]).join(',')}')">⚙️ 设置</button>
                <button onclick="deleteDiaryEntry('${d.id}')">🗑️ 删除</button>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }
  } catch (e) {
    list.innerHTML = '<p style="color:var(--error);text-align:center;">加载失败nya~</p>';
  }

  openModal('modal-diary');
}

// ── Delete Diary Entry ──────────────────────────
async function deleteDiaryEntry(diaryId) {
  const ac = AppState.activeChat;
  if (!confirm('确定删除这篇日记吗？')) return;
  await apiDelete('/api/diaries/' + ac.chat_id + '/' + diaryId);
  openDiary(); // refresh
}

// ── Open Diary Settings ─────────────────────────
let _diaryEditId = null;

function openDiarySettings(diaryId, bg, bgOpacity, visibleTo) {
  _diaryEditId = diaryId;
  document.getElementById('diary-edit-id').value = diaryId;
  document.getElementById('diary-edit-bg').value = bg || '';
  const opVal = bgOpacity != null ? bgOpacity : 85;
  document.getElementById('diary-bg-opacity').value = opVal;
  document.getElementById('diary-bg-opacity-val').textContent = opVal + '%';
  updateDiaryBgPreview();

  // Render visibility checkboxes
  const pick = document.getElementById('diary-visible-pick');
  const visibleIds = visibleTo ? visibleTo.split(',').filter(Boolean) : [];
  pick.innerHTML = AppState.characters.map(c => `
    <label class="char-check-item">
      <input type="checkbox" value="${c.id}" class="diary-visible-check"
        ${visibleIds.includes(c.id) ? 'checked' : ''}>
      <span style="font-size:20px;">${getCharAvatar(c)}</span>
      <span>${escapeHtml(c.name)}</span>
    </label>
  `).join('');

  openModal('modal-diary-settings');
}

function updateDiaryBgPreview() {
  const preview = document.getElementById('diary-bg-preview');
  const url = document.getElementById('diary-edit-bg').value.trim();
  if (url) {
    preview.classList.remove('hidden');
    preview.style.backgroundImage = `url(${url})`;
  } else {
    preview.classList.add('hidden');
  }
}

// ── Share Diary ──────────────────────────────────
async function shareDiary(idx) {
  const diary = _diaryList[idx];
  if (!diary) return;
  closeModal('modal-diary');

  const privateList = document.getElementById('share-private-list');
  const groupList = document.getElementById('share-group-list');

  // Characters
  privateList.innerHTML = AppState.characters.map(c => `
    <div class="contact-item" style="cursor:pointer;" onclick="shareToPrivate('${c.id}')">
      <div class="contact-item-avatar">${getCharAvatar(c)}</div>
      <div class="contact-item-info">
        <div class="contact-item-name">${escapeHtml(c.name)}</div>
      </div>
      <span style="color:var(--accent);">→</span>
    </div>
  `).join('') || '<p style="color:var(--text-secondary);padding:8px;">暂无角色</p>';

  // Groups
  groupList.innerHTML = AppState.groups.map(g => {
    return `
      <div class="contact-item" style="cursor:pointer;" onclick="shareToGroup('${g.id}')">
        <div class="contact-item-avatar">${g.avatar ? getCharAvatar({id:g.id,avatar:g.avatar}) : '👥'}</div>
        <div class="contact-item-info">
          <div class="contact-item-name">${escapeHtml(g.name)}</div>
          <div style="font-size:11px;color:var(--text-secondary);">${(g.members||[]).length}人</div>
        </div>
        <span style="color:var(--accent);">→</span>
      </div>
    `;
  }).join('') || '<p style="color:var(--text-secondary);padding:8px;">暂无群聊</p>';

  // Store diary for share callbacks
  _diaryList[idx]._shareData = { idx, date: diary.date, content: diary.content };
  openModal('modal-diary-share');
}

async function shareToPrivate(charId) {
  const d = _diaryList.find(x => x._shareData)?._shareData;
  if (!d) return;
  const char = AppState.characters.find(c => c.id === charId);
  if (!char) return;
  const originalCharName = AppState.activeChat.target?.name || '';
  const chatId = `private_${charId}`;
  closeModal('modal-diary-share');

  // Optimistic: add chat to sidebar immediately (if not already there)
  if (!AppState.chats.find(c => c.chat_id === chatId)) {
    AppState.chats.unshift({
      chat_id: chatId, type: 'private', mode: 'chat',
      target_id: charId, last_message: '', last_time: new Date().toISOString(),
      message_count: 0
    });
    renderChatList();
  }

  await switchToChat(chatId, 'private', 'chat', char);
  document.getElementById('message-input').value = `📔 分享了${originalCharName}的日记 (${d.date})\n\n${d.content}`;
  document.getElementById('btn-send').click();
}

async function shareToGroup(groupId) {
  const d = _diaryList.find(x => x._shareData)?._shareData;
  if (!d) return;
  const group = AppState.groups.find(g => g.id === groupId);
  if (!group) return;
  const originalCharName = AppState.activeChat.target?.name || '';
  const chatId = `group_${groupId}`;
  closeModal('modal-diary-share');

  // Optimistic: add chat to sidebar immediately (if not already there)
  if (!AppState.chats.find(c => c.chat_id === chatId)) {
    AppState.chats.unshift({
      chat_id: chatId, type: 'group', mode: 'chat',
      target_id: groupId, last_message: '', last_time: new Date().toISOString(),
      message_count: 0
    });
    renderChatList();
  }

  await switchToChat(chatId, 'group', 'chat', group);
  document.getElementById('message-input').value = `📔 分享了${originalCharName}的日记 (${d.date})\n\n${d.content}`;
  document.getElementById('btn-send').click();
}

// ── Event bindings ──────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Diary button
  document.getElementById('btn-diary')?.addEventListener('click', openDiary);

  // Manual generate
  document.getElementById('btn-manual-diary')?.addEventListener('click', () => {
    const ac = AppState.activeChat;
    generateDiary(ac.chat_id, ac.messages);
    setTimeout(() => openDiary(), 2000);
  });

  // Diary bg preview
  document.getElementById('diary-edit-bg')?.addEventListener('input', updateDiaryBgPreview);

  // Diary bg gallery
  document.getElementById('btn-diary-bg-gallery')?.addEventListener('click', () => {
    closeModal('modal-diary-settings');
    setTimeout(() => openGallery('diary-edit-bg', 'backgrounds'), 200);
  });

  // Diary bg upload
  document.getElementById('btn-upload-diary-bg')?.addEventListener('click', () => {
    document.getElementById('diary-edit-bg-file').click();
  });
  document.getElementById('diary-edit-bg-file')?.addEventListener('change', async (e) => {
    uploadWithCrop(e.target, 'diary_bg', (croppedUrl) => {
      document.getElementById('diary-edit-bg').value = croppedUrl;
      updateDiaryBgPreview();
      showToast('背景上传完成 ✨');
      e.target.value = '';
    });
  });

  // Diary bg opacity slider
  document.getElementById('diary-bg-opacity')?.addEventListener('input', function() {
    document.getElementById('diary-bg-opacity-val').textContent = this.value + '%';
  });

  // Save diary settings
  document.getElementById('btn-save-diary-settings')?.addEventListener('click', async () => {
    const ac = AppState.activeChat;
    const bg = document.getElementById('diary-edit-bg').value.trim();
    const bgOpacity = parseInt(document.getElementById('diary-bg-opacity').value);
    const visible = [...document.querySelectorAll('.diary-visible-check:checked')].map(cb => cb.value);
    await apiPut('/api/diaries/' + ac.chat_id + '/' + _diaryEditId, {
      background: bg, bg_opacity: bgOpacity, visible_to: visible
    });
    closeModal('modal-diary-settings');
    openDiary(); // refresh
    showToast('日记设置已保存 ✨');
  });
});
