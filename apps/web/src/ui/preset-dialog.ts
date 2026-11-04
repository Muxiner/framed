// 自定义预设弹层：保存当前排版、列表套用/删除、导入/导出 JSON、localStorage 持久化。
import { TEMPLATE_LABELS } from '../types';
import { h, setText } from './dom';
import type { Editor, EditorState } from './editor';
import { iconButton, textButton } from './fields';
import { icon } from './icons';
import {
  PRESET_LIMIT,
  PRESET_NAME_MAX,
  PresetStore,
  presetFileName,
  type Preset,
} from './presets';
import { toast } from './toast';

function formatPresetDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
}

export class PresetDialog {
  private readonly editor: Editor;
  private readonly store = new PresetStore();

  private readonly layer: HTMLElement;
  private readonly dialog: HTMLElement;
  private readonly list: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly countLabel: HTMLElement;
  private readonly saveButton: HTMLButtonElement;
  private readonly exportButton: HTMLButtonElement;
  private readonly importButton: HTMLButtonElement;
  private readonly importInput: HTMLInputElement;
  private readonly closeButton: HTMLButtonElement;

  private readonly nameLayer: HTMLElement;
  private readonly nameInput: HTMLInputElement;
  private readonly nameError: HTMLElement;
  private readonly nameSaveButton: HTMLButtonElement;

  private readonly shareImportButton: HTMLButtonElement;
  private readonly shareLayer: HTMLElement;
  private readonly shareCodeTextarea: HTMLTextAreaElement;
  private readonly shareCopyButton: HTMLButtonElement;
  private readonly importShareLayer: HTMLElement;
  private readonly importShareInput: HTMLTextAreaElement;
  private readonly importShareError: HTMLElement;
  private readonly importShareConfirm: HTMLButtonElement;

  private lastFocus: HTMLElement | null = null;
  private confirmingId: string | null = null;
  private confirmTimer = 0;

  constructor(editor: Editor) {
    this.editor = editor;

    this.closeButton = iconButton({
      name: 'close',
      label: '关闭预设面板',
      onClick: () => this.close(),
    });
    this.countLabel = h('span', { class: 'preset-count mono', text: `0 / ${PRESET_LIMIT}` });
    const head = h('header', { class: 'preset-head' }, [
      h('div', { class: 'preset-head-texts' }, [
        h('span', { class: 'preset-kicker mono', text: 'PRESETS' }),
        h('h2', { class: 'preset-title', text: '自定义预设' }),
      ]),
      h('div', { class: 'preset-head-actions' }, [this.countLabel, this.closeButton]),
    ]);

    this.saveButton = textButton('保存当前', {
      icon: 'plus',
      className: 'btn-accent preset-save',
      title: '保存当前边框与文字排版为预设',
      onClick: () => this.openNameDialog(),
    });
    this.importInput = h('input', {
      class: 'visually-hidden',
      attrs: { type: 'file', accept: 'application/json,.json', tabindex: '-1' },
    });
    this.importButton = textButton('导入 JSON', {
      icon: 'upload',
      className: 'btn-small',
      title: '从 JSON 文件导入预设',
      onClick: () => this.importInput.click(),
    });
    this.exportButton = textButton('导出 JSON', {
      icon: 'download',
      className: 'btn-small',
      title: '导出全部预设为 JSON',
      onClick: () => this.exportPresets(),
    });
    this.shareImportButton = textButton('导入分享码', {
      icon: 'link',
      className: 'btn-small',
      title: '粘贴分享码导入预设',
      onClick: () => this.openImportShare(),
    });
    const toolbar = h('div', { class: 'preset-toolbar' }, [
      this.saveButton,
      h('span', { class: 'preset-toolbar-spacer' }),
      this.shareImportButton,
      this.importButton,
      this.exportButton,
      this.importInput,
    ]);

    this.list = h('div', { class: 'preset-list', role: 'list', ariaLabel: '预设列表' });
    this.empty = h('div', { class: 'preset-empty' }, [
      h('span', { class: 'preset-empty-ico', html: icon('sparkle', 22) }),
      h('p', { class: 'preset-empty-title', text: '还没有自定义预设' }),
      h('p', {
        class: 'preset-empty-hint',
        text: '调好边框、文字样式与位置后，点「保存当前」，随时套用到其他照片。',
      }),
    ]);

    this.dialog = h(
      'section',
      {
        class: 'preset-dialog',
        role: 'dialog',
        attrs: { 'aria-modal': 'true', 'aria-label': '自定义预设' },
      },
      [
        head,
        toolbar,
        h('p', {
          class: 'preset-hint',
          text: '预设保存边框与文字排版。套用时保留当前照片的输出/网格，camera、gear、date 文本按当前照片 EXIF 替换。',
        }),
        this.list,
        this.empty,
        h('p', { class: 'preset-foot mono', text: `最多 ${PRESET_LIMIT} 个 · 保存在浏览器本地` }),
      ],
    );

    const backdrop = h('div', { class: 'preset-backdrop', ariaHidden: true });
    backdrop.addEventListener('click', () => this.close());

    // 保存命名对话框（自绘，不使用 window.prompt）
    this.nameInput = h('input', {
      class: 'input preset-name-input',
      attrs: {
        type: 'text',
        maxlength: String(PRESET_NAME_MAX),
        placeholder: '例如：我的胶片边框',
        autocomplete: 'off',
        'aria-label': '预设名称',
      },
    });
    this.nameError = h('p', { class: 'preset-name-error', hidden: true });
    this.nameSaveButton = textButton('保存预设', {
      className: 'btn-accent',
      onClick: () => this.commitSave(),
    });
    const nameBackdrop = h('div', { class: 'preset-name-backdrop', ariaHidden: true });
    nameBackdrop.addEventListener('click', () => this.closeNameDialog());
    this.nameLayer = h('div', { class: 'preset-name-layer', hidden: true }, [
      nameBackdrop,
      h(
        'section',
        {
          class: 'preset-name-dialog',
          role: 'dialog',
          attrs: { 'aria-modal': 'true', 'aria-label': '保存预设' },
        },
        [
          h('h3', { class: 'preset-name-title', text: '保存当前为预设' }),
          h('p', {
            class: 'preset-name-hint',
            text: '只保存边框与文字排版，不保存输出格式和网格设置。',
          }),
          this.nameInput,
          this.nameError,
          h('div', { class: 'preset-name-actions' }, [
            textButton('取消', { onClick: () => this.closeNameDialog() }),
            this.nameSaveButton,
          ]),
        ],
      ),
    ]);

    // 分享码对话框（复制给别人）
    this.shareCodeTextarea = h('textarea', {
      class: 'input preset-share-code',
      attrs: {
        readonly: 'readonly',
        spellcheck: 'false',
        rows: '6',
        'aria-label': '预设分享码',
      },
    });
    this.shareCopyButton = textButton('复制分享码', {
      icon: 'copy',
      className: 'btn-accent',
      onClick: () => void this.copyShareCode(),
    });
    const shareBackdrop = h('div', { class: 'preset-name-backdrop', ariaHidden: true });
    shareBackdrop.addEventListener('click', () => this.closeShareDialog());
    this.shareLayer = h('div', { class: 'preset-name-layer', hidden: true }, [
      shareBackdrop,
      h(
        'section',
        {
          class: 'preset-name-dialog preset-share-dialog',
          role: 'dialog',
          attrs: { 'aria-modal': 'true', 'aria-label': '分享预设' },
        },
        [
          h('h3', { class: 'preset-name-title', text: '分享码' }),
          h('p', {
            class: 'preset-name-hint',
            text: '复制下面这串代码发给朋友，在「预设 → 导入分享码」里粘贴即可。分享码不含输出格式与网格设置。',
          }),
          this.shareCodeTextarea,
          h('div', { class: 'preset-name-actions' }, [
            textButton('关闭', { onClick: () => this.closeShareDialog() }),
            this.shareCopyButton,
          ]),
        ],
      ),
    ]);

    // 导入分享码对话框
    this.importShareInput = h('textarea', {
      class: 'input preset-share-code',
      attrs: {
        spellcheck: 'false',
        rows: '4',
        placeholder: '粘贴 FRAMED1: 开头的分享码，或直接粘贴 base64 字符串',
        'aria-label': '分享码',
      },
    });
    this.importShareError = h('p', { class: 'preset-name-error', hidden: true });
    this.importShareConfirm = textButton('导入', {
      className: 'btn-accent',
      onClick: () => this.commitImportShare(),
    });
    const importShareBackdrop = h('div', { class: 'preset-name-backdrop', ariaHidden: true });
    importShareBackdrop.addEventListener('click', () => this.closeImportShare());
    this.importShareLayer = h('div', { class: 'preset-name-layer', hidden: true }, [
      importShareBackdrop,
      h(
        'section',
        {
          class: 'preset-name-dialog preset-share-dialog',
          role: 'dialog',
          attrs: { 'aria-modal': 'true', 'aria-label': '导入分享码' },
        },
        [
          h('h3', { class: 'preset-name-title', text: '导入分享码' }),
          h('p', {
            class: 'preset-name-hint',
            text: '粘贴朋友发来的分享码，导入后会加入预设列表（重名自动改名）。',
          }),
          this.importShareInput,
          this.importShareError,
          h('div', { class: 'preset-name-actions' }, [
            textButton('取消', { onClick: () => this.closeImportShare() }),
            this.importShareConfirm,
          ]),
        ],
      ),
    ]);

    this.layer = h('div', { class: 'preset-layer', hidden: true }, [
      backdrop,
      this.dialog,
      this.nameLayer,
      this.shareLayer,
      this.importShareLayer,
    ]);
    document.body.append(this.layer);

    this.importInput.addEventListener('change', () => void this.importPresets());
    this.nameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.commitSave();
      }
    });
    this.nameInput.addEventListener('input', () => {
      this.nameError.hidden = true;
    });

    document.addEventListener(
      'keydown',
      (event) => {
        if (this.layer.hidden) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          if (!this.importShareLayer.hidden) this.closeImportShare();
          else if (!this.shareLayer.hidden) this.closeShareDialog();
          else if (!this.nameLayer.hidden) this.closeNameDialog();
          else this.close();
          return;
        }
        if (event.key === 'Tab') this.trapFocus(event);
      },
      true,
    );

    editor.subscribe((state) => this.syncAvailability(state));
  }

  open(): void {
    if (!this.layer.hidden) return;
    this.lastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.layer.hidden = false;
    document.body.classList.add('modal-open');
    this.renderList();
    this.syncAvailability(this.editor.state);
    window.requestAnimationFrame(() => {
      const target = this.saveButton.disabled ? this.closeButton : this.saveButton;
      target.focus({ preventScroll: true });
    });
  }

  close(): void {
    if (this.layer.hidden) return;
    this.closeNameDialog();
    this.closeShareDialog();
    this.closeImportShare();
    this.layer.hidden = true;
    document.body.classList.remove('modal-open');
    this.confirmingId = null;
    if (this.confirmTimer) {
      window.clearTimeout(this.confirmTimer);
      this.confirmTimer = 0;
    }
    const focus = this.lastFocus;
    this.lastFocus = null;
    focus?.focus({ preventScroll: true });
  }

  private renderList(): void {
    const presets = this.store.list;
    this.list.replaceChildren();
    for (const preset of presets) this.list.append(this.buildPresetRow(preset));
    this.empty.hidden = presets.length > 0;
    this.list.hidden = presets.length === 0;
    setText(this.countLabel, `${presets.length} / ${PRESET_LIMIT}`);
    this.syncAvailability(this.editor.state);
  }

  private buildPresetRow(preset: Preset): HTMLElement {
    const template = preset.config.frame.template;
    const badge = h('span', {
      class: 'preset-badge mono',
      text: TEMPLATE_LABELS[template] ?? template,
      title: `模板：${TEMPLATE_LABELS[template] ?? template}`,
    });
    const name = h('span', { class: 'preset-name', text: preset.name });
    const metaParts = [formatPresetDate(preset.createdAt), `${preset.config.blocks.length} 个块`];
    if (preset.config.blocks.some((block) => block.type === 'logo')) metaParts.push('含 Logo');
    const meta = h('span', { class: 'preset-meta mono', text: metaParts.join(' · ') });

    const apply = h('button', {
      class: 'btn btn-small preset-apply',
      text: '套用',
      title: '套用到当前照片',
      ariaLabel: `套用预设 ${preset.name}`,
      attrs: { type: 'button' },
    });
    apply.disabled = this.editor.state.config === null;
    apply.addEventListener('click', () => {
      if (!this.editor.state.config) {
        toast('请先导入照片再套用预设', 'info', 2400);
        return;
      }
      this.editor.applyPreset(preset);
      this.close();
    });

    const share = iconButton({
      name: 'share',
      label: `生成分享码：${preset.name}`,
      title: '生成分享码（复制给别人）',
      className: 'preset-share-btn',
      onClick: () => this.sharePreset(preset),
    });

    const confirming = this.confirmingId === preset.id;
    const remove = h('button', {
      class: confirming ? 'preset-delete is-confirming' : 'preset-delete',
      html: confirming ? '确认删除' : icon('close', 12),
      title: confirming ? '再次点击确认删除' : '删除预设',
      ariaLabel: confirming ? `确认删除预设 ${preset.name}` : `删除预设 ${preset.name}`,
      attrs: { type: 'button' },
    });
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      this.handleDelete(preset);
    });

    const row = h('div', {
      class: confirming ? 'preset-item is-confirming' : 'preset-item',
      role: 'listitem',
      data: { id: preset.id },
    }, [
      h('div', { class: 'preset-info' }, [
        h('div', { class: 'preset-name-row' }, [name, badge]),
        meta,
      ]),
      h('div', { class: 'preset-actions' }, [share, apply, remove]),
    ]);
    return row;
  }

  private handleDelete(preset: Preset): void {
    if (this.confirmingId !== preset.id) {
      this.confirmingId = preset.id;
      this.renderList();
      if (this.confirmTimer) window.clearTimeout(this.confirmTimer);
      this.confirmTimer = window.setTimeout(() => {
        this.confirmingId = null;
        this.confirmTimer = 0;
        this.renderList();
      }, 3000);
      return;
    }
    if (this.confirmTimer) {
      window.clearTimeout(this.confirmTimer);
      this.confirmTimer = 0;
    }
    this.confirmingId = null;
    const removed = this.store.remove(preset.id);
    this.renderList();
    if (removed) toast(`已删除预设「${removed.name}」`, 'info', 2400);
    else toast('删除预设失败，请检查浏览器本地存储', 'error', 3600);
  }

  private openNameDialog(): void {
    if (!this.editor.state.config) {
      toast('请先导入照片再保存预设', 'info', 2400);
      return;
    }
    this.nameInput.value = `预设 ${this.store.count + 1}`;
    this.nameError.hidden = true;
    this.nameLayer.hidden = false;
    window.requestAnimationFrame(() => {
      this.nameInput.focus({ preventScroll: true });
      this.nameInput.select();
    });
  }

  private closeNameDialog(): void {
    if (this.nameLayer.hidden) return;
    this.nameLayer.hidden = true;
    if (!this.layer.hidden) this.saveButton.focus({ preventScroll: true });
  }

  private commitSave(): void {
    const config = this.editor.state.config;
    if (!config) {
      this.closeNameDialog();
      toast('请先导入照片再保存预设', 'info', 2400);
      return;
    }
    const name = this.nameInput.value.trim();
    if (!name) {
      this.nameError.textContent = '请输入预设名称';
      this.nameError.hidden = false;
      this.nameInput.focus({ preventScroll: true });
      return;
    }
    const result = this.store.save(name, config);
    if (!result.ok) {
      toast(result.error, 'error', 4200);
      return;
    }
    this.closeNameDialog();
    this.renderList();
    const base = result.renamed
      ? `名称重复，已保存为「${result.preset.name}」`
      : `已保存预设「${result.preset.name}」`;
    toast(result.hasLogo ? `${base}（含 Logo，占用本地存储）` : base, 'success', 3200);
  }

  private sharePreset(preset: Preset): void {
    const result = this.store.shareCode(preset);
    if (!result.ok) {
      toast(result.error, 'error', 4200);
      return;
    }
    this.shareCodeTextarea.value = result.code;
    this.shareLayer.hidden = false;
    window.requestAnimationFrame(() => {
      this.shareCodeTextarea.focus({ preventScroll: true });
      this.shareCodeTextarea.select();
    });
    void this.copyText(result.code).then((copied) => {
      toast(
        copied ? '分享码已复制到剪贴板' : '请手动复制分享码',
        copied ? 'success' : 'info',
        3200,
      );
    });
  }

  private closeShareDialog(): void {
    if (this.shareLayer.hidden) return;
    this.shareLayer.hidden = true;
    if (!this.layer.hidden) this.shareImportButton.focus({ preventScroll: true });
  }

  private copyShareCode(): void {
    void this.copyText(this.shareCodeTextarea.value).then((copied) => {
      toast(copied ? '已复制分享码' : '复制失败，请手动选择复制', copied ? 'success' : 'error', 2800);
    });
  }

  private async copyText(text: string): Promise<boolean> {
    if (!text) return false;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 剪贴板 API 不可用时回退到 execCommand。
    }
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    } finally {
      area.remove();
    }
    return copied;
  }

  private openImportShare(): void {
    this.importShareInput.value = '';
    this.importShareError.hidden = true;
    this.importShareLayer.hidden = false;
    window.requestAnimationFrame(() => this.importShareInput.focus({ preventScroll: true }));
  }

  private closeImportShare(): void {
    if (this.importShareLayer.hidden) return;
    this.importShareLayer.hidden = true;
    if (!this.layer.hidden) this.shareImportButton.focus({ preventScroll: true });
  }

  private commitImportShare(): void {
    const result = this.store.importShare(this.importShareInput.value);
    if (!result.ok) {
      this.importShareError.textContent = result.error;
      this.importShareError.hidden = false;
      return;
    }
    this.closeImportShare();
    this.renderList();
    const base = result.renamed
      ? `已导入分享码预设「${result.preset.name}」（重名已自动改名）`
      : `已导入分享码预设「${result.preset.name}」`;
    toast(base, 'success', 3600);
  }

  private exportPresets(): void {
    if (this.store.count === 0) {
      toast('暂无预设可导出', 'info', 2400);
      return;
    }
    const blob = new Blob([this.store.exportJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = presetFileName();
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1200);
    toast(`已导出 ${this.store.count} 个预设`, 'success', 2800);
  }

  private async importPresets(): Promise<void> {
    const file = this.importInput.files?.[0];
    this.importInput.value = '';
    if (!file) return;
    let text = '';
    try {
      text = await file.text();
    } catch {
      toast('读取 JSON 文件失败', 'error', 3600);
      return;
    }
    const result = this.store.importJson(text);
    this.renderList();
    if (result.error) {
      toast(result.error, 'error', 4200);
      return;
    }
    if (result.added > 0) {
      const notes = [`已导入 ${result.added} 个预设`];
      if (result.skipped > 0) notes.push(`跳过 ${result.skipped} 个无效或超限预设`);
      if (result.renamed > 0) notes.push(`${result.renamed} 个重名已自动改名`);
      toast(notes.join(' · '), 'success', 3800);
    } else if (result.skipped > 0) {
      toast('没有可导入的有效预设，已跳过损坏或超限的数据', 'error', 4200);
    } else {
      toast('JSON 中没有预设', 'info', 3000);
    }
  }

  private syncAvailability(state: EditorState): void {
    if (this.layer.hidden) return;
    const hasConfig = state.config !== null;
    this.saveButton.disabled = !hasConfig;
    for (const button of this.list.querySelectorAll<HTMLButtonElement>('.preset-apply')) {
      button.disabled = !hasConfig;
    }
  }

  private trapFocus(event: KeyboardEvent): void {
    const root = !this.importShareLayer.hidden
      ? this.importShareLayer
      : !this.shareLayer.hidden
        ? this.shareLayer
        : this.nameLayer.hidden
          ? this.dialog
          : this.nameLayer;
    const focusables = Array.from(
      root.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex="0"]'),
    ).filter((element) => element.offsetParent !== null);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    if (!root.contains(active)) {
      event.preventDefault();
      first.focus({ preventScroll: true });
      return;
    }
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  }
}
