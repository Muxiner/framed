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
import {
  FONT_MAX_BYTES,
  deleteFontRecord,
  fontNameFromFile,
  isFontFile,
  loadFontRecords,
  nextFontId,
  saveFontRecord,
  uniqueFontName,
  type CustomFontMeta,
} from './fonts';
import type { Preset } from './presets';
import { BRAND_STYLES, type BrandStyle } from './brand-styles';
import { fetchSample, type SampleId } from './samples';
import { toast } from './toast';

export type LoadStatus = 'boot' | 'empty' | 'loading' | 'ready';
export type EngineLabel = 'WASM' | 'MOCK' | 'TAURI';

/** 照片库上限 */
export const LIBRARY_LIMIT = 16;

/** 批量参数模式：统一（默认）或每张单独。 */
export type BatchMode = 'uniform' | 'separate';

/** 从 EXIF 派生的三段文本，统一参数模式下按照片各自保留。 */
export interface ExifTexts {
  camera: string;
  gear: string;
  date: string;
}

export interface LibraryPhoto {
  id: string;
  name: string;
  bytes: Uint8Array;
  info: PhotoInfo;
  thumbUrl: string;
  config: RenderConfig;
  template: FrameTemplate;
  exifTexts: ExifTexts;
}

export interface ImportProgress {
  done: number;
  total: number;
}

interface ImportSource {
  name: string;
  bytes: Uint8Array;
}

let photoSequence = 0;

function nextPhotoId(): string {
  photoSequence += 1;
  return `photo-${Date.now().toString(36)}-${photoSequence}`;
}

const IMAGE_FILE = /\.(jpe?g|png|webp|gif|tiff?|bmp|avif|heic|heif)$/i;

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || IMAGE_FILE.test(file.name);
}

function sanitizeBaseName(name: string): string {
  const withoutExtension = name.replace(/\.[a-zA-Z0-9]+$/, '');
  const cleaned = withoutExtension
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  return cleaned || 'photo';
}

function directoryOf(path: string): string {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return index > 0 ? path.slice(0, index) : path;
}

const EXIF_TEXT_IDS = ['camera', 'gear', 'date'] as const;
type ExifTextId = (typeof EXIF_TEXT_IDS)[number];

function isExifTextId(id: string): id is ExifTextId {
  return id === 'camera' || id === 'gear' || id === 'date';
}

function exifTextsFromBlocks(blocks: readonly Block[], fallback?: ExifTexts): ExifTexts {
  const texts: ExifTexts = {
    camera: fallback?.camera ?? '',
    gear: fallback?.gear ?? '',
    date: fallback?.date ?? '',
  };
  for (const block of blocks) {
    if (block.type === 'text' && isExifTextId(block.id)) texts[block.id] = block.text;
  }
  return texts;
}

/** 新照片继承当前照片的边框、水印文字、Logo、输出与网格，但 camera/gear/date 用新 EXIF。 */
function inheritPhotoConfig(fresh: RenderConfig, base: RenderConfig | null): RenderConfig {
  if (!base) return fresh;
  const baseWatermark = base.blocks.find(
    (block): block is TextBlock => block.type === 'text' && block.id === 'watermark',
  );
  const logos = base.blocks.filter((block): block is LogoBlock => block.type === 'logo');
  const blocks: Block[] = fresh.blocks.map((block) =>
    block.type === 'text' && block.id === 'watermark' && baseWatermark
      ? { ...block, text: baseWatermark.text }
      : block,
  );
  for (const logo of logos) {
    if (!blocks.some((block) => block.id === logo.id)) blocks.push({ ...logo });
  }
  return {
    ...fresh,
    frame: { ...base.frame },
    blocks,
    grid: { ...base.grid },
    output: { ...base.output },
  };
}

export interface EditorState {
  status: LoadStatus;
  engineKind: 'wasm' | 'tauri' | null;
  engineLabel: EngineLabel;
  template: FrameTemplate;
  photo: PhotoInfo | null;
  photoName: string;
  photoThumb: string | null;
  library: LibraryPhoto[];
  activePhotoId: string | null;
  importing: ImportProgress | null;
  /** 批量参数是否统一（默认 true）：编辑自动同步到全部照片。 */
  sharedParams: boolean;
  customFonts: CustomFontMeta[];
  fontBusy: boolean;
  config: RenderConfig | null;
  selectedId: string | null;
  /** 多选：包含主选中（selectedId）在内的全部选中块 id。 */
  selectedIds: string[];
  /** 最近套用的品牌样式 id（用于高亮卡片；手动改参数后清空）。 */
  activeStyleId: string | null;
  bitmap: ImageBitmap | null;
  meta: RenderMeta | null;
  rendering: boolean;
  renderMs: number;
  renderError: string | null;
  zoom: 'fit' | number;
  leftOpen: boolean;
  inspectorOpen: boolean;
  /** 桌面端左右侧栏是否收起（移动端仍用抽屉）。 */
  leftCollapsed: boolean;
  inspectorCollapsed: boolean;
  exporting: boolean;
  exportOpen: boolean;
  exportName: string;
  dragOver: boolean;
  dragCount: number;
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
    library: [],
    activePhotoId: null,
    importing: null,
    sharedParams: true,
    customFonts: [],
    fontBusy: false,
    config: null,
    selectedId: null,
    selectedIds: [],
    activeStyleId: null,
    bitmap: null,
    meta: null,
    rendering: false,
    renderMs: 0,
    renderError: null,
    zoom: 'fit',
    leftOpen: false,
    inspectorOpen: false,
    leftCollapsed: false,
    inspectorCollapsed: false,
    exporting: false,
    exportOpen: false,
    exportName: '',
    dragOver: false,
    dragCount: 0,
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

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
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
  private photoOp: Promise<void> = Promise.resolve();
  private importBusy = false;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private patch(partial: Partial<EditorState>): void {
    let next = partial;
    // 保持 selectedId / selectedIds 一致，并清理已被删除的块。
    if (next.config) {
      const ids = new Set(next.config.blocks.map((block) => block.id));
      const kept = this.state.selectedIds.filter((id) => ids.has(id));
      const primary =
        next.selectedId !== undefined
          ? next.selectedId
          : this.state.selectedId && ids.has(this.state.selectedId)
            ? this.state.selectedId
            : kept[kept.length - 1] ?? null;
      if (
        kept.length !== this.state.selectedIds.length ||
        (next.selectedId === undefined && primary !== this.state.selectedId)
      ) {
        next = { ...next, selectedIds: kept, selectedId: primary };
      }
    }
    if (next.selectedId !== undefined && next.selectedIds === undefined) {
      next = { ...next, selectedIds: next.selectedId ? [next.selectedId] : [] };
    }
    // 手动改参数后不再高亮品牌样式卡片。
    if (next.config && next.activeStyleId === undefined && this.state.activeStyleId !== null) {
      next = { ...next, activeStyleId: null };
    }
    Object.assign(this.state, next);
    // 当前照片的配置改动即时回写到照片库，切换回来时不会丢编辑。
    if (partial.config !== undefined && this.state.config && this.state.activePhotoId) {
      const entry = this.state.library.find((item) => item.id === this.state.activePhotoId);
      if (entry) {
        entry.config = this.state.config;
        entry.template = this.state.config.frame.template;
      }
      // 统一参数模式：当前编辑立即同步到其余照片（EXIF 三段文本仍各自保留）。
      if (this.state.sharedParams) {
        this.state.library = this.buildUniformLibrary(this.state.config);
      }
    }
    for (const listener of this.listeners) listener(this.state);
  }

  private activeEntry(): LibraryPhoto | undefined {
    const id = this.state.activePhotoId;
    if (!id) return undefined;
    return this.state.library.find((entry) => entry.id === id);
  }

  /** 以 master 为样式基底，但 camera/gear/date 文本使用目标照片自己的 exifTexts。 */
  private uniformConfigFor(entry: LibraryPhoto, master: RenderConfig): RenderConfig {
    const blocks: Block[] = master.blocks.map((block) => {
      if (block.type !== 'text' || !isExifTextId(block.id)) return block;
      const text = entry.exifTexts[block.id];
      return typeof text === 'string' ? { ...block, text } : block;
    });
    return {
      ...master,
      blocks,
      frame: { ...master.frame },
      grid: { ...master.grid },
      output: { ...master.output },
    };
  }

  private buildUniformLibrary(master: RenderConfig | null = this.state.config): LibraryPhoto[] {
    const activeId = this.state.activePhotoId;
    if (!master || !activeId) return this.state.library;
    return this.state.library.map((entry) =>
      entry.id === activeId
        ? entry
        : {
            ...entry,
            template: master.frame.template,
            config: this.uniformConfigFor(entry, master),
          },
    );
  }

  /** 统一模式下把当前照片的 EXIF 文本写进自己的 exifTexts，避免切走/撤销后被旧文本覆盖。 */
  private updateActiveExifTexts(blocks: readonly Block[]): void {
    const entry = this.activeEntry();
    if (!entry) return;
    entry.exifTexts = exifTextsFromBlocks(blocks, entry.exifTexts);
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
    // 恢复的是当前照片快照；先把 EXIF 文本同步进库，统一模式随后的同步才正确。
    this.updateActiveExifTexts(entry.blocks);
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
      await this.restoreCustomFonts(engine);
      if (label === 'MOCK') {
        toast('开发回退引擎（Canvas2D）已启用，wasm 内核就绪后自动切换', 'info', 4200);
      }
    } catch (error) {
      this.patch({ status: 'empty' });
      toast(`渲染引擎初始化失败：${errorMessage(error)}`, 'error', 6000);
    }
  }

  // ---------------------------------------------------------------- 用户字体

  private async restoreCustomFonts(engine: Engine): Promise<void> {
    const records = await loadFontRecords();
    if (records.length === 0) return;
    const metas: CustomFontMeta[] = [];
    for (const record of records) {
      try {
        await engine.registerFont(record.id, new Uint8Array(record.bytes));
        metas.push({
          id: record.id,
          name: record.name,
          size: record.size,
          addedAt: record.addedAt,
        });
      } catch (error) {
        console.warn('[framed] 恢复自定义字体失败，已跳过', record.name, error);
      }
    }
    if (metas.length > 0) this.patch({ customFonts: metas });
  }

  async uploadFont(file: File): Promise<void> {
    const engine = this.engine;
    if (!engine) {
      toast('渲染引擎尚未就绪，请稍后再试', 'error', 3200);
      return;
    }
    if (this.state.fontBusy) return;
    if (!isFontFile(file)) {
      toast('仅支持 .ttf / .otf 字体文件', 'error', 3600);
      return;
    }
    if (file.size > FONT_MAX_BYTES) {
      toast('字体文件超过 8MB 限制', 'error', 4200);
      return;
    }
    this.patch({ fontBusy: true });
    try {
      const bytes = await file.arrayBuffer();
      const id = nextFontId();
      const name = uniqueFontName(
        fontNameFromFile(file.name),
        this.state.customFonts.map((font) => font.name),
      );
      await engine.registerFont(id, new Uint8Array(bytes));
      const meta: CustomFontMeta = {
        id,
        name,
        size: file.size,
        addedAt: new Date().toISOString(),
      };
      const persisted = await saveFontRecord({ ...meta, bytes });
      if (!persisted) console.warn('[framed] 自定义字体持久化失败，刷新后可能丢失');
      this.patch({ customFonts: [...this.state.customFonts, meta], fontBusy: false });
      const applied = this.applyFontToSelectedTextBlock(id);
      toast(
        applied ? `已上传字体「${name}」并应用到当前文字` : `已上传字体「${name}」`,
        'success',
        3200,
      );
    } catch (error) {
      this.patch({ fontBusy: false });
      toast(`字体上传失败：${errorMessage(error)}`, 'error', 5200);
    }
  }

  private applyFontToSelectedTextBlock(fontId: string): boolean {
    const config = this.state.config;
    const selectedId = this.state.selectedId;
    if (!config || !selectedId) return false;
    const block = config.blocks.find((item) => item.id === selectedId);
    if (!block || block.type !== 'text') return false;
    const blocks = config.blocks.map((item) =>
      item.id === selectedId && item.type === 'text' ? { ...item, customFont: fontId } : item,
    );
    this.beginEdit('font:apply', 'manual');
    this.patch({ config: { ...config, blocks } });
    this.scheduleRender();
    this.endCoalescedEdit();
    return true;
  }

  async deleteFont(id: string): Promise<void> {
    if (this.state.fontBusy) return;
    const meta = this.state.customFonts.find((font) => font.id === id);
    if (!meta) return;
    this.endCoalescedEdit();
    const engine = this.engine;
    if (engine) {
      try {
        await engine.removeFont(id);
      } catch (error) {
        console.warn('[framed] 渲染内核移除字体失败', meta.name, error);
      }
    }
    await deleteFontRecord(id);
    this.patch({ customFonts: this.state.customFonts.filter((font) => font.id !== id) });

    const config = this.state.config;
    let clearedActive = false;
    if (config) {
      const hasReference = config.blocks.some(
        (block) => block.type === 'text' && block.customFont === id,
      );
      if (hasReference) {
        const blocks = config.blocks.map((block) =>
          block.type === 'text' && block.customFont === id
            ? { ...block, customFont: null }
            : block,
        );
        this.beginEdit('font:remove', 'manual');
        this.patch({ config: { ...config, blocks } });
        this.scheduleRender();
        this.endCoalescedEdit();
        clearedActive = true;
      }
    }

    // 单独模式下其他照片不会跟随 patch，需要手动清理引用；统一模式下 patch 已同步。
    const activeId = this.state.activePhotoId;
    let clearedOthers = false;
    const library = this.state.library.map((entry) => {
      if (entry.id === activeId) return entry;
      const hasReference = entry.config.blocks.some(
        (block) => block.type === 'text' && block.customFont === id,
      );
      if (!hasReference) return entry;
      clearedOthers = true;
      return {
        ...entry,
        config: {
          ...entry.config,
          blocks: entry.config.blocks.map((block) =>
            block.type === 'text' && block.customFont === id
              ? { ...block, customFont: null }
              : block,
          ),
        },
      };
    });
    if (clearedOthers) this.patch({ library });

    toast(
      clearedActive || clearedOthers
        ? `已删除字体「${meta.name}」，引用它的文字已回退内置字体`
        : `已删除字体「${meta.name}」`,
      'info',
      3200,
    );
  }

  // ---------------------------------------------------------------- 照片库 / 多图导入

  private enqueuePhotoOp<T>(task: () => Promise<T>): Promise<T> {
    const run = this.photoOp.then(task, task);
    this.photoOp = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** 把当前照片（若有）的 config/template 写回库，切换或导出前调用。 */
  private saveActiveConfig(): void {
    const { activePhotoId, config, library } = this.state;
    if (!activePhotoId || !config) return;
    const entry = library.find((item) => item.id === activePhotoId);
    if (entry) {
      entry.config = config;
      entry.template = config.frame.template;
    }
  }

  async loadPhoto(file: File): Promise<void> {
    await this.importFiles([file]);
  }

  async loadSample(id: SampleId): Promise<void> {
    if (this.state.sampleBusy || this.state.importing || this.importBusy) return;
    this.patch({ sampleBusy: true });
    try {
      const sample = await fetchSample(id);
      await this.importSources([{ name: sample.name, bytes: sample.bytes }]);
      if (sample.generated) toast('示例照片尚未就绪，已使用生成的占位画面', 'info', 3800);
    } catch (error) {
      toast(`示例照片载入失败：${errorMessage(error)}`, 'error', 5000);
    } finally {
      this.patch({ sampleBusy: false });
    }
  }

  /** 拖拽 / 文件选择 / 粘贴的入口：过滤非图片、读取字节、批量导入。 */
  async importFiles(files: File[]): Promise<void> {
    if (this.state.importing || this.importBusy) {
      toast('正在导入照片，请稍候', 'info', 2000);
      return;
    }
    const imageFiles: File[] = [];
    let skipped = 0;
    for (const file of files) {
      if (isImageFile(file)) imageFiles.push(file);
      else skipped += 1;
    }
    if (imageFiles.length === 0) {
      if (skipped > 0) toast(`已忽略 ${skipped} 个非图片文件`, 'info', 3200);
      return;
    }
    const capacity = Math.max(0, LIBRARY_LIMIT - this.state.library.length);
    if (capacity === 0) {
      toast(`照片库已满（最多 ${LIBRARY_LIMIT} 张），本次跳过 ${imageFiles.length} 张`, 'info', 4400);
      return;
    }
    // 先按剩余容量裁剪，避免一次性把上百张照片字节读进内存。
    const selected = imageFiles.slice(0, capacity);
    const overLimit = imageFiles.length - selected.length;
    this.importBusy = true;
    try {
      const sources: ImportSource[] = [];
      let failedRead = 0;
      for (const file of selected) {
        try {
          sources.push({
            name: file.name || 'photo',
            bytes: new Uint8Array(await file.arrayBuffer()),
          });
        } catch {
          failedRead += 1;
        }
      }
      await this.importSources(sources, { skipped, failedRead, overLimit });
    } finally {
      this.importBusy = false;
    }
  }

  private async importSources(
    sources: ImportSource[],
    counts: { skipped?: number; failedRead?: number; overLimit?: number } = {},
  ): Promise<void> {
    const engine = this.engine;
    if (!engine) {
      toast('渲染引擎尚未就绪，请稍后重试', 'error');
      return;
    }
    if (sources.length === 0) {
      if (counts.failedRead) toast('照片读取失败，请重试', 'error', 4200);
      return;
    }
    this.endCoalescedEdit();
    return this.enqueuePhotoOp(async () => {
      const capacity = Math.max(0, LIBRARY_LIMIT - this.state.library.length);
      const accepted = sources.slice(0, capacity);
      const overLimit = sources.length - accepted.length + (counts.overLimit ?? 0);
      if (accepted.length === 0) {
        toast(`照片库已满（最多 ${LIBRARY_LIMIT} 张），本次跳过 ${sources.length} 张`, 'info', 4400);
        return;
      }
      // 继承导入前当前照片的视觉配置（模板/边框/水印文字/Logo/output/grid）。
      const baseConfig = this.state.config;
      const template = baseConfig?.frame.template ?? this.state.template;
      if (!this.state.photo) this.patch({ status: 'loading' });
      this.patch({ importing: { done: 0, total: accepted.length } });
      const added: LibraryPhoto[] = [];
      let failed = 0;
      for (let index = 0; index < accepted.length; index += 1) {
        const source = accepted[index];
        if (!source) continue;
        try {
          const id = nextPhotoId();
          const info = await engine.loadImage(source.bytes, id);
          const fresh = await engine.defaultConfig(info, template);
          const config = inheritPhotoConfig(fresh, baseConfig);
          const thumbUrl = URL.createObjectURL(
            new Blob([source.bytes as unknown as BlobPart], {
              type: guessMime(source.bytes, source.name),
            }),
          );
          const entry: LibraryPhoto = {
            id,
            name: source.name || 'photo',
            bytes: source.bytes,
            info,
            thumbUrl,
            config,
            template,
            exifTexts: exifTextsFromBlocks(fresh.blocks),
          };
          added.push(entry);
          this.patch({
            library: [...this.state.library, entry],
            importing: { done: index + 1, total: accepted.length },
          });
        } catch (error) {
          failed += 1;
          this.patch({ importing: { done: index + 1, total: accepted.length } });
          console.warn('[framed] 照片导入失败', source.name, error);
        }
      }
      this.patch({ importing: null });

      if (added.length === 0) {
        if (!this.state.photo) this.patch({ status: 'empty' });
        toast('照片导入失败，请检查文件格式', 'error', 5200);
        return;
      }

      const first = added[0];
      if (first) await this.activateEntry(first);

      const notes: string[] = [`已导入 ${added.length} 张照片`];
      if (counts.skipped) notes.push(`跳过 ${counts.skipped} 个非图片文件`);
      if (counts.failedRead) notes.push(`${counts.failedRead} 个文件读取失败`);
      if (failed > 0) notes.push(`${failed} 张解析失败`);
      if (overLimit > 0) notes.push(`超过 ${LIBRARY_LIMIT} 张上限跳过 ${overLimit} 张`);
      const hasWarning = Boolean(counts.skipped || counts.failedRead || failed || overLimit);
      toast(notes.join(' · '), hasWarning ? 'info' : 'success', 4600);
    });
  }

  /** 激活库中的某张照片（调用方需在 photoOp 队列里）。 */
  private async activateEntry(entry: LibraryPhoto): Promise<void> {
    const engine = this.engine;
    if (!engine) return;
    this.endCoalescedEdit();
    this.saveActiveConfig();
    if (this.state.activePhotoId === entry.id && this.state.photo) return;
    const previousBitmap = this.state.bitmap;
    this.seq += 1;
    this.patch({ status: 'loading', rendering: true, renderError: null });
    try {
      const info = await engine.selectImage(entry.id, entry.bytes);
      entry.info = info;
      entry.exifTexts = exifTextsFromBlocks(entry.config.blocks, entry.exifTexts);
      this.seq += 1;
      this.patch({
        photo: info,
        photoName: entry.name,
        photoThumb: entry.thumbUrl,
        config: entry.config,
        template: entry.template,
        activePhotoId: entry.id,
        selectedId: null,
    selectedIds: [],
    activeStyleId: null,
        meta: null,
        bitmap: null,
        status: 'ready',
        zoom: 'fit',
      });
      this.relayoutAppliedStyle();
      this.resetHistory();
      previousBitmap?.close();
      await this.renderPreview();
    } catch (error) {
      this.patch({ status: this.state.photo ? 'ready' : 'empty', rendering: false });
      toast(`切换照片失败：${errorMessage(error)}`, 'error', 5200);
    }
  }

  /** 仅调整照片库顺序：不改 activePhotoId、不触发渲染、不进撤销历史。 */
  movePhoto(fromIndex: number, toIndex: number): void {
    const length = this.state.library.length;
    if (length < 2) return;
    const from = Math.max(0, Math.min(length - 1, Math.trunc(fromIndex)));
    const to = Math.max(0, Math.min(length - 1, Math.trunc(toIndex)));
    if (from === to) return;
    const library = [...this.state.library];
    const [entry] = library.splice(from, 1);
    if (!entry) return;
    library.splice(to, 0, entry);
    this.patch({ library });
    toast('已调整照片顺序', 'info', 1500);
  }

  async switchPhoto(id: string): Promise<void> {
    if (this.state.importing) {
      toast('正在导入照片，请稍候', 'info', 2000);
      return;
    }
    if (this.state.activePhotoId === id) return;
    const entry = this.state.library.find((item) => item.id === id);
    if (!entry) return;
    await this.enqueuePhotoOp(() => this.activateEntry(entry));
  }

  async deletePhoto(id: string): Promise<void> {
    if (this.state.importing) {
      toast('正在导入照片，请稍候', 'info', 2000);
      return;
    }
    const index = this.state.library.findIndex((item) => item.id === id);
    const entry = this.state.library[index];
    if (!entry) return;
    const wasActive = this.state.activePhotoId === id;
    const remaining = this.state.library.filter((item) => item.id !== id);
    this.patch({ library: remaining });

    if (!wasActive) {
      URL.revokeObjectURL(entry.thumbUrl);
      toast('已删除 1 张照片', 'info', 1800);
      return;
    }

    if (remaining.length === 0) {
      URL.revokeObjectURL(entry.thumbUrl);
      this.clearActiveState(false);
      toast('照片库已清空', 'info', 2600);
      return;
    }

    const next = remaining[Math.min(index, remaining.length - 1)];
    if (!next) return;
    const previousBitmap = this.state.bitmap;
    this.seq += 1;
    this.patch({ status: 'loading', bitmap: null, meta: null, selectedId: null });
    previousBitmap?.close();
    await this.enqueuePhotoOp(async () => {
      await this.activateEntry(next);
      URL.revokeObjectURL(entry.thumbUrl);
      if (this.state.photoThumb !== next.thumbUrl) this.patch({ photoThumb: next.thumbUrl });
    });
    toast('已删除照片', 'info', 1800);
  }

  clearLibrary(): void {
    if (this.state.importing) {
      toast('正在导入照片，请稍候', 'info', 2000);
      return;
    }
    if (this.state.library.length === 0) return;
    for (const entry of this.state.library) URL.revokeObjectURL(entry.thumbUrl);
    this.clearActiveState(false);
    this.patch({ library: [] });
    toast('已清空照片库', 'info', 2600);
  }

  private clearActiveState(revokeThumb: boolean): void {
    const previousBitmap = this.state.bitmap;
    const thumb = this.state.photoThumb;
    if (revokeThumb && thumb && thumb.startsWith('blob:')) URL.revokeObjectURL(thumb);
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    this.seq += 1;
    this.patch({
      photo: null,
      photoName: '',
      photoThumb: null,
      config: null,
      activePhotoId: null,
      selectedId: null,
    selectedIds: [],
    activeStyleId: null,
      bitmap: null,
      meta: null,
      status: 'empty',
      rendering: false,
      renderError: null,
      importing: null,
      zoom: 'fit',
      exportOpen: false,
    });
    previousBitmap?.close();
    this.resetHistory();
  }

  /** 切换批量参数：不进入撤销历史，切换本身会清空历史。 */
  setSharedParams(shared: boolean): void {
    if (this.state.sharedParams === shared) return;
    this.endCoalescedEdit();
    this.saveActiveConfig();
    const config = this.state.config;
    this.patch({ sharedParams: shared });
    this.resetHistory();
    if (shared && config) {
      this.patch({ library: this.buildUniformLibrary(config) });
    }
    toast(
      shared
        ? `已切换为统一参数，已同步到 ${this.state.library.length} 张照片（EXIF 文本各自保留）`
        : '已切换为单独调整，之后修改只影响当前照片',
      'info',
      3200,
    );
  }

  /** UI 分段控件的便捷入口。 */
  setBatchMode(mode: BatchMode): void {
    this.setSharedParams(mode === 'uniform');
  }

  /** 单独模式下，把当前照片的全部参数一次性同步到其余照片（EXIF 文本仍各自保留）。 */
  applyCurrentToAll(): void {
    if (this.state.sharedParams) return;
    const config = this.state.config;
    const count = this.state.library.length;
    if (!config || count < 2) return;
    this.endCoalescedEdit();
    this.saveActiveConfig();
    this.patch({ library: this.buildUniformLibrary(config) });
    toast(`已应用当前参数到全部 ${count} 张照片`, 'success', 2800);
  }

  /** 套用自定义预设：覆盖当前照片 frame/blocks，保留 output/grid；文本按当前照片 EXIF。 */
  applyPreset(preset: Preset): void {
    const config = this.state.config;
    if (!config) {
      toast('请先导入照片再套用预设', 'info', 2400);
      return;
    }
    const active = this.activeEntry();
    const blocks: Block[] = preset.config.blocks.map((block) => {
      if (block.type === 'text' && isExifTextId(block.id)) {
        const text = active?.exifTexts[block.id];
        if (typeof text === 'string') return { ...block, text };
      }
      return { ...block };
    });
    const next: RenderConfig = {
      ...config,
      frame: { ...preset.config.frame },
      blocks,
    };
    const selectedId =
      this.state.selectedId && blocks.some((block) => block.id === this.state.selectedId)
        ? this.state.selectedId
        : null;
    this.beginEdit('preset:apply', 'manual');
    this.patch({ config: next, template: next.frame.template, selectedId });
    this.scheduleRender();
    this.endCoalescedEdit();
    toast(`已套用预设「${preset.name}」`, 'success', 2800);
  }

  // ---------------------------------------------------------------- 品牌样式

  async applyBrandStyle(style: BrandStyle): Promise<void> {
    const engine = this.engine;
    const photo = this.state.photo;
    const config = this.state.config;
    if (!engine || !photo || !config) {
      toast('请先导入照片再套用样式', 'info', 2400);
      return;
    }
    try {
      const base = await engine.defaultConfig(photo, style.template);
      const next = style.build(base, photo);
      next.output = { ...config.output };
      next.grid = { ...config.grid };
      const ids = new Set(next.blocks.map((block) => block.id));
      const selectedIds = this.state.selectedIds.filter((id) => ids.has(id));
      this.beginEdit('style:apply', 'manual');
      this.patch({
        config: next,
        template: next.frame.template,
        activeStyleId: style.id,
        selectedIds,
        selectedId: selectedIds.includes(this.state.selectedId ?? '')
          ? this.state.selectedId
          : selectedIds[selectedIds.length - 1] ?? null,
      });
      this.scheduleRender();
      this.endCoalescedEdit();
      toast(`已应用「${style.name}」风格`, 'success', 2600);
    } catch (error) {
      toast(`样式应用失败：${errorMessage(error)}`, 'error', 4200);
    }
  }

  /** 边框/模板/照片变化后，按当前底栏重新摆放品牌样式文字（保留字号/字体/文本）。 */
  private relayoutAppliedStyle(): void {
    const config = this.state.config;
    const photo = this.state.photo;
    if (!config || !photo) return;
    const watermark = config.blocks.find((block) => block.id === 'watermark');
    if (!watermark || watermark.type !== 'text') return;
    const style = BRAND_STYLES.find((item) => item.wordmark === watermark.text);
    if (!style) return;
    try {
      const styled = style.build(config, photo, config.frame);
      const current = new Map(config.blocks.map((block) => [block.id, block]));
      const blocks = styled.blocks.map((block) => {
        const existing = current.get(block.id);
        if (block.type === 'text' && existing?.type === 'text') {
          return {
            ...block,
            text: existing.text,
            size: existing.size,
            font: existing.font,
            customFont: existing.customFont ?? null,
          };
        }
        return block;
      });
      this.patch({ config: { ...config, blocks } });
      this.scheduleRender();
    } catch {
      // 布局失败不影响边框修改本身。
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
      // 切换模板不应丢掉用户调好的照片阴影。
      config.frame = { ...config.frame, photoShadow: { ...previous.frame.photoShadow } };
      this.beginEdit('template', 'manual');
      this.patch({ config });
      this.relayoutAppliedStyle();
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
    this.relayoutAppliedStyle();
    this.scheduleRender();
  }

  /** 一键缩放相机/参数/日期文本字号（base 为缩放前的字号快照）。 */
  setParameterScale(scale: number, base: Record<string, number>): void {
    const config = this.state.config;
    if (!config) return;
    const ids = new Set(Object.keys(base));
    let changed = false;
    const blocks = config.blocks.map((block) => {
      if (block.type !== 'text' || !ids.has(block.id)) return block;
      const baseSize = base[block.id];
      if (typeof baseSize !== 'number') return block;
      const size = Math.min(8, Math.max(0.1, baseSize * scale));
      if (Math.abs(size - block.size) > 0.0001) changed = true;
      return { ...block, size };
    });
    if (!changed) return;
    this.beginEdit('params:scale', 'idle', 700);
    this.patch({ config: { ...config, blocks } });
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

  select(id: string | null, options: { additive?: boolean } = {}): void {
    this.endCoalescedEdit();
    if (id === null) {
      if (this.state.selectedId === null && this.state.selectedIds.length === 0) return;
      this.patch({ selectedId: null, selectedIds: [] });
      return;
    }
    if (!this.state.config?.blocks.some((block) => block.id === id)) return;

    if (options.additive) {
      const exists = this.state.selectedIds.includes(id);
      const next = exists
        ? this.state.selectedIds.filter((item) => item !== id)
        : [...this.state.selectedIds, id];
      const primary = next.length === 0
        ? null
        : this.state.selectedId === id && exists
          ? next[next.length - 1] ?? null
          : id;
      this.patch({ selectedIds: next, selectedId: primary });
      return;
    }
    if (this.state.selectedIds.length === 1 && this.state.selectedId === id) return;
    this.patch({ selectedIds: [id], selectedId: id });
  }

  /** 全选可见文字块（Cmd/Ctrl+A）。 */
  selectAllText(): void {
    const config = this.state.config;
    if (!config) return;
    const ids = config.blocks
      .filter((block) => block.visible && block.type === 'text')
      .map((block) => block.id);
    if (ids.length === 0) {
      toast('没有可选的文字块', 'info', 1800);
      return;
    }
    this.endCoalescedEdit();
    this.patch({ selectedIds: ids, selectedId: ids[ids.length - 1] ?? null });
  }

  /** 整体微调选中块（方向键）。 */
  nudgeSelection(dx: number, dy: number): void {
    const config = this.state.config;
    if (!config) return;
    const ids = this.currentSelection();
    if (ids.length === 0) return;
    const selected = new Set(ids);
    const movable = config.blocks.some((block) => selected.has(block.id) && block.visible);
    if (!movable) return;
    this.beginEdit('position:nudge', 'idle', 600);
    const blocks = config.blocks.map((block) =>
      selected.has(block.id) && block.visible
        ? { ...block, x: clamp01(block.x + dx), y: clamp01(block.y + dy) }
        : block,
    );
    this.patch({ config: { ...config, blocks } });
    this.scheduleRender();
  }

  /** 把多个块移动到指定位置（整体拖拽，一个历史步）。 */
  moveBlocksTo(positions: Map<string, { x: number; y: number }>): void {
    const config = this.state.config;
    if (!config || positions.size === 0) return;
    this.beginEdit('position:group', 'manual');
    const blocks = config.blocks.map((block) => {
      const next = positions.get(block.id);
      return next ? { ...block, x: clamp01(next.x), y: clamp01(next.y) } : block;
    });
    this.patch({ config: { ...config, blocks } });
    this.scheduleRender();
  }

  private currentSelection(): string[] {
    if (this.state.selectedIds.length > 0) return this.state.selectedIds;
    return this.state.selectedId ? [this.state.selectedId] : [];
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
    const changed = keys.some((key) => {
      if (key === 'customFont') {
        return (target.customFont ?? null) !== (patch.customFont ?? null);
      }
      return JSON.stringify(target[key]) !== JSON.stringify(patch[key]);
    });
    if (!changed) return;
    if (isExifTextId(id) && typeof patch.text === 'string') {
      const entry = this.activeEntry();
      if (entry) entry.exifTexts = { ...entry.exifTexts, [id]: patch.text };
    }
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
    if (mobileQuery()) {
      this.patch({ leftOpen: !this.state.leftOpen, inspectorOpen: false });
      return;
    }
    this.patch({ leftCollapsed: !this.state.leftCollapsed });
  }

  toggleInspector(): void {
    if (mobileQuery()) {
      this.patch({ inspectorOpen: !this.state.inspectorOpen, leftOpen: false });
      return;
    }
    this.patch({ inspectorCollapsed: !this.state.inspectorCollapsed });
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

  setDragOver(over: boolean, count = 0): void {
    const nextCount = over ? Math.max(1, count) : 0;
    if (this.state.dragOver === over && this.state.dragCount === nextCount) return;
    this.patch({ dragOver: over, dragCount: nextCount });
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
    this.endCoalescedEdit();
    this.saveActiveConfig();
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

  /** 批量导出照片库（使用每张照片自己的 config/output 设置）。 */
  async exportAll(): Promise<void> {
    const engine = this.engine;
    const library = [...this.state.library];
    if (!engine || library.length === 0 || this.state.exporting) return;
    this.endCoalescedEdit();
    this.saveActiveConfig();
    this.patch({ exporting: true });
    const uniform = this.state.sharedParams;
    const modeLabel = uniform ? '统一参数' : '单独参数';
    const master = this.state.config;
    try {
      const used = new Set<string>();
      const items = library.map((entry) => {
        const config =
          uniform && master
            ? entry.id === this.state.activePhotoId
              ? structuredClone(master)
              : this.uniformConfigFor(entry, master)
            : structuredClone(entry.config);
        const format = config.output.format;
        const extension = format === 'jpeg' ? 'jpg' : 'png';
        const base = sanitizeBaseName(entry.name);
        let filename = `${base}-framed.${extension}`;
        let suffix = 2;
        while (used.has(filename.toLowerCase())) {
          filename = `${base}-framed-${suffix}.${extension}`;
          suffix += 1;
        }
        used.add(filename.toLowerCase());
        return { id: entry.id, filename, config };
      });
      const result = await this.enqueuePhotoOp(() => engine.exportBatch(items));
      if (result.canceled) {
        toast('已取消批量导出', 'info', 2600);
      } else if (engine.kind === 'tauri') {
        const directory = result.paths?.[0] ? directoryOf(result.paths[0]) : '';
        toast(
          `已导出 ${result.saved} 张照片（${modeLabel}）${directory ? ` · ${directory}` : ''}`,
          'success',
          5200,
        );
      } else {
        toast(
          `已导出 ${result.saved} 张照片（${modeLabel}）· 浏览器可能询问多个下载`,
          'success',
          5200,
        );
      }
      this.patch({ exportOpen: false });
    } catch (error) {
      toast(`批量导出失败：${errorMessage(error)}`, 'error', 5600);
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
