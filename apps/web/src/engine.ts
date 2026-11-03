// 平台适配层：网页（wasm）、Tauri 桌面（原生命令）、无 wasm 时的 mock。
// 具体实现见 engine.wasm.ts / engine.tauri.ts / engine.mock.ts。
import type { Engine } from './types';

function isTauri(): boolean {
  return typeof window !== 'undefined' && typeof window.__TAURI__?.core?.invoke === 'function';
}

async function wasmAvailable(): Promise<boolean> {
  try {
    const url = new URL('framed_wasm.wasm', document.baseURI);
    const res = await fetch(url, { method: 'HEAD' });
    return res.ok;
  } catch {
    return false;
  }
}

let enginePromise: Promise<Engine> | null = null;

export function createEngine(): Promise<Engine> {
  if (!enginePromise) {
    enginePromise = (async () => {
      if (isTauri()) {
        const { createTauriEngine } = await import('./engine.tauri');
        return createTauriEngine();
      }
      if (await wasmAvailable()) {
        try {
          const { createWasmEngine } = await import('./engine.wasm');
          return await createWasmEngine();
        } catch (err) {
          console.error('[framed] wasm 引擎加载失败，回退到 mock', err);
        }
      }
      const { createMockEngine } = await import('./engine.mock');
      return createMockEngine();
    })();
  }
  return enginePromise;
}
