// 示例照片：优先取 /samples/*.jpg（由 Lead 放入 public/），
// 缺失时在本地程序化生成一张近似照片的占位画面，保证空状态与演示可用。

export type SampleId = 'mountain' | 'city' | 'portrait';

export interface SampleDef {
  id: SampleId;
  label: string;
  sub: string;
  file: string;
  width: number;
  height: number;
}

export const SAMPLES: readonly SampleDef[] = [
  { id: 'mountain', label: '山野', sub: 'MOUNTAIN', file: 'mountain.jpg', width: 1600, height: 1067 },
  { id: 'city', label: '城市', sub: 'CITY', file: 'city.jpg', width: 1600, height: 1067 },
  { id: 'portrait', label: '人像', sub: 'PORTRAIT', file: 'portrait.jpg', width: 1067, height: 1600 },
];

export interface LoadedSample {
  bytes: Uint8Array;
  name: string;
  generated: boolean;
}

export function sampleUrl(id: SampleId): string {
  const def = SAMPLES.find((item) => item.id === id) ?? SAMPLES[0];
  return new URL(`samples/${def?.file ?? 'mountain.jpg'}`, document.baseURI).toString();
}

function looksLikeImage(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  // JPEG
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;
  // PNG
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true;
  // WebP
  const riff = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
  const webp = bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  if (riff && webp) return true;
  // GIF
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return true;
  return false;
}

export async function fetchSample(id: SampleId): Promise<LoadedSample> {
  const def = SAMPLES.find((item) => item.id === id) ?? SAMPLES[0];
  try {
    const response = await fetch(sampleUrl(id), { cache: 'no-store' });
    if (response.ok) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (looksLikeImage(bytes)) {
        return { bytes, name: `示例 · ${def?.label ?? ''}`, generated: false };
      }
    }
  } catch {
    // 静默回退：示例照片尚未就绪是正常的开发状态
  }
  const bytes = await generateSample(id);
  return { bytes, name: `示例 · ${def?.label ?? ''}`, generated: true };
}

// ---------------------------------------------------------------------------
// 程序化占位画面（只用于开发期 / 示例缺失时的 graceful fallback）
// ---------------------------------------------------------------------------

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function linear(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  stops: [number, string][],
): CanvasGradient {
  const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  return gradient;
}

function radial(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  stops: [number, string][],
): CanvasGradient {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  return gradient;
}

function ridge(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  baseY: number,
  amp: number,
  seed: number,
  color: string,
  detail = 3,
): void {
  const random = rng(seed);
  const phase1 = random() * Math.PI * 2;
  const phase2 = random() * Math.PI * 2;
  const phase3 = random() * Math.PI * 2;
  ctx.beginPath();
  ctx.moveTo(0, height);
  for (let i = 0; i <= 120; i += 1) {
    const t = i / 120;
    const x = t * width;
    const wave =
      Math.sin(t * Math.PI * 2.1 + phase1) * 0.55 +
      Math.sin(t * Math.PI * 5.3 + phase2) * 0.3 * detail +
      Math.sin(t * Math.PI * 11.7 + phase3) * 0.15;
    const y = baseY - wave * amp - Math.sin(t * Math.PI + phase2) * amp * 0.25;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(width, height);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function mist(
  ctx: CanvasRenderingContext2D,
  width: number,
  y: number,
  height: number,
  color: string,
): void {
  const gradient = linear(ctx, 0, y, 0, y + height, [
    [0, 'rgba(0,0,0,0)'],
    [0.45, color],
    [1, 'rgba(0,0,0,0)'],
  ]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, y, width, height);
}

function grain(ctx: CanvasRenderingContext2D, width: number, height: number, strength: number): void {
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const random = rng(width * 31 + height * 17);
  for (let i = 0; i < data.length; i += 4) {
    const noise = (random() - 0.5) * strength;
    data[i] = Math.max(0, Math.min(255, (data[i] ?? 0) + noise));
    data[i + 1] = Math.max(0, Math.min(255, (data[i + 1] ?? 0) + noise));
    data[i + 2] = Math.max(0, Math.min(255, (data[i + 2] ?? 0) + noise));
  }
  ctx.putImageData(image, 0, 0);
}

function vignette(ctx: CanvasRenderingContext2D, width: number, height: number, strength = 0.42): void {
  const gradient = radial(ctx, width * 0.5, height * 0.48, Math.max(width, height) * 0.78, [
    [0, 'rgba(0,0,0,0)'],
    [0.62, 'rgba(0,0,0,0)'],
    [1, `rgba(0,0,0,${strength})`],
  ]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

function drawMountain(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.fillStyle = linear(ctx, 0, 0, 0, height, [
    [0, '#0b101c'],
    [0.28, '#232a44'],
    [0.52, '#5c4d63'],
    [0.68, '#a56f65'],
    [0.78, '#d99a6d'],
    [0.84, '#f0b984'],
    [1, '#8a6a5a'],
  ]);
  ctx.fillRect(0, 0, width, height);

  // 落日光晕
  const sunX = width * 0.66;
  const sunY = height * 0.79;
  ctx.fillStyle = radial(ctx, sunX, sunY, width * 0.42, [
    [0, 'rgba(255,224,178,0.85)'],
    [0.16, 'rgba(255,198,140,0.42)'],
    [0.5, 'rgba(214,138,94,0.12)'],
    [1, 'rgba(0,0,0,0)'],
  ]);
  ctx.fillRect(0, 0, width, height);
  ctx.beginPath();
  ctx.arc(sunX, sunY, width * 0.019, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,238,208,0.95)';
  ctx.fill();

  // 云层
  const random = rng(9147);
  ctx.save();
  for (let i = 0; i < 7; i += 1) {
    const y = height * (0.22 + random() * 0.36);
    const w = width * (0.25 + random() * 0.5);
    const x = width * random() - w * 0.2;
    const h = height * (0.012 + random() * 0.03);
    const warm = random() > 0.45;
    ctx.fillStyle = warm ? 'rgba(230,176,140,0.14)' : 'rgba(30,32,51,0.22)';
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y, w / 2, h, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // 远山
  ridge(ctx, width, height, height * 0.62, height * 0.1, 11, '#7d6370', 2);
  ctx.fillStyle = linear(ctx, 0, height * 0.5, 0, height * 0.72, [
    [0, 'rgba(240,185,132,0.22)'],
    [1, 'rgba(240,185,132,0)'],
  ]);
  ctx.fillRect(0, height * 0.5, width, height * 0.22);
  ridge(ctx, width, height, height * 0.7, height * 0.13, 27, '#4b3d50', 3);
  mist(ctx, width, height * 0.6, height * 0.16, 'rgba(226,170,136,0.16)');
  ridge(ctx, width, height, height * 0.79, height * 0.1, 53, '#2b2637', 3);
  mist(ctx, width, height * 0.7, height * 0.12, 'rgba(210,150,120,0.12)');
  ridge(ctx, width, height, height * 0.92, height * 0.08, 79, '#14141d', 4);

  // 前景山脊 + 松影
  ctx.beginPath();
  ctx.moveTo(0, height);
  ctx.lineTo(0, height * 0.9);
  for (let i = 0; i <= 40; i += 1) {
    const t = i / 40;
    const y = height * 0.9 - Math.sin(t * Math.PI * 1.4 + 0.6) * height * 0.035;
    ctx.lineTo(t * width, y);
  }
  ctx.lineTo(width, height);
  ctx.closePath();
  ctx.fillStyle = '#0b0b12';
  ctx.fill();

  const trees = rng(555);
  for (let i = 0; i < 26; i += 1) {
    const x = width * trees();
    const baseY = height * (0.885 + trees() * 0.025);
    const treeH = height * (0.02 + trees() * 0.05);
    const treeW = treeH * 0.34;
    ctx.beginPath();
    ctx.moveTo(x, baseY - treeH);
    ctx.lineTo(x - treeW, baseY);
    ctx.lineTo(x + treeW, baseY);
    ctx.closePath();
    ctx.fillStyle = 'rgba(6,7,11,0.92)';
    ctx.fill();
  }

  grain(ctx, width, height, 16);
  vignette(ctx, width, height, 0.5);
}

function drawCity(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.fillStyle = linear(ctx, 0, 0, 0, height, [
    [0, '#0a0f1c'],
    [0.3, '#202741'],
    [0.52, '#584a5f'],
    [0.68, '#a86f63'],
    [0.78, '#da9868'],
    [0.86, '#f2bb84'],
    [1, '#5c4a45'],
  ]);
  ctx.fillRect(0, 0, width, height);

  const sunX = width * 0.5;
  const sunY = height * 0.75;
  ctx.fillStyle = radial(ctx, sunX, sunY, width * 0.5, [
    [0, 'rgba(255,215,160,0.5)'],
    [0.28, 'rgba(255,180,120,0.18)'],
    [1, 'rgba(0,0,0,0)'],
  ]);
  ctx.fillRect(0, 0, width, height);

  const random = rng(20261103);

  const layer = (
    baseY: number,
    minH: number,
    maxH: number,
    minW: number,
    maxW: number,
    color: string,
    windows: number,
  ): void => {
    let x = -width * 0.04;
    while (x < width) {
      const w = width * (minW + random() * (maxW - minW));
      const h = height * (minH + random() * (maxH - minH));
      const top = baseY - h;
      ctx.fillStyle = color;
      ctx.fillRect(x, top, w, h + height * 0.1);
      if (windows > 0) {
        const cols = Math.max(2, Math.floor(w / (width * 0.018)));
        const rows = Math.max(2, Math.floor(h / (height * 0.042)));
        for (let c = 0; c < cols; c += 1) {
          for (let r = 0; r < rows; r += 1) {
            if (random() > windows) continue;
            const wx = x + w * 0.12 + (w * 0.76 * c) / Math.max(1, cols - 1);
            const wy = top + h * 0.08 + (h * 0.8 * r) / Math.max(1, rows - 1);
            const warm = random() > 0.25;
            ctx.fillStyle = warm ? 'rgba(255,198,124,0.55)' : 'rgba(160,196,214,0.28)';
            ctx.fillRect(wx, wy, w / (cols * 3.4), height * 0.009);
          }
        }
      }
      x += w + width * (0.004 + random() * 0.012);
    }
  };

  ctx.fillStyle = linear(ctx, 0, height * 0.55, 0, height * 0.78, [
    [0, 'rgba(235,170,120,0.2)'],
    [1, 'rgba(235,170,120,0)'],
  ]);
  ctx.fillRect(0, height * 0.55, width, height * 0.3);

  layer(height * 0.74, 0.12, 0.3, 0.018, 0.055, '#332f3f', 0.22);
  mist(ctx, width, height * 0.66, height * 0.12, 'rgba(224,170,130,0.14)');
  layer(height * 0.83, 0.16, 0.38, 0.025, 0.07, '#1d1c28', 0.3);
  layer(height * 0.96, 0.2, 0.46, 0.03, 0.1, '#0d0e14', 0.34);

  // 街道余光
  ctx.fillStyle = linear(ctx, 0, height * 0.86, 0, height, [
    [0, 'rgba(240,170,110,0)'],
    [1, 'rgba(240,170,110,0.22)'],
  ]);
  ctx.fillRect(0, height * 0.86, width, height * 0.14);

  grain(ctx, width, height, 15);
  vignette(ctx, width, height, 0.52);
}

function drawPortrait(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.fillStyle = radial(ctx, width * 0.4, height * 0.3, Math.max(width, height) * 0.85, [
    [0, '#4a382c'],
    [0.35, '#2b211b'],
    [0.72, '#161210'],
    [1, '#080706'],
  ]);
  ctx.fillRect(0, 0, width, height);

  // 背景暖色光斑
  const random = rng(77121);
  for (let i = 0; i < 14; i += 1) {
    const x = width * random();
    const y = height * (random() * 0.55);
    const r = width * (0.02 + random() * 0.09);
    ctx.fillStyle = `rgba(229,181,103,${0.03 + random() * 0.06})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 柔光
  ctx.fillStyle = radial(ctx, width * 0.34, height * 0.26, width * 0.52, [
    [0, 'rgba(255,224,178,0.2)'],
    [1, 'rgba(255,224,178,0)'],
  ]);
  ctx.fillRect(0, 0, width, height);

  // 人像剪影（头 + 肩）
  const headX = width * 0.5;
  const headY = height * 0.42;
  const headRx = width * 0.145;
  const headRy = height * 0.19;
  const shoulderTop = height * 0.66;

  const silhouette = (offsetX: number, fill: string): void => {
    ctx.save();
    ctx.translate(offsetX, 0);
    ctx.beginPath();
    ctx.ellipse(headX, headY, headRx, headRy, 0, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(headX - width * 0.075, headY + headRy * 0.82);
    ctx.bezierCurveTo(
      headX - width * 0.16,
      headY + headRy * 1.15,
      headX - width * 0.31,
      shoulderTop + height * 0.01,
      headX - width * 0.36,
      height,
    );
    ctx.lineTo(headX + width * 0.36, height);
    ctx.bezierCurveTo(
      headX + width * 0.31,
      shoulderTop + height * 0.01,
      headX + width * 0.16,
      headY + headRy * 1.15,
      headX + width * 0.075,
      headY + headRy * 0.82,
    );
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  // 轮廓光：向右偏移的暖色剪影
  silhouette(width * 0.012, 'rgba(229,181,103,0.5)');
  silhouette(0, '#0b0908');

  // 面部一侧微光
  ctx.fillStyle = radial(ctx, headX - headRx * 0.55, headY - headRy * 0.2, headRx * 0.9, [
    [0, 'rgba(255,215,170,0.16)'],
    [1, 'rgba(255,215,170,0)'],
  ]);
  ctx.fillRect(width * 0.15, height * 0.15, width * 0.55, height * 0.5);

  grain(ctx, width, height, 14);
  vignette(ctx, width, height, 0.55);
}

function drawScene(id: SampleId, ctx: CanvasRenderingContext2D, width: number, height: number): void {
  if (id === 'city') drawCity(ctx, width, height);
  else if (id === 'portrait') drawPortrait(ctx, width, height);
  else drawMountain(ctx, width, height);
}

function canvasOf(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D 不可用');
  return { canvas, ctx };
}

export async function generateSample(id: SampleId): Promise<Uint8Array> {
  const def = SAMPLES.find((item) => item.id === id) ?? SAMPLES[0];
  const { canvas, ctx } = canvasOf(def?.width ?? 1600, def?.height ?? 1067);
  drawScene(id, ctx, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error('占位图生成失败'))),
      'image/jpeg',
      0.92,
    );
  });
  return new Uint8Array(await blob.arrayBuffer());
}

const thumbCache = new Map<string, string>();

export async function sampleThumb(id: SampleId, width = 240, height = 160): Promise<string> {
  const key = `${id}:${width}x${height}`;
  const cached = thumbCache.get(key);
  if (cached) return cached;
  const def = SAMPLES.find((item) => item.id === id) ?? SAMPLES[0];
  const ratio = (def?.height ?? 3) / (def?.width ?? 4);
  const w = Math.round(width);
  const h = Math.round(width * ratio);
  const { canvas, ctx } = canvasOf(w, h);
  drawScene(id, ctx, w, h);
  const url = canvas.toDataURL('image/jpeg', 0.75);
  thumbCache.set(key, url);
  return url;
}
