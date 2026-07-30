/* ═══════════════════════════════════════════════
   NekoChat — contacts.js: 角色/群组/故事管理
   ═══════════════════════════════════════════════ */

// ── Private Chat Picker ────────────────────────
function openPrivatePicker() {
  const list = document.getElementById('private-pick-list');
  list.innerHTML = AppState.characters.map(c => `
    <div class="char-pick-item" onclick="startPrivateChat('${c.id}');closeModal('modal-private-pick');">
      <span style="font-size:24px;">${getCharAvatar(c)}</span>
      <div>
        <div style="font-weight:bold;">${escapeHtml(c.name)}</div>
        <div style="font-size:12px;color:var(--text-secondary);">${escapeHtml((c.system_prompt||'').substring(0,30))}...</div>
      </div>
      <span style="margin-left:auto;color:var(--accent);">→</span>
    </div>
  `).join('');
  openModal('modal-private-pick');
}

// ── Story Create ────────────────────────────────
function openStoryCreate() {
  const grid = document.getElementById('story-char-pick');
  grid.innerHTML = AppState.characters.map(c => `
    <label class="char-check-item">
      <input type="checkbox" value="${c.id}" class="story-char-check">
      <span style="font-size:20px;">${getCharAvatar(c)}</span>
      <span>${escapeHtml(c.name)}</span>
    </label>
  `).join('');

  document.getElementById('story-title').value = '';
  document.getElementById('story-background').value = '';
  document.getElementById('story-style').value = '自然流畅';
  document.getElementById('story-bg').value = '';
  openModal('modal-story-create');

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

  document.getElementById('btn-create-story').onclick = async () => {
    const checked = [...document.querySelectorAll('.story-char-check:checked')].map(cb => cb.value);
    if (checked.length === 0) { showToast('请至少选择一个角色nya~', 'error'); return; }

    const title = document.getElementById('story-title').value.trim() || '未命名故事';
    const background = document.getElementById('story-background').value.trim();
    const style = document.getElementById('story-style').value;

    const storyChars = AppState.characters.filter(c => checked.includes(c.id));
    const chatId = `story_${Date.now()}`;

    const storyTarget = {
      id: chatId,
      name: title,
      _storyBackground: background,
      _narrativeStyle: style,
      _storyTitle: title,
      _storyChars: storyChars,
      _storyBg: document.getElementById('story-bg').value.trim()
    };

    AppState.activeChat = {
      chat_id: chatId, type: 'story', mode: 'story',
      target: storyTarget,
      messages: [], offset: 0, hasMore: false,
      isLoading: false, streamingBubbles: {}
    };

    closeModal('modal-story-create');
    updateChatHeader();
    document.getElementById('messages-list').innerHTML = '';
    document.getElementById('welcome-screen').classList.add('hidden');
    document.getElementById('load-more-area').classList.add('hidden');
    document.getElementById('btn-at-mention').classList.add('hidden');

    // Show story info card
    const container = document.getElementById('messages-list');
    const charNames = storyChars.map(c => `${getCharAvatar(c)} ${c.name}`).join('  ');
    container.innerHTML = `
      <div style="text-align:center;padding:30px;color:var(--text-secondary);">
        <div style="font-size:48px;margin-bottom:12px;">📖</div>
        <div style="font-size:var(--font-size-lg);font-weight:bold;margin-bottom:8px;">${escapeHtml(title)}</div>
        <div style="font-size:var(--font-size-sm);max-width:400px;margin:0 auto;line-height:1.8;">${escapeHtml(background)}</div>
        <div style="margin-top:12px;font-size:var(--font-size-sm);">角色: ${charNames} | 风格: ${style}</div>
        <div style="margin-top:16px;color:var(--accent);">✨ 故事开始 — 输入你的行动或对话吧！</div>
      </div>
    `;

    // Dummy register in chat index
    const storyBg = document.getElementById('story-bg').value.trim();
    try {
      await apiPost('/api/chat/private', {
        character_id: storyChars[0].id, chat_id: chatId, mode: 'story',
        messages: [{ role: 'user', content: '' }],
        api_key: AppState.settings.api_key || 'dummy',
        base_url: AppState.settings.base_url, model: AppState.settings.model,
        story_background: background, narrative_style: style, title: title,
        chat_background: storyBg
      });
    } catch (e) {}

    // Apply story background immediately
    if (storyBg) {
      document.getElementById('chat-area').style.backgroundImage = `url(${storyBg})`;
      document.getElementById('chat-area').style.backgroundSize = 'cover';
    }

    document.getElementById('message-input').focus();
  };
}

// ── Group Create ────────────────────────────────
function openGroupCreate() {
  const list = document.getElementById('group-char-pick');
  list.innerHTML = AppState.characters.map(c => `
    <label class="char-check-item">
      <input type="checkbox" value="${c.id}" class="group-char-check">
      <span style="font-size:20px;">${getCharAvatar(c)}</span>
      <span>${escapeHtml(c.name)}</span>
    </label>
  `).join('');

  document.getElementById('group-name').value = '';
  openModal('modal-group-create');

  document.getElementById('btn-create-group').onclick = async () => {
    const name = document.getElementById('group-name').value.trim() || '新群聊';
    const checked = [...document.querySelectorAll('.group-char-check:checked')].map(cb => cb.value);
    if (checked.length < 2) { showToast('至少选择2个成员nya~', 'error'); return; }

    const groupData = {
      id: `group_${Date.now()}`,
      name, avatar: document.getElementById('group-avatar').value.trim(),
      type: 'group',
      members: checked
    };

    await apiPost('/api/groups', groupData);
    AppState.groups = await apiGet('/api/groups');

    const groupId = groupData.id;
    const chatId = `group_${groupId}`;

    const target = AppState.groups.find(g => g.id === groupId);
    closeModal('modal-group-create');
    await switchToChat(chatId, 'group', 'chat', target);
    renderChatList();
    showToast('群聊创建成功nya~ ✨');
  };
}

// ── Character Edit (Settings) ───────────────────
function openCharEdit(charId = null) {
  const char = charId ? AppState.characters.find(c => c.id === charId) : null;
  document.getElementById('char-edit-id').value = charId || '';
  document.getElementById('char-edit-name').value = char?.name || '';
  document.getElementById('char-edit-avatar').value = char?.avatar || '';
  document.getElementById('char-edit-prompt').value = char?.system_prompt || '';
  document.getElementById('char-edit-temp').value = char?.temperature ?? 0.9;
  document.getElementById('char-temp-val').textContent = (char?.temperature ?? 0.9).toFixed(2);
  document.getElementById('char-edit-bg').value = char?.chat_background || '';
  updateCharBgPreview();
  document.getElementById('char-edit-title').textContent = char ? '🤖 编辑角色' : '🤖 新建角色';
  document.getElementById('btn-delete-char').style.display = char ? 'inline-block' : 'none';
  openModal('modal-char-edit');

  // Char avatar upload handler
  document.getElementById('btn-upload-char-avatar').onclick = () => {
    document.getElementById('char-edit-avatar-file').click();
  };
  document.getElementById('char-edit-avatar-file').onchange = async (e) => {
    uploadWithCrop(e.target, 'avatar', (croppedUrl) => {
      document.getElementById('char-edit-avatar').value = croppedUrl;
      showToast('头像上传+裁剪完成nya~ ✨');
      e.target.value = '';
    });
  };

  // Char bg upload handler
  document.getElementById('btn-upload-char-bg').onclick = () => {
    document.getElementById('char-edit-bg-file').click();
  };
  document.getElementById('char-edit-bg-file').onchange = async (e) => {
    uploadWithCrop(e.target, 'background', (croppedUrl) => {
      document.getElementById('char-edit-bg').value = croppedUrl;
      updateCharBgPreview();
      showToast('背景上传+裁剪完成nya~ ✨');
      e.target.value = '';
    });
  };

  document.getElementById('char-edit-bg').addEventListener('input', updateCharBgPreview);

  document.getElementById('char-edit-temp').oninput = function() {
    document.getElementById('char-temp-val').textContent = parseFloat(this.value).toFixed(2);
  };

  document.getElementById('btn-save-char').onclick = async () => {
    const data = {
      id: document.getElementById('char-edit-id').value || `char_${Date.now()}`,
      name: document.getElementById('char-edit-name').value.trim(),
      avatar: document.getElementById('char-edit-avatar').value.trim(),
      system_prompt: document.getElementById('char-edit-prompt').value.trim(),
      temperature: parseFloat(document.getElementById('char-edit-temp').value),
      chat_background: document.getElementById('char-edit-bg').value.trim(),
      model: null
    };
    if (!data.name) { showToast('角色名不能为空nya~', 'error'); return; }

    if (charId) {
      await apiPut(`/api/characters/${charId}`, data);
    } else {
      await apiPost('/api/characters', data);
    }
    AppState.characters = await apiGet('/api/characters');
    closeModal('modal-char-edit');
    renderSettingsCharList();
    renderChatList();
    renderWelcomeChars();
    showToast('角色保存成功nya~ ✨');
  };

  document.getElementById('btn-delete-char').onclick = async () => {
    if (!confirm(`确定删除角色 "${char?.name}" 吗？`)) return;
    await apiDelete(`/api/characters/${charId}`);
    AppState.characters = await apiGet('/api/characters');
    closeModal('modal-char-edit');
    renderSettingsCharList();
    renderChatList();
    renderWelcomeChars();
    showToast('角色已删除');
  };
}

// ── Group Edit (Settings) ──────────────────────
function openGroupEdit(groupId = null) {
  // For simplicity, reuse group create modal for editing
  const group = groupId ? AppState.groups.find(g => g.id === groupId) : null;

  const list = document.getElementById('group-char-pick');
  list.innerHTML = AppState.characters.map(c => `
    <label class="char-check-item">
      <input type="checkbox" value="${c.id}" class="group-char-check"
        ${group?.members?.includes(c.id) ? 'checked' : ''}>
      <span style="font-size:20px;">${getCharAvatar(c)}</span>
      <span>${escapeHtml(c.name)}</span>
    </label>
  `).join('');

  document.getElementById('group-name').value = group?.name || '';
  document.getElementById('group-avatar').value = group?.avatar || '';
  document.getElementById('modal-group-create').querySelector('.modal-header h3').textContent =
    group ? '👥 编辑群组' : '👥 新建群组';

  openModal('modal-group-create');

  document.getElementById('btn-create-group').onclick = async () => {
    const name = document.getElementById('group-name').value.trim() || '新群聊';
    const checked = [...document.querySelectorAll('.group-char-check:checked')].map(cb => cb.value);
    if (checked.length < 2) { showToast('至少选择2个成员nya~', 'error'); return; }

    const groupData = {
      id: groupId || `group_${Date.now()}`,
      name, avatar: document.getElementById('group-avatar').value.trim(),
      type: 'group',
      members: checked
    };

    if (groupId) {
      await apiPut(`/api/groups/${groupId}`, groupData);
    } else {
      await apiPost('/api/groups', groupData);
    }
    AppState.groups = await apiGet('/api/groups');
    closeModal('modal-group-create');
    renderSettingsGroupList();
    renderChatList();
    document.getElementById('modal-group-create').querySelector('.modal-header h3').textContent = '👥 新建群聊';
    showToast('群组保存成功nya~ ✨');
  };
}

// ── Invite Member to Group ─────────────────────
function openInviteMember() {
  const ac = AppState.activeChat;
  if (ac.type !== 'group' || !ac.target) return;

  const currentMembers = ac.target.members || [];
  const available = AppState.characters.filter(c => !currentMembers.includes(c.id));

  const list = document.getElementById('invite-char-pick');
  if (available.length === 0) {
    list.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:20px;">所有角色都已在群里了nya~</p>';
  } else {
    list.innerHTML = available.map(c => `
      <label class="char-check-item">
        <input type="checkbox" value="${c.id}" class="invite-char-check">
        <span style="font-size:20px;">${getCharAvatar(c)}</span>
        <span>${escapeHtml(c.name)}</span>
      </label>
    `).join('');
  }

  openModal('modal-invite-member');

  document.getElementById('btn-confirm-invite').onclick = async () => {
    const checked = [...document.querySelectorAll('.invite-char-check:checked')].map(cb => cb.value);
    if (checked.length === 0) { showToast('请至少选一个角色nya~', 'error'); return; }

    const newMembers = [...currentMembers, ...checked];
    await apiPut(`/api/groups/${ac.target.id}`, {
      ...ac.target,
      members: newMembers
    });

    // Refresh
    AppState.groups = await apiGet('/api/groups');
    const updatedGroup = AppState.groups.find(g => g.id === ac.target.id);
    if (updatedGroup) {
      ac.target = updatedGroup;
      updateChatHeader();
    }

    closeModal('modal-invite-member');
    showToast(`成功拉入 ${checked.length} 个角色nya~ ✨`);
  };
}

function updateCharBgPreview() {
  const preview = document.getElementById('char-bg-preview');
  const url = document.getElementById('char-edit-bg').value.trim();
  if (url) {
    preview.classList.remove('hidden');
    preview.style.backgroundImage = `url(${url})`;
  } else {
    preview.classList.add('hidden');
    preview.style.backgroundImage = '';
  }
}
