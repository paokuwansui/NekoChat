/*  NekoChat — gallery.js: 图片选择器 + 相册管理  */

// ── Gallery Picker ──────────────────────────────
let _galleryTarget = null;  // input element ID to fill on select

async function openGallery(targetInputId, type) {
  _galleryTarget = targetInputId;
  document.getElementById('gallery-type-filter').value = type || 'backgrounds';
  await loadGalleryImages();
  openModal('modal-gallery');
}

async function loadGalleryImages() {
  const type = document.getElementById('gallery-type-filter').value;
  const grid = document.getElementById('gallery-grid');
  const empty = document.getElementById('gallery-empty');

  try {
    const images = await apiGet(`/api/uploads/list?type=${type}`);
    if (images.length === 0) {
      grid.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');
    grid.innerHTML = images.map(img => `
      <img src="${img.path}" class="gallery-img"
           onclick="selectGalleryImage('${img.path}')"
           title="${img.name}" loading="lazy">
    `).join('');
  } catch (e) {
    grid.innerHTML = '';
    empty.textContent = '加载失败nya~';
    empty.classList.remove('hidden');
  }
}

function selectGalleryImage(path) {
  if (_galleryTarget) {
    const input = document.getElementById(_galleryTarget);
    if (input) {
      input.value = path;
      input.dispatchEvent(new Event('input'));
      // Trigger preview if it's a bg/avatar input
      if (typeof updateCharBgPreview === 'function') updateCharBgPreview();
      if (typeof updateBgPreview === 'function') updateBgPreview();
    }
  }
  closeModal('modal-gallery');
}

// ── Album ───────────────────────────────────────
let _albumCharId = null;

async function openAlbum(charId) {
  _albumCharId = charId;
  const char = AppState.characters.find(c => c.id === charId);
  document.getElementById('album-title').textContent = `📷 ${char?.name || 'AI'} 的相册`;
  document.getElementById('album-url').value = '';
  document.getElementById('album-caption').value = '';
  await loadAlbum();
  openModal('modal-album');
}

async function loadAlbum() {
  const grid = document.getElementById('album-grid');
  const empty = document.getElementById('album-empty');
  try {
    const photos = await apiGet(`/api/albums/${_albumCharId}`);
    if (photos.length === 0) {
      grid.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');
    grid.innerHTML = photos.map((p, i) => `
      <div class="album-photo">
        <img src="${p.url}" loading="lazy" onclick="showImagePreview('${p.url}')"
             onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🖼️</text></svg>'"
             style="cursor:pointer;">
        ${p.caption ? `<div class="album-photo-caption">${escapeHtml(p.caption)}</div>` : ''}
        <button class="album-photo-delete" onclick="event.stopPropagation();deleteAlbumPhoto(${i})">✕</button>
      </div>
    `).join('');
  } catch (e) {
    grid.innerHTML = '';
    empty.textContent = '加载失败nya~';
    empty.classList.remove('hidden');
  }
}

async function addAlbumPhoto(url, caption) {
  if (!url) { showToast('请输入图片URL或上传nya~', 'error'); return; }
  await apiPost(`/api/albums/${_albumCharId}`, { url, caption });
  document.getElementById('album-url').value = '';
  document.getElementById('album-caption').value = '';
  await loadAlbum();
  showToast('已添加到相册nya~ ✨');
}

async function deleteAlbumPhoto(idx) {
  await apiDelete(`/api/albums/${_albumCharId}/${idx}`);
  await loadAlbum();
}

// ── Event bindings ──────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Gallery type filter
  const filter = document.getElementById('gallery-type-filter');
  if (filter) filter.addEventListener('change', loadGalleryImages);

  // Album button
  document.getElementById('btn-album')?.addEventListener('click', () => {
    const ac = AppState.activeChat;
    if (ac.target?.id) openAlbum(ac.target.id);
  });

  // Album add photo
  document.getElementById('btn-add-photo')?.addEventListener('click', () => {
    const url = document.getElementById('album-url').value.trim();
    const caption = document.getElementById('album-caption').value.trim();
    addAlbumPhoto(url, caption);
  });

  // Album gallery picker
  document.getElementById('btn-album-gallery')?.addEventListener('click', () => {
    closeModal('modal-album');
    setTimeout(() => openGallery('album-url', 'backgrounds'), 200);
  });

  // Album upload
  document.getElementById('btn-album-upload')?.addEventListener('click', () => {
    document.getElementById('album-upload-file').click();
  });
  document.getElementById('album-upload-file')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', 'backgrounds');
    const resp = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await resp.json();
    if (data.status === 'ok') {
      document.getElementById('album-url').value = data.path;
    }
    e.target.value = '';
  });

  // Settings gallery buttons
  document.getElementById('btn-upload-bg')?.insertAdjacentHTML('afterend',
    '<button id="btn-gallery-bg" class="btn-sm" style="margin-left:4px;">🖼️</button>');
  document.getElementById('btn-gallery-bg')?.addEventListener('click', () => {
    openGallery('set-chat-bg', 'backgrounds');
  });

  document.getElementById('btn-upload-char-bg')?.insertAdjacentHTML('afterend',
    '<button id="btn-gallery-char-bg" class="btn-sm" style="margin-left:4px;">🖼️</button>');
  document.getElementById('btn-gallery-char-bg')?.addEventListener('click', () => {
    openGallery('char-edit-bg', 'backgrounds');
  });

  document.getElementById('btn-upload-char-avatar')?.insertAdjacentHTML('afterend',
    '<button id="btn-gallery-char-av" class="btn-sm" style="margin-left:4px;">🖼️</button>');
  document.getElementById('btn-gallery-char-av')?.addEventListener('click', () => {
    openGallery('char-edit-avatar', 'avatars');
  });
});
