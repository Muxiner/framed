// 网页引擎：加载 framed_wasm.wasm（手写 C ABI，无 wasm-bindgen），
// 打包格式见 docs/CONTRACT.md §3.2。
//
// 性能要点：
// - `framed_prepare` 在载入/切换照片时解码 + 转正 + 缩放一次，wasm 侧缓存底图；
// - 每次改参数走 `framed_render_preview`，只重新合成 + JPEG 编码（不再解码原图）；
// - 全尺寸导出/批量导出才 `framed_render` 解码原图。
import type {
  BatchExportItem,
  BatchExportResult,
  Engine,
  ExportResult,
  FrameTemplate,
  PhotoInfo,
  RenderConfig,
  RenderMeta,
  RenderResult,
} from './types';

interface WasmExports {
  memory: WebAssembly.Memory;
  framed_alloc(len: number): number;
  framed_free(ptr: number, len: number): void;
  framed_probe(ptr: number, len: number): number;
  framed_prepare(ptr: number, len: number, maxDim: number): number;
  framed_render_preview(cfgPtr: number, cfgLen: number): number;
  framed_default_config(ptr: number, len: number): number;
  framed_render(imgPtr: number, imgLen: number, cfgPtr: number, cfgLen: number): number;
}

interface Packed {
  json: Record<string, unknown>;
  bin: Uint8Array;
}

/** 预览底图长边（照片本身，不含边框），与 wasm/桌面端保持一致。 */
const PREVIEW_PHOTO_DIM = 1400;

const encoder = new TextEncoder();
const decoder = new TextDecoder();
let photoSequence = 0;

function nextPhotoId(): string {
  photoSequence += 1;
  return `photo-${Date.now().toString(36)}-${photoSequence}`;
}

function parsePacked(exports: WasmExports, ptr: number): Packed {
  const buffer = exports.memory.buffer;
  const view = new DataView(buffer);
  const jsonLen = view.getUint32(ptr, true);
  const jsonBytes = new Uint8Array(buffer, ptr + 4, jsonLen);
  const json = JSON.parse(decoder.decode(jsonBytes)) as Record<string, unknown>;
  const binHeader = ptr + 4 + jsonLen;
  const binLen = view.getUint32(binHeader, true);
  const bin = new Uint8Array(buffer, binHeader + 4, binLen).slice();
  exports.framed_free(ptr, 4 + jsonLen + 4 + binLen);
  if (json.ok !== true) {
    throw new Error(typeof json.error === 'string' ? json.error : '渲染失败');
  }
  return { json, bin };
}

function writeBytes(exports: WasmExports, bytes: Uint8Array): number {
  const ptr = exports.framed_alloc(bytes.length);
  if (!ptr) throw new Error('wasm 内存分配失败');
  new Uint8Array(exports.memory.buffer, ptr, bytes.length).set(bytes);
  return ptr;
}

function downloadBlob(bytes: Uint8Array, filename: string, mime: string): void {
  const blob = new Blob([bytes as unknown as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

class WasmEngine implements Engine {
  readonly kind = 'wasm' as const;

  private exports: WasmExports;
  private photos = new Map<string, Uint8Array>();
  private currentId: string | null = null;

  constructor(exports: WasmExports) {
    this.exports = exports;
  }

  async loadImage(bytes: Uint8Array, id: string = nextPhotoId()): Promise<PhotoInfo> {
    const cached = bytes.slice();
    this.photos.set(id, cached);
    // 导入阶段只做轻量探测（读尺寸 + EXIF），真正的解码/缩放推迟到
    // 切换激活（selectImage）时，避免一次导入 N 张时做 N 次重解码。
    const ptr = writeBytes(this.exports, cached);
    try {
      return parsePacked(this.exports, this.exports.framed_probe(ptr, cached.length))
        .json as unknown as PhotoInfo;
    } finally {
      this.exports.framed_free(ptr, cached.length);
    }
  }

  async selectImage(id: string, bytes?: Uint8Array): Promise<PhotoInfo> {
    if (bytes) this.photos.set(id, bytes.slice());
    const cached = this.photos.get(id);
    if (!cached) throw new Error('照片不在内存中，请重新导入');
    return this.prepare(id, cached);
  }

  /** 解码 + 缩放并让 wasm 侧缓存预览底图。 */
  private prepare(id: string, bytes: Uint8Array): PhotoInfo {
    const ptr = writeBytes(this.exports, bytes);
    try {
      const packed = parsePacked(
        this.exports,
        this.exports.framed_prepare(ptr, bytes.length, PREVIEW_PHOTO_DIM),
      );
      this.currentId = id;
      return packed.json as unknown as PhotoInfo;
    } finally {
      this.exports.framed_free(ptr, bytes.length);
    }
  }

  async defaultConfig(photo: PhotoInfo, template: FrameTemplate): Promise<RenderConfig> {
    const bytes = encoder.encode(JSON.stringify({ photo, template }));
    const ptr = writeBytes(this.exports, bytes);
    try {
      return parsePacked(this.exports, this.exports.framed_default_config(ptr, bytes.length))
        .json as unknown as RenderConfig;
    } finally {
      this.exports.framed_free(ptr, bytes.length);
    }
  }

  async render(config: RenderConfig, preview: boolean): Promise<RenderResult> {
    if (!this.currentId) throw new Error('尚未加载照片');
    if (!preview) return this.renderFull(this.currentId, config);

    // 预览：复用 wasm 侧缓存的底图，只合成 + JPEG 编码。
    const tuned: RenderConfig = {
      ...config,
      output: { ...config.output, format: 'jpeg', quality: 90, maxDim: 0 },
    };
    const cfg = encoder.encode(JSON.stringify(tuned));
    const cfgPtr = writeBytes(this.exports, cfg);
    try {
      const packed = parsePacked(
        this.exports,
        this.exports.framed_render_preview(cfgPtr, cfg.length),
      );
      return { png: packed.bin, meta: packed.json as unknown as RenderMeta };
    } finally {
      this.exports.framed_free(cfgPtr, cfg.length);
    }
  }

  /** 全尺寸渲染（导出用）：解码原图，按配置编码。 */
  private renderFull(id: string, config: RenderConfig): RenderResult {
    const bytes = this.photos.get(id);
    if (!bytes) throw new Error('照片不在内存中，请重新导入');
    const imgPtr = writeBytes(this.exports, bytes);
    const cfg = encoder.encode(JSON.stringify(config));
    const cfgPtr = writeBytes(this.exports, cfg);
    try {
      const packed = parsePacked(
        this.exports,
        this.exports.framed_render(imgPtr, bytes.length, cfgPtr, cfg.length),
      );
      return { png: packed.bin, meta: packed.json as unknown as RenderMeta };
    } finally {
      this.exports.framed_free(cfgPtr, cfg.length);
      this.exports.framed_free(imgPtr, bytes.length);
    }
  }

  async exportImage(config: RenderConfig, suggestedName: string): Promise<ExportResult> {
    if (!this.currentId) throw new Error('尚未加载照片');
    const rendered = this.renderFull(this.currentId, config);
    const mime = config.output.format === 'jpeg' ? 'image/jpeg' : 'image/png';
    downloadBlob(rendered.png, suggestedName, mime);
    return {};
  }

  async exportBatch(items: BatchExportItem[]): Promise<BatchExportResult> {
    const paths: string[] = [];
    for (const item of items) {
      const rendered = this.renderFull(item.id, item.config);
      const mime = item.config.output.format === 'jpeg' ? 'image/jpeg' : 'image/png';
      downloadBlob(rendered.png, item.filename, mime);
      paths.push(item.filename);
      // 浏览器对连续下载有节流，放慢一点更稳。
      await sleep(420);
    }
    return { saved: paths.length, method: 'download', paths };
  }
}

export async function createWasmEngine(): Promise<Engine> {
  const url = new URL('framed_wasm.wasm', document.baseURI);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`加载 wasm 失败：${response.status}`);
  const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), {});
  return new WasmEngine(instance.exports as unknown as WasmExports);
}
