// 网页引擎：加载 framed_wasm.wasm（手写 C ABI，无 wasm-bindgen），
// 打包格式见 docs/CONTRACT.md §3.2。
import type {
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
  framed_default_config(ptr: number, len: number): number;
  framed_render(imgPtr: number, imgLen: number, cfgPtr: number, cfgLen: number): number;
}

interface Packed {
  json: Record<string, unknown>;
  bin: Uint8Array;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

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

function withJson<T>(
  exports: WasmExports,
  fn: (ptr: number, len: number) => number,
  payload: unknown,
): T {
  const bytes = encoder.encode(JSON.stringify(payload));
  const ptr = writeBytes(exports, bytes);
  try {
    return parsePacked(exports, fn(ptr, bytes.length)).json as T;
  } finally {
    exports.framed_free(ptr, bytes.length);
  }
}

class WasmEngine implements Engine {
  readonly kind = 'wasm' as const;

  private exports: WasmExports;
  private imagePtr = 0;
  private imageLen = 0;

  constructor(exports: WasmExports) {
    this.exports = exports;
  }

  async loadImage(bytes: Uint8Array): Promise<PhotoInfo> {
    this.releaseImage();
    const ptr = writeBytes(this.exports, bytes);
    this.imagePtr = ptr;
    this.imageLen = bytes.length;
    try {
      const info = parsePacked(this.exports, this.exports.framed_probe(ptr, bytes.length))
        .json as unknown as PhotoInfo;
      return info;
    } catch (err) {
      this.releaseImage();
      throw err;
    }
  }

  async defaultConfig(photo: PhotoInfo, template: FrameTemplate): Promise<RenderConfig> {
    return withJson<RenderConfig>(
      this.exports,
      (p, len) => this.exports.framed_default_config(p, len),
      { photo, template },
    );
  }

  async render(config: RenderConfig, preview: boolean): Promise<RenderResult> {
    if (!this.imagePtr) throw new Error('尚未加载照片');
    const tuned: RenderConfig = preview
      ? {
          ...config,
          output: {
            ...config.output,
            format: 'png',
            maxDim: config.output.maxDim > 0 ? Math.min(1600, config.output.maxDim) : 1600,
          },
        }
      : config;
    const cfg = encoder.encode(JSON.stringify(tuned));
    const cfgPtr = writeBytes(this.exports, cfg);
    try {
      const packed = parsePacked(
        this.exports,
        this.exports.framed_render(this.imagePtr, this.imageLen, cfgPtr, cfg.length),
      );
      return { png: packed.bin, meta: packed.json as unknown as RenderMeta };
    } finally {
      this.exports.framed_free(cfgPtr, cfg.length);
    }
  }

  async exportImage(config: RenderConfig, suggestedName: string): Promise<ExportResult> {
    const rendered = await this.render(
      {
        ...config,
        output: { ...config.output, maxDim: config.output.maxDim },
      },
      false,
    );
    const format = config.output.format;
    const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
    const blob = new Blob([rendered.png as unknown as BlobPart], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = suggestedName;
    anchor.click();
    URL.revokeObjectURL(url);
    return {};
  }

  private releaseImage(): void {
    if (this.imagePtr) {
      this.exports.framed_free(this.imagePtr, this.imageLen);
      this.imagePtr = 0;
      this.imageLen = 0;
    }
  }
}

export async function createWasmEngine(): Promise<Engine> {
  const url = new URL('framed_wasm.wasm', document.baseURI);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`加载 wasm 失败：${response.status}`);
  const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), {});
  return new WasmEngine(instance.exports as unknown as WasmExports);
}
