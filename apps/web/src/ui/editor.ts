// 编辑器状态与动作：唯一的数据源 + 渲染管线（rAF 合并、序列号丢弃过期结果）。
// UI 组件只通过这里读写状态，不直接碰引擎。
import { createEngine } from '../engine';
import type {
  Block,
  Engine,
  FrameConfig,
  FrameTemplate,
  GridConfig,
  LogoBlock,
  OutputConfig,
  PhotoInfo,
  RenderConfig,
  RenderMeta,
  TextBlock,
} from '../types';
import { fetchSample, type SampleId } from './samples';
import { toast } from './toast';

export type LoadStatus = 'boot' | 'empty' | 'loading' | 'ready';
export type EngineLabel = 'WASM' | 'MOCK' | 'TAURI';

export interface EditorState {
  status: LoadStatus;
  engineKind: 'wasm' | 'tauri' | null;
  engineLabel: EngineLabel;
  template: FrameTemplate;
  photo: PhotoInfo | null;
  photoName: string;
  photoThumb: string | null;
  config: RenderConfig | null;
  selectedId: string | null;
  bitmap: ImageBitmap | null;
  meta: RenderMeta | null;
  rendering: boolean;
  renderMs: number;
  renderError: string | null;
  zoom: 'fit' | number;
  leftOpen: boolean;
  inspectorOpen: boolean;
  exporting: boolean;
  exportOpen: boolean;
  exportName: string;
  dragOver: boolean;
  sampleBusy: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

export type Listener = (state: EditorState) => void;

function initialState(): EditorState {
  return {
    status: 'boot',
    engineKind: null,
    engineLabel: 'MOCK',
    template: 'white',
    photo: null,
    photoName: '',
    photoThumb: null,
    config: null,
    selectedId: null,
    bitmap: null,
    meta: null,
    rendering: false,
    renderMs: 0,
    renderError: null,
    zoom: 'fit',
    leftOpen: false,
    inspectorOpen: false,
    exporting: false,
    exportOpen: false,
    exportName: '',
    dragOver: false,
    sampleBusy: false,
    canUndo: false,
    canRedo: false,
  };
}

export function isTextBlock(block: Block): block is TextBlock {
  return block.type === 'text';
}

export function isLogoBlock(block: Block): block is LogoBlock {
  return block.type === 'logo';
}

export function blockTypeLabel(block: Block): string {
  return block.type === 'logo' ? '图片' : '文字';
}

interface MergeOptions {
  preserveAllText?: boolean;
  preserveTextIds?: string[];
  preserveLogo?: boolean;
  preserveGrid?: boolean;
  preserveOutput?: boolean;
}

function mergeConfig(fresh: RenderConfig, previous: RenderConfig | null, options: MergeOptions): RenderConfig {
  if (!previous) return fresh;
  const previousById = new Map(previous.blocks.map((block) => [block.id, block]));
  const blocks: Block[] = fresh.blocks.map((block) => {
    if (block.type !== 'text') return block;
    const old = previousById.get(block.id);
    if (!old || old.type !== 'text') return block;
    const keep =
      options.preserveAllText === true || (options.preserveTextIds ?? []).includes(block.id);
    return keep ? { ...block, text: old.text } : block;
  });
  if (options.preserveLogo) {
    const hasLogo = blocks.some((block) => block.type === 'logo');
    if (!hasLogo) {
      for (const block of previous.blocks) if (block.type === 'logo') blocks.push(block);
    }
  }
  return {
    ...fresh,
    blocks,
    grid: options.preserveGrid ? previous.grid : fresh.grid,
    output: options.preserveOutput ? previous.output : fresh.output,
  };
}

function guessMime(bytes: Uint8Array, name: string): string {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'image/gif';
  const lower = name.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return '未知错误';
}

function isMockEngine(engine: Engine): boolean {
  return (engine as Engine & { mock?: boolean }).mock === true;
}

function mobileQuery(): boolean {
  return window.matchMedia('(max-width: 1099px)').matches;
}

/** 历史里保存的「可见结果」：画布几何 + 内容块。网格/输出等 UI 偏好不进历史。 */
interface HistoryEntry {
  frame: FrameConfig;
  blocks: Block[];
}

interface BurstState {
  key: string;
  mode: 'idle' | 'manual';
  timer: number;
}

interface EditOptions {
  /** 一次性操作：立即落一个历史步（定位器、Logo 上传等）。 */
  discrete?: boolean;
}

interface FocusSnapshot {
  element: HTMLElement;
  start: number | null;
  end: number | null;
}

const HISTORY_LIMIT = 40;

function captureFocusState(active: Element | null): FocusSnapshot | null {
  if (!(active instanceof HTMLElement)) return null;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    return { element: active, start: active.selectionStart, end: active.selectionEnd };
  }
  return { element: active, start: null, end: null };
}

function restoreFocusState(snapshot: FocusSnapshot | null): void {
  if (!snapshot) return;
  const { element } = snapshot;
  if (!element.isConnected || element.hasAttribute('disabled')) return;
  element.focus({ preventScroll: true });
  if ((element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) &&
      snapshot.start !== null && snapshot.end !== null) {
    try {
      const max = element.value.length;
      element.setSelectionRange(Math.min(snapshot.start, max), Math.min(snapshot.end, max));
    } catch {
      // range / color / number 等输入不支持 selection API
    }
  }
}

export class Editor {
  readonly state: EditorState = initialState();
  fitScale = 1;

  private listeners = new Set<Listener>();
  private engine: Engine | null = null;
  private raf = 0;
  private seq = 0;
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];
  private burst: BurstState | null = null;
  private draggingBlock: string | null = null;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private patch(partial: Partial<EditorState>): void {
    Object.assign(this.state, partial);
    for (const listener of this.listeners) listener(this.state);
  }

  // ---------------------------------------------------------------- 撤销 / 重做

  private syncHistoryFlags(): void {
    const canUndo = this.past.length > 0;
    const canRedo = this.future.length > 0;
    if (canUndo === this.state.canUndo && canRedo === this.state.canRedo) return;
    this.patch({ canUndo, canRedo });
  }

  /**
   * 在真正修改 config 之前调用：把「修改前」的快照压栈。
   * 相同 key 的连续操作（连续输入 / 滑杆拖动 / 拖拽）复用同一个 burst，只落一步。
   */
  private beginEdit(key: string, mode: 'idle' | 'manual' = 'idle', idleMs = 800): void {
    const config = this.state.config;
    if (!config) return;
    if (this.burst) {
      if (this.burst.key === key) {
        if (this.burst.mode === 'idle') this.resetBurstTimer(idleMs);
        return;
      }
      this.endCoalescedEdit();
    }
    this.past.push({ frame: config.frame, blocks: config.blocks });
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future.length = 0;
    this.burst = { key, mode, timer: 0 };
    if (mode === 'idle') this.resetBurstTimer(idleMs);
    this.syncHistoryFlags();
  }

  private resetBurstTimer(idleMs: number): void {
    const burst = this.burst;
    if (!burst) return;
    if (burst.timer) window.clearTimeout(burst.timer);
    burst.timer = window.setTimeout(() => this.endCoalescedEdit(), idleMs);
  }

  /** 收束当前连续编辑（文字静默/失焦/Enter、滑杆释放、拖拽结束、切换选中）。 */
  endCoalescedEdit(): void {
    const burst = this.burst;
    if (!burst) return;
    if (burst.timer) window.clearTimeout(burst.timer);
    this.burst = null;
    this.syncHistoryFlags();
  }

  private resetHistory(): void {
    if (this.burst?.timer) window.clearTimeout(this.burst.timer);
    this.burst = null;
    this.draggingBlock = null;
    this.past = [];
    this.future = [];
    this.syncHistoryFlags();
  }

  undo(): void {
    this.endCoalescedEdit();
    this.draggingBlock = null;
    const config = this.state.config;
    if (!config) return;
    const previous = this.past.pop();
    if (!previous) {
      this.syncHistoryFlags();
      return;
    }
    this.future.push({ frame: config.frame, blocks: config.blocks });
    if (this.future.length > HISTORY_LIMIT) this.future.shift();
    this.applyHistory(previous);
  }

  redo(): void {
    this.endCoalescedEdit();
    this.draggingBlock = null;
    const config = this.state.config;
    if (!config) return;
    const next = this.future.pop();
    if (!next) {
      this.syncHistoryFlags();
      return;
    }
    this.past.push({ frame: config.frame, blocks: config.blocks });
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.applyHistory(next);
  }

  private applyHistory(entry: HistoryEntry): void {
    const config = this.state.config;
    if (!config) return;
    // 撤销时输入框可能正聚焦：先失焦让受控控件同步，再回填文本并恢复焦点/光标。
    const focus = captureFocusState(document.activeElement);
    if (focus && focus.element !== document.body) focus.element.blur();
    const next: RenderConfig = { ...config, frame: entry.frame, blocks: entry.blocks };
    const selectedId = this.resolveHistorySelection(config.blocks, entry.blocks);
    this.patch({
      config: next,
      selectedId,
      canUndo: this.past.length > 0,
      canRedo: this.future.length > 0,
    });
    if (focus) restoreFocusState(focus);
    this.scheduleRender();
  }

  /** 撤销/重做后尽量选中发生变化的块，方便用户看到改动。 */
  private resolveHistorySelection(before: readonly Block[], after: readonly Block[]): string | null {
    const selected = this.state.selectedId;
    const afterIds = new Set(after.map((block) => block.id));
    const beforeById = new Map(before.map((block) => [block.id, block]));
    const changed: string[] = [];
    for (const block of after) {
      const previous = beforeById.get(block.id);
      if (!previous || previous !== block) changed.push(block.id);
    }
    if (selected && changed.includes(selected)) return selected;
    if (selected && changed.length === 0 && afterIds.has(selected)) return selected;
    for (const id of changed) if (afterIds.has(id)) return id;
    if (selected && afterIds.has(selected)) return selected;
    return after[0]?.id ?? null;
  }

  async init(): Promise<void> {
    try {
      const engine = await createEngine();
      this.engine = engine;
      const label: EngineLabel = engine.kind === 'tauri' ? 'TAURI' : isMockEngine(engine) ? 'MOCK' : 'WASM';
      this.patch({ engineKind: engine.kind, engineLabel: label, status: 'empty' });
      if (label === 'MOCK') {
        toast('开发回退引擎（Canvas2D）已启用，wasm 内核就绪后自动切换', 'info', 4200);
      }
    } catch (error) {
      this.patch({ status: 'empty' });
      toast(`渲染引擎初始化失败：${errorMessage(error)}`, 'error', 6000);
    }
  }

  // ---------------------------------------------------------------- 照片

  async loadPhoto(file: File): Promise<void> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await this.loadBytes(bytes, file.name);
  }

  async loadSample(id: SampleId): Promise<void> {
    if (this.state.sampleBusy) return;
    this.patch({ sampleBusy: true });
    try {
      const sample = await fetchSample(id);
      await this.loadBytes(sample.bytes, sample.name);
      if (sample.generated) toast('示例照片尚未就绪，已使用生成的占位画面', 'info', 3800);
    } catch (error) {
      toast(`示例照片载入失败：${errorMessage(error)}`, 'error', 5000);
    } finally {
      this.patch({ sampleBusy: false });
    }
  }

  private async loadBytes(bytes: Uint8Array, name: string): Promise<void> {
    const engine = this.engine;
    if (!engine) {
      toast('渲染引擎尚未就绪，请稍后重试', 'error');
      return;
    }
    const previous = this.state.config;
    const hadPhoto = this.state.photo !== null;
    this.patch({
      status: hadPhoto ? 'ready' : 'loading',
      rendering: true,
      renderError: null,
      photoName: name,
    });
    try {
      const photo = await engine.loadImage(bytes);
      const template = this.state.template;
      const fresh = await engine.defaultConfig(photo, template);
      const config = mergeConfig(fresh, previous, {
        preserveTextIds: ['watermark'],
        preserveLogo: true,
        preserveGrid: true,
        preserveOutput: true,
      });
      const oldThumb = this.state.photoThumb;
      const thumb = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: guessMime(bytes, name) }));
      if (oldThumb && oldThumb.startsWith('blob:')) URL.revokeObjectURL(oldThumb);
      this.patch({
        photo,
        photoName: name,
        photoThumb: thumb,
        config,
        selectedId: null,
        meta: null,
        bitmap: null,
        status: 'ready',
        zoom: 'fit',
      });
      this.resetHistory();
      await this.renderPreview();
    } catch (error) {
      this.patch({ rendering: false });
      toast(`无法载入照片：${errorMessage(error)}`, 'error', 5200);
      if (!hadPhoto) this.patch({ status: 'empty' });
    }
  }

  // ---------------------------------------------------------------- 模板 / 边框

  async setTemplate(template: FrameTemplate): Promise<void> {
    const engine = this.engine;
    if (this.state.template === template && this.state.config?.frame.template === template) return;
    this.patch({ template });
    const photo = this.state.photo;
    const previous = this.state.config;
    if (!engine || !photo || !previous) {
      this.patch({ config: previous ? { ...previous, frame: { ...previous.frame, template } } : null });
      return;
    }
    try {
      const fresh = await engine.defaultConfig(photo, template);
      const config = mergeConfig(fresh, previous, {
        preserveAllText: true,
        preserveLogo: true,
        preserveGrid: true,
        preserveOutput: true,
      });
      this.beginEdit('template', 'manual');
      this.patch({ config });
      this.scheduleRender();
      this.endCoalescedEdit();
    } catch (error) {
      toast(`模板切换失败：${errorMessage(error)}`, 'error', 5000);
    }
  }

  setFrame(patch: Partial<FrameConfig>): void {
    const config = this.state.config;
    if (!config) return;
    const keys = Object.keys(patch) as (keyof FrameConfig)[];
    if (keys.length === 0) return;
    const changed = keys.some(
      (key) => JSON.stringify(config.frame[key]) !== JSON.stringify(patch[key]),
    );
    if (!changed) return;
    this.beginEdit(`frame:${keys.slice().sort().join(',')}`, 'idle', 600);
    this.patch({ config: { ...config, frame: { ...config.frame, ...patch } } });
    this.scheduleRender();
  }

  setGrid(patch: Partial<GridConfig>): void {
    const config = this.state.config;
    if (!config) return;
    this.patch({ config: { ...config, grid: { ...config.grid, ...patch } } });
  }

  toggleGrid(): void {
    const config = this.state.config;
    if (!config) return;
    this.setGrid({ visible: !config.grid.visible });
  }

  toggleSnap(): void {
    const config = this.state.config;
    if (!config) return;
    this.setGrid({ snap: !config.grid.snap });
  }

  setOutput(patch: Partial<OutputConfig>): void {
    const config = this.state.config;
    if (!config) return;
    this.patch({ config: { ...config, output: { ...config.output, ...patch } } });
  }

  // ---------------------------------------------------------------- 内容块

  select(id: string | null): void {
    this.endCoalescedEdit();
    if (this.state.selectedId === id) return;
    this.patch({ selectedId: id });
  }

  /** 窄屏下从左侧列表进入检查器（舞台拖拽时不弹抽屉，避免遮住画布）。 */
  openInspectorForSelection(): void {
    if (!mobileQuery() || this.state.inspectorOpen) return;
    this.patch({ inspectorOpen: true, leftOpen: false });
  }

  updateTextBlock(
    id: string,
    patch: Partial<Omit<TextBlock, 'type' | 'id'>>,
    options: EditOptions = {},
  ): void {
    const config = this.state.config;
    if (!config) return;
    const target = config.blocks.find((block) => block.id === id);
    if (!target || target.type !== 'text') return;
    const keys = Object.keys(patch) as (keyof typeof patch)[];
    if (keys.length === 0) return;
    const changed = keys.some(
      (key) => JSON.stringify(target[key]) !== JSON.stringify(patch[key]),
    );
    if (!changed) return;
    this.beginEdit(
      `text:${id}:${keys.slice().sort().join(',')}`,
      options.discrete ? 'manual' : 'idle',
      800,
    );
    const blocks = config.blocks.map((block) =>
      block.id === id && block.type === 'text' ? ({ ...block, ...patch } as TextBlock) : block,
    );
    this.patch({ config: { ...config, blocks } });
    this.scheduleRender();
    if (options.discrete) this.endCoalescedEdit();
  }

  updateLogoBlock(
    id: string,
    patch: Partial<Omit<LogoBlock, 'type' | 'id'>>,
    options: EditOptions = {},
  ): void {
    const config = this.state.config;
    if (!config) return;
    const target = config.blocks.find((block) => block.id === id);
    if (!target || target.type !== 'logo') return;
    const keys = Object.keys(patch) as (keyof typeof patch)[];
    if (keys.length === 0) return;
    const changed = keys.some(
      (key) => JSON.stringify(target[key]) !== JSON.stringify(patch[key]),
    );
    if (!changed) return;
    this.beginEdit(
      `logo:${id}:${keys.slice().sort().join(',')}`,
      options.discrete ? 'manual' : 'idle',
      800,
    );
    const blocks = config.blocks.map((block) =>
      block.id === id && block.type === 'logo' ? ({ ...block, ...patch } as LogoBlock) : block,
    );
    this.patch({ config: { ...config, blocks } });
    this.scheduleRender();
    if (options.discrete) this.endCoalescedEdit();
  }

  setBlockPosition(id: string, x: number, y: number, options: EditOptions = {}): void {
    const config = this.state.config;
    if (!config) return;
    const block = config.blocks.find((item) => item.id === id);
    if (!block) return;
    const nx = Math.min(1, Math.max(0, x));
    const ny = Math.min(1, Math.max(0, y));
    if (Math.abs(block.x - nx) < 0.0002 && Math.abs(block.y - ny) < 0.0002) return;
    const dragging = this.draggingBlock === id && this.burst?.key === `position:${id}`;
    if (!dragging) {
      this.beginEdit(
        `position:${id}`,
        options.discrete ? 'manual' : 'idle',
        700,
      );
    }
    const blocks = config.blocks.map((item) => (item.id === id ? { ...item, x: nx, y: ny } : item));
    this.patch({ config: { ...config, blocks } });
    this.scheduleRender();
    if (options.discrete) this.endCoalescedEdit();
  }

  /** 舞台开始拖拽：整段拖拽只记录一个历史步（pointerup 时提交）。 */
  beginBlockDrag(id: string): void {
    const config = this.state.config;
    if (!config || !config.blocks.some((block) => block.id === id)) return;
    this.endCoalescedEdit();
    this.draggingBlock = id;
    this.beginEdit(`position:${id}`, 'manual');
  }

  endBlockDrag(): void {
    if (!this.draggingBlock) return;
    this.draggingBlock = null;
    this.endCoalescedEdit();
  }

  toggleVisibility(id: string): void {
    const config = this.state.config;
    if (!config) return;
    const block = config.blocks.find((item) => item.id === id);
    if (!block) return;
    this.beginEdit(`visibility:${id}`, 'manual');
    const blocks = config.blocks.map((item) =>
      item.id === id ? { ...item, visible: !item.visible } : item,
    );
    this.patch({ config: { ...config, blocks } });
    this.scheduleRender();
    this.endCoalescedEdit();
  }

  async uploadLogo(file: File): Promise<void> {
    try {
      const src = await toLogoDataUrl(file);
      const config = this.state.config;
      if (!config) return;
      const existing = config.blocks.find((block) => block.type === 'logo');
      if (existing) {
        this.updateLogoBlock(existing.id, { src, visible: true }, { discrete: true });
      } else {
        const logo: LogoBlock = {
          type: 'logo',
          id: 'logo',
          name: 'Logo',
          x: 0.5,
          y: 0.5,
          align: 'center',
          alignY: 'middle',
          opacity: 1,
          visible: true,
          src,
          width: 0.14,
        };
        const blocks = [...config.blocks, logo];
        this.beginEdit('logo:add', 'manual');
        this.patch({ config: { ...config, blocks }, selectedId: logo.id });
        this.scheduleRender();
        this.endCoalescedEdit();
      }
      toast('Logo 已更新', 'success', 2000);
    } catch (error) {
      toast(`Logo 上传失败：${errorMessage(error)}`, 'error', 5000);
    }
  }

  removeLogo(): void {
    const config = this.state.config;
    if (!config) return;
    const hasLogo = config.blocks.some((block) => block.type === 'logo');
    if (!hasLogo) return;
    this.beginEdit('logo:remove', 'manual');
    const blocks = config.blocks.filter((block) => block.type !== 'logo');
    const selected = this.state.selectedId;
    const selectedWasLogo = config.blocks.some((block) => block.type === 'logo' && block.id === selected);
    this.patch({ config: { ...config, blocks }, selectedId: selectedWasLogo ? null : selected });
    this.scheduleRender();
    this.endCoalescedEdit();
  }

  // ---------------------------------------------------------------- 舞台视图

  reportFitScale(scale: number): void {
    this.fitScale = scale;
  }

  setZoom(zoom: 'fit' | number): void {
    this.patch({ zoom });
  }

  zoomBy(factor: number): void {
    const base = this.state.zoom === 'fit' ? this.fitScale : this.state.zoom;
    const next = Math.min(4, Math.max(0.08, base * factor));
    const fit = this.fitScale;
    this.patch({ zoom: Math.abs(next - fit) / fit < 0.02 ? 'fit' : Number(next.toFixed(3)) });
  }

  // ---------------------------------------------------------------- 布局 / 抽屉

  toggleLeft(): void {
    this.patch({ leftOpen: !this.state.leftOpen, inspectorOpen: false });
  }

  toggleInspector(): void {
    this.patch({ inspectorOpen: !this.state.inspectorOpen, leftOpen: false });
  }

  closeDrawers(): void {
    if (!this.state.leftOpen && !this.state.inspectorOpen) return;
    this.patch({ leftOpen: false, inspectorOpen: false });
  }

  // ---------------------------------------------------------------- 导出

  setExportOpen(open: boolean): void {
    if (this.state.exportOpen === open) return;
    this.patch({ exportOpen: open });
  }

  setExportName(name: string): void {
    this.patch({ exportName: name });
  }

  setDragOver(over: boolean): void {
    if (this.state.dragOver === over) return;
    this.patch({ dragOver: over });
  }

  private exportFilename(): string {
    const config = this.state.config;
    const format = config?.output.format ?? 'png';
    const extension = format === 'jpeg' ? 'jpg' : 'png';
    const typed = this.state.exportName.trim().replace(/\.[a-zA-Z0-9]+$/, '');
    const base = typed || defaultExportName();
    return `${base}.${extension}`;
  }

  async exportNow(): Promise<void> {
    const engine = this.engine;
    const config = this.state.config;
    if (!engine || !config || this.state.exporting) return;
    this.patch({ exporting: true });
    const filename = this.exportFilename();
    try {
      const result = await engine.exportImage(structuredClone(config), filename);
      if (engine.kind === 'tauri') {
        if (result.path) toast(`已保存到 ${result.path}`, 'success', 4600);
        else toast('已取消保存', 'info');
      } else {
        toast(`已导出 ${filename}`, 'success', 3200);
      }
      this.patch({ exportOpen: false });
    } catch (error) {
      toast(`导出失败：${errorMessage(error)}`, 'error', 5200);
    } finally {
      this.patch({ exporting: false });
    }
  }

  // ---------------------------------------------------------------- 渲染管线

  scheduleRender(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      void this.renderPreview();
    });
  }

  async renderPreview(): Promise<void> {
    const engine = this.engine;
    const config = this.state.config;
    if (!engine || !config || !this.state.photo) return;
    const seq = ++this.seq;
    if (!this.state.rendering) this.patch({ rendering: true });
    const started = performance.now();
    try {
      const result = await engine.render(structuredClone(config), true);
      if (seq !== this.seq) return;
      const bitmap = await createImageBitmap(
        new Blob([result.png as unknown as BlobPart], { type: 'image/png' }),
      );
      if (seq !== this.seq) {
        bitmap.close();
        return;
      }
      const previous = this.state.bitmap;
      this.patch({
        bitmap,
        meta: result.meta,
        rendering: false,
        renderMs: Math.round(performance.now() - started),
        renderError: null,
      });
      previous?.close();
    } catch (error) {
      if (seq !== this.seq) return;
      const message = errorMessage(error);
      this.patch({ rendering: false, renderError: message });
      toast(`渲染失败：${message}`, 'error', 5200);
    }
  }
}

function defaultExportName(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `framed-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

/** 上传的 Logo 缩到 ≤800px 内，转成 PNG dataURL（保留透明通道）。 */
async function toLogoDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const max = 800;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D 不可用');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return canvas.toDataURL('image/png');
}
