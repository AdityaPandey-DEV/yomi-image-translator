// High-Fidelity Manga Sample Generator for Instant Demonstration (Yomi Clean-Room)

export interface SampleMangaOption {
  id: string;
  title: string;
  genre: string;
  description: string;
  generate: () => Promise<string>;
}

/**
 * Creates an authentic Shonen Battle action manga page with dynamic panels,
 * speed lines, screentones, and Japanese speech bubbles.
 */
export async function createSampleShonenPage(): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = 900;
  canvas.height = 1350;
  const ctx = canvas.getContext('2d')!;

  // Background tone: classic manga paper off-white
  ctx.fillStyle = '#f8f8f6';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Outer border & margins
  const m = 40;
  ctx.strokeStyle = '#18181b';
  ctx.lineWidth = 5;

  // Panel 1 (Top Hero Close-up & Tension)
  drawPanel(ctx, m, m, canvas.width - m * 2, 400);
  drawSpeedlines(ctx, m + 400, m + 200, 360, 25);
  drawMangaEyeSilhouette(ctx, m + 350, m + 180, 1.2);
  drawSpeechBubble(ctx, m + 80, m + 70, 240, 150, true);
  drawJapaneseText(ctx, ['待たせたな！', '覚悟は', 'できているか？！'], m + 80, m + 70);

  // Panel 2 (Middle Left - Opponent reaction)
  const p2W = (canvas.width - m * 2 - 20) * 0.55;
  drawPanel(ctx, m, m + 420, p2W, 420);
  drawScreentoneHalftone(ctx, m, m + 420, p2W, 420);
  drawSpikeBubble(ctx, m + p2W - 130, m + 490, 220, 140);
  drawJapaneseText(ctx, ['フン…笑わせるな！', '貴様などに何が', 'できるというのだ！'], m + p2W - 130, m + 490);

  // Panel 3 (Middle Right - Power charge effect)
  const p3X = m + p2W + 20;
  const p3W = canvas.width - m * 2 - p2W - 20;
  drawPanel(ctx, p3X, m + 420, p3W, 420);
  drawEnergySparkles(ctx, p3X + p3W / 2, m + 420 + 210, 80);
  drawSpeechBubble(ctx, p3X + 50, m + 500, 180, 120, false);
  drawJapaneseText(ctx, ['力が…', '溢れてくる…！'], p3X + 50, m + 500);

  // Panel 4 (Bottom - Climactic Action Clash)
  drawPanel(ctx, m, m + 860, canvas.width - m * 2, 410);
  drawImpactBurst(ctx, canvas.width / 2, m + 1060, 280);
  drawKatakanaSFX(ctx, 'ドォォン！', canvas.width / 2 - 120, m + 1040, 68);
  drawSpeechBubble(ctx, canvas.width - m - 230, m + 920, 200, 130, true);
  drawJapaneseText(ctx, ['いくぞーーっ！！'], canvas.width - m - 230, m + 920);

  return canvas.toDataURL('image/png');
}

/**
 * Creates an authentic Romance / Slice-of-Life manga page
 */
export async function createSampleRomancePage(): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = 900;
  canvas.height = 1350;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#fafaf9';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const m = 40;
  // Panel 1: Sunset rooftop
  drawPanel(ctx, m, m, canvas.width - m * 2, 450);
  drawScreentoneHalftone(ctx, m, m, canvas.width - m * 2, 450, 0.25);
  drawCloudSilhouette(ctx, m + 100, m + 80, 200);
  drawSpeechBubble(ctx, m + 120, m + 120, 260, 160, true);
  drawJapaneseText(ctx, ['あのね…', 'ずっと前から', '伝えたかったことが…'], m + 120, m + 120);

  // Panel 2: Hesitant gaze
  drawPanel(ctx, m, m + 480, (canvas.width - m * 2 - 20) / 2, 400);
  drawSpeechBubble(ctx, m + 60, m + 530, 220, 140, false);
  drawJapaneseText(ctx, ['え…？', '何のこと…？'], m + 60, m + 530);

  // Panel 3: Heartbeat & shy smile
  const p3X = m + (canvas.width - m * 2 - 20) / 2 + 20;
  drawPanel(ctx, p3X, m + 480, (canvas.width - m * 2 - 20) / 2, 400);
  drawKatakanaSFX(ctx, 'ドキ…ドキ…', p3X + 40, m + 600, 36);
  drawSpeechBubble(ctx, p3X + 60, m + 680, 240, 130, true);
  drawJapaneseText(ctx, ['君が好きです。'], p3X + 60, m + 680);

  // Panel 4: Emotional wide resolution
  drawPanel(ctx, m, m + 900, canvas.width - m * 2, 380);
  drawSpeechBubble(ctx, canvas.width / 2 - 130, m + 980, 260, 150, true);
  drawJapaneseText(ctx, ['私も…ずっと、', '同じ気持ちだったよ。'], canvas.width / 2 - 130, m + 980);

  return canvas.toDataURL('image/png');
}

// ----------------- Helper Drawing Functions -----------------

function drawPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#18181b';
  ctx.lineWidth = 4;
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

function drawSpeechBubble(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  tail = true
) {
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#18181b';
  ctx.lineWidth = 3.5;

  ctx.beginPath();
  ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  if (tail) {
    ctx.beginPath();
    ctx.moveTo(x + w / 2 - 15, y + h - 4);
    ctx.lineTo(x + w / 2 + 25, y + h + 28);
    ctx.lineTo(x + w / 2 + 10, y + h - 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawSpikeBubble(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#18181b';
  ctx.lineWidth = 3.5;

  const cx = x + w / 2;
  const cy = y + h / 2;
  const spikes = 14;
  const rx = w / 2;
  const ry = h / 2;

  ctx.beginPath();
  for (let i = 0; i < spikes; i++) {
    const angle1 = (i / spikes) * Math.PI * 2;
    const angle2 = ((i + 0.5) / spikes) * Math.PI * 2;
    const px1 = cx + Math.cos(angle1) * rx;
    const py1 = cy + Math.sin(angle1) * ry;
    const px2 = cx + Math.cos(angle2) * (rx * 1.25);
    const py2 = cy + Math.sin(angle2) * (ry * 1.25);

    if (i === 0) ctx.moveTo(px1, py1);
    else ctx.lineTo(px1, py1);
    ctx.lineTo(px2, py2);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawJapaneseText(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  boxX: number,
  boxY: number
) {
  ctx.save();
  ctx.font = 'bold 22px "Noto Sans JP", sans-serif';
  ctx.fillStyle = '#18181b';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const totalH = lines.length * 32;
  const startY = boxY + 70 - totalH / 2 + 16;
  const centerX = boxX + 110;

  lines.forEach((line, i) => {
    ctx.fillText(line, centerX, startY + i * 32);
  });
  ctx.restore();
}

function drawKatakanaSFX(ctx: CanvasRenderingContext2D, sfx: string, x: number, y: number, size = 50) {
  ctx.save();
  ctx.font = `900 ${size}px "Noto Sans JP", "Bangers", sans-serif`;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 8;
  ctx.lineJoin = 'round';
  ctx.strokeText(sfx, x, y);
  ctx.fillStyle = '#18181b';
  ctx.fillText(sfx, x, y);
  ctx.restore();
}

function drawSpeedlines(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, count = 20) {
  ctx.save();
  ctx.strokeStyle = '#27272a';
  ctx.lineWidth = 2;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const r1 = radius * 0.45;
    const r2 = radius * 1.1;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * r1, cy + Math.sin(angle) * r1);
    ctx.lineTo(cx + Math.cos(angle) * r2, cy + Math.sin(angle) * r2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawImpactBurst(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number) {
  ctx.save();
  ctx.fillStyle = '#18181b';
  for (let i = 0; i < 36; i++) {
    const angle = (i / 36) * Math.PI * 2;
    const len = radius * (0.6 + Math.random() * 0.4);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle - 0.04) * len, cy + Math.sin(angle - 0.04) * len);
    ctx.lineTo(cx + Math.cos(angle + 0.04) * len, cy + Math.sin(angle + 0.04) * len);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawScreentoneHalftone(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  density = 0.4
) {
  ctx.save();
  ctx.fillStyle = '#71717a';
  const step = 8;
  for (let py = y; py < y + h; py += step) {
    for (let px = x; px < x + w; px += step) {
      if (Math.random() < density) {
        ctx.beginPath();
        ctx.arc(px, py, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

function drawMangaEyeSilhouette(ctx: CanvasRenderingContext2D, cx: number, cy: number, scale = 1.0) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.fillStyle = '#18181b';

  // Upper eyelid
  ctx.beginPath();
  ctx.moveTo(-60, 0);
  ctx.quadraticCurveTo(0, -35, 60, -5);
  ctx.quadraticCurveTo(0, -25, -60, 0);
  ctx.fill();

  // Iris
  ctx.beginPath();
  ctx.arc(5, 5, 22, 0, Math.PI * 2);
  ctx.fill();

  // Highlight
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(-2, 0, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawEnergySparkles(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.save();
  ctx.strokeStyle = '#18181b';
  ctx.lineWidth = 3;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    ctx.beginPath();
    ctx.moveTo(x - 10, y);
    ctx.lineTo(x + 10, y);
    ctx.moveTo(x, y - 10);
    ctx.lineTo(x, y + 10);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCloudSilhouette(ctx: CanvasRenderingContext2D, x: number, y: number, w: number) {
  ctx.save();
  ctx.strokeStyle = '#a1a1aa';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x + 30, y + 30, 25, Math.PI * 0.8, Math.PI * 1.8);
  ctx.arc(x + 70, y + 20, 35, Math.PI * 1.1, Math.PI * 2.1);
  ctx.arc(x + 120, y + 30, 25, Math.PI * 1.2, Math.PI * 0.2);
  ctx.stroke();
  ctx.restore();
}
