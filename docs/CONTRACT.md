# 框影 Framed · 工程契约（CONTRACT）

> 本文件是前后端/多端之间的**唯一权威接口说明**。改接口先改这里。
> 产品：给照片加「相机取景框」——边框 + 拍摄参数 + 文字/Logo 水印，支持实时预览、逐项编辑、12 栅格定位、导出。
> 内核：Rust 一次实现，编译成 **WebAssembly（网页）** 与 **原生（Tauri 桌面 / CLI）** 两种形态。

## 1. 仓库结构

```
framed/
├── Cargo.toml                 # Rust workspace: core / cli / wasm
├── crates/
│   ├── core/                  # ★ 渲染引擎（平台无关，唯一的真·实现）
│   │   ├── assets/fonts/      # 内嵌字体（Google Fonts 子集，OFL）
│   │   ├── src/
│   │   └── tests/
│   ├── cli/                   # framed：命令行批量渲染（原生可执行文件）
│   └── wasm/                  # wasm32-unknown-unknown cdylib（无 wasm-bindgen，手写 C ABI）
├── apps/
│   ├── web/                   # Vite + 原生 TypeScript 编辑器（网页版 & Tauri 内嵌同一套 UI）
│   └── desktop/               # Tauri v2 桌面壳
│       ├── package.json
│       └── src-tauri/         # 独立 cargo 工程（不在根 workspace 内）
├── apps/web/public/samples/   # 示例照片（合成，带 EXIF）
├── scripts/                   # 构建脚本、字体子集化
├── docs/                      # 本契约、截图
└── README.md / AGENTS.md / .agents/skills/framed/SKILL.md
```

**写入范围（多人协作时不要越界）**

| 区域 | 负责人 |
| --- | --- |
| `crates/core`、`crates/cli`、`crates/wasm`、`assets/`、`scripts/` | Lead |
| `apps/web/src`、`apps/web/index.html`、`apps/web/src/style.css` | 前端 |
| `apps/web/engine*.ts`（平台适配层）由 Lead 提供骨架，前端可改 UI 部分 | 共享，先沟通 |
| `apps/desktop`、`apps/web` 之外的构建脚本、README/AGENTS/SKILL | 桌面负责人 / Lead |

## 2. 渲染配置 JSON（`RenderConfig`）

所有平台之间只传这个 JSON。字段全部可选，缺省值见 `crates/core/src/config.rs`。

```ts
type FrameTemplate = 'none' | 'white' | 'polaroid' | 'film' | 'black';
type FontFamily = 'sans' | 'mono' | 'cjk';
type TextAlign = 'left' | 'center' | 'right';
type AnchorY = 'top' | 'middle' | 'bottom';

interface FrameConfig {
  template: FrameTemplate;
  margin: number;       // 边框宽度，相对于照片短边的比例，0.02–0.12，默认 0.045
  bottomRatio: number;  // 底边额外宽度倍数（white / polaroid），默认 3.0 / 4.2
  background: string;   // 边框底色 #rrggbb
  radius: number;       // 照片圆角，相对于照片短边的比例，0–0.06，默认 0
  filmHoles: boolean;   // film 模板的齿孔，默认 true
}

interface BlockBase {
  id: string;           // 稳定 id：camera / gear / date / watermark / logo / 自定义
  name: string;         // UI 展示名
  x: number;            // 0..1，相对于成品画布宽度的锚点
  y: number;            // 0..1，相对于成品画布高度的锚点
  align: TextAlign;     // 水平锚定方向：left=左边缘对齐 x；center=中心；right=右边缘
  alignY: AnchorY;      // 垂直锚定方向：top=顶部；middle=中心；bottom=底部
  opacity: number;      // 0..1
  visible: boolean;
}

interface TextBlock extends BlockBase {
  type: 'text';
  text: string;          // 支持 \n 多行
  font: FontFamily;      // sans=Inter，mono=JetBrains Mono，cjk=Noto Sans SC
  weight: 400 | 600 | 700;
  size: number;          // 字号倍数（基准字号 = min(画布宽, 画布高) * 0.018），0.5–4
  lineHeight: number;    // 1.0–2.4
  letterSpacing: number; // 字间距（em），-0.05–0.5
  color: string;         // #rrggbb
  shadow: boolean;       // 文字投影（叠在照片上时建议开）
}

interface LogoBlock extends BlockBase {
  type: 'logo';
  src: string;           // data:image/png;base64,...（建议上传前缩到 ≤ 800px）
  width: number;         // 相对于画布宽度的比例，0.03–0.4
}

type Block = TextBlock | LogoBlock;

interface GridConfig {
  columns: 12;
  rows: 12;
  snap: boolean;         // 拖拽/放置时吸附 1/12 栅格
  visible: boolean;      // 画布上显示 12×12 参考线
}

interface OutputConfig {
  format: 'png' | 'jpeg';
  quality: number;       // 1–100，jpeg 生效
  maxDim: number;        // 长边像素上限；0 = 原图（预览时前端传 1600）
}

interface RenderConfig {
  version: 1;
  frame: FrameConfig;
  blocks: Block[];
  grid: GridConfig;
  output: OutputConfig;
}
```

### 2.1 坐标系与「12 等分」规则

- `x`/`y` 是**成品画布**（含边框）上的归一化坐标 `0..1`。
- 编辑器里 12 等分栅格：列线 `x = i/12`（i=0..12），行线 `y = j/12`。开启吸附时取最近的 `i/12` / `j/12`。
- 9 宫格快捷位（相对画布内安全区）：左上 `(1/12, 1/12)`、上中 `(6/12, 1/12)`、右上 `(11/12, 1/12)`，其余同理；实际取值由 `default_config` 返回。
- `align`/`alignY` 决定文字块相对锚点的伸展方向，例如 `align: right` 时文字右边缘位于 `x`。

## 3. 引擎 API

### 3.1 TypeScript 适配层（`apps/web/src/engine.ts`）

```ts
interface ExifInfo {
  camera: string;      // "SONY α7 IV"（已拼好 Make + Model）
  make: string;
  model: string;
  lens: string;
  focal: string;       // "35mm"
  aperture: string;    // "f/2.8"
  shutter: string;     // "1/250s"
  iso: string;         // "ISO 100"
  date: string;        // "2026.11.03 19:34"
  datetime: string;    // 原始 "2026:11:03 19:34:08"
  artist: string;
  copyright: string;
}

interface PhotoInfo {
  width: number;
  height: number;
  exif: ExifInfo;
}

interface BlockRect { id: string; x: number; y: number; w: number; h: number; }
interface RenderMeta { width: number; height: number; blocks: BlockRect[]; }

interface RenderResult { png: Uint8Array; meta: RenderMeta; }

interface Engine {
  /** 加载/探测照片（上传后调用一次） */
  loadImage(bytes: Uint8Array): Promise<PhotoInfo>;
  /** 依据 EXIF 与模板生成默认配置（默认文字块均已摆好位） */
  defaultConfig(photo: PhotoInfo, template: FrameTemplate): Promise<RenderConfig>;
  /** 渲染。preview=true 时内部把 output.maxDim 限制为 1600、格式 PNG */
  render(config: RenderConfig, preview: boolean): Promise<RenderResult>;
  /** 导出。网页端触发下载；Tauri 端弹系统保存框。返回保存路径或 Blob */
  exportImage(config: RenderConfig, suggestedName: string): Promise<{ path?: string }>;
  /** 引擎标识，用于 UI 显示（wasm / tauri） */
  readonly kind: 'wasm' | 'tauri';
}
```

- `engine.ts` 负责探测环境：`window.__TAURI__` 存在 → Tauri 适配；否则加载 `/framed_wasm.wasm` → wasm 适配。
- **开发期没有 wasm 时**，前端先接 `engine.mock.ts`（Canvas2D 近似渲染，见 §6），接口完全一致；Lead 完成后切换默认实现。

### 3.2 WASM C ABI（`crates/wasm`，无 wasm-bindgen）

导出（全部 `extern "C"`，`usize` = u32）：

```
framed_alloc(len: u32) -> *mut u8
framed_free(ptr: *mut u8, len: u32)
framed_probe(ptr: *const u8, len: u32) -> *mut u8
framed_default_config(ptr: *const u8, len: u32) -> *mut u8
framed_render(img_ptr: *const u8, img_len: u32, cfg_ptr: *const u8, cfg_len: u32) -> *mut u8
```

返回缓冲区格式（小端）：

```
[0..4)  u32 json_len
[4..4+json_len)  UTF-8 JSON：{ok:true, ...} 或 {ok:false, error:"..."}
[4+json_len .. +4)  u32 bin_len
[.. +bin_len)  二进制：probe/default_config 为空；render 为 PNG/JPEG 字节
```

- `probe` 的 JSON 即 `PhotoInfo`；`default_config` 入参为 `PhotoInfo` JSON、出参为 `RenderConfig`；`render` 的 JSON 为 `RenderMeta`。
- 调用方读完必须 `framed_free(ptr, total_len)` 释放。
- 调用返回后 wasm 内存可能增长，**JS 必须每次重新获取 `memory.buffer`**。

### 3.3 Tauri 命令（`apps/desktop/src-tauri`）

```
load_image(data_b64: String) -> PhotoInfo            # 原生解码 + 缓存当前照片
default_config(photo_json: String, template: String) -> String
render_image(config_json: String) -> tauri::ipc::Response   # 打包格式同 §3.2（meta+png）
export_image(config_json: String, suggested_name: String) -> Option<String>
```

- 渲染走原生 `framed-core`，不加载 wasm；`render_image` 内部把 `output.maxDim` 限制为 1600。
- `export_image` 用 `tauri-plugin-dialog` 弹保存框，返回保存路径。
- 前端通过 `window.__TAURI__.core.invoke(...)` 调用（`withGlobalTauri: true`）。

## 4. UI 设计简报（apps/web）

**气质**：专业影像工具 / 暗房。安静、克制、高密度但不拥挤；像 Lightroom + 富士相机的混血。
参考色板（写进 CSS variables）：

```css
--bg: #0d0c0b;          /* 页面背景 */
--panel: #141311;       /* 面板 */
--panel-2: #1a1815;     /* 卡片 */
--line: #2a2723;        /* 分割线 */
--text: #efeae1;        /* 主文字 */
--muted: #8c8579;       /* 次文字 */
--accent: #e5b567;      /* 暖金：选中/高亮 */
--accent-dim: #3a3021;  /* 选中底 */
--danger: #d1695c;
```

- 字体：系统无衬线栈（`-apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`）；数字/参数用 `ui-monospace, "SF Mono", "JetBrains Mono", monospace`。
- 布局：顶栏 56px（品牌「框影 FRAMED」、模板切换、导出）；左侧 320px 控制栏；中间舞台（深色格纹 + 画布）；右侧 320px 检查器（选中块的排版参数 + 12 栅格定位器）。窄屏（<1100px）左右栏收起为抽屉/标签页。
- 控制栏分区（可折叠）：① 照片（缩略图、换图、尺寸/EXIF 摘要）② 边框（5 个模板卡片、边距/底宽/底色/圆角）③ 内容块列表（相机/参数/日期/水印，开关 + 点击选中）④ 水印（文字、字体、字号、颜色…）⑤ Logo（上传、宽度、位置）。
- 舞台：画布等比适应；底部悬浮工具条（适应窗口 / 缩放 % / 12 栅格开关 / 吸附开关）；画布上可**拖拽文字块**，吸附至 1/12 网格；选中块显示虚线选框 + 名称。
- 检查器：字号、字重、行高、字间距、颜色、不透明度、对齐、阴影；**12×12 定位器**（144 格，点击定位）+ 9 宫格快捷位 + 偏移微调；`x/y` 数值输入。Logo 块显示宽度/位置/透明度。
- 交互：所有修改 < 100ms 内反映到预览（rAF 合并渲染请求）；渲染中显示轻微状态点；错误 toast；导出成功 toast。
- 撤销 / 重做：`⌘/Ctrl+Z` 撤销，`⇧⌘Z` / `Ctrl+Y` 重做；顶栏按钮带禁用态与快捷键提示；历史栈上限 40。一次拖拽、一段连续文字输入（800ms 静默 / blur / Enter / 切换选中时提交）、一次滑杆拖动各记 1 步；模板切换 / 块显隐 / Logo 上传删除各 1 步。选中、缩放、12 栅格开关、抽屉、导出弹层**不进历史**；新编辑清空 redo；换照片重置历史；撤销后自动选中发生变化的块。
- 空状态：未选图时舞台显示产品说明 + 「上传照片 / 用示例照片」。

## 5. 渲染规格（core 行为，前端照此校验）

- 输入 JPEG/PNG/WebP/GIF/TIFF 字节；按 EXIF `Orientation` 自动转正。
- 画布 = 照片 + 边框；`margin` 相对于照片短边；`white` 底边 = `margin * bottomRatio`。
- 基准字号 = `min(canvas_w, canvas_h) * 0.018 * block.size`。
- 字体回退链：sans → Inter → Noto Sans SC；mono → JetBrains Mono → Noto Sans SC；cjk → Noto Sans SC → Inter。
- 预览：`render(config, preview=true)` 自动限长边 1600，且与原图构图一致。
- 导出：`output.maxDim > 0` 时长边缩到该值；JPEG 质量取 `quality`。

## 6. 默认配置（`default_config`）

按模板生成 4 个文字块（`camera` / `gear` / `date` / `watermark`），摆位如下（均落在底栏或画布安全区）：

- `white`：底栏内左侧两行（机型 / 参数），右下日期 + 水印；深色文字。
- `polaroid`：底栏大留白：机型居中偏上、参数居中、日期右下、水印底部居中。
- `film`：黑色边框 + 上下齿孔（`filmHoles`），浅色 mono 文字 + 阴影压在画面底部：机型/参数左下、日期/水印右下。
- `black`：叠在照片上，浅色文字 + 阴影：机型/参数左下，日期左上/右下，水印右下。
- `none`：不扩画布，参数左下、水印右下，均开阴影。

文字内容示例（有 EXIF 时）：`SONY α7 IV · FE 24-70mm F2.8 GM II`、`35mm · f/2.8 · 1/250s · ISO 100`、`2026.11.03`、`© muxiner`。

## 7. 构建 / 开发命令

```bash
# 网页（wasm）
./scripts/build-wasm.sh            # cargo build -p framed-wasm --target wasm32-unknown-unknown --release
npm --prefix apps/web install      # 仅首次
npm --prefix apps/web run dev      # http://localhost:5173

# 桌面（Tauri）
npm --prefix apps/desktop install
npm --prefix apps/desktop run tauri dev     # 开发
npm --prefix apps/desktop run tauri build   # 产出 .app / .exe

# 原生 CLI
cargo run -p framed-cli -- --help
```

## 8. 验收标准

1. `cargo test -p framed-core` 全绿（含 EXIF 解析、配置序列化、渲染快照尺寸断言）。
2. `cargo run -p framed-cli -- render <输入> -o out.png --template white` 产出图片，肉眼构图正确。
3. `scripts/build-wasm.sh` 产出 `apps/web/public/framed_wasm.wasm`，网页端可上传、实时预览、编辑、导出。
4. `npm --prefix apps/desktop run tauri build` 产出可双击启动的 `.app`（macOS）。
5. UI 在 1440×900 与 390×844 两个尺寸下无溢出、无遮挡。
6. 撤销 / 重做：拖拽一次后撤销回到原坐标、重做恢复；连续输入一次撤销清整段且输入框焦点保持；顶栏按钮禁用态正确。
