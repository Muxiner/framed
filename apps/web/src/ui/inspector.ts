// 右侧检查器：选中块的排版参数、12×12 定位器、9 宫格快捷位、微调，
// 未选中时展示画布与导出设置。
import {
  FONT_LABELS,
  TEMPLATE_LABELS,
  type AnchorY,
  type Block,
  type FontFamily,
  type OutputFormat,
  type TextAlign,
} from '../types';
import {
  clamp,
  h,
  percent,
  setText,
  toggleClass,
} from './dom';
import type { Editor, EditorState } from './editor';
import {
  colorField,
  iconButton,
  numberField,
  segmentedField,
  selectField,
  sliderField,
  textButton,
  textareaField,
  toggleField,
  type ColorHandle,
  type NumberFieldHandle,
  type SegmentedHandle,
  type SelectHandle,
  type SliderHandle,
  type TextAreaHandle,
  type ToggleHandle,
} from './fields';
import { icon } from './icons';

type WeightKey = '400' | '600' | '700';
type MaxDimKey = '0' | '2400' | '1600';

interface PositionHandle {
  root: HTMLElement;
  anchors: HTMLButtonElement[];
  locatorCells: HTMLButtonElement[];
  marker: HTMLElement;
  up: HTMLButtonElement;
  down: HTMLButtonElement;
  left: HTMLButtonElement;
  right: HTMLButtonElement;
  xField: NumberFieldHandle;
  yField: NumberFieldHandle;
  activeCell: number;
}

interface SelectedPanel {
  signature: string;
  root: HTMLElement;
  name: HTMLElement;
  tag: HTMLElement;
  visibility: HTMLButtonElement;
  text?: TextAreaHandle;
  font?: SelectHandle<FontFamily>;
  weight?: SegmentedHandle<WeightKey>;
  size?: SliderHandle;
  lineHeight?: SliderHandle;
  letterSpacing?: SliderHandle;
  align?: SegmentedHandle<TextAlign>;
  alignY?: SegmentedHandle<AnchorY>;
  color?: ColorHandle;
  opacity?: SliderHandle;
  shadow?: ToggleHandle;
  logoPreview?: HTMLImageElement;
  logoWidth?: SliderHandle;
  position: PositionHandle;
}

interface EmptyHandles {
  root: HTMLElement;
  dims: HTMLElement;
  template: HTMLElement;
  grid: ToggleHandle;
  snap: ToggleHandle;
  format: SegmentedHandle<OutputFormat>;
  quality: SliderHandle;
  maxDim: SegmentedHandle<MaxDimKey>;
  hint: HTMLElement;
}

const ANCHOR_X = [1 / 12, 6 / 12, 11 / 12];
const ANCHOR_Y = [1 / 12, 6 / 12, 11 / 12];
const ANCHOR_LABELS = ['左上', '上中', '右上', '左中', '正中', '右中', '左下', '下中', '右下'];
const ANCHOR_DOT: Record<number, [number, number]> = {
  0: [22, 22],
  1: [50, 22],
  2: [78, 22],
  3: [22, 50],
  4: [50, 50],
  5: [78, 50],
  6: [22, 78],
  7: [50, 78],
  8: [78, 78],
};
const NUDGE_STEP = 1 / 144;
const FINE_GRID = 1 / 12;

export class Inspector {
  readonly root: HTMLElement;

  private readonly editor: Editor;
  private readonly scroll: HTMLElement;
  private readonly selectedHost: HTMLElement;
  private readonly empty: EmptyHandles;
  private panel: SelectedPanel | null = null;
  private readonly logoInput: HTMLInputElement;
  private lastGridVisible: boolean | null = null;
  private lastSnap: boolean | null = null;

  constructor(editor: Editor) {
    this.editor = editor;

    this.logoInput = h('input', {
      class: 'visually-hidden',
      attrs: { type: 'file', accept: 'image/png,image/jpeg,image/webp', tabindex: '-1' },
    });
    this.logoInput.addEventListener('change', () => {
      const file = this.logoInput.files?.[0];
      if (file) void editor.uploadLogo(file);
      this.logoInput.value = '';
    });

    const head = h('div', { class: 'panel-head' }, [
      h('span', { class: 'panel-title mono', text: '检查器' }),
      h('div', { class: 'panel-head-actions' }, [
        iconButton({
          name: 'close',
          label: '关闭检查器',
          className: 'drawer-close',
          onClick: () => editor.closeDrawers(),
        }),
      ]),
    ]);

    this.empty = this.buildEmpty();
    this.selectedHost = h('div', { class: 'insp-selected', hidden: true });
    this.scroll = h('div', { class: 'panel-scroll' }, [this.empty.root, this.selectedHost]);

    this.root = h('aside', { class: 'panel panel-inspector', ariaLabel: '检查器' }, [
      head,
      this.logoInput,
      this.scroll,
    ]);

    editor.subscribe((state) => this.update(state));
    this.update(editor.state);
  }

  // ------------------------------------------------------------------ 未选中

  private buildEmpty(): EmptyHandles {
    const dims = h('span', { class: 'insp-meta-value mono', text: '—' });
    const template = h('span', { class: 'insp-meta-value mono', text: '—' });

    const grid = toggleField({
      label: '显示 12×12 参考线',
      checked: false,
      onChange: (checked) => this.editor.setGrid({ visible: checked }),
    });
    const snap = toggleField({
      label: '吸附 1/12 栅格',
      checked: true,
      onChange: (checked) => this.editor.setGrid({ snap: checked }),
    });

    const format = segmentedField<OutputFormat>({
      label: '格式',
      options: [
        { value: 'png', label: 'PNG' },
        { value: 'jpeg', label: 'JPEG' },
      ],
      value: 'png',
      onChange: (value) => this.editor.setOutput({ format: value }),
    });
    const quality = sliderField({
      label: 'JPEG 质量',
      min: 1,
      max: 100,
      step: 1,
      value: 92,
      format: (value) => String(value),
      ariaLabel: 'JPEG 质量',
      onInput: (value) => this.editor.setOutput({ quality: Math.round(value) }),
    });
    const maxDim = segmentedField<MaxDimKey>({
      label: '长边上限',
      options: [
        { value: '0', label: '原图' },
        { value: '2400', label: '2400' },
        { value: '1600', label: '1600' },
      ],
      value: '0',
      onChange: (value) => this.editor.setOutput({ maxDim: Number(value) }),
    });
    const hint = h('p', {
      class: 'sec-note',
      text: '在画布或左侧列表中选择元素，调整排版与位置。',
    });

    const root = h('div', { class: 'insp-empty' }, [
      h('div', { class: 'insp-empty-hero' }, [
        h('span', { class: 'insp-empty-ico', html: icon('sliders', 20) }),
        h('p', { class: 'insp-empty-title', text: '未选中元素' }),
        hint,
      ]),
      h('div', { class: 'insp-group' }, [
        h('div', { class: 'insp-group-head' }, [h('span', { class: 'mono', text: '画布' })]),
        h('div', { class: 'insp-meta' }, [
          h('span', { class: 'insp-meta-label', text: '尺寸' }),
          dims,
          h('span', { class: 'insp-meta-label', text: '模板' }),
          template,
        ]),
        grid.root,
        snap.root,
      ]),
      h('div', { class: 'insp-group' }, [
        h('div', { class: 'insp-group-head' }, [h('span', { class: 'mono', text: '导出' })]),
        format.root,
        quality.root,
        maxDim.root,
        h('p', { class: 'sec-note', text: '网页版直接下载；桌面版弹出系统保存框。' }),
      ]),
      h('div', { class: 'insp-group' }, [
        h('div', { class: 'insp-group-head' }, [h('span', { class: 'mono', text: '快捷键' })]),
        h('ul', { class: 'shortcut-list' }, [
          h('li', {}, [h('kbd', { text: 'G' }), h('span', { text: '参考线' })]),
          h('li', {}, [h('kbd', { text: 'S' }), h('span', { text: '吸附' })]),
          h('li', {}, [h('kbd', { text: 'F' }), h('span', { text: '适应窗口' })]),
          h('li', {}, [h('kbd', { text: '方向键' }), h('span', { text: '微调位置' })]),
          h('li', {}, [h('kbd', { text: 'Esc' }), h('span', { text: '取消选中' })]),
        ]),
      ]),
    ]);

    return { root, dims, template, grid, snap, format, quality, maxDim, hint };
  }

  private updateEmpty(state: EditorState): void {
    const meta = state.meta;
    setText(this.empty.dims, meta ? `${meta.width} × ${meta.height}` : '—');
    setText(
      this.empty.template,
      state.config ? TEMPLATE_LABELS[state.config.frame.template] : TEMPLATE_LABELS[state.template],
    );
    const visible = state.config?.grid.visible ?? false;
    const snap = state.config?.grid.snap ?? true;
    if (visible !== this.lastGridVisible) {
      this.lastGridVisible = visible;
      this.empty.grid.setValue(visible);
    }
    if (snap !== this.lastSnap) {
      this.lastSnap = snap;
      this.empty.snap.setValue(snap);
    }
    const output = state.config?.output;
    const disabled = !state.config;
    this.empty.format.setDisabled(disabled);
    this.empty.quality.setDisabled(disabled || output?.format !== 'jpeg');
    this.empty.maxDim.setDisabled(disabled);
    setText(
      this.empty.hint,
      state.config
        ? '在画布或左侧列表中选择元素，调整排版与位置。'
        : '载入照片后，这里会显示画布与导出设置。',
    );
    if (output) {
      this.empty.format.setValue(output.format);
      this.empty.quality.setValue(output.quality);
      const key: MaxDimKey = output.maxDim === 0 ? '0' : output.maxDim >= 2400 ? '2400' : '1600';
      this.empty.maxDim.setValue(key);
    }
  }

  // ------------------------------------------------------------------ 选中块面板

  private update(state: EditorState): void {
    toggleClass(this.root, 'is-open', state.inspectorOpen);
    const block =
      (state.config?.blocks.find((item) => item.id === state.selectedId) as Block | undefined) ?? null;
    if (!block) {
      this.panel = null;
      this.selectedHost.replaceChildren();
      this.selectedHost.hidden = true;
      this.empty.root.hidden = false;
      this.updateEmpty(state);
      return;
    }
    this.empty.root.hidden = true;
    this.selectedHost.hidden = false;

    const signature = `${block.id}:${block.type}`;
    if (!this.panel || this.panel.signature !== signature) {
      this.panel = this.buildPanel(block);
      this.selectedHost.replaceChildren(this.panel.root);
    }
    this.updatePanel(block, this.panel);
  }

  private buildPanel(block: Block): SelectedPanel {
    const name = h('span', { class: 'insp-name', text: block.name });
    const tag = h('span', { class: 'insp-tag mono', text: `${block.type === 'logo' ? 'IMAGE' : 'TEXT'} · ${block.id}` });
    const visibility = iconButton({
      name: 'eye',
      label: `隐藏 ${block.name}`,
      className: 'insp-visibility',
      onClick: () => this.editor.toggleVisibility(block.id),
    });
    const close = iconButton({
      name: 'close',
      label: '取消选中',
      onClick: () => this.editor.select(null),
    });
    const head = h('div', { class: 'insp-head' }, [
      h('div', { class: 'insp-head-texts' }, [name, tag]),
      h('div', { class: 'insp-head-actions' }, [visibility, close]),
    ]);

    const groups: HTMLElement[] = [];
    const panel: Partial<SelectedPanel> = {};
    panel.signature = `${block.id}:${block.type}`;
    panel.name = name;
    panel.tag = tag;

    if (block.type === 'text') {
      const text = textareaField({
        label: '文本内容',
        value: block.text,
        rows: 3,
        hint: '支持换行 · 输入即时生效',
        onInput: (value) => this.editor.updateTextBlock(block.id, { text: value }),
      });
      const font = selectField<FontFamily>({
        label: '字体',
        options: [
          { value: 'sans', label: FONT_LABELS.sans },
          { value: 'mono', label: FONT_LABELS.mono },
          { value: 'cjk', label: FONT_LABELS.cjk },
        ],
        value: block.font,
        onChange: (value) => this.editor.updateTextBlock(block.id, { font: value }),
      });
      const weight = segmentedField<WeightKey>({
        label: '字重',
        options: [
          { value: '400', label: '常规' },
          { value: '600', label: '中粗' },
          { value: '700', label: '粗体' },
        ],
        value: String(block.weight) as WeightKey,
        onChange: (value) =>
          this.editor.updateTextBlock(block.id, { weight: Number(value) as 400 | 600 | 700 }),
      });
      const size = sliderField({
        label: '字号',
        min: 0.5,
        max: 4,
        step: 0.02,
        value: block.size,
        format: (value) => `${value.toFixed(2)}×`,
        ariaLabel: '字号',
        onInput: (value) => this.editor.updateTextBlock(block.id, { size: value }),
      });
      const lineHeight = sliderField({
        label: '行高',
        min: 1,
        max: 2.4,
        step: 0.02,
        value: block.lineHeight,
        format: (value) => value.toFixed(2),
        ariaLabel: '行高',
        onInput: (value) => this.editor.updateTextBlock(block.id, { lineHeight: value }),
      });
      const letterSpacing = sliderField({
        label: '字间距',
        min: -0.05,
        max: 0.5,
        step: 0.005,
        value: block.letterSpacing,
        format: (value) => `${value.toFixed(3)}em`,
        ariaLabel: '字间距',
        onInput: (value) => this.editor.updateTextBlock(block.id, { letterSpacing: value }),
      });
      const align = segmentedField<TextAlign>({
        label: '水平对齐',
        options: [
          { value: 'left', label: '左对齐', icon: 'alignLeft' },
          { value: 'center', label: '居中', icon: 'alignCenter' },
          { value: 'right', label: '右对齐', icon: 'alignRight' },
        ],
        value: block.align,
        iconOnly: true,
        onChange: (value) => this.editor.updateTextBlock(block.id, { align: value }),
      });
      const alignY = segmentedField<AnchorY>({
        label: '垂直锚定',
        options: [
          { value: 'top', label: '顶部', icon: 'alignTop' },
          { value: 'middle', label: '居中', icon: 'alignMiddle' },
          { value: 'bottom', label: '底部', icon: 'alignBottom' },
        ],
        value: block.alignY,
        iconOnly: true,
        onChange: (value) => this.editor.updateTextBlock(block.id, { alignY: value }),
      });
      const color = colorField({
        label: '颜色',
        value: block.color,
        onChange: (value) => this.editor.updateTextBlock(block.id, { color: value }),
      });
      const opacity = sliderField({
        label: '不透明度',
        min: 0,
        max: 1,
        step: 0.01,
        value: block.opacity,
        format: (value) => percent(value, 0),
        onInput: (value) => this.editor.updateTextBlock(block.id, { opacity: value }),
      });
      const shadow = toggleField({
        label: '文字投影',
        checked: block.shadow,
        hint: '叠在照片上时建议开启',
        onChange: (checked) => this.editor.updateTextBlock(block.id, { shadow: checked }),
      });

      panel.text = text;
      panel.font = font;
      panel.weight = weight;
      panel.size = size;
      panel.lineHeight = lineHeight;
      panel.letterSpacing = letterSpacing;
      panel.align = align;
      panel.alignY = alignY;
      panel.color = color;
      panel.opacity = opacity;
      panel.shadow = shadow;

      groups.push(
        this.group('文本', [text.root]),
        this.group('排版', [
          font.root,
          weight.root,
          size.root,
          lineHeight.root,
          letterSpacing.root,
          h('div', { class: 'field-pair' }, [align.root, alignY.root]),
          color.root,
          opacity.root,
          shadow.root,
        ]),
      );
    } else {
      const preview = h('img', { class: 'insp-logo-preview', attrs: { alt: 'Logo 预览' } });
      preview.src = block.src;
      const replace = textButton('更换 Logo', {
        icon: 'upload',
        className: 'btn-block',
        onClick: () => this.logoInput.click(),
      });
      const logoWidth = sliderField({
        label: '宽度',
        min: 0.03,
        max: 0.4,
        step: 0.005,
        value: block.width,
        format: (value) => percent(value, 1),
        ariaLabel: 'Logo 宽度',
        onInput: (value) => this.editor.updateLogoBlock(block.id, { width: value }),
      });
      const opacity = sliderField({
        label: '不透明度',
        min: 0,
        max: 1,
        step: 0.01,
        value: block.opacity,
        format: (value) => percent(value, 0),
        onInput: (value) => this.editor.updateLogoBlock(block.id, { opacity: value }),
      });
      panel.logoPreview = preview;
      panel.logoWidth = logoWidth;
      panel.opacity = opacity;
      groups.push(
        this.group('来源', [
          h('div', { class: 'insp-logo-card' }, [preview]),
          replace,
        ]),
        this.group('尺寸', [logoWidth.root, opacity.root]),
      );
    }

    const position = this.buildPosition(block);
    panel.position = position;
    groups.push(this.group('位置', [position.root]));

    const description = h('p', {
      class: 'sec-note',
      text:
        block.type === 'text'
          ? '拖拽画布中的文字块可移动，开启吸附后自动对齐 1/12 栅格。'
          : '拖拽画布中的 Logo 可移动，或在定位器中点选锚点。',
    });

    const root = h('div', { class: 'insp-panel' }, [head, ...groups, description]);
    panel.root = root;
    panel.visibility = visibility;
    return panel as SelectedPanel;
  }

  private group(title: string, children: (HTMLElement | null)[]): HTMLElement {
    return h('div', { class: 'insp-group' }, [
      h('div', { class: 'insp-group-head' }, [h('span', { class: 'mono', text: title })]),
      ...children.filter((child): child is HTMLElement => child !== null),
    ]);
  }

  // ------------------------------------------------------------------ 位置（9 宫格 + 12×12 + 数值）

  private buildPosition(block: Block): PositionHandle {
    const anchors: HTMLButtonElement[] = [];
    const anchorGrid = h('div', { class: 'anchor-grid', role: 'group', ariaLabel: '9 宫格快捷位置' });
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        const index = row * 3 + col;
        const dot = ANCHOR_DOT[index] ?? [50, 50];
        const button = h('button', {
          class: 'anchor-cell',
          title: ANCHOR_LABELS[index] ?? '',
          ariaLabel: `定位到${ANCHOR_LABELS[index] ?? ''}`,
          attrs: { type: 'button' },
          style: { '--ax': `${dot[0]}%`, '--ay': `${dot[1]}%` },
        });
        button.addEventListener('click', () => {
          this.editor.setBlockPosition(
            block.id,
            ANCHOR_X[col] ?? 0.5,
            ANCHOR_Y[row] ?? 0.5,
          );
        });
        anchors.push(button);
        anchorGrid.append(button);
      }
    }

    const nudge = (dx: number, dy: number) => {
      const current = this.editor.state.config?.blocks.find((item) => item.id === block.id);
      if (!current) return;
      this.editor.setBlockPosition(
        block.id,
        clamp(current.x + dx, 0, 1),
        clamp(current.y + dy, 0, 1),
      );
    };
    const up = h('button', {
      class: 'nudge-btn nudge-up',
      html: icon('arrowUp', 12),
      ariaLabel: '向上微调',
      title: '向上微调（Shift 步进 1/12）',
      attrs: { type: 'button' },
    });
    const down = h('button', {
      class: 'nudge-btn nudge-down',
      html: icon('arrowDown', 12),
      ariaLabel: '向下微调',
      title: '向下微调（Shift 步进 1/12）',
      attrs: { type: 'button' },
    });
    const left = h('button', {
      class: 'nudge-btn nudge-left',
      html: icon('arrowLeft', 12),
      ariaLabel: '向左微调',
      title: '向左微调（Shift 步进 1/12）',
      attrs: { type: 'button' },
    });
    const right = h('button', {
      class: 'nudge-btn nudge-right',
      html: icon('arrowRight', 12),
      ariaLabel: '向右微调',
      title: '向右微调（Shift 步进 1/12）',
      attrs: { type: 'button' },
    });
    up.addEventListener('click', (event) => nudge(0, -stepOf(event)));
    down.addEventListener('click', (event) => nudge(0, stepOf(event)));
    left.addEventListener('click', (event) => nudge(-stepOf(event), 0));
    right.addEventListener('click', (event) => nudge(stepOf(event), 0));
    const pad = h('div', { class: 'nudge-pad' }, [
      up,
      left,
      h('span', { class: 'nudge-center mono', text: '1/144' }),
      right,
      down,
    ]);

    const locator = h('div', { class: 'locator', role: 'group', ariaLabel: '12×12 定位器' });
    const locatorCells: HTMLButtonElement[] = [];
    for (let row = 0; row < 12; row += 1) {
      for (let col = 0; col < 12; col += 1) {
        const button = h('button', {
          class: 'locator-cell',
          ariaLabel: `定位到第 ${row + 1} 行第 ${col + 1} 列`,
          title: `${col + 1} / 12 · ${row + 1} / 12`,
          attrs: { type: 'button' },
        });
        button.addEventListener('click', () => {
          this.editor.setBlockPosition(
            block.id,
            (col + 0.5) / 12,
            (row + 0.5) / 12,
          );
        });
        locatorCells.push(button);
        locator.append(button);
      }
    }
    const marker = h('span', { class: 'locator-marker', ariaHidden: true });
    locator.append(marker);
    const locatorWrap = h('div', { class: 'locator-wrap' }, [locator]);

    const xField = numberField({
      label: 'x',
      value: block.x,
      min: 0,
      max: 1,
      step: 0.001,
      digits: 3,
      ariaLabel: '水平位置 x',
      onChange: (value) => {
        const current = this.editor.state.config?.blocks.find((item) => item.id === block.id);
        if (current) this.editor.setBlockPosition(block.id, value, current.y);
      },
    });
    const yField = numberField({
      label: 'y',
      value: block.y,
      min: 0,
      max: 1,
      step: 0.001,
      digits: 3,
      ariaLabel: '垂直位置 y',
      onChange: (value) => {
        const current = this.editor.state.config?.blocks.find((item) => item.id === block.id);
        if (current) this.editor.setBlockPosition(block.id, current.x, value);
      },
    });

    const root = h('div', { class: 'position-block' }, [
      h('div', { class: 'position-top' }, [
        h('div', { class: 'anchor-wrap' }, [
          h('span', { class: 'field-label', text: '9 宫格' }),
          anchorGrid,
        ]),
        h('div', { class: 'nudge-wrap' }, [
          h('span', { class: 'field-label', text: '微调' }),
          pad,
        ]),
      ]),
      locatorWrap,
      h('div', { class: 'xy-row' }, [xField.root, yField.root]),
    ]);

    return {
      root,
      anchors,
      locatorCells,
      marker,
      up,
      down,
      left,
      right,
      xField,
      yField,
      activeCell: -1,
    };
  }

  // ------------------------------------------------------------------ 增量更新

  private updatePanel(block: Block, panel: SelectedPanel): void {
    setText(panel.name, block.name);
    setText(
      panel.tag,
      `${block.type === 'logo' ? 'IMAGE' : 'TEXT'} · ${block.id}${block.visible ? '' : ' · 已隐藏'}`,
    );
    panel.visibility.innerHTML = icon(block.visible ? 'eye' : 'eyeOff', 14);
    panel.visibility.setAttribute('aria-label', `${block.visible ? '隐藏' : '显示'} ${block.name}`);
    panel.visibility.setAttribute('aria-pressed', String(block.visible));

    if (block.type === 'text') {
      panel.text?.setValue(block.text);
      panel.font?.setValue(block.font);
      panel.weight?.setValue(String(block.weight) as WeightKey);
      panel.size?.setValue(block.size);
      panel.lineHeight?.setValue(block.lineHeight);
      panel.letterSpacing?.setValue(block.letterSpacing);
      panel.align?.setValue(block.align);
      panel.alignY?.setValue(block.alignY);
      panel.color?.setValue(block.color);
      panel.opacity?.setValue(block.opacity);
      panel.shadow?.setValue(block.shadow);
    } else {
      if (panel.logoPreview && panel.logoPreview.src !== block.src) panel.logoPreview.src = block.src;
      panel.logoWidth?.setValue(block.width);
      panel.opacity?.setValue(block.opacity);
    }

    const position = panel.position;
    position.xField.setValue(block.x);
    position.yField.setValue(block.y);
    position.marker.style.left = `${block.x * 100}%`;
    position.marker.style.top = `${block.y * 100}%`;

    const col = clamp(Math.floor(block.x * 12), 0, 11);
    const row = clamp(Math.floor(block.y * 12), 0, 11);
    const cell = row * 12 + col;
    if (position.activeCell !== cell) {
      const previous = position.locatorCells[position.activeCell];
      if (previous) toggleClass(previous, 'is-active', false);
      const next = position.locatorCells[cell];
      if (next) toggleClass(next, 'is-active', true);
      position.activeCell = cell;
    }

    for (let index = 0; index < position.anchors.length; index += 1) {
      const button = position.anchors[index];
      if (!button) continue;
      const ax = ANCHOR_X[index % 3] ?? 0;
      const ay = ANCHOR_Y[Math.floor(index / 3)] ?? 0;
      toggleClass(button, 'is-active', Math.abs(block.x - ax) < 0.015 && Math.abs(block.y - ay) < 0.015);
    }
  }
}

function stepOf(event: MouseEvent): number {
  return event.shiftKey ? FINE_GRID : NUDGE_STEP;
}
