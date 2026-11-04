// 自定义预设：把当前 frame + blocks 存到 localStorage，可导出/导入 JSON。
// 注意：预设只影响 frame/blocks；套用时保留当前照片的 output/grid。
import type {
  AnchorY,
  Block,
  FontFamily,
  FrameConfig,
  FrameTemplate,
  GridConfig,
  LogoBlock,
  OutputConfig,
  PhotoShadowConfig,
  PhotoTransformConfig,
  RenderConfig,
  ShadowMode,
  TextAlign,
  TextBlock,
} from '../types';

export const PRESET_STORAGE_KEY = 'framed.presets.v1';
export const PRESET_NAME_MAX = 30;
export const PRESET_LIMIT = 30;
export const PRESET_LOGO_LIMIT = 2 * 1024 * 1024;
export const PRESET_SHARE_PREFIX = 'FRAMED1:';
export const PRESET_SHARE_LIMIT = 32 * 1024;
const PRESET_VERSION = 1;

export interface Preset {
  id: string;
  name: string;
  createdAt: string;
  config: RenderConfig;
}

export type SavePresetResult =
  | { ok: true; preset: Preset; renamed: boolean; hasLogo: boolean; bytes: number }
  | { ok: false; error: string };

export interface ImportPresetsResult {
  added: number;
  skipped: number;
  renamed: number;
  error?: string;
}

const TEMPLATES: readonly FrameTemplate[] = ['none', 'white', 'polaroid', 'film', 'black'];
const FONTS: readonly FontFamily[] = ['sans', 'mono', 'cjk'];
const ALIGNS: readonly TextAlign[] = ['left', 'center', 'right'];
const ANCHORS: readonly AnchorY[] = ['top', 'middle', 'bottom'];
const WEIGHTS = [400, 600, 700] as const;

let presetSequence = 0;

function nextPresetId(): string {
  presetSequence += 1;
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${presetSequence}`;
  return `preset-${random}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const SHADOW_MODES: readonly ShadowMode[] = ['outer', 'inner', 'both'];

function defaultPhotoShadow(): PhotoShadowConfig {
  return {
    enabled: false,
    mode: 'outer',
    angle: 120,
    distance: 0.012,
    blur: 0.02,
    spread: 0,
    color: '#000000',
    opacity: 0.28,
  };
}

function normalizePhotoShadow(value: unknown): PhotoShadowConfig {
  const fallback = defaultPhotoShadow();
  if (!isRecord(value)) return fallback;
  return {
    enabled: value.enabled === true,
    mode:
      typeof value.mode === 'string' && SHADOW_MODES.includes(value.mode as ShadowMode)
        ? (value.mode as ShadowMode)
        : fallback.mode,
    angle: isNumber(value.angle) ? clamp(value.angle, 0, 360) : fallback.angle,
    distance: isNumber(value.distance) ? clamp(value.distance, 0, 0.3) : fallback.distance,
    blur: isNumber(value.blur) ? clamp(value.blur, 0, 0.3) : fallback.blur,
    spread: isNumber(value.spread) ? clamp(value.spread, -0.2, 0.3) : fallback.spread,
    color: isHexColor(value.color) ? value.color.toLowerCase() : fallback.color,
    opacity: isNumber(value.opacity) ? clamp(value.opacity, 0, 1) : fallback.opacity,
  };
}

function defaultPhotoTransform(): PhotoTransformConfig {
  return { scale: 1, offsetX: 0, offsetY: 0 };
}

function normalizePhotoTransform(value: unknown): PhotoTransformConfig {
  const fallback = defaultPhotoTransform();
  if (!isRecord(value)) return fallback;
  return {
    scale: isNumber(value.scale) ? clamp(value.scale, 1, 4) : fallback.scale,
    offsetX: isNumber(value.offsetX) ? clamp(value.offsetX, -1, 1) : fallback.offsetX,
    offsetY: isNumber(value.offsetY) ? clamp(value.offsetY, -1, 1) : fallback.offsetY,
  };
}

function normalizeFrame(value: unknown): FrameConfig | null {
  if (!isRecord(value)) return null;
  const template = value.template;
  if (typeof template !== 'string' || !TEMPLATES.includes(template as FrameTemplate)) return null;
  if (!isNumber(value.margin) || !isNumber(value.bottomRatio) || !isNumber(value.radius)) return null;
  if (!isHexColor(value.background) || typeof value.filmHoles !== 'boolean') return null;
  return {
    template: template as FrameTemplate,
    margin: clamp(value.margin, 0, 0.5),
    bottomRatio: clamp(value.bottomRatio, 0.5, 10),
    background: value.background.toLowerCase(),
    radius: clamp(value.radius, 0, 0.5),
    filmHoles: value.filmHoles,
    photoShadow: normalizePhotoShadow(value.photoShadow),
    photoTransform: normalizePhotoTransform(value.photoTransform),
  };
}

function normalizeBlock(value: unknown): Block | null {
  if (!isRecord(value)) return null;
  const { id, name, x, y, align, alignY, opacity, visible, type } = value;
  if (typeof id !== 'string' || !id) return null;
  if (typeof name !== 'string') return null;
  if (!isNumber(x) || !isNumber(y) || !isNumber(opacity) || typeof visible !== 'boolean') return null;
  if (typeof align !== 'string' || !ALIGNS.includes(align as TextAlign)) return null;
  if (typeof alignY !== 'string' || !ANCHORS.includes(alignY as AnchorY)) return null;
  const base = {
    id,
    name: name.slice(0, 60),
    x: clamp(x, 0, 1),
    y: clamp(y, 0, 1),
    align: align as TextAlign,
    alignY: alignY as AnchorY,
    opacity: clamp(opacity, 0, 1),
    visible,
  };
  if (type === 'text') {
    const { text, font, weight, size, lineHeight, letterSpacing, color, shadow } = value;
    if (typeof text !== 'string') return null;
    if (typeof font !== 'string' || !FONTS.includes(font as FontFamily)) return null;
    if (typeof weight !== 'number' || !WEIGHTS.includes(weight as 400 | 600 | 700)) return null;
    if (!isNumber(size) || !isNumber(lineHeight) || !isNumber(letterSpacing)) return null;
    if (!isHexColor(color) || typeof shadow !== 'boolean') return null;
    const block: TextBlock = {
      ...base,
      type: 'text',
      text,
      font: font as FontFamily,
      weight: weight as 400 | 600 | 700,
      size: clamp(size, 0.1, 10),
      lineHeight: clamp(lineHeight, 0.5, 5),
      letterSpacing: clamp(letterSpacing, -1, 1),
      color: color.toLowerCase(),
      shadow,
    };
    // 预留：用户字体 id（types.ts 可选字段），预设透传不丢。
    if (typeof value.customFont === 'string' || value.customFont === null) {
      block.customFont = value.customFont;
    }
    return block;
  }
  if (type === 'logo') {
    const { src, width } = value;
    if (typeof src !== 'string' || !src.startsWith('data:image/')) return null;
    if (!isNumber(width)) return null;
    const block: LogoBlock = {
      ...base,
      type: 'logo',
      src,
      width: clamp(width, 0.01, 1),
    };
    return block;
  }
  return null;
}

function normalizeOutput(value: unknown): OutputConfig {
  if (!isRecord(value)) return { format: 'png', quality: 92, maxDim: 0 };
  return {
    format: value.format === 'jpeg' ? 'jpeg' : 'png',
    quality: isNumber(value.quality) ? clamp(Math.round(value.quality), 1, 100) : 92,
    maxDim: isNumber(value.maxDim) ? clamp(Math.round(value.maxDim), 0, 20000) : 0,
  };
}

function normalizeGrid(value: unknown): GridConfig {
  return {
    columns: 12,
    rows: 12,
    snap: isRecord(value) && value.snap === true,
    visible: isRecord(value) && value.visible === true,
  };
}

function normalizePreset(value: unknown): Preset | null {
  if (!isRecord(value)) return null;
  const rawName = typeof value.name === 'string' ? value.name.trim() : '';
  if (!rawName) return null;
  const config = value.config;
  if (!isRecord(config) || !Array.isArray(config.blocks)) return null;
  const frame = normalizeFrame(config.frame);
  if (!frame) return null;
  const blocks: Block[] = [];
  for (const rawBlock of config.blocks) {
    const block = normalizeBlock(rawBlock);
    if (!block) return null;
    blocks.push(block);
  }
  if (blocks.length === 0) return null;
  const createdAt = typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt))
    ? new Date(value.createdAt).toISOString()
    : new Date().toISOString();
  return {
    id: typeof value.id === 'string' && value.id ? value.id : nextPresetId(),
    name: rawName.slice(0, PRESET_NAME_MAX),
    createdAt,
    config: {
      version: 1,
      frame,
      blocks,
      output: normalizeOutput(config.output),
      grid: normalizeGrid(config.grid),
    },
  };
}

function presetSizeBytes(preset: Preset): number {
  try {
    return new TextEncoder().encode(JSON.stringify(preset)).length;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function uniquePresetName(
  name: string,
  existing: readonly string[],
): { name: string; renamed: boolean } {
  const used = new Set(existing.map((item) => item.trim().toLocaleLowerCase()));
  const base = name.trim().slice(0, PRESET_NAME_MAX) || '未命名预设';
  if (!used.has(base.toLocaleLowerCase())) return { name: base, renamed: false };
  for (let index = 2; index < 1000; index += 1) {
    const suffix = ` ${index}`;
    const candidate = `${base.slice(0, PRESET_NAME_MAX - suffix.length)}${suffix}`;
    if (!used.has(candidate.toLocaleLowerCase())) return { name: candidate, renamed: true };
  }
  const fallback = `预设 ${Date.now().toString(36).slice(-5)}`;
  return { name: fallback, renamed: true };
}

/** 保存到预设时只让 frame/blocks 生效；output/grid 保留当前照片的值（套用时忽略预设里的）。 */
export function createPresetConfig(config: RenderConfig): RenderConfig {
  return {
    version: 1,
    frame: { ...config.frame },
    blocks: config.blocks.map((block) => ({ ...block })),
    grid: { ...config.grid },
    output: { ...config.output },
  };
}

export function presetFileName(date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `framed-presets-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}.json`;
}

export type PresetShareResult = { ok: true; code: string } | { ok: false; error: string };

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(input: string): Uint8Array | null {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

/** 生成可复制的分享码（不含 output/grid；含 Logo 时引导用 JSON 导出）。 */
export function encodePresetShare(preset: Preset): PresetShareResult {
  if (preset.config.blocks.some((block) => block.type === 'logo')) {
    return { ok: false, error: '包含 Logo 的预设请用「导出 JSON」分享' };
  }
  const payload = {
    v: 1,
    name: preset.name,
    frame: preset.config.frame,
    blocks: preset.config.blocks,
  };
  let bytes: Uint8Array;
  try {
    bytes = new TextEncoder().encode(JSON.stringify(payload));
  } catch {
    return { ok: false, error: '预设无法序列化' };
  }
  const code = `${PRESET_SHARE_PREFIX}${base64UrlEncode(bytes)}`;
  if (code.length > PRESET_SHARE_LIMIT) {
    return { ok: false, error: '分享码过长，请改用「导出 JSON」' };
  }
  return { ok: true, code };
}

export type DecodePresetShareResult = { ok: true; preset: Preset } | { ok: false; error: string };

/** 解析分享码，兼容前缀缺失、空白、标准/URL-safe base64。 */
export function decodePresetShare(input: string): DecodePresetShareResult {
  const text = input.trim();
  if (!text) return { ok: false, error: '请粘贴分享码' };
  if (text.length > PRESET_SHARE_LIMIT) return { ok: false, error: '分享码过长' };
  let payload = text;
  if (payload.toUpperCase().startsWith(PRESET_SHARE_PREFIX.toUpperCase())) {
    payload = payload.slice(PRESET_SHARE_PREFIX.length);
  }
  payload = payload.replace(/\s+/g, '');
  if (!payload) return { ok: false, error: '分享码内容为空' };
  if (!/^[A-Za-z0-9+/=_-]+$/.test(payload)) return { ok: false, error: '分享码格式无效' };

  const bytes = base64UrlDecode(payload);
  if (!bytes) return { ok: false, error: '分享码解码失败' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { ok: false, error: '分享码内容不是有效 JSON' };
  }
  if (!isRecord(parsed) || parsed.v !== 1) return { ok: false, error: '分享码版本不支持' };
  const rawConfig = {
    version: 1,
    frame: parsed.frame,
    blocks: parsed.blocks,
    output: { format: 'png', quality: 92, maxDim: 0 },
    grid: { columns: 12, rows: 12, snap: false, visible: false },
  };
  const preset = normalizePreset({
    name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : '分享的预设',
    config: rawConfig,
  });
  if (!preset) return { ok: false, error: '分享码结构无效' };
  if (presetSizeBytes(preset) > PRESET_LOGO_LIMIT) {
    return { ok: false, error: '分享码里的预设超过 2MB，无法导入' };
  }
  return { ok: true, preset };
}

export class PresetStore {
  private presets: Preset[] = [];

  constructor() {
    this.presets = this.read();
  }

  get list(): readonly Preset[] {
    return this.presets;
  }

  get count(): number {
    return this.presets.length;
  }

  save(name: string, config: RenderConfig): SavePresetResult {
    const cleanName = name.trim().slice(0, PRESET_NAME_MAX);
    if (!cleanName) return { ok: false, error: '请输入预设名称' };
    if (this.presets.length >= PRESET_LIMIT) {
      return { ok: false, error: `最多保存 ${PRESET_LIMIT} 个预设，请先删除旧的` };
    }
    const presetConfig = createPresetConfig(config);
    const hasLogo = presetConfig.blocks.some((block) => block.type === 'logo');
    const { name: uniqueName, renamed } = uniquePresetName(
      cleanName,
      this.presets.map((preset) => preset.name),
    );
    const preset: Preset = {
      id: nextPresetId(),
      name: uniqueName,
      createdAt: new Date().toISOString(),
      config: presetConfig,
    };
    const bytes = presetSizeBytes(preset);
    if (bytes > PRESET_LOGO_LIMIT) {
      return {
        ok: false,
        error: hasLogo ? '预设中的 Logo 图片超过 2MB，未保存' : '预设体积超过 2MB，未保存',
      };
    }
    const previous = this.presets.slice();
    this.presets = [...this.presets, preset];
    if (!this.persist()) {
      this.presets = previous;
      return { ok: false, error: '浏览器本地存储已满，保存失败' };
    }
    return { ok: true, preset, renamed, hasLogo, bytes };
  }

  remove(id: string): Preset | null {
    const index = this.presets.findIndex((preset) => preset.id === id);
    if (index < 0) return null;
    const previous = this.presets.slice();
    const [removed] = this.presets.splice(index, 1);
    if (!removed) return null;
    if (!this.persist()) {
      this.presets = previous;
      console.warn('[framed] 删除预设后写入 localStorage 失败');
      return null;
    }
    return removed;
  }

  shareCode(preset: Preset): PresetShareResult {
    return encodePresetShare(preset);
  }

  importShare(code: string): { ok: true; preset: Preset; renamed: boolean } | { ok: false; error: string } {
    if (this.presets.length >= PRESET_LIMIT) {
      return { ok: false, error: `最多保存 ${PRESET_LIMIT} 个预设，请先删除旧的` };
    }
    const decoded = decodePresetShare(code);
    if (!decoded.ok) return decoded;
    const previous = this.presets.slice();
    const nameInfo = uniquePresetName(
      decoded.preset.name,
      this.presets.map((preset) => preset.name),
    );
    const preset: Preset = {
      ...decoded.preset,
      id: nextPresetId(),
      name: nameInfo.name,
    };
    if (presetSizeBytes(preset) > PRESET_LOGO_LIMIT) {
      return { ok: false, error: '分享码里的预设超过 2MB，无法导入' };
    }
    this.presets.push(preset);
    if (!this.persist()) {
      this.presets = previous;
      return { ok: false, error: '浏览器本地存储已满，导入失败' };
    }
    return { ok: true, preset, renamed: nameInfo.renamed };
  }

  exportJson(): string {
    return JSON.stringify({ version: PRESET_VERSION, presets: this.presets }, null, 2);
  }

  importJson(text: string): ImportPresetsResult {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { added: 0, skipped: 0, renamed: 0, error: '不是有效的 JSON 文件' };
    }
    let rawList: unknown[] | null = null;
    if (Array.isArray(parsed)) {
      rawList = parsed;
    } else if (isRecord(parsed) && Array.isArray(parsed.presets)) {
      if (parsed.version !== undefined && parsed.version !== PRESET_VERSION) {
        return { added: 0, skipped: 0, renamed: 0, error: '不支持的预设文件版本' };
      }
      rawList = parsed.presets;
    }
    if (!rawList) {
      return { added: 0, skipped: 0, renamed: 0, error: 'JSON 结构无效：缺少 presets 数组' };
    }
    const previous = this.presets.slice();
    const usedIds = new Set(this.presets.map((preset) => preset.id));
    let added = 0;
    let skipped = 0;
    let renamed = 0;
    for (const raw of rawList) {
      if (this.presets.length >= PRESET_LIMIT) {
        skipped += 1;
        continue;
      }
      const preset = normalizePreset(raw);
      if (!preset) {
        skipped += 1;
        continue;
      }
      if (presetSizeBytes(preset) > PRESET_LOGO_LIMIT) {
        skipped += 1;
        continue;
      }
      const nameInfo = uniquePresetName(
        preset.name,
        this.presets.map((item) => item.name),
      );
      let id = preset.id;
      if (usedIds.has(id)) id = nextPresetId();
      usedIds.add(id);
      this.presets.push({ ...preset, id, name: nameInfo.name });
      added += 1;
      if (nameInfo.renamed) renamed += 1;
    }
    if (added > 0 && !this.persist()) {
      this.presets = previous;
      return { added: 0, skipped, renamed: 0, error: '浏览器本地存储已满，导入失败' };
    }
    return { added, skipped, renamed };
  }

  private read(): Preset[] {
    try {
      if (typeof localStorage === 'undefined') return [];
      const raw = localStorage.getItem(PRESET_STORAGE_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      const list = Array.isArray(parsed)
        ? parsed
        : isRecord(parsed) && Array.isArray(parsed.presets)
          ? parsed.presets
          : null;
      if (!list) {
        console.warn('[framed] 预设存储格式无效，已忽略');
        return [];
      }
      const presets: Preset[] = [];
      for (const item of list) {
        if (presets.length >= PRESET_LIMIT) break;
        const preset = normalizePreset(item);
        if (preset) presets.push(preset);
        else console.warn('[framed] 忽略损坏的预设数据', item);
      }
      return presets;
    } catch (error) {
      console.warn('[framed] 读取预设失败，已忽略损坏数据', error);
      return [];
    }
  }

  private persist(): boolean {
    try {
      localStorage.setItem(
        PRESET_STORAGE_KEY,
        JSON.stringify({ version: PRESET_VERSION, presets: this.presets }),
      );
      return true;
    } catch (error) {
      console.warn('[framed] 写入预设失败', error);
      return false;
    }
  }
}
