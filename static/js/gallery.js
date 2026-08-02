/*  NekoChat — gallery.js: 图片选择器 + 相册管理  */

// ── Gallery Picker ──────────────────────────────
let _galleryTarget = null;  // input element ID to fill on select

async function openGallery(targetInputId, type) {
  _galleryTarget = targetInputId;
  document.getElementById('gallery-type-filter').value = type || 'backgrounds';
  await loadGalleryImages();
  // If another modal is already open, push gallery to the top layer
  if (document.querySelectorAll('.modal:not(.hidden)').length > 0) {
    document.getElementById('modal-gallery').style.zIndex = '750';
  }
  openModal('modal-gallery');
}

async function loadGalleryImages() {
  const type = document.getElementById('gallery-type-filter').value;
  const grid = document.getElementById('gallery-grid');
  const empty = document.getElementById('gallery-empty');

  try {
    const images = await apiGet(`/api/uploads/list?type=${type}`);
    // Only show image files (skip video/audio)
    const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const filtered = images.filter(img => {
      const name = (img.name || img.path || '').toLowerCase();
      return imageExts.some(ext => name.endsWith(ext));
    });
    if (filtered.length === 0) {
      grid.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');
    grid.innerHTML = filtered.map(img => `
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
  // Reset gallery z-index
  document.getElementById('modal-gallery').style.zIndex = '';
  // If another modal is still open beneath gallery, re-show overlay
  if (document.querySelectorAll('.modal:not(.hidden)').length > 0) {
    document.getElementById('overlay').classList.remove('hidden');
  }
}

// ── Album ───────────────────────────────────────
let _albumCharId = null;
let _albumPhotos = [];  // cached for prev/next navigation
let _previewIndex = -1;

async function openAlbum(albumId, displayTitle) {
  _albumCharId = albumId;
  const title = displayTitle || (AppState.characters.find(c => c.id === albumId)?.name || 'AI');
  document.getElementById('album-title').textContent = `📷 ${title} 的相册`;
  document.getElementById('album-url').value = '';
  document.getElementById('album-caption').value = '';
  await loadAlbum();
  openModal('modal-album');
}

async function loadAlbum() {
  const grid = document.getElementById('album-grid');
  const empty = document.getElementById('album-empty');
  try {
    _albumPhotos = await apiGet(`/api/albums/${_albumCharId}`);
    if (_albumPhotos.length === 0) {
      grid.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');
    grid.innerHTML = _albumPhotos.map((p, i) => {
      const ext = (p.url || '').split('.').pop().toLowerCase();
      const isVideo = ['mp4','webm'].includes(ext);
      const isAudio = ['mp3','wav','ogg'].includes(ext);
      let mediaHtml;
      if (isVideo) {
        mediaHtml = `<video src="${p.url}" muted autoplay loop preload="metadata" style="width:100%;height:100%;object-fit:cover;" onclick="event.stopPropagation();showImagePreview('${p.url}')" onerror="this.style.display='none'"></video>`;
      } else if (isAudio) {
        mediaHtml = `<audio src="${p.url}" controls style="width:100%;"></audio>`;
      } else {
        mediaHtml = `<img src="${p.url}" loading="lazy" onclick="showImagePreview('${p.url}', ${i})"
             onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🖼️</text></svg>'"
             style="cursor:pointer;">`;
      }
      return `
      <div class="album-photo">
        ${mediaHtml}
        ${p.caption ? `<div class="album-photo-caption">${escapeHtml(p.caption)}</div>` : ''}
        <button class="album-photo-delete" onclick="event.stopPropagation();deleteAlbumPhoto(${i})">✕</button>
      </div>
    `}).join('');
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
    if (ac.type === 'story') {
      openAlbum(ac.chat_id, ac.target._storyTitle || ac.target.name);
    } else if (ac.type === 'group') {
      openAlbum(ac.chat_id, ac.target.name || '群聊');
    } else if (ac.target?.id) {
      openAlbum(ac.target.id);
    }
  });

  // Album add photo
  document.getElementById('btn-add-photo')?.addEventListener('click', () => {
    const url = document.getElementById('album-url').value.trim();
    const caption = document.getElementById('album-caption').value.trim();
    addAlbumPhoto(url, caption);
  });

  // Album gallery picker — don't close album, open gallery on top
  document.getElementById('btn-album-gallery')?.addEventListener('click', () => {
    openGallery('album-url', 'backgrounds');
  });

  // Album upload (batch)
  document.getElementById('btn-album-upload')?.addEventListener('click', () => {
    document.getElementById('album-upload-file').click();
  });
  document.getElementById('album-upload-file')?.addEventListener('change', async (e) => {
    const files = [...e.target.files];
    if (!files.length) return;
    const caption = document.getElementById('album-caption').value.trim();
    let uploaded = 0;
    let isFirst = true;
    for (const file of files) {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', 'backgrounds');
      try {
        const resp = await fetch('/api/upload', { method: 'POST', body: formData });
        const data = await resp.json();
        if (data.status === 'ok') {
          await apiPost(`/api/albums/${_albumCharId}`, { url: data.path, caption: isFirst ? caption : '' });
          isFirst = false;
          uploaded++;
        }
      } catch {}
    }
    if (uploaded > 0) {
      await loadAlbum();
      showToast(`已上传 ${uploaded} 张到相册nya~ ✨`);
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

  // Story modal gallery buttons
  document.getElementById('btn-upload-story-avatar')?.insertAdjacentHTML('afterend',
    '<button id="btn-gallery-story-av" class="btn-sm" style="margin-left:4px;">🖼️</button>');
  document.getElementById('btn-gallery-story-av')?.addEventListener('click', () => {
    openGallery('story-avatar', 'avatars');
  });

  document.getElementById('btn-upload-story-bg')?.insertAdjacentHTML('afterend',
    '<button id="btn-gallery-story-bg" class="btn-sm" style="margin-left:4px;">🖼️</button>');
  document.getElementById('btn-gallery-story-bg')?.addEventListener('click', () => {
    openGallery('story-bg', 'backgrounds');
  });
});
