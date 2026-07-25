const RULER_SIZE = 16;
const MAJOR_INTERVAL = 100;
const MINOR_INTERVAL = 20;

let resizeObserver = null;

function drawRuler(canvas, length, orientation) {
  const dpr = window.devicePixelRatio || 1;
  const w = orientation === 'horizontal' ? length : RULER_SIZE;
  const h = orientation === 'horizontal' ? RULER_SIZE : length;

  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = '#8a94a6';
  ctx.fillStyle = '#e8e8e8';
  ctx.font = '10px monospace';
  ctx.textBaseline = 'alphabetic';
  ctx.lineWidth = 1;

  for (let pos = 0; pos <= length; pos += MINOR_INTERVAL) {
    const isMajor = pos % MAJOR_INTERVAL === 0;
    const tickLen = isMajor ? RULER_SIZE * 0.6 : RULER_SIZE * 0.3;

    ctx.beginPath();
    if (orientation === 'horizontal') {
      ctx.moveTo(pos + 0.5, RULER_SIZE);
      ctx.lineTo(pos + 0.5, RULER_SIZE - tickLen);
    } else {
      ctx.moveTo(RULER_SIZE, pos + 0.5);
      ctx.lineTo(RULER_SIZE - tickLen, pos + 0.5);
    }
    ctx.stroke();

    if (isMajor && pos > 0) {
      if (orientation === 'horizontal') {
        ctx.fillText(String(pos), pos + 3, 10);
      } else {
        ctx.save();
        ctx.translate(9, pos - 3);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(String(pos), 0, 0);
        ctx.restore();
      }
    }
  }
}

export function drawRulers() {
  const container = document.getElementById('viewArea');
  const topCanvas = document.getElementById('rulerTopCanvas');
  const leftCanvas = document.getElementById('rulerLeftCanvas');
  if (!container || !topCanvas || !leftCanvas) return;

  const rect = container.getBoundingClientRect();
  drawRuler(topCanvas, Math.max(0, rect.width - RULER_SIZE), 'horizontal');
  drawRuler(leftCanvas, Math.max(0, rect.height - RULER_SIZE), 'vertical');
}

export function initRulers() {
  const container = document.getElementById('viewArea');
  if (!container) return;

  resizeObserver = new ResizeObserver(() => drawRulers());
  resizeObserver.observe(container);
}
