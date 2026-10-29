/** Dibujo de histogramas (WBC/RBC/PLT) en canvas. */
'use strict';

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{points?: number[], 'Scale(fl)'?: number}} graph
 */
export function drawGraph(canvas, graph) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 240;
  const cssH = canvas.clientHeight || 130;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssW, cssH);

  const points = Array.isArray(graph.points) ? graph.points : [];
  if (!points.length) return;

  const max = Math.max(1, ...points);
  const pad = { l: 6, r: 6, t: 8, b: 16 };
  const width = cssW - pad.l - pad.r;
  const height = cssH - pad.t - pad.b;

  // Rejilla horizontal
  ctx.strokeStyle = '#e7eef5';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = pad.t + (height * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(pad.l + width, y);
    ctx.stroke();
  }

  const step = width / (points.length - 1 || 1);
  const gradient = ctx.createLinearGradient(0, pad.t, 0, pad.t + height);
  gradient.addColorStop(0, 'rgba(15,163,177,.32)');
  gradient.addColorStop(1, 'rgba(15,163,177,.02)');

  const linePath = new Path2D();
  points.forEach((value, index) => {
    const x = pad.l + index * step;
    const y = pad.t + height - (value / max) * height;
    if (index === 0) linePath.moveTo(x, y);
    else linePath.lineTo(x, y);
  });

  ctx.save();
  ctx.lineTo(pad.l + width, pad.t + height);
  ctx.lineTo(pad.l, pad.t + height);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = '#0d6e8c';
  ctx.lineWidth = 1.6;
  ctx.stroke(linePath);

  ctx.fillStyle = '#8aa0b2';
  ctx.font = '10px Segoe UI, sans-serif';
  ctx.fillText('0', pad.l, cssH - 3);
  ctx.textAlign = 'right';
  ctx.fillText(String(graph['Scale(fl)'] ?? ''), pad.l + width, cssH - 3);
  ctx.textAlign = 'left';
}
