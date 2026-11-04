// Tauri 桌面引擎：调用 src-tauri 暴露的原生命令（走原生 framed-core，不加载 wasm）。
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

interface TauriCore {
  invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
}

const decoder = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk)) as unknown as number[],
    );
  }
  return btoa(binary);
}

function parsePacked(raw: ArrayBuffer | Uint8Array | number[]): {
  json: Record<string, unknown>;
  bin: Uint8Array;
} {
  const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw as ArrayBuffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLen = view.getUint32(0, true);
  const json = JSON.parse(decoder.decode(bytes.subarray(4, 4 + jsonLen))) as Record<
    string,
    unknown
  >;
  const binHeader = 4 + jsonLen;
  const binLen = view.getUint32(binHeader, true);
  const bin = bytes.slice(binHeader + 4, binHeader + 4 + binLen);
  if (json.ok !== true) {
    throw new Error(typeof json.error === 'string' ? json.error : '渲染失败');
  }
  return { json, bin };
}

function core(): TauriCore {
  const api = window.__TAURI__?.core;
  if (!api) throw new Error('Tauri API 不可用');
  return api;
}

class TauriEngine implements Engine {
  readonly kind = 'tauri' as const;

  async loadImage(bytes: Uint8Array, id?: string): Promise<PhotoInfo> {
    return core().invoke<PhotoInfo>('load_image', {
      dataB64: toBase64(bytes),
      photoId: id ?? null,
    });
  }

  async selectImage(id: string): Promise<PhotoInfo> {
    return core().invoke<PhotoInfo>('select_image', { photoId: id });
  }

  async defaultConfig(photo: PhotoInfo, template: FrameTemplate): Promise<RenderConfig> {
    const json = await core().invoke<string>('default_config', {
      photoJson: JSON.stringify(photo),
      template,
    });
    return JSON.parse(json) as RenderConfig;
  }

  async render(config: RenderConfig, preview: boolean): Promise<RenderResult> {
    const tuned: RenderConfig = preview
      ? { ...config, output: { ...config.output, format: 'png', maxDim: 1600 } }
      : config;
    const raw = await core().invoke<ArrayBuffer>('render_image', {
      configJson: JSON.stringify(tuned),
    });
    const packed = parsePacked(raw);
    return { png: packed.bin, meta: packed.json as unknown as RenderMeta };
  }

  async exportImage(config: RenderConfig, suggestedName: string): Promise<ExportResult> {
    const path = await core().invoke<string | null>('export_image', {
      configJson: JSON.stringify(config),
      suggestedName,
    });
    return path ? { path } : {};
  }

  async registerFont(id: string, bytes: Uint8Array): Promise<void> {
    await core().invoke('register_font', { id, dataB64: toBase64(bytes) });
  }

  async removeFont(id: string): Promise<void> {
    await core().invoke('remove_font', { id });
  }

  async exportBatch(items: BatchExportItem[]): Promise<BatchExportResult> {
    const result = await core().invoke<{
      saved: number;
      paths: string[];
      canceled?: boolean;
    }>('export_batch', { itemsJson: JSON.stringify(items) });
    return {
      saved: result.saved,
      method: 'folder',
      paths: result.paths,
      canceled: result.canceled ?? false,
    };
  }
}

export function createTauriEngine(): Engine {
  return new TauriEngine();
}
