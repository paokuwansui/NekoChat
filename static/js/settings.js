/* ═══════════════════════════════════════════════
   NekoChat — settings.js: 设置面板
   ═══════════════════════════════════════════════ */

// ── Open / Close ────────────────────────────────
function openSettings() {
  document.getElementById('settings-panel').classList.add('open');
  loadSettingsForm();
  renderSettingsCharList();
  renderSettingsGroupList();
}

function closeSettings() {
  document.getElementById('settings-panel').classList.remove('open');
  saveSettingsSilent();
}

function loadSettingsForm() {
  const s = AppState.settings;
  document.getElementById('set-api-key').value = s.api_key || '';
  document.getElementById('set-base-url').value = s.base_url;
  document.getElementById('set-model').value = s.model;
  document.getElementById('set-chat-bg').value = s.chat_background || '';
  document.getElementById('set-ai-bubble').value = s.ai_bubble_color;
  document.getElementById('set-user-bubble').value = s.user_bubble_color;
  document.getElementById('set-font-size').value = s.font_size;
  document.getElementById('font-size-val').textContent = s.font_size + 'px';
  document.getElementById('set-page-size').value = s.messages_per_page;
  document.getElementById('set-bg-opacity').value = Math.round((s.bg_opacity || 0.85) * 100);
  document.getElementById('bg-opacity-val').textContent = Math.round((s.bg_opacity || 0.85) * 100) + '%';

  // User profile
  document.getElementById('set-my-name').value = AppState.user.name || '我';
  document.getElementById('set-my-avatar').value = AppState.user.avatar || '';

  // Preview
  updateBgPreview();
}

// ── Live Preview ────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Real-time preview bindings
  ['set-ai-bubble', 'set-user-bubble'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => {
      const key = id === 'set-ai-bubble' ? 'ai_bubble_color' : 'user_bubble_color';
      AppState.settings[key] = el.value;
      applySettings();
    });
  });

  const fontSizeEl = document.getElementById('set-font-size');
  if (fontSizeEl) fontSizeEl.addEventListener('input', () => {
    AppState.settings.font_size = parseInt(fontSizeEl.value);
    document.getElementById('font-size-val').textContent = fontSizeEl.value + 'px';
    applySettings();
  });

  const chatBgEl = document.getElementById('set-chat-bg');
  if (chatBgEl) chatBgEl.addEventListener('input', () => {
    AppState.settings.chat_background = chatBgEl.value;
    applySettings();
    updateBgPreview();
  });

  // Bg opacity slider
  const bgOpacityEl = document.getElementById('set-bg-opacity');
  if (bgOpacityEl) bgOpacityEl.addEventListener('input', () => {
    AppState.settings.bg_opacity = parseInt(bgOpacityEl.value) / 100;
    document.getElementById('bg-opacity-val').textContent = bgOpacityEl.value + '%';
    applySettings();
  });

  // Password toggle
  document.querySelectorAll('.toggle-vis').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '🙈';
      } else {
        input.type = 'password';
        btn.textContent = '👁️';
      }
    });
  });

  // Test connection
  document.getElementById('btn-test-connection')?.addEventListener('click', async () => {
    const result = document.getElementById('test-result');
    result.textContent = '测试中...';
    try {
      const resp = await fetch('/api/test_connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: document.getElementById('set-api-key').value,
          base_url: document.getElementById('set-base-url').value
        })
      });
      const data = await resp.json();
      result.textContent = data.status === 'ok' ? '✅ ' + data.message : '❌ ' + data.message;
      result.style.color = data.status === 'ok' ? 'var(--success)' : 'var(--error)';
    } catch (e) {
      result.textContent = '❌ 连接失败';
      result.style.color = 'var(--error)';
    }
  });

  // Upload background
  document.getElementById('btn-upload-bg')?.addEventListener('click', () => {
    document.getElementById('set-chat-bg-file').click();
  });
  document.getElementById('set-chat-bg-file')?.addEventListener('change', async (e) => {
    uploadWithCrop(e.target, 'background', (croppedUrl) => {
      document.getElementById('set-chat-bg').value = croppedUrl;
      AppState.settings.chat_background = croppedUrl;
      applySettings();
      updateBgPreview();
      showToast('背景上传+裁剪完成nya~ ✨');
      e.target.value = '';
    });
  });

  // Upload my avatar
  document.getElementById('btn-upload-my-avatar')?.addEventListener('click', () => {
    document.getElementById('set-my-avatar-file').click();
  });
  document.getElementById('set-my-avatar-file')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', 'avatars');
    const resp = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await resp.json();
    if (data.status === 'ok') {
      document.getElementById('set-my-avatar').value = data.path;
      showToast('头像上传成功nya~ ✨');
    } else {
      showToast(data.message || '上传失败', 'error');
    }
  });

  // Add character button
  document.getElementById('btn-add-character')?.addEventListener('click', () => openCharEdit(null));

  // Add group button
  document.getElementById('btn-add-group')?.addEventListener('click', () => openGroupEdit(null));

  // Save settings
  document.getElementById('btn-save-settings')?.addEventListener('click', saveSettings);

  // Clear all history
  // Crop global bg button
  document.getElementById('btn-crop-global-bg')?.addEventListener('click', () => {
    const url = (AppState.settings.chat_background || '').split('|')[0];
    if (!url) return;
    closeSettings();
    openCropModal(url, (croppedUrl) => {
      document.getElementById('set-chat-bg').value = croppedUrl;
      AppState.settings.chat_background = croppedUrl;
      applySettings();
      updateBgPreview();
      openSettings();
    }, 'background');
  });

  document.getElementById('btn-clear-all-history')?.addEventListener('click', async () => {
    if (!confirm('确定要清空所有聊天历史吗？此操作不可撤销！')) return;
    await apiDelete('/api/history');
    AppState.chats = [];
    renderChatList();
    AppState.activeChat = {
      chat_id: null, type: null, mode: null, target: null,
      messages: [], offset: 0, hasMore: false, isLoading: false, streamingBubbles: {}
    };
    document.getElementById('messages-list').innerHTML = '';
    document.getElementById('welcome-screen').classList.remove('hidden');
    showToast('所有历史已清空');
  });

  // Reset all — triple confirmation
  document.getElementById('btn-reset-all')?.addEventListener('click', async () => {
    if (!confirm('⚠️ 确定要还原所有设置到初始状态吗？\n\n这将重置：API设置、角色、群组、聊天历史、日记、相册')) return;
    if (!confirm('⚠️ 第二次确认：此操作完全不可撤销！\n\n所有自定义的角色、群组、聊天记录、日记都将永久删除！')) return;
    if (!confirm('⚠️ 最后一次确认：真的要还原吗？\n\n点击"确定"后页面将自动刷新。')) return;

    try {
      await fetch('/api/reset', { method: 'POST' });
      showToast('已还原到初始设置，正在刷新... 🔄');
      setTimeout(() => location.reload(), 1500);
    } catch (e) {
      showToast('还原失败: ' + e.message, 'error');
    }
  });
});

function updateBgPreview() {
  const preview = document.getElementById('bg-preview');
  const cropBtn = document.getElementById('btn-crop-global-bg');
  const url = AppState.settings.chat_background;
  if (url) {
    preview.classList.remove('hidden');
    preview.style.backgroundImage = `url(${url})`;
    cropBtn.classList.remove('hidden');
  } else {
    preview.classList.add('hidden');
    preview.style.backgroundImage = '';
    cropBtn.classList.add('hidden');
  }
}
// ── Save ────────────────────────────────────────
async function saveSettings() {
  const data = {
    api_key: document.getElementById('set-api-key').value,
    base_url: document.getElementById('set-base-url').value,
    model: document.getElementById('set-model').value,
    chat_background: document.getElementById('set-chat-bg').value,
    ai_bubble_color: document.getElementById('set-ai-bubble').value,
    user_bubble_color: document.getElementById('set-user-bubble').value,
    font_size: parseInt(document.getElementById('set-font-size').value),
    messages_per_page: parseInt(document.getElementById('set-page-size').value),
    bg_opacity: parseInt(document.getElementById('set-bg-opacity').value) / 100
  };

  Object.assign(AppState.settings, data);
  applySettings();

  // Save user profile
  const userData = {
    name: document.getElementById('set-my-name').value || '我',
    avatar: document.getElementById('set-my-avatar').value || ''
  };
  AppState.user = userData;

  try {
    await apiPost('/api/settings', data);
    await apiPost('/api/user_profile', userData);
    showToast('设置保存成功nya~ 💾');
  } catch (e) {
    showToast('保存失败，请重试', 'error');
  }
}

async function saveSettingsSilent() {
  try {
    const userData = {
      name: document.getElementById('set-my-name')?.value || AppState.user.name,
      avatar: document.getElementById('set-my-avatar')?.value || AppState.user.avatar
    };
    await apiPost('/api/settings', AppState.settings);
    await apiPost('/api/user_profile', userData);
  } catch (e) { /* silent */ }
}

// ── Character List in Settings ──────────────────
function renderSettingsCharList() {
  const container = document.getElementById('char-list-settings');
  container.innerHTML = AppState.characters.map(c => `
    <div class="char-item-setting">
      <div class="char-item-info">
        <span class="char-avatar-sm">${getCharAvatar(c)}</span>
        <span>${escapeHtml(c.name)}</span>
      </div>
      <div class="char-actions">
        <button class="btn-sm" onclick="openCharEdit('${c.id}')">✏️</button>
        <button class="btn-sm btn-danger" onclick="deleteChar('${c.id}')">🗑️</button>
      </div>
    </div>
  `).join('');
}

async function deleteChar(charId) {
  const char = AppState.characters.find(c => c.id === charId);
  if (!char) return;
  if (!confirm(`确定删除角色 "${char.name}" 吗？`)) return;
  await apiDelete(`/api/characters/${charId}`);
  AppState.characters = await apiGet('/api/characters');
  renderSettingsCharList();
  renderChatList();
  renderWelcomeChars();
  showToast('角色已删除');
}

// ── Group List in Settings ──────────────────────
function renderSettingsGroupList() {
  const container = document.getElementById('group-list-settings');
  container.innerHTML = AppState.groups.map(g => `
    <div class="group-item-setting">
      <div class="group-item-info">
        <span>👥</span>
        <span>${escapeHtml(g.name)}</span>
        <span style="font-size:11px;color:var(--text-secondary);">${(g.members||[]).length}人</span>
      </div>
      <div class="group-actions">
        <button class="btn-sm" onclick="openGroupEdit('${g.id}')">✏️</button>
        <button class="btn-sm btn-danger" onclick="deleteGroup('${g.id}')">🗑️</button>
      </div>
    </div>
  `).join('');
}

async function deleteGroup(groupId) {
  const group = AppState.groups.find(g => g.id === groupId);
  if (!group) return;
  if (!confirm(`确定删除群组 "${group.name}" 吗？`)) return;
  await apiDelete(`/api/groups/${groupId}`);
  AppState.groups = await apiGet('/api/groups');
  renderSettingsGroupList();
  renderChatList();
  showToast('群组已删除');
}
