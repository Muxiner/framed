---
name: framed
description: 在「框影 Framed」仓库里开发或修改照片边框/水印功能时使用：改 Rust 渲染内核、wasm ABI、编辑器 UI、Tauri 桌面壳，或做构建/验收/截图检查。
---

# 框影 Framed 开发工作流

## 什么时候用

- 任务涉及本仓库（`framed/`）的任何改动：渲染内核、模板、EXIF、文字排版、12 栅格、网页编辑器、Tauri 桌面、CLI、构建脚本。
- 用户说「给照片加边框 / 水印 / 相机参数」「改模板 / 字号 / 位置」「跑一下桌面版」「修 wasm」等，且上下文指向本项目。

## 先做的三件事

1. 读 `docs/CONTRACT.md`：配置 schema（§2）、wasm C ABI（§3.2）、Tauri 命令（§3.3）、UI 规范（§4）、验收（§8）。
2. 读 `AGENTS.md`：硬性约定与常见坑。
3. 确认改动落在哪一层：
   - 构图/字体/EXIF/导出 → `crates/core`（唯一真实现），改完三端一致；
   - 前端交互 → `apps/web`，渲染只通过 `createEngine()`；
   - 桌面壳 → `apps/desktop/src-tauri`（独立 cargo 工程，不在根 workspace）；
   - 跨端接口 → 先改 `docs/CONTRACT.md`，再同步 `config.rs`、`types.ts`、`engine.wasm.ts`、`main.rs`。

## 构建 / 调试路径

```bash
# 内核（最快反馈）
cargo test -p framed-core
cargo run -p framed-cli -- demo apps/web/public/samples/mountain.jpg --out-dir /tmp/demo

# 网页
./scripts/build-wasm.sh          # 产物 apps/web/public/framed_wasm.wasm（已 gitignore）
npm --prefix apps/web run dev    # 5173
npm --prefix apps/web run build  # tsc --noEmit + vite build

# 桌面
npm --prefix apps/desktop install
./scripts/build-desktop.sh
open apps/desktop/src-tauri/target/release/bundle/macos/Framed.app

# 无 GUI 时验证网页 UI
/Applications/Chromium.app/Contents/MacOS/Chromium --headless=new --no-sandbox \
  --disable-gpu --user-data-dir=/tmp/framed-chrome \
  --screenshot=/tmp/framed.png --window-size=1440,900 \
  --virtual-time-budget=8000 http://localhost:5173
```

受限环境里 `~/.cargo` / `~/.npm` 不可写时：`export CARGO_HOME=<可写目录>`、`npm_config_cache=<可写目录>`，npm 走 `--registry=https://registry.npmmirror.com`。

## 修改检查清单

- [ ] 改 `RenderConfig` 字段 → 同步 `apps/web/src/types.ts`、`docs/CONTRACT.md`、默认值（`config.rs` 的 `Default`）。
- [ ] 改布局/字号 → 只用比例值，跑 `cargo test -p framed-core`，再用 `framed demo` 目检 5 个模板。
- [ ] 改 wasm 导出 → 同步 `engine.wasm.ts` 的 `<T>` 解析与内存释放；用 Node 脚本（见下）验证 ABI。
- [ ] 改 UI → 1440×900 与 390×844 都截图检查；输入框编辑时不能丢焦点。
- [ ] 改编辑器里的 `frame` / `blocks` → 接入撤销历史（`beginEdit`/`endCoalescedEdit`，连续操作合并一步），并用 CDP 验证 `⌘Z` / `⇧⌘Z` 生效。
- [ ] 改桌面命令 → `cargo check`（`apps/desktop/src-tauri`）并尽量 `tauri build` 出 `.app`。
- [ ] 提交前：`cargo test`、`npm --prefix apps/web run build` 全绿。

## Node 里快速验证 wasm ABI

```js
// node /tmp/check-wasm.mjs（仓库根目录执行）
import fs from 'node:fs';
const { instance } = await WebAssembly.instantiate(
  fs.readFileSync('target/wasm32-unknown-unknown/release/framed_wasm.wasm'), {});
const e = instance.exports;
const bytes = fs.readFileSync('crates/core/tests/fixtures/sample.jpg');
const ptr = e.framed_alloc(bytes.length);
new Uint8Array(e.memory.buffer, ptr, bytes.length).set(bytes);
const out = e.framed_probe(ptr, bytes.length);
const view = new DataView(e.memory.buffer);
const len = view.getUint32(out, true);
console.log(JSON.parse(new TextDecoder().decode(new Uint8Array(e.memory.buffer, out + 4, len))));
e.framed_free(out, 4 + len + 4);
e.framed_free(ptr, bytes.length);
```

## 常见失败

| 现象 | 原因 / 处理 |
| --- | --- |
| `cargo` 报 registry 写不进去 | 沙箱不允许写 `~/.cargo`，设 `CARGO_HOME` |
| wasm 体积暴涨 | 字体被换成完整版；跑 `scripts/build_fonts.py` 重新子集化 |
| 网页显示旧图 | `framed_wasm.wasm` 是构建产物，重新 `build-wasm.sh`；浏览器强刷 |
| 文字变豆腐块 | 字体子集缺字；在 `build_fonts.py` 的字符集里补 unicode range |
| 预览与导出构图不同 | 限长边的顺序错了：必须缩放照片后重算几何 |
| Tauri 白屏 | `apps/web/dist` 不存在或 `frontendDist` 路径不对（`../../web/dist`） |
