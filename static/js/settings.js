/* ═══════════════════════════════════════════════
   NekoChat — settings.js: 设置面板
   ═══════════════════════════════════════════════ */

// ── Open / Close ────────────────────────────────
function openSettings() {
  document.getElementById('settings-panel').classList.add('open');
  loadSettingsForm();
  renderSettingsCharList();
  renderSettingsGroupList();
  renderSettingsStoryList();
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
  document.getElementById('set-bg-opacity').value = Math.round((s.bg_opacity ?? 0.35) * 100);
  document.getElementById('bg-opacity-val').textContent = Math.round((s.bg_opacity ?? 0.35) * 100) + '%';
  document.getElementById('set-bubble-opacity').value = Math.round((s.bubble_opacity ?? 1) * 100);
  document.getElementById('bubble-opacity-val').textContent = Math.round((s.bubble_opacity ?? 1) * 100) + '%';

  // Diary settings
  document.getElementById('set-diary-base').value = s.diary_base ?? 40;
  document.getElementById('set-diary-random').value = s.diary_random ?? 20;

  // User profile
  document.getElementById('set-my-name').value = AppState.user.name || '我';

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

  // Bubble opacity slider
  const bubbleOpacityEl = document.getElementById('set-bubble-opacity');
  if (bubbleOpacityEl) bubbleOpacityEl.addEventListener('input', () => {
    AppState.settings.bubble_opacity = parseInt(bubbleOpacityEl.value) / 100;
    document.getElementById('bubble-opacity-val').textContent = bubbleOpacityEl.value + '%';
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

  // Add character button
  document.getElementById('btn-add-character')?.addEventListener('click', () => openCharEdit(null));

  // Add group button
  document.getElementById('btn-add-group')?.addEventListener('click', () => openGroupEdit(null));

  // Add story button (from settings)
  document.getElementById('btn-add-story')?.addEventListener('click', () => {
    closeSettings();
    openStoryCreate();
  });

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

  // Cleanup unreferenced uploads
  document.getElementById('btn-cleanup-uploads')?.addEventListener('click', async () => {
    if (!confirm('🧹 将删除所有未被角色/群组/故事/日记/相册引用的上传图片。\n\n确定继续吗？')) return;
    try {
      const resp = await fetch('/api/uploads/cleanup', { method: 'POST' });
      const data = await resp.json();
      if (data.status === 'ok') {
        showToast(`清理完成，删除了 ${data.deleted} 个未使用的文件 🧹`);
      } else {
        showToast('清理失败: ' + (data.error || '未知错误'), 'error');
      }
    } catch (e) {
      showToast('清理失败: ' + e.message, 'error');
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
    bg_opacity: parseInt(document.getElementById('set-bg-opacity').value) / 100,
    bubble_opacity: parseInt(document.getElementById('set-bubble-opacity').value) / 100,
    diary_base: parseInt(document.getElementById('set-diary-base').value) || 40,
    diary_random: parseInt(document.getElementById('set-diary-random').value) || 20
  };

  Object.assign(AppState.settings, data);
  applySettings();

  // Save user profile
  const userData = {
    name: document.getElementById('set-my-name').value || '我',
    avatar: AppState.user.avatar || ''
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
      avatar: AppState.user.avatar
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
        <span class="char-avatar-sm">${g.avatar ? getCharAvatar({id: g.id, avatar: g.avatar}) : '👥'}</span>
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
}

// ── Story Management ──────────────────────────

function renderSettingsStoryList() {
  const container = document.getElementById('story-list-settings');
  const stories = AppState.chats.filter(c => c.type === 'story');
  if (stories.length === 0) {
    container.innerHTML = '<p style=\"color:var(--text-secondary);font-size:var(--font-size-sm);padding:8px;\">暂无故事nya~</p>';
    return;
  }
  container.innerHTML = stories.map(s => {
    const chars = (s.story_chars || []).map(sc => sc.name).join('、') || '全部角色';
    return `
    <div class="group-item-setting">
      <div class="group-item-info">
        <span class="char-avatar-sm">${s.story_avatar ? getCharAvatar({id:'story',avatar:s.story_avatar}) : '📖'}</span>
        <span>${escapeHtml(s.title || '未命名故事')}</span>
        <span style="font-size:11px;color:var(--text-secondary);">${chars}</span>
      </div>
      <div class="group-actions">
        <button class="btn-sm" onclick="openStoryEdit('${s.chat_id}')">✏️</button>
        <button class="btn-sm btn-danger" onclick="deleteStory('${s.chat_id}')">🗑️</button>
      </div>
    </div>
  `}).join('');
}

function openStoryEdit(chatId) {
  const story = AppState.chats.find(c => c.chat_id === chatId);
  if (!story) return;

  // Populate character checkboxes (normally done by openStoryCreate)
  const grid = document.getElementById('story-char-pick');
  grid.innerHTML = AppState.characters.map(c => `
    <label class="char-check-item">
      <input type="checkbox" value="${c.id}" class="story-char-check">
      <span style="font-size:20px;">${getCharAvatar(c)}</span>
      <span>${escapeHtml(c.name)}</span>
    </label>
  `).join('');

  openModal('modal-story-create');
  document.getElementById('modal-story-create').querySelector('.modal-header h3').textContent = '📖 编辑故事';

  // Story bg upload
  document.getElementById('btn-upload-story-bg').onclick = () => {
    document.getElementById('story-bg-file').click();
  };
  document.getElementById('story-bg-file').onchange = async (e) => {
    uploadWithCrop(e.target, 'background', (croppedUrl) => {
      document.getElementById('story-bg').value = croppedUrl;
      showToast('背景上传+裁剪完成nya~ ✨');
      e.target.value = '';
    });
  };

  // Story avatar upload
  document.getElementById('btn-upload-story-avatar').onclick = () => {
    document.getElementById('story-avatar-file').click();
  };
  document.getElementById('story-avatar-file').onchange = async (e) => {
    uploadWithCrop(e.target, 'avatar', (croppedUrl) => {
      document.getElementById('story-avatar').value = croppedUrl;
      showToast('头像上传+裁剪完成nya~ ✨');
      e.target.value = '';
    });
  };
  
  // Pre-fill form
  document.getElementById('story-title').value = story.title || '';
  document.getElementById('story-background').value = story.story_background || '';
  document.getElementById('story-style').value = story.narrative_style || '自然流畅';
  document.getElementById('story-bg').value = story.chat_background || '';
  document.getElementById('story-avatar').value = story.story_avatar || '';
  
  // Pre-check characters
  const savedIds = (story.story_chars || []).map(sc => sc.id);
  document.querySelectorAll('.story-char-check').forEach(cb => {
    cb.checked = savedIds.includes(cb.value);
  });

  // Override the create button to do an update instead
  const btn = document.getElementById('btn-create-story');
  btn.textContent = '💾 保存修改';
  btn.onclick = async () => {
    const checked = [...document.querySelectorAll('.story-char-check:checked')].map(cb => cb.value);
    if (checked.length === 0) { showToast('请至少选择一个角色nya~', 'error'); return; }
    const title = document.getElementById('story-title').value.trim() || '未命名故事';
    const background = document.getElementById('story-background').value.trim();
    const style = document.getElementById('story-style').value;
    const bg = document.getElementById('story-bg').value.trim();
    const avatar = document.getElementById('story-avatar').value.trim();
    const storyChars = AppState.characters.filter(c => checked.includes(c.id));

    // Optimistic: update local state immediately
    const idx = AppState.chats.findIndex(c => c.chat_id === chatId);
    if (idx >= 0) {
      AppState.chats[idx] = {
        ...AppState.chats[idx],
        title, story_background: background, narrative_style: style,
        chat_background: bg, story_avatar: avatar,
        story_chars: storyChars.map(c => ({ id: c.id, name: c.name }))
      };
    }

    closeModal('modal-story-create');
    renderSettingsStoryList();
    renderChatList();
    updateChatHeader();
    showToast('故事已更新nya~ ✨');

    // Persist to server in background
    try {
      await apiPut(`/api/chats/${chatId}`, {
        title, story_background: background, narrative_style: style,
        chat_background: bg, story_avatar: avatar,
        story_chars: storyChars.map(c => ({ id: c.id, name: c.name }))
      });
    } catch (e) {
      AppState.chats = await apiGet('/api/chats');
      renderSettingsStoryList();
      renderChatList();
      showToast('保存失败，请重试', 'error');
    }
  };
}

async function deleteStory(chatId) {
  const story = AppState.chats.find(c => c.chat_id === chatId);
  if (!story) return;
  if (!confirm(`确定删除故事 "${story.title || '未命名'}" 吗？\n将同时删除聊天记录和相册。`)) return;

  // Optimistic: remove from local state immediately
  AppState.chats = AppState.chats.filter(c => c.chat_id !== chatId);
  renderSettingsStoryList();
  renderChatList();
  showToast('故事已删除');

  // If this was the active chat, clear it
  if (AppState.activeChat.chat_id === chatId) {
    AppState.activeChat = {
      chat_id: null, type: null, mode: null, target: null,
      messages: [], offset: 0, hasMore: false,
      isLoading: false, streamingBubbles: {}
    };
    document.getElementById('messages-list').innerHTML = '';
    document.getElementById('welcome-screen').classList.remove('hidden');
    updateChatHeader();
  }

  // Delete on server in background
  try {
    await apiDelete(`/api/chats/${chatId}`);
  } catch (e) {
    // Revert on failure
    AppState.chats = await apiGet('/api/chats');
    renderSettingsStoryList();
    renderChatList();
    showToast('删除失败，请重试', 'error');
  }
}

// ── Music Player ─────────────────────────────────
let _musicPlayer = null;
let _musicIndex = -1;
let _musicList = [];
let _musicLoopMode = 'all';  // all | single | none

function initMusicPlayer() {
  const list = document.getElementById('music-list');
  const status = document.getElementById('music-status');
  const volSlider = document.getElementById('music-volume');
  const volVal = document.getElementById('music-volume-val');

  // Create audio element
  if (!_musicPlayer) {
    _musicPlayer = new Audio();
    _musicPlayer.volume = 0.5;
    _musicPlayer.onended = onMusicEnded;
  }

  // Loop mode
  document.querySelectorAll('[name="loop-mode"]').forEach(r => {
    r.addEventListener('change', () => { _musicLoopMode = r.value; });
  });

  // Volume
  volSlider.addEventListener('input', () => {
    _musicPlayer.volume = volSlider.value / 100;
    volVal.textContent = volSlider.value + '%';
  });

  // Load music list
  document.getElementById('btn-refresh-music').addEventListener('click', loadMusicList);
  loadMusicList();

  // Play button
  document.getElementById('btn-music-play').addEventListener('click', () => {
    if (_musicPlayer.paused && _musicIndex >= 0) {
      _musicPlayer.play();
      document.getElementById('btn-music-play').textContent = '⏸️';
    } else if (!_musicPlayer.paused) {
      _musicPlayer.pause();
      document.getElementById('btn-music-play').textContent = '▶️';
    } else if (_musicList.length > 0) {
      playMusic(0);
    }
  });

  // Prev / Next
  document.getElementById('btn-music-prev').addEventListener('click', () => {
    if (_musicList.length === 0) return;
    const idx = (_musicIndex - 1 + _musicList.length) % _musicList.length;
    playMusic(idx);
  });
  document.getElementById('btn-music-next').addEventListener('click', () => {
    if (_musicList.length === 0) return;
    const idx = (_musicIndex + 1) % _musicList.length;
    playMusic(idx);
  });

  // Select from list
  list.addEventListener('dblclick', () => {
    if (list.selectedIndex >= 0) playMusic(list.selectedIndex);
  });

  // Upload
  document.getElementById('btn-upload-music').addEventListener('click', () => {
    document.getElementById('music-upload-file').click();
  });
  document.getElementById('music-upload-file').addEventListener('change', async (e) => {
    const files = e.target.files;
    for (const f of files) {
      const fd = new FormData();
      fd.append('file', f);
      await fetch('/api/music', { method: 'POST', body: fd });
    }
    loadMusicList();
    showToast('音乐上传完成 🎵');
  });
}

async function loadMusicList() {
  try {
    const data = await apiGet('/api/music');
    _musicList = data;
    const list = document.getElementById('music-list');
    list.innerHTML = data.map((m, i) => `<option value="${i}">${m.name}</option>`).join('');
    if (_musicIndex >= 0 && _musicIndex < data.length) list.selectedIndex = _musicIndex;
  } catch (e) {
    document.getElementById('music-list').innerHTML = '<option>加载失败</option>';
  }
}

function playMusic(idx) {
  if (idx < 0 || idx >= _musicList.length) return;
  _musicIndex = idx;
  _musicPlayer.src = _musicList[idx].url;
  _musicPlayer.play();
  document.getElementById('btn-music-play').textContent = '⏸️';
  document.getElementById('music-list').selectedIndex = idx;
  document.getElementById('music-status').textContent = '♪ ' + _musicList[idx].name;
}

function onMusicEnded() {
  if (_musicLoopMode === 'single') {
    _musicPlayer.currentTime = 0;
    _musicPlayer.play();
  } else if (_musicLoopMode === 'all') {
    const next = (_musicIndex + 1) % _musicList.length;
    playMusic(next);
  } else {
    document.getElementById('btn-music-play').textContent = '▶️';
  }
}
