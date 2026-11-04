// 无 wasm 时的开发/回退引擎：用 Canvas2D 近似渲染同一份 RenderConfig。
// 真正的实现是 Rust 内核；这个 mock 只用于开发期或 wasm 缺失时保证 UI 可用。
import type {
  BatchExportItem,
  BatchExportResult,
  Block,
  BlockRect,
  Engine,
  ExportResult,
  ExifInfo,
  FrameConfig,
  FrameTemplate,
  LogoBlock,
  PhotoInfo,
  RenderConfig,
  RenderMeta,
  RenderResult,
  TextBlock,
} from './types';

const EMPTY_EXIF: ExifInfo = {
  camera: 'SONY α7 IV',
  make: 'SONY',
  model: 'ILCE-7M4',
  lens: 'FE 24-70mm F2.8 GM II',
  focal: '35mm',
  aperture: 'f/2.8',
  shutter: '1/250s',
  iso: 'ISO 100',
  date: '2026.11.03 19:34',
  datetime: '2026:11:03 19:34:08',
  artist: '',
  copyright: '',
};

function templateFrame(template: FrameTemplate, photoW: number, photoH: number): FrameConfig {
  const short = Math.min(photoW, photoH);
  const presets: Record<FrameTemplate, FrameConfig> = {
    white: { template, margin: 0.045, bottomRatio: 3.0, background: '#f6f3ee', radius: 0, filmHoles: true },
    polaroid: { template, margin: 0.05, bottomRatio: 4.2, background: '#f7f4ee', radius: 0, filmHoles: true },
    film: { template, margin: 0.04, bottomRatio: 1.9, background: '#0b0b0b', radius: 0, filmHoles: true },
    black: { template, margin: 0.035, bottomRatio: 1, background: '#0a0a0a', radius: 0, filmHoles: false },
    none: { template, margin: 0, bottomRatio: 1, background: '#000000', radius: 0, filmHoles: false },
  };
  void short;
  return presets[template];
}

function textBlock(
  partial: Partial<TextBlock> & Pick<TextBlock, 'id' | 'name' | 'text' | 'x' | 'y'>,
): TextBlock {
  return {
    type: 'text',
    align: 'left',
    alignY: 'top',
    opacity: 1,
    visible: true,
    font: 'sans',
    weight: 400,
    size: 1,
    lineHeight: 1.35,
    letterSpacing: 0,
    color: '#1a1a18',
    shadow: false,
    ...partial,
  };
}

function defaultBlocks(template: FrameTemplate, exif: ExifInfo): Block[] {
  const light = template === 'black' || template === 'film';
  const color = light ? '#f2efe9' : '#1a1a18';
  const muted = light ? '#b9b2a6' : '#6b6459';
  const camera = exif.camera || '相机型号';
  const gear = [exif.focal, exif.aperture, exif.shutter, exif.iso].filter(Boolean).join(' · ') || '参数';
  if (template === 'white' || template === 'polaroid') {
    return [
      textBlock({ id: 'camera', name: '机型', text: camera, x: 0.05, y: 0.9, weight: 600, color }),
      textBlock({ id: 'gear', name: '拍摄参数', text: gear, x: 0.05, y: 0.94, font: 'mono', size: 0.9, color: muted }),
      textBlock({ id: 'date', name: '日期', text: exif.date, x: 0.95, y: 0.9, align: 'right', size: 0.85, color: muted }),
      textBlock({ id: 'watermark', name: '水印', text: '© muxiner', x: 0.95, y: 0.945, align: 'right', size: 0.8, color }),
    ];
  }
  if (template === 'film') {
    return [
      textBlock({ id: 'camera', name: '机型', text: camera, x: 0.06, y: 0.955, font: 'mono', size: 0.8, color }),
      textBlock({ id: 'gear', name: '拍摄参数', text: gear, x: 0.5, y: 0.955, align: 'center', font: 'mono', size: 0.8, color: muted }),
      textBlock({ id: 'watermark', name: '水印', text: '© muxiner', x: 0.94, y: 0.955, align: 'right', font: 'mono', size: 0.8, color }),
    ];
  }
  return [
    textBlock({ id: 'camera', name: '机型', text: camera, x: 0.035, y: 0.9, weight: 600, color, shadow: true }),
    textBlock({ id: 'gear', name: '拍摄参数', text: gear, x: 0.035, y: 0.945, font: 'mono', size: 0.85, color: muted, shadow: true }),
    textBlock({ id: 'date', name: '日期', text: exif.date, x: 0.965, y: 0.9, align: 'right', size: 0.8, color: muted, shadow: true }),
    textBlock({ id: 'watermark', name: '水印', text: '© muxiner', x: 0.965, y: 0.95, align: 'right', size: 0.8, color, shadow: true }),
  ];
}

const mockCustomFamilies = new Map<string, string>();

function fontStack(block: TextBlock): string {
  let base: string;
  if (block.font === 'mono') {
    base = 'ui-monospace, "SF Mono", "JetBrains Mono", "PingFang SC", monospace';
  } else if (block.font === 'cjk') {
    base = '"PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif';
  } else {
    base = '-apple-system, "Inter", "PingFang SC", "Microsoft YaHei", sans-serif';
  }
  const family = block.customFont ? mockCustomFamilies.get(block.customFont) : undefined;
  return family ? `"${family}", ${base}` : base;
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

type SpacedContext = CanvasRenderingContext2D & { letterSpacing?: string };

function setLetterSpacing(ctx: CanvasRenderingContext2D, px: number): void {
  const target = ctx as SpacedContext;
  if ('letterSpacing' in target) target.letterSpacing = `${px.toFixed(3)}px`;
}

interface TextBox {
  x: number;
  y: number;
  w: number;
  h: number;
  base: number;
  lineHeight: number;
}

function measureTextBox(
  ctx: CanvasRenderingContext2D,
  block: TextBlock,
  canvasW: number,
  canvasH: number,
): TextBox {
  const base = Math.min(canvasW, canvasH) * 0.018 * block.size;
  const lineHeight = base * block.lineHeight;
  const lines = block.text.split('\n');
  ctx.save();
  ctx.font = `${block.weight} ${base}px ${fontStack(block)}`;
  setLetterSpacing(ctx, block.letterSpacing * base);
  let w = 0;
  for (const line of lines) w = Math.max(w, ctx.measureText(line).width);
  ctx.restore();
  setLetterSpacing(ctx, 0);
  const total = lineHeight * lines.length;
  const anchorX = block.x * canvasW;
  const x =
    block.align === 'left'
      ? anchorX
      : block.align === 'center'
        ? anchorX - w / 2
        : anchorX - w;
  const anchorY = block.y * canvasH;
  const y =
    block.alignY === 'top'
      ? anchorY
      : block.alignY === 'middle'
        ? anchorY - total / 2
        : anchorY - total;
  return { x, y, w, h: total, base, lineHeight };
}

function drawTextBlock(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  block: TextBlock,
): BlockRect {
  const box = measureTextBox(ctx, block, canvasW, canvasH);
  const lines = block.text.split('\n');
  ctx.save();
  ctx.globalAlpha = block.opacity;
  ctx.font = `${block.weight} ${box.base}px ${fontStack(block)}`;
  setLetterSpacing(ctx, block.letterSpacing * box.base);
  ctx.textAlign = block.align === 'left' ? 'left' : block.align === 'center' ? 'center' : 'right';
  ctx.textBaseline = 'top';
  if (block.shadow) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = box.base * 0.5;
    ctx.shadowOffsetY = box.base * 0.06;
  }
  ctx.fillStyle = block.color;
  lines.forEach((line, index) => {
    ctx.fillText(line, box.x, box.y + index * box.lineHeight);
  });
  ctx.restore();
  setLetterSpacing(ctx, 0);
  return { id: block.id, x: box.x, y: box.y, w: box.w, h: box.h };
}

function drawLogoBlock(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  block: LogoBlock,
  image: HTMLImageElement,
): BlockRect | null {
  if (!image.naturalWidth || !image.naturalHeight) return null;
  const w = block.width * canvasW;
  const h = (image.naturalHeight / image.naturalWidth) * w;
  const anchorX = block.x * canvasW;
  const x =
    block.align === 'left'
      ? anchorX
      : block.align === 'center'
        ? anchorX - w / 2
        : anchorX - w;
  const anchorY = block.y * canvasH;
  const y =
    block.alignY === 'top'
      ? anchorY
      : block.alignY === 'middle'
        ? anchorY - h / 2
        : anchorY - h;
  ctx.save();
  ctx.globalAlpha = block.opacity;
  ctx.drawImage(image, x, y, w, h);
  ctx.restore();
  return { id: block.id, x, y, w, h };
}

function drawFilmHoles(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  margin: number,
): void {
  if (margin < 4) return;
  const holeH = Math.max(2, margin * 0.32);
  const holeW = holeH * 2.2;
  const gap = holeW * 0.9;
  const yTop = margin * 0.5 - holeH / 2;
  const yBottom = height - margin * 0.5 - holeH / 2;
  ctx.save();
  ctx.fillStyle = 'rgba(38, 37, 34, 0.95)';
  for (const y of [yTop, yBottom]) {
    for (let x = gap * 0.8; x + holeW < width - gap * 0.4; x += holeW + gap) {
      roundRectPath(ctx, x, y, holeW, holeH, holeH * 0.28);
      ctx.fill();
    }
  }
  ctx.restore();
}

class MockEngine implements Engine {
  readonly kind = 'wasm' as const;
  /** 标记这是开发回退实现，UI 会显示 MOCK 徽标。 */
  readonly mock = true;

  private photo: PhotoInfo = { width: 1600, height: 1067, exif: { ...EMPTY_EXIF } };
  private image: HTMLImageElement | null = null;
  private photos = new Map<string, { url: string; img: HTMLImageElement; info: PhotoInfo }>();
  private currentId: string | null = null;
  private logos = new Map<string, HTMLImageElement>();
  private customFaces = new Map<string, FontFace>();

  async loadImage(bytes: Uint8Array, id = `mock-${Date.now().toString(36)}-${this.photos.size}`): Promise<PhotoInfo> {
    const blob = new Blob([bytes as unknown as BlobPart]);
    const url = URL.createObjectURL(blob);
    const img = new Image();
    try {
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('图片解码失败'));
        img.src = url;
      });
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
    const previous = this.photos.get(id);
    if (previous) URL.revokeObjectURL(previous.url);
    const info: PhotoInfo = {
      width: img.naturalWidth,
      height: img.naturalHeight,
      exif: { ...EMPTY_EXIF },
    };
    this.photos.set(id, { url, img, info });
    this.currentId = id;
    this.image = img;
    this.photo = info;
    return info;
  }

  async selectImage(id: string): Promise<PhotoInfo> {
    const entry = this.photos.get(id);
    if (!entry) throw new Error('照片不在内存中，请重新导入');
    this.currentId = id;
    this.image = entry.img;
    this.photo = entry.info;
    return entry.info;
  }

  async defaultConfig(photo: PhotoInfo, template: FrameTemplate): Promise<RenderConfig> {
    return {
      version: 1,
      frame: templateFrame(template, photo.width, photo.height),
      blocks: defaultBlocks(template, photo.exif),
      grid: { columns: 12, rows: 12, snap: true, visible: false },
      output: { format: 'png', quality: 92, maxDim: 0 },
    };
  }

  private loadLogo(src: string): Promise<HTMLImageElement | null> {
    if (!src) return Promise.resolve(null);
    const cached = this.logos.get(src);
    if (cached) return Promise.resolve(cached);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        this.logos.set(src, img);
        resolve(img);
      };
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  async render(config: RenderConfig, preview: boolean): Promise<RenderResult> {
    const image = this.image;
    if (!image) throw new Error('尚未加载照片');
    const photoW = this.photo.width;
    const photoH = this.photo.height;
    const longEdge = Math.max(photoW, photoH);
    const margin = config.frame.margin * Math.min(photoW, photoH);
    const bottom = config.frame.template === 'none' ? 0 : margin * config.frame.bottomRatio;
    const canvasW = Math.round(photoW + margin * 2);
    const canvasH = Math.round(photoH + margin + bottom);
    const previewScale = Math.min(1, 1600 / Math.max(canvasW, canvasH));
    const maxDim = config.output.maxDim;
    const outputScale = maxDim > 0 ? Math.min(1, maxDim / Math.max(canvasW, canvasH)) : 1;
    const scale = preview ? previewScale : outputScale;
    void longEdge;

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(canvasW * scale));
    canvas.height = Math.max(1, Math.round(canvasH * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 不可用');
    const width = canvas.width;
    const height = canvas.height;
    const scaledMargin = margin * scale;

    ctx.fillStyle = config.frame.background;
    ctx.fillRect(0, 0, width, height);
    if (config.frame.template === 'film' && config.frame.filmHoles) {
      drawFilmHoles(ctx, width, height, scaledMargin);
    }
    const radius = config.frame.radius * Math.min(photoW, photoH) * scale;
    const photoBox = {
      x: scaledMargin,
      y: scaledMargin,
      w: photoW * scale,
      h: photoH * scale,
    };
    ctx.save();
    if (radius > 0) {
      roundRectPath(ctx, photoBox.x, photoBox.y, photoBox.w, photoBox.h, radius);
      ctx.clip();
    }
    ctx.drawImage(image, photoBox.x, photoBox.y, photoBox.w, photoBox.h);
    ctx.restore();

    const logoImages = new Map<string, HTMLImageElement>();
    await Promise.all(
      config.blocks
        .filter((block) => block.visible && block.type === 'logo')
        .map(async (block) => {
          if (block.type !== 'logo') return;
          const img = await this.loadLogo(block.src);
          if (img) logoImages.set(block.id, img);
        }),
    );

    const blocks: RenderMeta['blocks'] = [];
    for (const block of config.blocks) {
      if (!block.visible) continue;
      if (block.type === 'text') {
        blocks.push(drawTextBlock(ctx, width, height, block));
      } else {
        const img = logoImages.get(block.id);
        if (!img) continue;
        const rect = drawLogoBlock(ctx, width, height, block, img);
        if (rect) blocks.push(rect);
      }
    }

    const mime = preview || config.output.format === 'png' ? 'image/png' : 'image/jpeg';
    const quality = Math.min(1, Math.max(0.1, config.output.quality / 100));
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error('导出失败'))),
        mime,
        quality,
      );
    });
    const meta: RenderMeta = { width, height, blocks };
    return { png: new Uint8Array(await blob.arrayBuffer()), meta };
  }

  async exportImage(config: RenderConfig, suggestedName: string): Promise<ExportResult> {
    const result = await this.render(config, false);
    const mime = config.output.format === 'jpeg' ? 'image/jpeg' : 'image/png';
    const blob = new Blob([result.png as unknown as BlobPart], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = suggestedName;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return {};
  }

  async registerFont(id: string, bytes: Uint8Array): Promise<void> {
    const family = `FramedMockFont-${id}`;
    const face = new FontFace(family, bytes as unknown as ArrayBuffer);
    await face.load();
    document.fonts.add(face);
    this.customFaces.set(id, face);
    mockCustomFamilies.set(id, family);
  }

  async removeFont(id: string): Promise<void> {
    const face = this.customFaces.get(id);
    if (face) document.fonts.delete(face);
    this.customFaces.delete(id);
    mockCustomFamilies.delete(id);
  }

  async exportBatch(items: BatchExportItem[]): Promise<BatchExportResult> {
    const current = this.currentId;
    const paths: string[] = [];
    for (const item of items) {
      await this.selectImage(item.id);
      const result = await this.render(item.config, false);
      const mime = item.config.output.format === 'jpeg' ? 'image/jpeg' : 'image/png';
      const blob = new Blob([result.png as unknown as BlobPart], { type: mime });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = item.filename;
      anchor.click();
      paths.push(item.filename);
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
      await new Promise((resolve) => window.setTimeout(resolve, 420));
    }
    if (current && current !== this.currentId) await this.selectImage(current);
    return { saved: paths.length, method: 'download', paths };
  }
}

export function createMockEngine(): Engine {
  return new MockEngine();
}
