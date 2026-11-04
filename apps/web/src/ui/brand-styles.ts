// 品牌风格：参考主流相机/手机厂商照片水印的版式与配色（不复制商标/Logo）。
// 版式：左侧品牌字标 + 副标，右侧相机/镜头、曝光、日期三行；文本块沿用 EXIF，
// 切换照片时相机/参数/日期仍逐张替换。
import type {
  Block,
  FrameConfig,
  FrameTemplate,
  PhotoShadowConfig,
  RenderConfig,
  TextBlock,
} from '../types';

export interface BrandPreview {
  /** 卡片迷你预览的边框底色。 */
  background: string;
  /** 迷你照片的渐变。 */
  photo: string;
  /** 迷你字标颜色。 */
  mark: string;
  /** 无边框、文字压在照片上的样式。 */
  overlay?: boolean;
}

export interface BrandStyle {
  id: string;
  name: string;
  tagline: string;
  accent: string;
  template: FrameTemplate;
  wordmark: string;
  preview: BrandPreview;
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

interface TextSpec {
  text?: string;
  font?: TextBlock['font'];
  weight?: TextBlock['weight'];
  size?: number;
  lineHeight?: number;
  letterSpacing?: number;
  color?: string;
  shadow?: boolean;
  x?: number;
  y?: number;
  align?: TextBlock['align'];
  alignY?: TextBlock['alignY'];
  opacity?: number;
}

function applySpec(block: TextBlock, spec: TextSpec): TextBlock {
  const next: TextBlock = { ...block };
  for (const [key, value] of Object.entries(spec)) {
    if (value !== undefined) {
      (next as unknown as Record<string, unknown>)[key] = value;
    }
  }
  return next;
}

function styleBlock(block: Block, spec: TextSpec): Block {
  return block.type === 'text' ? applySpec(block, spec) : block;
}

function taglineBlock(text: string, spec: TextSpec): Block {
  const base: TextBlock = {
    type: 'text',
    id: 'tagline',
    name: '品牌副标',
    x: 0.05,
    y: 0.9,
    align: 'left',
    alignY: 'top',
    opacity: 1,
    visible: true,
    text,
    font: 'mono',
    customFont: null,
    weight: 400,
    size: 0.6,
    lineHeight: 1.2,
    letterSpacing: 0,
    color: '#000000',
    shadow: false,
  };
  return applySpec(base, spec);
}

interface Layout {
  template: FrameTemplate;
  frame: Partial<FrameConfig>;
  /** 品牌字标（复用水印块）。 */
  brand: TextSpec;
  camera: TextSpec;
  gear: TextSpec;
  date: TextSpec;
  tagline: string;
  taglineSpec: TextSpec;
}

function buildStyle(layout: Layout, base: RenderConfig): RenderConfig {
  const frame: FrameConfig = {
    ...base.frame,
    template: layout.template,
    ...layout.frame,
  };
  const blocks: Block[] = base.blocks.map((block) => {
    if (block.type !== 'text') return block;
    if (block.id === 'watermark') return styleBlock(block, { align: 'left', ...layout.brand });
    if (block.id === 'camera') return styleBlock(block, layout.camera);
    if (block.id === 'gear') return styleBlock(block, layout.gear);
    if (block.id === 'date') return styleBlock(block, layout.date);
    return block;
  });
  const tagline = taglineBlock(layout.tagline, layout.taglineSpec);
  const index = blocks.findIndex((block) => block.id === 'tagline');
  if (index >= 0) blocks[index] = tagline;
  else blocks.push(tagline);
  return { ...base, frame, blocks };
}

const INFO_FONT = { font: 'mono' as const, weight: 400 as const };
const INFO_COLOR_LIGHT = '#5f5a52';
const INFO_COLOR_DARK = '#c9c3b7';

/** 白底三行信息的小字号。 */
const infoLight = (x: number): { camera: TextSpec; gear: TextSpec; date: TextSpec } => ({
  camera: { ...INFO_FONT, size: 0.8, color: INFO_COLOR_LIGHT, x, y: 0.855, align: 'right' },
  gear: { ...INFO_FONT, size: 0.74, color: '#7d776c', x, y: 0.895, align: 'right' },
  date: { ...INFO_FONT, size: 0.66, color: '#9a9388', x, y: 0.932, align: 'right' },
});

/** 黑底三行信息的小字号。 */
const infoDark = (x: number): { camera: TextSpec; gear: TextSpec; date: TextSpec } => ({
  camera: { ...INFO_FONT, size: 0.78, color: INFO_COLOR_DARK, x, y: 0.855, align: 'right' },
  gear: { ...INFO_FONT, size: 0.72, color: '#a9a396', x, y: 0.895, align: 'right' },
  date: { ...INFO_FONT, size: 0.64, color: '#8f8a80', x, y: 0.932, align: 'right' },
});

export const BRAND_STYLES: BrandStyle[] = [
  {
    id: 'leica',
    name: '徕卡',
    tagline: '白边 · 红标 · 大留白',
    accent: '#c8102e',
    template: 'white',
    wordmark: 'LEICA',
    preview: { background: '#f6f3ec', photo: 'linear-gradient(135deg,#d9c9a8,#8d9aa0)', mark: '#141414' },
    build: (base) =>
      buildStyle(
        {
          template: 'white',
          frame: {
            margin: 0.065,
            bottomRatio: 3.5,
            background: '#f6f3ec',
            radius: 0,
            filmHoles: false,
            photoShadow: shadow({ opacity: 0.14, blur: 0.03 }),
          },
          brand: {
            text: 'LEICA',
            font: 'sans',
            weight: 700,
            size: 2.2,
            letterSpacing: 0.16,
            color: '#141414',
            x: 0.055,
            y: 0.855,
          },
          ...infoLight(0.945),
          tagline: 'LEICA CAMERA · WETZLAR',
          taglineSpec: {
            ...INFO_FONT,
            size: 0.6,
            letterSpacing: 0.16,
            color: '#c8102e',
            x: 0.055,
            y: 0.932,
          },
        },
        base,
      ),
  },
  {
    id: 'sony',
    name: '索尼 α',
    tagline: '黑底白字 · 阿尔法橙',
    accent: '#f47b20',
    template: 'black',
    wordmark: 'SONY',
    preview: { background: '#0b0b0b', photo: 'linear-gradient(135deg,#2b3038,#52616b)', mark: '#f4f1ea' },
    build: (base) =>
      buildStyle(
        {
          template: 'black',
          frame: {
            margin: 0.05,
            bottomRatio: 2.8,
            background: '#080808',
            radius: 0,
            filmHoles: false,
            photoShadow: shadow({ opacity: 0.24, blur: 0.026 }),
          },
          brand: {
            text: 'SONY',
            font: 'sans',
            weight: 700,
            size: 2.2,
            letterSpacing: 0.22,
            color: '#f4f1ea',
            x: 0.05,
            y: 0.838,
          },
          ...infoDark(0.95),
          tagline: 'ALPHA',
          taglineSpec: {
            ...INFO_FONT,
            weight: 600,
            size: 0.66,
            letterSpacing: 0.34,
            color: '#f47b20',
            x: 0.05,
            y: 0.932,
          },
        },
        base,
      ),
  },
  {
    id: 'canon',
    name: '佳能',
    tagline: '亮白纸感 · 红色字标',
    accent: '#c8102e',
    template: 'white',
    wordmark: 'Canon',
    preview: { background: '#fbfaf7', photo: 'linear-gradient(135deg,#d8c3a2,#87979c)', mark: '#c8102e' },
    build: (base) =>
      buildStyle(
        {
          template: 'white',
          frame: {
            margin: 0.055,
            bottomRatio: 3.2,
            background: '#fbfaf7',
            radius: 0,
            filmHoles: false,
            photoShadow: shadow({ opacity: 0.13, blur: 0.026 }),
          },
          brand: {
            text: 'Canon',
            font: 'sans',
            weight: 700,
            size: 2.4,
            letterSpacing: 0,
            color: '#c8102e',
            x: 0.05,
            y: 0.86,
          },
          ...infoLight(0.95),
          tagline: 'EOS SERIES',
          taglineSpec: {
            ...INFO_FONT,
            weight: 600,
            size: 0.62,
            letterSpacing: 0.24,
            color: '#1c1b18',
            x: 0.05,
            y: 0.932,
          },
        },
        base,
      ),
  },
  {
    id: 'nikon',
    name: '尼康',
    tagline: '黑金 · 硬朗字标',
    accent: '#ffd100',
    template: 'black',
    wordmark: 'Nikon',
    preview: { background: '#0a0a0a', photo: 'linear-gradient(135deg,#2a2f35,#5a6068)', mark: '#ffd100' },
    build: (base) =>
      buildStyle(
        {
          template: 'black',
          frame: {
            margin: 0.05,
            bottomRatio: 2.8,
            background: '#070707',
            radius: 0,
            filmHoles: false,
            photoShadow: shadow({ opacity: 0.22, blur: 0.026 }),
          },
          brand: {
            text: 'Nikon',
            font: 'sans',
            weight: 700,
            size: 2.15,
            letterSpacing: 0.01,
            color: '#ffd100',
            x: 0.05,
            y: 0.838,
          },
          ...infoDark(0.95),
          tagline: 'Z SERIES',
          taglineSpec: {
            ...INFO_FONT,
            weight: 600,
            size: 0.62,
            letterSpacing: 0.26,
            color: '#f5f2e9',
            x: 0.05,
            y: 0.932,
          },
        },
        base,
      ),
  },
  {
    id: 'fujifilm',
    name: '富士',
    tagline: '胶片齿孔 · 经典正片',
    accent: '#e60012',
    template: 'film',
    wordmark: 'FUJIFILM',
    preview: { background: '#0b0b0b', photo: 'linear-gradient(135deg,#39424a,#6d7c84)', mark: '#e60012' },
    build: (base) =>
      buildStyle(
        {
          template: 'film',
          frame: {
            margin: 0.045,
            bottomRatio: 2.4,
            background: '#0a0a0a',
            radius: 0,
            filmHoles: true,
            photoShadow: shadow({ opacity: 0.2, blur: 0.026 }),
          },
          brand: {
            text: 'FUJIFILM',
            font: 'sans',
            weight: 700,
            size: 1.5,
            letterSpacing: 0.12,
            color: '#e60012',
            x: 0.045,
            y: 0.836,
          },
          ...infoDark(0.955),
          tagline: 'CLASSIC CHROME',
          taglineSpec: {
            ...INFO_FONT,
            weight: 600,
            size: 0.6,
            letterSpacing: 0.2,
            color: '#2ea36b',
            x: 0.045,
            y: 0.932,
          },
        },
        base,
      ),
  },
  {
    id: 'xiaomi',
    name: '小米',
    tagline: '无边框 · 手机水印',
    accent: '#ff6900',
    template: 'none',
    wordmark: 'XIAOMI',
    preview: {
      background: '#121212',
      photo: 'linear-gradient(135deg,#e2b98c,#65727c)',
      mark: '#ffffff',
      overlay: true,
    },
    build: (base) =>
      buildStyle(
        {
          template: 'none',
          frame: {
            margin: 0,
            bottomRatio: 1,
            background: '#000000',
            radius: 0,
            filmHoles: false,
            photoShadow: { ...SHADOW_BASE, enabled: false, opacity: 0 },
          },
          brand: {
            text: 'XIAOMI 15 Ultra',
            font: 'sans',
            weight: 600,
            size: 1.4,
            letterSpacing: 0,
            color: '#ffffff',
            shadow: true,
            x: 0.05,
            y: 0.805,
          },
          ...{
            camera: {
              ...INFO_FONT,
              size: 0.66,
              color: '#ffffff',
              shadow: true,
              x: 0.95,
              y: 0.805,
              align: 'right' as const,
            },
            gear: {
              ...INFO_FONT,
              size: 0.62,
              color: '#ffffff',
              shadow: true,
              x: 0.95,
              y: 0.852,
              align: 'right' as const,
            },
            date: {
              ...INFO_FONT,
              size: 0.58,
              color: '#ffffff',
              shadow: true,
              x: 0.95,
              y: 0.899,
              align: 'right' as const,
            },
          },
          tagline: 'LEICA OPTICS · 23mm · f/1.63',
          taglineSpec: {
            ...INFO_FONT,
            size: 0.68,
            letterSpacing: 0.02,
            color: '#f1ede3',
            shadow: true,
            x: 0.05,
            y: 0.885,
          },
        },
        base,
      ),
  },
  {
    id: 'hasselblad',
    name: '哈苏',
    tagline: '黑底 · 大字距',
    accent: '#ded7c6',
    template: 'black',
    wordmark: 'HASSELBLAD',
    preview: { background: '#0a0a0a', photo: 'linear-gradient(135deg,#3a3a36,#6b6a60)', mark: '#ded7c6' },
    build: (base) =>
      buildStyle(
        {
          template: 'black',
          frame: {
            margin: 0.055,
            bottomRatio: 2.6,
            background: '#080808',
            radius: 0,
            filmHoles: false,
            photoShadow: shadow({ opacity: 0.18, blur: 0.03 }),
          },
          brand: {
            text: 'HASSELBLAD',
            font: 'sans',
            weight: 600,
            size: 1.1,
            letterSpacing: 0.36,
            color: '#f1ede3',
            x: 0.05,
            y: 0.838,
          },
          ...infoDark(0.95),
          tagline: 'X2D 100C',
          taglineSpec: {
            ...INFO_FONT,
            size: 0.66,
            letterSpacing: 0.26,
            color: '#b9b3a7',
            x: 0.05,
            y: 0.932,
          },
        },
        base,
      ),
  },
];
