/* ═══════════════════════════════════════════════
   NekoChat — particles.js: 樱花粒子特效
   ═══════════════════════════════════════════════ */

let particlesCanvas, particlesCtx;
let particles = [];
let animFrameId;

function initParticles() {
  particlesCanvas = document.getElementById('particles');
  particlesCtx = particlesCanvas.getContext('2d');
  resizeCanvas();
  createParticles();
  window.addEventListener('resize', resizeCanvas);
  animateParticles();
}

function resizeCanvas() {
  particlesCanvas.width = window.innerWidth;
  particlesCanvas.height = window.innerHeight;
}

function createParticles() {
  particles = [];
  const count = Math.min(25, Math.floor(window.innerWidth / 60));

  for (let i = 0; i < count; i++) {
    particles.push({
      x: Math.random() * particlesCanvas.width,
      y: Math.random() * particlesCanvas.height,
      size: 6 + Math.random() * 14,
      speed: 0.3 + Math.random() * 1.2,
      opacity: 0.15 + Math.random() * 0.35,
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.02,
      drift: (Math.random() - 0.5) * 0.5,
      type: Math.random() < 0.15 ? 'star' : 'petal',
      color: Math.random() < 0.5 ? '#FFB6C1' : '#FFD4E0'
    });
  }
}

function animateParticles() {
  particlesCtx.clearRect(0, 0, particlesCanvas.width, particlesCanvas.height);

  particles.forEach(p => {
    p.y += p.speed;
    p.x += p.drift;
    p.rotation += p.rotSpeed;

    // Wrap around
    if (p.y > particlesCanvas.height + 20) {
      p.y = -20;
      p.x = Math.random() * particlesCanvas.width;
    }
    if (p.x > particlesCanvas.width + 20) p.x = -20;
    if (p.x < -20) p.x = particlesCanvas.width + 20;

    particlesCtx.save();
    particlesCtx.translate(p.x, p.y);
    particlesCtx.rotate(p.rotation);
    particlesCtx.globalAlpha = p.opacity;

    if (p.type === 'star') {
      drawStar(p.size);
    } else {
      drawPetal(p.size, p.color);
    }

    particlesCtx.restore();
  });

  animFrameId = requestAnimationFrame(animateParticles);
}

function drawPetal(size, color) {
  const ctx = particlesCtx;
  ctx.fillStyle = color;
  ctx.beginPath();
  // 5-petal flower shape
  const s = size / 2;
  ctx.moveTo(0, -s);
  ctx.bezierCurveTo(s * 0.6, -s, s, -s * 0.3, s, 0);
  ctx.bezierCurveTo(s, s * 0.3, s * 0.6, s, 0, s);
  ctx.bezierCurveTo(-s * 0.6, s, -s, s * 0.3, -s, 0);
  ctx.bezierCurveTo(-s, -s * 0.3, -s * 0.6, -s, 0, -s);
  ctx.fill();
}

function drawStar(size) {
  const ctx = particlesCtx;
  ctx.fillStyle = '#FFD700';
  const s = size / 2;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const angle = (i * 4 * Math.PI) / 5 - Math.PI / 2;
    const x = Math.cos(angle) * s;
    const y = Math.sin(angle) * s;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}
