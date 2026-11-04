// 品牌风格：模仿主流相机/手机厂商的边框气质（不复制商标/Logo，只用配色与排版）。
import type {
  Block,
  FrameConfig,
  FrameTemplate,
  PhotoShadowConfig,
  RenderConfig,
  TextBlock,
} from '../types';

export interface BrandStyle {
  id: string;
  name: string;
  tagline: string;
  accent: string;
  template: FrameTemplate;
  build: (base: RenderConfig) => RenderConfig;
}

const SHADOW_BASE: PhotoShadowConfig = {
  enabled: true,
  mode: 'outer',
  angle: 118,
  distance: 0.012,
  blur: 0.028,
  spread: 0,
  color: '#000000',
  opacity: 0.18,
};

function shadow(overrides: Partial<PhotoShadowConfig> = {}): PhotoShadowConfig {
  return { ...SHADOW_BASE, ...overrides };
}

type TextPatch = Partial<Omit<TextBlock, 'type' | 'id'>> & { text?: string };

function patchText(blocks: readonly Block[], id: string, patch: TextPatch): Block[] {
  return blocks.map((block) => {
    if (block.id !== id || block.type !== 'text') return block;
    return { ...block, ...patch } as TextBlock;
  });
}

interface StyleSpec {
  template: FrameTemplate;
  frame: Partial<FrameConfig>;
  camera: TextPatch;
  gear: TextPatch;
  date: TextPatch;
  watermark: TextPatch;
}

function build(spec: StyleSpec): (base: RenderConfig) => RenderConfig {
  return (base) => {
    let blocks: Block[] = base.blocks;
    blocks = patchText(blocks, 'camera', spec.camera);
    blocks = patchText(blocks, 'gear', spec.gear);
    blocks = patchText(blocks, 'date', spec.date);
    blocks = patchText(blocks, 'watermark', spec.watermark);
    const frame: FrameConfig = { ...base.frame, template: spec.template, ...spec.frame };
    return { ...base, frame, blocks };
  };
}

export const BRAND_STYLES: BrandStyle[] = [
  {
    id: 'leica',
    name: '徕卡',
    tagline: '米白留白 · 红点字标',
    accent: '#c8102e',
    template: 'white',
    build: build({
      template: 'white',
      frame: {
        margin: 0.06,
        bottomRatio: 3.3,
        background: '#f7f5f0',
        radius: 0,
        filmHoles: false,
        photoShadow: shadow({ opacity: 0.16, blur: 0.03 }),
      },
      camera: { x: 0.055, y: 0.878, font: 'sans', weight: 600, size: 0.95, color: '#161513' },
      gear: { x: 0.055, y: 0.925, font: 'mono', weight: 400, size: 0.72, color: '#57524a' },
      date: { x: 0.945, y: 0.878, align: 'right', font: 'mono', weight: 400, size: 0.68, color: '#6b655c' },
      watermark: {
        text: 'LEICA',
        x: 0.945,
        y: 0.925,
        align: 'right',
        font: 'sans',
        weight: 600,
        size: 0.92,
        letterSpacing: 0.28,
        color: '#c8102e',
      },
    }),
  },
  {
    id: 'sony',
    name: '索尼 α',
    tagline: '暗底白字 · 橙色点缀',
    accent: '#f47b20',
    template: 'black',
    build: build({
      template: 'black',
      frame: {
        margin: 0.045,
        bottomRatio: 1,
        background: '#070707',
        radius: 0,
        filmHoles: false,
        photoShadow: shadow({ opacity: 0.22, blur: 0.026 }),
      },
      camera: { x: 0.045, y: 0.86, font: 'mono', weight: 600, size: 0.82, color: '#f2efe8' },
      gear: { x: 0.045, y: 0.905, font: 'mono', weight: 400, size: 0.74, color: '#b8b2a7' },
      date: { x: 0.955, y: 0.86, align: 'right', font: 'mono', weight: 400, size: 0.68, color: '#b8b2a7' },
      watermark: {
        text: 'SONY α',
        x: 0.955,
        y: 0.905,
        align: 'right',
        font: 'mono',
        weight: 600,
        size: 0.82,
        letterSpacing: 0.06,
        color: '#f47b20',
      },
    }),
  },
  {
    id: 'canon',
    name: '佳能',
    tagline: '亮白底 · 红色字标',
    accent: '#c8102e',
    template: 'white',
    build: build({
      template: 'white',
      frame: {
        margin: 0.055,
        bottomRatio: 3.0,
        background: '#fbfaf7',
        radius: 0,
        filmHoles: false,
        photoShadow: shadow({ opacity: 0.14, blur: 0.026 }),
      },
      camera: { x: 0.05, y: 0.88, font: 'sans', weight: 700, size: 0.98, color: '#151515' },
      gear: { x: 0.05, y: 0.93, font: 'mono', weight: 400, size: 0.72, color: '#6c6659' },
      date: { x: 0.95, y: 0.88, align: 'right', font: 'mono', weight: 400, size: 0.68, color: '#6c6659' },
      watermark: {
        text: 'Canon',
        x: 0.95,
        y: 0.93,
        align: 'right',
        font: 'sans',
        weight: 700,
        size: 0.9,
        letterSpacing: 0.04,
        color: '#c8102e',
      },
    }),
  },
  {
    id: 'nikon',
    name: '尼康',
    tagline: '黑金配色 · 硬朗字标',
    accent: '#ffd100',
    template: 'black',
    build: build({
      template: 'black',
      frame: {
        margin: 0.05,
        bottomRatio: 1,
        background: '#050505',
        radius: 0,
        filmHoles: false,
        photoShadow: shadow({ opacity: 0.2, blur: 0.026 }),
      },
      camera: { x: 0.048, y: 0.865, font: 'sans', weight: 600, size: 0.9, color: '#f5f2e9' },
      gear: { x: 0.048, y: 0.91, font: 'mono', weight: 400, size: 0.74, color: '#c0bbb0' },
      date: { x: 0.952, y: 0.865, align: 'right', font: 'mono', weight: 400, size: 0.68, color: '#c0bbb0' },
      watermark: {
        text: 'Nikon',
        x: 0.952,
        y: 0.91,
        align: 'right',
        font: 'sans',
        weight: 700,
        size: 0.86,
        letterSpacing: 0.06,
        color: '#ffd100',
      },
    }),
  },
  {
    id: 'xiaomi',
    name: '小米',
    tagline: '极简白 · 活力橙',
    accent: '#ff6900',
    template: 'white',
    build: build({
      template: 'white',
      frame: {
        margin: 0.052,
        bottomRatio: 3.3,
        background: '#fafafa',
        radius: 0,
        filmHoles: false,
        photoShadow: shadow({ opacity: 0.12, blur: 0.024 }),
      },
      camera: { x: 0.05, y: 0.878, font: 'sans', weight: 600, size: 0.92, color: '#111111' },
      gear: { x: 0.05, y: 0.927, font: 'mono', weight: 400, size: 0.74, color: '#777777' },
      date: { x: 0.95, y: 0.878, align: 'right', font: 'mono', weight: 400, size: 0.68, color: '#999999' },
      watermark: {
        text: 'XIAOMI 15 Ultra',
        x: 0.95,
        y: 0.927,
        align: 'right',
        font: 'sans',
        weight: 400,
        size: 0.72,
        letterSpacing: 0.12,
        color: '#ff6900',
      },
    }),
  },
  {
    id: 'fujifilm',
    name: '富士',
    tagline: '胶片黑边 · 富士绿',
    accent: '#00843d',
    template: 'film',
    build: build({
      template: 'film',
      frame: {
        margin: 0.045,
        bottomRatio: 1,
        background: '#080808',
        radius: 0,
        filmHoles: true,
        photoShadow: shadow({ opacity: 0.2, blur: 0.026 }),
      },
      camera: { x: 0.04, y: 0.84, font: 'mono', weight: 600, size: 0.8, color: '#f4f0e6' },
      gear: { x: 0.04, y: 0.885, font: 'mono', weight: 400, size: 0.74, color: '#b8b2a6' },
      date: { x: 0.96, y: 0.84, align: 'right', font: 'mono', weight: 400, size: 0.66, color: '#b8b2a6' },
      watermark: {
        text: 'FUJIFILM',
        x: 0.96,
        y: 0.885,
        align: 'right',
        font: 'mono',
        weight: 600,
        size: 0.8,
        letterSpacing: 0.1,
        color: '#2ea36b',
      },
    }),
  },
  {
    id: 'hasselblad',
    name: '哈苏',
    tagline: '黑底大字距 · 冷静克制',
    accent: '#ded7c6',
    template: 'black',
    build: build({
      template: 'black',
      frame: {
        margin: 0.06,
        bottomRatio: 1,
        background: '#060606',
        radius: 0,
        filmHoles: false,
        photoShadow: shadow({ opacity: 0.16, blur: 0.03 }),
      },
      camera: { x: 0.05, y: 0.855, font: 'sans', weight: 400, size: 0.82, color: '#f1ede3' },
      gear: { x: 0.05, y: 0.9, font: 'mono', weight: 400, size: 0.7, color: '#b9b3a7' },
      date: { x: 0.95, y: 0.855, align: 'right', font: 'mono', weight: 400, size: 0.64, color: '#b9b3a7' },
      watermark: {
        text: 'HASSELBLAD',
        x: 0.95,
        y: 0.9,
        align: 'right',
        font: 'sans',
        weight: 600,
        size: 0.72,
        letterSpacing: 0.42,
        color: '#ded7c6',
      },
    }),
  },
];
