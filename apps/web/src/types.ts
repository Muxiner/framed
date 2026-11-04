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

/** 批量导出的一项：照片 id + 输出文件名 + 该照片自己的配置。 */
export interface BatchExportItem {
  id: string;
  filename: string;
  config: RenderConfig;
}

export interface BatchExportResult {
  saved: number;
  /** 网页端逐个下载；桌面端弹一次目录选择框写入。 */
  method: 'download' | 'folder';
  paths?: string[];
  canceled?: boolean;
}

export interface Engine {
  readonly kind: 'wasm' | 'tauri';
  /**
   * 载入照片并缓存为 `id`（不传 id 时自动生成）。
   * 多图模式下每张照片只在这里上传一次。
   */
  loadImage(bytes: Uint8Array, id?: string): Promise<PhotoInfo>;
  /**
   * 切换到已载入的照片。wasm 端需要再次传入 bytes（内部有缓存，传了会更新）；
   * 桌面端由原生侧按 id 取缓存，不会重复传输图片。
   */
  selectImage(id: string, bytes?: Uint8Array): Promise<PhotoInfo>;
  defaultConfig(photo: PhotoInfo, template: FrameTemplate): Promise<RenderConfig>;
  render(config: RenderConfig, preview: boolean): Promise<RenderResult>;
  exportImage(config: RenderConfig, suggestedName: string): Promise<ExportResult>;
  /** 批量导出：网页端逐张下载，桌面端选目录后一次写入。 */
  exportBatch(items: BatchExportItem[]): Promise<BatchExportResult>;
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
