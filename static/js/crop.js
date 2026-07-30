/*  NekoChat — crop.js: QQ风格头像/背景裁剪器 */

let _cropCallback = null;
let _cropType = 'avatar';
let _cropImg = null;
let _cropScale = 1;
let _cropX = 0, _cropY = 0;  // image offset in px
let _dragging = false;
let _dragStartX = 0, _dragStartY = 0;
let _dragImgX = 0, _dragImgY = 0;

// ── Unified upload + crop ────────────────────────
function uploadWithCrop(fileInput, type, callback) {
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;
  _cropCallback = callback;
  _cropType = type || 'avatar';

  const reader = new FileReader();
  reader.onload = (e) => openCropModal(e.target.result, type);
  reader.readAsDataURL(file);
}

// ── Open crop modal ──────────────────────────────
function openCropModal(imageUrl, type) {
  type = type || 'avatar';
  _cropType = type;
  _cropScale = 1;
  _cropX = 0;
  _cropY = 0;

  const modal = document.getElementById('modal-crop');
  modal.classList.remove('hidden');

  const frame = document.getElementById('crop-frame');
  // Fixed viewport: circle for avatar, rectangle for background
  if (type === 'background') {
    frame.style.width = '340px';
    frame.style.height = '200px';
    frame.style.borderRadius = '12px';
  } else {
    frame.style.width = '250px';
    frame.style.height = '250px';
    frame.style.borderRadius = '50%';
  }
  frame.style.overflow = 'hidden';
  frame.style.position = 'relative';
  frame.style.margin = '0 auto';
  frame.style.border = '3px solid var(--accent)';
  frame.style.cursor = 'grab';

  const inner = document.getElementById('crop-inner');
  inner.innerHTML = '';
  inner.style.position = 'absolute';
  inner.style.transformOrigin = '0 0';

  _cropImg = document.createElement('img');
  _cropImg.src = imageUrl;
  _cropImg.style.display = 'block';
  _cropImg.style.userSelect = 'none';
  _cropImg.style.pointerEvents = 'none';
  _cropImg.onload = () => {
    // Scale to fit frame width
    const fw = frame.clientWidth;
    _cropScale = fw / _cropImg.naturalWidth;
    _cropX = 0;
    _cropY = -(frame.clientHeight - _cropImg.naturalHeight * _cropScale) / 2;
    applyCropTransform(frame);
  };
  inner.appendChild(_cropImg);

  // Mouse drag
  frame.onmousedown = (e) => {
    _dragging = true;
    _dragStartX = e.clientX;
    _dragStartY = e.clientY;
    _dragImgX = _cropX;
    _dragImgY = _cropY;
    frame.style.cursor = 'grabbing';
    e.preventDefault();
  };

  document.onmousemove = (e) => {
    if (!_dragging) return;
    _cropX = _dragImgX + (e.clientX - _dragStartX);
    _cropY = _dragImgY + (e.clientY - _dragStartY);
    applyCropTransform(frame);
  };

  document.onmouseup = () => {
    if (_dragging) { _dragging = false; frame.style.cursor = 'grab'; }
  };

  // Scroll wheel zoom
  frame.onwheel = (e) => {
    e.preventDefault();
    const oldScale = _cropScale;
    _cropScale = Math.max(0.3, Math.min(3, _cropScale - e.deltaY * 0.001));
    // Keep center point steady
    const rect = frame.getBoundingClientRect();
    const cx = (e.clientX - rect.left) / oldScale;
    const cy = (e.clientY - rect.top) / oldScale;
    _cropX = e.clientX - rect.left - cx * _cropScale;
    _cropY = e.clientY - rect.top - cy * _cropScale;
    applyCropTransform(frame);
  };

  // Close
  modal.querySelector('.close-btn').onclick = () => {
    modal.classList.add('hidden');
    document.onmousemove = null;
    document.onmouseup = null;
  };

  // Confirm: canvas crop
  document.getElementById('btn-crop-confirm').onclick = () => {
    const fw = frame.clientWidth;
    const fh = frame.clientHeight;
    const canvas = document.createElement('canvas');
    canvas.width = fw;
    canvas.height = fh;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(_cropImg, -_cropX / _cropScale, -_cropY / _cropScale,
      fw / _cropScale, fh / _cropScale, 0, 0, fw, fh);

    canvas.toBlob(blob => {
      const fd = new FormData();
      fd.append('file', blob, 'crop_result.png');
      fd.append('type', type === 'background' ? 'backgrounds' : 'avatars');
      fetch('/api/upload', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(d => { if (d.status === 'ok' && _cropCallback) _cropCallback(d.path); })
        .catch(() => { if (_cropCallback) _cropCallback(_cropImg.src); });
      modal.classList.add('hidden');
      document.onmousemove = null;
      document.onmouseup = null;
    }, 'image/png');
  };
}

function applyCropTransform(frame) {
  const inner = document.getElementById('crop-inner');
  inner.style.transform = `translate(${_cropX}px, ${_cropY}px) scale(${_cropScale})`;
  document.getElementById('crop-zoom-val').textContent = Math.round(_cropScale * 100) + '%';
  document.getElementById('crop-zoom').value = Math.round(_cropScale * 100);
}

// Init zoom slider
document.getElementById('crop-zoom')?.addEventListener('input', function() {
  _cropScale = parseInt(this.value) / 100;
  const frame = document.getElementById('crop-frame');
  applyCropTransform(frame);
});
