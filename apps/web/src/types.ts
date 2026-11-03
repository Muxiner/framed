// 渲染配置的 TypeScript 镜像：唯一权威定义见 docs/CONTRACT.md §2。
// 改字段 → 同步 crates/core/src/config.rs。

export type FrameTemplate = 'none' | 'white' | 'polaroid' | 'film' | 'black';
export type FontFamily = 'sans' | 'mono' | 'cjk';
export type TextAlign = 'left' | 'center' | 'right';
export type AnchorY = 'top' | 'middle' | 'bottom';
export type OutputFormat = 'png' | 'jpeg';

export interface FrameConfig {
  template: FrameTemplate;
  margin: number;
  bottomRatio: number;
  background: string;
  radius: number;
  filmHoles: boolean;
}

export interface BlockBase {
  id: string;
  name: string;
  x: number;
  y: number;
  align: TextAlign;
  alignY: AnchorY;
  opacity: number;
  visible: boolean;
}

export interface TextBlock extends BlockBase {
  type: 'text';
  text: string;
  font: FontFamily;
  weight: 400 | 600 | 700;
  size: number;
  lineHeight: number;
  letterSpacing: number;
  color: string;
  shadow: boolean;
}

export interface LogoBlock extends BlockBase {
  type: 'logo';
  src: string;
  width: number;
}

export type Block = TextBlock | LogoBlock;

export interface GridConfig {
  columns: 12;
  rows: 12;
  snap: boolean;
  visible: boolean;
}

export interface OutputConfig {
  format: OutputFormat;
  quality: number;
  maxDim: number;
}

export interface RenderConfig {
  version: 1;
  frame: FrameConfig;
  blocks: Block[];
  grid: GridConfig;
  output: OutputConfig;
}

export interface ExifInfo {
  camera: string;
  make: string;
  model: string;
  lens: string;
  focal: string;
  aperture: string;
  shutter: string;
  iso: string;
  date: string;
  datetime: string;
  artist: string;
  copyright: string;
}

export interface PhotoInfo {
  width: number;
  height: number;
  exif: ExifInfo;
}

export interface BlockRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RenderMeta {
  width: number;
  height: number;
  blocks: BlockRect[];
}

export interface RenderResult {
  png: Uint8Array;
  meta: RenderMeta;
}

export interface ExportResult {
  path?: string;
}

export interface Engine {
  readonly kind: 'wasm' | 'tauri';
  loadImage(bytes: Uint8Array): Promise<PhotoInfo>;
  defaultConfig(photo: PhotoInfo, template: FrameTemplate): Promise<RenderConfig>;
  render(config: RenderConfig, preview: boolean): Promise<RenderResult>;
  exportImage(config: RenderConfig, suggestedName: string): Promise<ExportResult>;
}

export const TEMPLATE_LABELS: Record<FrameTemplate, string> = {
  white: '白边',
  polaroid: '拍立得',
  film: '胶片',
  black: '黑框',
  none: '无边框',
};

export const FONT_LABELS: Record<FontFamily, string> = {
  sans: '无衬线',
  mono: '等宽',
  cjk: '中文',
};
