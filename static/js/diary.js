/*  NekoChat — diary.js: 日记自动生成 + 查看器 + 设置  */

let _diaryCounter = 0;
let _diaryThreshold = Math.floor(Math.random() * 21) + 20; // 20-40
let _diaryChatId = null;
let _diaryList = [];  // current loaded diaries for sharing by index

// ── Auto-generate check ─────────────────────────
function checkDiaryAutoGenerate(chatId, messages) {
  if (_diaryChatId !== chatId) {
    _diaryChatId = chatId;
    _diaryCounter = 0;
    _diaryThreshold = Math.floor(Math.random() * 21) + 20;
  }
  _diaryCounter++;
  if (_diaryCounter >= _diaryThreshold && AppState.settings.api_key) {
    _diaryCounter = 0;
    _diaryThreshold = Math.floor(Math.random() * 21) + 20;
    generateDiary(chatId, messages, true);
  }
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
      if (!silent) showToast('日记生成成功nya~ 📔');
      else showToast('📔 自动生成了一篇新日记！点📔查看');
    } else {
      if (!silent) showToast('生成失败: ' + (data.error || '未知错误'), 'error');
    }
  } catch (e) {
    if (!silent) showToast('生成失败: ' + e.message, 'error');
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
        const visibleNames = (d.visible_to || [])
          .map(cid => AppState.characters.find(c => c.id === cid)?.name)
          .filter(Boolean);

        return `
          <div class="diary-card" style="${bgStyle}">
            ${hasBg ? '<div style="position:absolute;inset:0;background:rgba(255,255,255,0.85);border-radius:14px;z-index:0;"></div>' : ''}
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
                <button onclick="openDiarySettings('${d.id}','${escapeHtml(d.background || '')}','${(d.visible_to||[]).join(',')}')">⚙️ 设置</button>
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

function openDiarySettings(diaryId, bg, visibleTo) {
  _diaryEditId = diaryId;
  document.getElementById('diary-edit-id').value = diaryId;
  document.getElementById('diary-edit-bg').value = bg || '';
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
  closeModal('modal-diary-share');
  await switchToChat(`private_${charId}`, 'private', 'chat', char);
  document.getElementById('message-input').value = `📔 分享了${originalCharName}的日记 (${d.date})\n\n${d.content}`;
  document.getElementById('btn-send').click();
}

async function shareToGroup(groupId) {
  const d = _diaryList.find(x => x._shareData)?._shareData;
  if (!d) return;
  const group = AppState.groups.find(g => g.id === groupId);
  if (!group) return;
  const originalCharName = AppState.activeChat.target?.name || '';
  closeModal('modal-diary-share');
  await switchToChat(`group_${groupId}`, 'group', 'chat', group);
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

  // Save diary settings
  document.getElementById('btn-save-diary-settings')?.addEventListener('click', async () => {
    const ac = AppState.activeChat;
    const bg = document.getElementById('diary-edit-bg').value.trim();
    const visible = [...document.querySelectorAll('.diary-visible-check:checked')].map(cb => cb.value);
    await apiPut('/api/diaries/' + ac.chat_id + '/' + _diaryEditId, {
      background: bg, visible_to: visible
    });
    closeModal('modal-diary-settings');
    openDiary(); // refresh
    showToast('日记设置已保存 ✨');
  });
});
