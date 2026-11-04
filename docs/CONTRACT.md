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
  photoShadow: {        // 照片阴影（默认关闭）
    enabled: boolean;
    mode: 'outer' | 'inner' | 'both';
    angle: number;      // 方向：0° 向右，90° 向下
    distance: number;   // 偏移 / 照片短边，0–0.2
    blur: number;       // 模糊 / 照片短边，0–0.2
    spread: number;     // 扩散 / 照片短边，-0.1–0.2
    color: string;      // #rrggbb
    opacity: number;    // 0–1
  };
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
  customFont?: string;   // 用户上传字体 id；缺字形时按 font 回退
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

interface BatchExportItem { id: string; filename: string; config: RenderConfig; }
interface BatchExportResult {
  saved: number;
  method: 'download' | 'folder';   // 网页端逐张下载 / 桌面端写入所选目录
  paths?: string[];
  canceled?: boolean;
}

interface Engine {
  /** 载入照片并缓存为 `id`（多图模式下每张只上传一次；不传自动生成） */
  loadImage(bytes: Uint8Array, id?: string): Promise<PhotoInfo>;
  /** 切换到已缓存照片（wasm 端需要 bytes，桌面端按 id 取原生缓存） */
  selectImage(id: string, bytes?: Uint8Array): Promise<PhotoInfo>;
  /** 依据 EXIF 与模板生成默认配置（默认文字块均已摆好位） */
  defaultConfig(photo: PhotoInfo, template: FrameTemplate): Promise<RenderConfig>;
  /** 渲染。preview=true 时内部把 output.maxDim 限制为 1600、格式 PNG */
  render(config: RenderConfig, preview: boolean): Promise<RenderResult>;
  /** 导出。网页端触发下载；Tauri 端弹系统保存框。返回保存路径或 Blob */
  exportImage(config: RenderConfig, suggestedName: string): Promise<{ path?: string }>;
  /** 批量导出：网页端逐张下载，桌面端选一次目录后写入全部 */
  exportBatch(items: BatchExportItem[]): Promise<BatchExportResult>;
  /** 引擎标识，用于 UI 显示（wasm / tauri） */
  readonly kind: 'wasm' | 'tauri';
}
```

- **多图**：照片字节缓存在前端（`Map<id, Uint8Array>`）；桌面端另外在 Rust 侧按 id 缓存，切换时不重复传图。
- **导入**：支持拖拽 1..N 张、文件选择多选、粘贴多张；上次上限 16 张，超限/非图片会跳过并提示。

- `engine.ts` 负责探测环境：`window.__TAURI__` 存在 → Tauri 适配；否则加载 `/framed_wasm.wasm` → wasm 适配。
- **开发期没有 wasm 时**，前端先接 `engine.mock.ts`（Canvas2D 近似渲染，见 §6），接口完全一致；Lead 完成后切换默认实现。

### 3.2 WASM C ABI（`crates/wasm`，无 wasm-bindgen）

导出（全部 `extern "C"`，`usize` = u32）：

```
framed_alloc(len: u32) -> *mut u8
framed_free(ptr: *mut u8, len: u32)
framed_probe(ptr: *const u8, len: u32) -> *mut u8
framed_prepare(ptr: *const u8, len: u32, max_dim: u32) -> *mut u8   # 解码+转正+缩放并缓存预览底图
framed_register_font(id_ptr: *const u8, id_len: u32, data_ptr: *const u8, data_len: u32) -> *mut u8  # 注册用户字体
framed_remove_font(ptr: *const u8, len: u32) -> *mut u8              # 移除用户字体
framed_default_config(ptr: *const u8, len: u32) -> *mut u8
framed_render_preview(cfg_ptr: *const u8, cfg_len: u32) -> *mut u8  # 用缓存底图合成 + JPEG（热路径）
framed_render(img_ptr: *const u8, img_len: u32, cfg_ptr: *const u8, cfg_len: u32) -> *mut u8  # 全尺寸导出
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
load_image(data_b64: String, photo_id: Option<String>) -> PhotoInfo   # 解码 + 按 id 缓存并设为当前
select_image(photo_id: String) -> PhotoInfo            # 切换当前照片（用原生缓存，不重传图片）
default_config(photo_json: String, template: String) -> String
render_image(config_json: String) -> tauri::ipc::Response   # 打包格式同 §3.2（meta+png）
export_image(config_json: String, suggested_name: String) -> Option<String>
export_batch(items_json: String) -> { saved, paths, canceled }       # 选目录后批量写入
register_font(id: String, data_b64: String) -> ()                   # 注册用户字体（ttf/otf）
remove_font(id: String) -> ()                                       # 移除用户字体
list_fonts() -> [String]                                            # 当前进程已注册字体 id
```

- 渲染走原生 `framed-core`，不加载 wasm；`render_image` 是预览热路径：复用 `PhotoState` 里已解码的预览底图，只合成 + JPEG(q90) 编码后返回。
- `export_image` 用 `tauri-plugin-dialog` 弹保存框，返回保存路径；`export_batch` 弹一次文件夹选择框，按 `items_json` 里的 `{id, filename, config}` 逐张写入（文件名做路径穿越过滤）。
- 窗口设置 `dragDropEnabled: false`，让 WebView 接收 HTML5 文件拖放（否则拖拽会被原生拖放拦截）。
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
- 多选：普通点击单选，Shift/Cmd/Ctrl+点击切换多选；拖动任意选中块按同一归一化位移整体移动（一次拖拽=1 步撤销），方向键整体微调，⌘/Ctrl+A 全选文字块；检查器在多选时显示「已选 N 个元素」。
- 照片阴影：边框区「照片阴影」开关 + 外/内/内外 + 方向 0–360° + 距离/模糊/扩散/颜色/不透明度；改参数走撤销历史与统一模式同步；切换模板/套用预设时保留当前 photoShadow。
- 品牌样式：边框区顶部 7 个内置风格（徕卡/索尼/佳能/尼康/小米/富士/哈苏），点击应用（走撤销历史、统一模式同步全部照片、EXIF 文本各自保留）。
- 照片库：拖拽任意位置导入 1..N 张、文件多选、粘贴多图；左栏缩略图网格（当前高亮、hover 删除、点击切换、上限 16）；缩略图可拖拽排序（Pointer Events，鼠标/触摸，暖金插入线；`activePhotoId` 不变、不渲染、不进历史；「导出全部」顺序跟随库顺序），支持 Alt+←/→ 键盘移动；每张照片独立配置；切换 < 1s；导入进度与跳过提示。
- 批量参数：默认「统一」（`sharedParams: true`）——任何 `frame` / `blocks` 编辑在 `patch` 时自动同步到照片库全部照片；但 `camera` / `gear` / `date` 三个文字块的**文本**按各照片 `exifTexts` 各自保留（编辑这三段只更新当前照片），其余样式/位置/水印/Logo/output/grid 全量同步。切「单独」后各照片独立，编辑只影响当前；「应用当前参数到全部」可一次性同步（文本按各图 EXIF 替换）。模式切换不进撤销栈并重置历史。
- 预设：边框区「预设」入口，可把当前 `frame + blocks` 保存为命名预设（localStorage，上限 30），随时套用/删除/导出 JSON/导入 JSON；套用时 camera/gear/date 文本按当前照片 EXIF 替换，保留 output/grid 并走撤销历史。
- 预设分享码：`FRAMED1:<base64url>`，payload 为紧凑 JSON `{v:1,name,frame,blocks}`（去掉 output/grid）；含 Logo 或超过 32KB 时提示改用 JSON 导出；导入容忍前缀、标准/URL-safe base64、空白。
- 自定义字体：左栏字体区上传 ttf/otf（≤8MB），检查器字体下拉可选用；已上传字体在网页端持久化（IndexedDB），桌面端为当前进程内有效；移除字体时引用它的文本块自动回退到内置字体。
- 批量导出：导出弹层支持「导出全部」，按当前模式构造配置——统一模式用 master 样式 + 各图 EXIF 文本，单独模式用各自 config；网页端逐张下载、桌面端选目录一次写入。
- 交互：所有修改 < 100ms 内反映到预览（rAF 合并渲染请求）；渲染中显示轻微状态点；错误 toast；导出成功 toast。
- 撤销 / 重做：`⌘/Ctrl+Z` 撤销，`⇧⌘Z` / `Ctrl+Y` 重做；顶栏按钮带禁用态与快捷键提示；历史栈上限 40。一次拖拽、一段连续文字输入（800ms 静默 / blur / Enter / 切换选中时提交）、一次滑杆拖动各记 1 步；模板切换 / 块显隐 / Logo 上传删除各 1 步。选中、缩放、12 栅格开关、抽屉、导出弹层**不进历史**；新编辑清空 redo；换照片重置历史；撤销后自动选中发生变化的块。
- 空状态：未选图时舞台显示产品说明 + 「上传照片 / 用示例照片」。

## 5. 渲染规格（core 行为，前端照此校验）

- 输入 JPEG/PNG/WebP/GIF/TIFF 字节；按 EXIF `Orientation` 自动转正。
- 画布 = 照片 + 边框；`margin` 相对于照片短边；`white` 底边 = `margin * bottomRatio`。
- 基准字号 = `min(canvas_w, canvas_h) * 0.018 * block.size`。
- 字体回退链：sans → Inter → Noto Sans SC；mono → JetBrains Mono → Noto Sans SC；cjk → Noto Sans SC → Inter。
- **预览性能**：照片载入/切换时 `prepare_photo`（wasm 侧缓存）解码 + 按 EXIF 转正 + 缩放（照片长边 1400）；之后每次改参数只走 `compose`（边框/文字/Logo）+ JPEG(q90) 编码。预览不再重复解码原图。桌面端把底图缓存在 `PhotoState.preview`，wasm 端缓存在静态 `PREPARED`。
- 预览构图与原图一致（`render_prepared` 用同一套几何），全尺寸导出仍走 `render` 解码原图。
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
7. 多图：一次拖入 3 张照片 → 照片库 3 张、激活第一张；删除后数量正确；「导出全部」产出 3 个文件（网页端下载 / 桌面端一次选目录写入）。
8. 批量参数：默认统一——改水印/边距后 3 张 config 数值一致，且 camera 文本分别为 SONY/FUJIFILM/Canon；切单独后改一张不影响其他；切回统一后全部变为当前参数；统一模式撤销/重做可让全部照片跟随回退。
9. 预设：保存当前排版为预设后改乱参数 → 套用预设恢复 frame/blocks、camera 文本仍来自当前照片；刷新后预设仍在；导入/导出 JSON 可用。
10. 自定义字体：上传 ttf → 指定到文字块后渲染不报错且 config.customFont 生效；移除字体后文本回退内置字体，页面不崩。
11. 照片库排序：拖第 3 张到第 1 位 → `state.library` 顺序变化、activePhotoId 不变、「导出全部」顺序跟随；点击/小位移不误触、Esc 取消、Alt+←/→ 可移动。
12. 多选与阴影：Shift/Cmd 多选后拖动任意选中块 → 全部块同位移、相对位置不变、一次撤销回退；照片阴影切换内/外/内外后预览变化，切模板后 photoShadow 保留。
13. 品牌样式：7 个样式均可应用且颜色/字体/水印不同；统一参数模式应同步到全部照片且相机/参数/日期文本各自保留。
14. 预设分享码：生成 `FRAMED1:` 码 → 清空预设后粘贴导入可用、frame/blocks 一致（无 output/grid）；无前缀/URL-safe/含空白均能导入；非法码报错且不写入；含 Logo 的预设提示用 JSON 导出。
