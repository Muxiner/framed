# AGENTS.md — 给 AI 协作者的项目说明

> 本文件面向在本仓库工作的 AI/自动化代理。人类开发者请看 `README.md` 与 `docs/CONTRACT.md`。

## 项目一句话

「框影 Framed」：给照片加相机取景框（边框 + EXIF 参数 + 文字/Logo 水印），Rust 内核，网页（wasm）与桌面（Tauri）双端，12 栅格排版。

## 先读什么

| 顺序 | 文件 | 用途 |
| --- | --- | --- |
| 1 | `docs/CONTRACT.md` | 配置 schema、wasm C ABI、Tauri 命令、UI 设计简报、验收标准——**改接口先改它** |
| 2 | `README.md` | 产品与构建方式 |
| 3 | `crates/core/src/config.rs` | 配置结构的唯一 Rust 实现 |
| 4 | `apps/web/src/types.ts` | 配置结构的 TypeScript 镜像 |

## 目录与职责

```
crates/core     Rust 渲染内核（无平台依赖，唯一真实现）
crates/cli      原生 CLI（framed）
crates/wasm     wasm32 cdylib，手写 C ABI，无 wasm-bindgen
apps/web        Vite + 原生 TS 编辑器（网页 / Tauri 共用）
apps/desktop    Tauri v2 壳；src-tauri 是独立 cargo 工程（根 workspace 之外）
scripts         构建脚本 / 字体子集化 / 示例图生成
docs            契约与截图
```

## 常用命令

```bash
# 测试（只测内核，桌面壳独立工程不参与）
cargo test -p framed-core

# 网页开发（先有 wasm）
./scripts/build-wasm.sh
npm --prefix apps/web run dev

# 类型检查 / 构建
npm --prefix apps/web run typecheck
npm --prefix apps/web run build

# 桌面
npm --prefix apps/desktop install
./scripts/build-desktop.sh

# CLI
cargo run -p framed-cli -- render photo.jpg -t film -o out.png
```

受限沙箱（如 CI 容器）里 `~/.cargo` 不可写时，先设 `CARGO_HOME` 到可写目录；npm 缓存同理用 `npm_config_cache`。

## 硬性约定

1. **配置字段两边同步**：改 `crates/core/src/config.rs` 必须同步 `apps/web/src/types.ts` 与 `docs/CONTRACT.md`；serde 一律 `camelCase`（`#[serde(rename_all = "camelCase")]` + `#[serde(default)]`）。
2. **尺寸全部按比例**：字号 = `min(canvas_w, canvas_h) * 0.018 * size`；边框宽度 = `margin * min(photo_w, photo_h)`；坐标 = 画布归一化 `0..1`。不要写死像素。
3. **三端一致**：任何视觉改动先在 `crates/core` 实现，网页与桌面自动一致。禁止在 JS 里「补一套渲染」——`engine.mock.ts` 只作开发回退。
4. **wasm 无绑定**：`crates/wasm` 只暴露 C ABI；返回缓冲格式 `[u32 json_len][json][u32 bin_len][bin]`（小端），调用方必须 `framed_free`。改 ABI 同步 `engine.wasm.ts` 与 Tauri 的 `main.rs`。
5. **字体**：`crates/core/assets/fonts/` 是子集化后的文件（含 OFL 文本），用 `scripts/build_fonts.py` 重新生成，不要手工替换成完整字体（wasm 体积会爆炸）。
6. **生成物不入库**：`apps/web/public/framed_wasm.wasm`、`apps/web/dist`、`target/`、`node_modules/`、`apps/desktop/src-tauri/target/` 已在 `.gitignore`。
7. **示例照片**：`apps/web/public/samples/` 由 `scripts/make_samples.py` 合成，带 EXIF；不要提交真实摄影师作品。
8. **多图 = 多份配置**：`LibraryPhoto` 各持自己的 `RenderConfig`；切换照片用 `engine.selectImage(id, bytes)`（桌面端按 id 走原生缓存，不重传），批量导出用 `engine.exportBatch([{id, filename, config}])`。不要把「全局唯一 config」的想法加回来。
9. **编辑器状态必须可撤销**：`apps/web` 里凡是改 `frame` / `blocks` 的操作都要走 `Editor` 的历史入口（`beginEdit` + `endCoalescedEdit`），并把连续操作合并成一步；选中、缩放、网格、抽屉、导出弹层等 UI 状态**不得**进历史。新增修改入口忘记接历史，撤销就会「跳过」这次改动。

## 视觉规范（UI）

- 暗色影像工具风：页面 `#0d0c0b`，面板 `#141311`，卡片 `#1a1815`，分割线 `#2a2723`，主文字 `#efeae1`，次文字 `#8c8579`，强调色暖金 `#e5b567`。
- 字体栈：系统无衬线（`-apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei"`），数字/参数可用 `ui-monospace`。
- 三栏：顶栏 56px、左 320px、右 320px；<1100px 收成抽屉/标签页。
- 数字、参数行用等宽/`font-variant-numeric: tabular-nums`；选中态用暖金描边而不是大面积填充。

## 验收流程（提交前）

```bash
cargo test -p framed-core
cargo run -p framed-cli -- demo apps/web/public/samples/mountain.jpg --out-dir /tmp/demo
npm --prefix apps/web run build      # 含 tsc --noEmit
```

肉眼检查 `/tmp/demo` 的 5 张图：文字不溢出、参数行不重叠、底栏留白合理、胶片齿孔对齐；再跑桌面 `./scripts/build-desktop.sh`（如涉及桌面改动）。

## 性能约定

- 预览热路径：`prepare_photo` 解码一次 → `render_prepared`（`compose`）反复合成；**不要在每次参数变化时重新 `render(bytes, config)`**（会重新解码原图 + Lanczos，慢 10 倍）。
- 预览编码用 JPEG(q90)，全尺寸导出才用用户在 output 里选的格式；wasm 端缓存放在 `PREPARED` 静态，桌面端放在 `PhotoState.preview`（`Arc<PreparedPhoto>`）。
- 新增预览相关逻辑时，用 CDP 测一下 `engine.render(config, true)` 的单帧耗时（24MP 照片目标 < 80ms）。

## 常见坑

- **EXIF 字段可能写在 IFD0 或 Exif 子 IFD**：内核按 tag number 查找（`field.tag.1`），不要用 `Tag` 的 `PartialEq`（它连同 Context 比较）。
- **ab_glyph 坐标**：`OutlinedGlyph::px_bounds()` 与 `Glyph::position` 同一坐标系；`draw(x, y, coverage)` 的 `x/y` 相对 bounds 左上角，要加 `bounds.min`。
- **手机竖拍**：按 `Orientation` 转正后再取宽高，5–8 需要交换宽高。
- **预览/导出一致**：限长边时先缩放照片、再按缩放后尺寸重算几何，不要缩放成品画布（否则字号比例会漂移）。
- **Tauri 命令返回二进制**：用 `tauri::ipc::Response` 原样返回打包字节；`Vec<u8>` 走 JSON 会非常慢。
- **撤销与受控输入框**：撤销前先 `blur`、回填配置后再恢复焦点/光标，否则 `textarea` / `range` 的 DOM 值与 `config` 不同步；`Cmd/Ctrl+Z` 在输入框聚焦时也要走应用级历史。
- **历史内存**：快照只存 `{frame, blocks}` 且共享不可变引用；不要把 Logo dataURL 逐帧深拷贝进栈。
- **桌面拖放**：Tauri 窗口必须 `dragDropEnabled: false`（`tauri.conf.json`），否则原生拖放会拦截 WebView 的 HTML5 文件 drop，拖拽导入在桌面端失效。
- **多图内存**：wasm 端照片缓存没有删除 API（最多 16 张，刷新释放）；桌面端 `PhotoCache` 按 id 存字节，批量导出直接从缓存渲染，不要重新 base64 传图。

## 相关技能文件

- `.agents/skills/framed/SKILL.md` — 本项目的可复用工作流（触发词、构建/调试路径、验收清单）。
