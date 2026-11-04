// 顶栏：品牌、模板快切、渲染状态、引擎标识、导出（含导出设置弹层）。
import type { FrameTemplate, OutputFormat } from '../types';
import { TEMPLATE_LABELS } from '../types';
import { h, setAttr, setHidden, setText, setValue, toggleClass } from './dom';
import type { Editor, EditorState } from './editor';
import {
  iconButton,
  segmentedField,
  sliderField,
  textButton,
  type SegmentedHandle,
  type SliderHandle,
} from './fields';
import { brandMark, icon } from './icons';
import { REDO_SHORTCUT, UNDO_SHORTCUT } from './platform';

type MaxDimKey = '0' | '2400' | '1600';
const TEMPLATE_ORDER: FrameTemplate[] = ['none', 'white', 'polaroid', 'film', 'black'];

function defaultNameHint(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `framed-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

export class Topbar {
  readonly root: HTMLElement;

  private readonly editor: Editor;
  private readonly templateButtons = new Map<FrameTemplate, HTMLButtonElement>();
  private readonly statusWrap: HTMLElement;
  private readonly statusDot: HTMLElement;
  private readonly statusText: HTMLElement;
  private readonly engineBadge: HTMLElement;
  private readonly undoButton: HTMLButtonElement;
  private readonly redoButton: HTMLButtonElement;
  private readonly leftToggle: HTMLButtonElement;
  private readonly inspectorToggle: HTMLButtonElement;
  private readonly exportMain: HTMLButtonElement;
  private readonly exportLabel: HTMLElement;
  private readonly exportCaret: HTMLButtonElement;
  private readonly popover: HTMLElement;
  private readonly formatField: SegmentedHandle<OutputFormat>;
  private readonly qualityField: SliderHandle;
  private readonly qualityRoot: HTMLElement;
  private readonly maxDimField: SegmentedHandle<MaxDimKey>;
  private readonly nameInput: HTMLInputElement;
  private readonly popoverExport: HTMLButtonElement;
  private readonly exportAllButton: HTMLButtonElement;
  private readonly popoverFormatHint: HTMLElement;
  private lastExporting = false;

  constructor(editor: Editor) {
    this.editor = editor;

    const brand = h('div', { class: 'brand', ariaLabel: '框影 Framed' }, [
      h('span', { class: 'brand-ico', html: brandMark(28) }),
      h('span', { class: 'brand-texts' }, [
        h('span', { class: 'brand-name', text: '框影' }),
        h('span', { class: 'brand-sub mono', text: 'FRAMED' }),
      ]),
    ]);

    const nav = h('nav', { class: 'template-nav', role: 'group', ariaLabel: '边框模板快切' });
    for (const template of TEMPLATE_ORDER) {
      const button = h(
        'button',
        {
          class: 'template-tab',
          text: TEMPLATE_LABELS[template],
          ariaPressed: false,
          attrs: { type: 'button', title: `${TEMPLATE_LABELS[template]}模板` },
        },
      );
      button.addEventListener('click', () => void editor.setTemplate(template));
      this.templateButtons.set(template, button);
      nav.append(button);
    }

    this.statusDot = h('span', { class: 'status-dot' });
    this.statusText = h('span', { class: 'status-text mono', text: '启动中' });
    this.statusWrap = h('div', { class: 'render-status', role: 'status', ariaLive: 'polite' }, [
      this.statusDot,
      this.statusText,
    ]);
    this.engineBadge = h('span', {
      class: 'engine-badge mono',
      text: 'MOCK',
      title: '渲染内核',
    });

    this.undoButton = iconButton({
      name: 'undo',
      label: `撤销（${UNDO_SHORTCUT}）`,
      title: `撤销 (${UNDO_SHORTCUT})`,
      className: 'history-btn',
      onClick: () => editor.undo(),
    });
    this.redoButton = iconButton({
      name: 'redo',
      label: `重做（${REDO_SHORTCUT}）`,
      title: `重做 (${REDO_SHORTCUT})`,
      className: 'history-btn',
      onClick: () => editor.redo(),
    });
    this.undoButton.setAttribute('aria-keyshortcuts', 'Meta+Z Control+Z');
    this.redoButton.setAttribute('aria-keyshortcuts', 'Meta+Shift+Z Control+Shift+Z Control+Y');
    const historyGroup = h(
      'div',
      { class: 'history-group', role: 'group', ariaLabel: '历史操作' },
      [this.undoButton, this.redoButton],
    );

    this.leftToggle = iconButton({
      name: 'sliders',
      label: '打开控制栏',
      className: 'mobile-only',
      onClick: () => editor.toggleLeft(),
    });
    this.inspectorToggle = iconButton({
      name: 'panelRight',
      label: '打开检查器',
      className: 'mobile-only',
      onClick: () => editor.toggleInspector(),
    });

    this.exportLabel = h('span', { class: 'export-label', text: '导出' });
    this.exportMain = h(
      'button',
      {
        class: 'btn btn-accent export-main',
        title: '导出图片',
        ariaLabel: '导出图片',
        attrs: { type: 'button' },
      },
      [h('span', { class: 'export-ico', html: icon('download', 15) }), this.exportLabel],
    );
    this.exportMain.addEventListener('click', () => void editor.exportNow());
    this.exportCaret = h('button', {
      class: 'btn btn-accent export-caret',
      html: icon('chevronDown', 13),
      ariaLabel: '导出设置',
      ariaExpanded: false,
      attrs: { type: 'button' },
    });
    this.exportCaret.addEventListener('click', () => editor.setExportOpen(!editor.state.exportOpen));

    const exportGroup = h('div', { class: 'export-group' }, [this.exportMain, this.exportCaret]);

    const right = h('div', { class: 'topbar-right' }, [
      this.statusWrap,
      this.engineBadge,
      this.leftToggle,
      this.inspectorToggle,
      exportGroup,
    ]);

    // 导出设置弹层
    this.formatField = segmentedField<OutputFormat>({
      label: '格式',
      options: [
        { value: 'png', label: 'PNG' },
        { value: 'jpeg', label: 'JPEG' },
      ],
      value: 'png',
      onChange: (value) => editor.setOutput({ format: value }),
    });
    this.qualityField = sliderField({
      label: 'JPEG 质量',
      min: 1,
      max: 100,
      step: 1,
      value: 92,
      format: (value) => String(value),
      ariaLabel: 'JPEG 质量',
      onInput: (value) => editor.setOutput({ quality: Math.round(value) }),
    });
    this.qualityRoot = this.qualityField.root;
    this.maxDimField = segmentedField<MaxDimKey>({
      label: '长边上限',
      options: [
        { value: '0', label: '原图' },
        { value: '2400', label: '2400' },
        { value: '1600', label: '1600' },
      ],
      value: '0',
      onChange: (value) => editor.setOutput({ maxDim: Number(value) }),
    });
    this.nameInput = h('input', {
      class: 'input',
      attrs: {
        type: 'text',
        placeholder: defaultNameHint(),
        spellcheck: 'false',
        autocomplete: 'off',
        'aria-label': '导出文件名（不含扩展名）',
      },
    });
    this.nameInput.addEventListener('input', () => editor.setExportName(this.nameInput.value));
    this.popoverFormatHint = h('p', { class: 'sec-note', text: '' });
    this.popoverExport = textButton('导出图片', {
      icon: 'download',
      className: 'btn-accent btn-block',
      onClick: () => void editor.exportNow(),
    });
    this.exportAllButton = textButton('导出全部', {
      icon: 'download',
      className: 'btn-block btn-ghost export-all-btn',
      title: '导出照片库中的全部照片',
      onClick: () => void editor.exportAll(),
    });
    this.exportAllButton.hidden = true;

    const popoverClose = iconButton({
      name: 'close',
      label: '关闭导出设置',
      onClick: () => editor.setExportOpen(false),
    });
    this.popover = h(
      'div',
      {
        class: 'export-popover',
        role: 'dialog',
        ariaLabel: '导出设置',
        hidden: true,
      },
      [
        h('div', { class: 'popover-head' }, [
          h('span', { class: 'popover-title mono', text: 'EXPORT' }),
          popoverClose,
        ]),
        this.formatField.root,
        this.qualityRoot,
        this.maxDimField.root,
        h('div', { class: 'field' }, [
          h('div', { class: 'field-head' }, [
            h('label', { class: 'field-label', text: '文件名' }),
          ]),
          this.nameInput,
        ]),
        this.popoverFormatHint,
        this.popoverExport,
        this.exportAllButton,
      ],
    );

    this.root = h('header', { class: 'topbar' }, [
      brand,
      historyGroup,
      h('div', { class: 'topbar-center' }, [nav]),
      right,
      this.popover,
    ]);

    document.addEventListener('pointerdown', (event) => {
      if (!this.editor.state.exportOpen) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (this.popover.contains(target)) return;
      if (this.exportMain.contains(target) || this.exportCaret.contains(target)) return;
      this.editor.setExportOpen(false);
    });

    editor.subscribe((state) => this.update(state));
    this.update(editor.state);
  }

  private update(state: EditorState): void {
    const template = state.config?.frame.template ?? state.template;
    for (const [key, button] of this.templateButtons) {
      const active = key === template;
      toggleClass(button, 'is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }

    const statusClass = state.renderError
      ? 'is-error'
      : state.rendering
        ? 'is-rendering'
        : 'is-idle';
    this.statusDot.className = `status-dot ${statusClass}`;
    const renderTime =
      state.renderMs >= 1000 ? `${(state.renderMs / 1000).toFixed(1)}s` : `${state.renderMs}ms`;
    const statusLabel = state.status === 'boot'
      ? '启动中'
      : state.importing
        ? `导入中 ${state.importing.done}/${state.importing.total}`
        : state.renderError
          ? '渲染错误'
          : state.rendering
            ? '渲染中'
            : state.photo
              ? `就绪${state.renderMs > 0 ? ` · ${renderTime}` : ''}`
              : '待载入';
    setText(this.statusText, statusLabel);
    this.statusWrap.title =
      state.engineLabel === 'MOCK'
        ? 'Canvas2D 开发回退引擎'
        : state.engineLabel === 'TAURI'
          ? 'Tauri 原生渲染内核'
          : 'Rust / WebAssembly 渲染内核';

    setText(this.engineBadge, state.engineLabel);
    this.engineBadge.dataset.kind = state.engineLabel.toLowerCase();
    this.engineBadge.title = this.statusWrap.title;

    this.undoButton.disabled = !state.canUndo;
    this.redoButton.disabled = !state.canRedo;
    this.undoButton.setAttribute('aria-disabled', String(!state.canUndo));
    this.redoButton.setAttribute('aria-disabled', String(!state.canRedo));

    toggleClass(this.leftToggle, 'is-active', state.leftOpen);
    this.leftToggle.setAttribute('aria-pressed', String(state.leftOpen));
    toggleClass(this.inspectorToggle, 'is-active', state.inspectorOpen);
    this.inspectorToggle.setAttribute('aria-pressed', String(state.inspectorOpen));

    const canExport = state.config !== null && !state.exporting;
    this.exportMain.disabled = !canExport;
    this.exportCaret.disabled = state.config === null;
    setText(this.exportLabel, state.exporting ? '导出中…' : '导出');
    setAttr(this.exportCaret, 'aria-expanded', String(state.exportOpen));
    toggleClass(this.exportCaret, 'is-open', state.exportOpen);

    setHidden(this.popover, !state.exportOpen);
    if (state.config) {
      const output = state.config.output;
      this.formatField.setValue(output.format);
      this.qualityField.setValue(output.quality);
      const key: MaxDimKey = output.maxDim === 0 ? '0' : output.maxDim >= 2400 ? '2400' : '1600';
      this.maxDimField.setValue(key);
      this.maxDimField.setDisabled(false);
      this.formatField.setDisabled(false);
      this.qualityRoot.hidden = output.format !== 'jpeg';
      this.qualityField.setDisabled(output.format !== 'jpeg');
      setValue(this.nameInput, state.exportName);
      const extension = output.format === 'jpeg' ? 'jpg' : 'png';
      const base = state.exportName.trim().replace(/\.[a-zA-Z0-9]+$/, '') || defaultNameHint();
      setText(this.popoverFormatHint, `将输出 ${base}.${extension} · ${output.maxDim === 0 ? '原图尺寸' : `长边 ${output.maxDim}px`}`);
      const libraryCount = state.library.length;
      this.exportAllButton.hidden = libraryCount < 2;
      this.exportAllButton.disabled = state.exporting;
      const exportAllLabel = this.exportAllButton.querySelector('span');
      if (exportAllLabel) setText(exportAllLabel, `导出全部（${libraryCount} 张）`);
      this.popoverExport.disabled = state.exporting;
      if (this.lastExporting !== state.exporting) {
        this.lastExporting = state.exporting;
        this.popoverExport.innerHTML = `${icon('download', 14)}<span>${state.exporting ? '导出中…' : '导出图片'}</span>`;
      }
    } else {
      this.formatField.setDisabled(true);
      this.maxDimField.setDisabled(true);
      this.qualityField.setDisabled(true);
      this.popoverExport.disabled = true;
    }
  }
}
