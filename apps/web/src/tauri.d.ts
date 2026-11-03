// Tauri 全局注入 API 的类型声明（withGlobalTauri: true）。
// 单独成文件，避免多个模块各自 declare global 造成 TS2717 冲突。

interface TauriInvoke {
  <T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>;
}

interface TauriCore {
  invoke: TauriInvoke;
}

interface TauriGlobal {
  core?: TauriCore;
  [key: string]: unknown;
}

declare global {
  interface Window {
    __TAURI__?: TauriGlobal;
  }
}

export {};
