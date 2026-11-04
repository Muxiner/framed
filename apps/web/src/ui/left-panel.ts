// 左侧控制栏：照片 / 边框 / 内容块 / 水印 / Logo。
import {
  FONT_LABELS,
  TEMPLATE_LABELS,
  type Block,
  type FontFamily,
  type FrameTemplate,
  type PhotoShadowConfig,
  type ShadowMode,
} from '../types';
import { h, percent, setText, setValue, toggleClass } from './dom';
import {
  LIBRARY_LIMIT,
  type BatchMode,
  type Editor,
  type EditorState,
  type LibraryPhoto,
} from './editor';
import {
  colorField,
  iconButton,
  section,
  segmentedField,
  sliderField,
  textButton,
  textareaField,
  toggleField,
  type ColorHandle,
  type SectionHandle,
  type SegmentedHandle,
  type SliderHandle,
  type TextAreaHandle,
  type ToggleHandle,
} from './fields';
import { formatFontDate, formatFontSize, type CustomFontMeta } from './fonts';
import { icon } from './icons';
import { BRAND_STYLES } from './brand-styles';
import { COLOR_THEMES } from './color-themes';
import { LibraryReorder } from './library-reorder';
import { PresetDialog } from './preset-dialog';
import { SAMPLES, sampleThumb, sampleUrl, type SampleId } from './samples';

const TEMPLATE_ORDER: FrameTemplate[] = ['none', 'white', 'polaroid', 'film', 'black'];

const BLOCK_ICONS: Record<string, string> = {
  camera: 'camera',
  gear: 'aperture',
  date: 'calendar',
  watermark: 'text',
  logo: 'logo',
};

interface BlockRow {
  root: HTMLElement;
  main: HTMLButtonElement;
  eye: HTMLButtonElement;
  iconWrap: HTMLElement;
  name: HTMLElement;
  preview: HTMLElement;
  edit: HTMLElement;
  textarea: HTMLTextAreaElement | null;
  logoImg: HTMLImageElement | null;
}

interface LibraryItemHandle {
  root: HTMLElement;
  thumb: HTMLButtonElement;
  remove: HTMLButtonElement;
}

function exposureLine(state: EditorState): string {
  const exif = state.photo?.exif;
  if (!exif) return '—';
  const parts = [exif.focal, exif.aperture, exif.shutter, exif.iso].filter((item) => item.length > 0);
  return parts.length ? parts.join(' · ') : '—';
}

function fileExt(name: string): string {
  const match = /\.([a-zA-Z0-9]+)$/.exec(name);
  return match?.[1]?.toUpperCase() ?? 'IMAGE';
}

export class LeftPanel {
  readonly root: HTMLElement;

  private readonly editor: Editor;
  private readonly photoInput: HTMLInputElement;
  private readonly logoInput: HTMLInputElement;
  private readonly presetDialog: PresetDialog;

  private photoSection!: SectionHandle;
  private photoThumb!: HTMLImageElement;
  private photoBadge!: HTMLElement;
  private photoName!: HTMLElement;
  private photoSub!: HTMLElement;
  private photoEmpty!: HTMLElement;
  private exifValues = new Map<string, HTMLElement>();
  private importButton!: HTMLButtonElement;
  private libraryGrid!: HTMLElement;
  private libraryCount!: HTMLElement;
  private libraryClear!: HTMLButtonElement;
  private libraryProgress!: HTMLElement;
  private libraryProgressText!: HTMLElement;
  private libraryEmpty!: HTMLElement;
  private libraryItems = new Map<string, LibraryItemHandle>();
  private reorder!: LibraryReorder;
  private libraryIds = '';
  private libraryActive: string | null = null;
  private libraryImporting = false;
  private batchModeField!: SegmentedHandle<BatchMode>;
  private batchModeNote!: HTMLElement;

  private templateCards = new Map<FrameTemplate, HTMLButtonElement>();
  private frameSection!: SectionHandle;
  private marginField!: SliderHandle;
  private bottomField!: SliderHandle;
  private backgroundField!: ColorHandle;
  private radiusField!: SliderHandle;
  private holesField!: ToggleHandle;
  private holesRow!: HTMLElement;
  private paramSizeField!: SliderHandle;
  private paramColorField!: ColorHandle;
  private photoScaleField!: SliderHandle;
  private photoOffsetXField!: SliderHandle;
  private photoOffsetYField!: SliderHandle;
  private photoDragToggle!: ToggleHandle;
  private paramWeightField!: SegmentedHandle<'400' | '600' | '700'>;
  private brandToggle!: ToggleHandle;
  private brandWordColorField!: ColorHandle;
  private brandWordSizeField!: SliderHandle;
  private brandTagColorField!: ColorHandle;
  private brandTagSizeField!: SliderHandle;
  private brandWordFontField!: SegmentedHandle<'sans' | 'mono' | 'cjk'>;
  private brandTagFontField!: SegmentedHandle<'sans' | 'mono' | 'cjk'>;
  private brandTextDetails!: HTMLDetailsElement;
  private themeButtons = new Map<string, HTMLButtonElement>();
  private paramSwatches = new Map<string, HTMLButtonElement>();
  private readonly paramColors = [
    '#ffffff',
    '#efeae1',
    '#9a9388',
    '#5f5a52',
    '#141414',
    '#c8102e',
    '#f47b20',
    '#ffd100',
    '#2ea36b',
    '#2f6fed',
  ] as const;
  private paramBaseSizes: Record<string, number> | null = null;
  private paramLastStyleId: string | null = null;
  private paramLastPhotoId: string | null = null;
  private shadowBlock!: HTMLElement;
  private shadowToggle!: ToggleHandle;
  private shadowModeField!: SegmentedHandle<ShadowMode>;
  private shadowAngleField!: SliderHandle;
  private shadowDistanceField!: SliderHandle;
  private shadowBlurField!: SliderHandle;
  private shadowSpreadField!: SliderHandle;
  private shadowOpacityField!: SliderHandle;
  private shadowColorField!: ColorHandle;
  private shadowParams!: HTMLElement;
  private brandCards: { card: HTMLButtonElement; id: string }[] = [];
  private applyAllButton!: HTMLButtonElement;

  private blocksSection!: SectionHandle;
  private blockList!: HTMLElement;
  private blockRows = new Map<string, BlockRow>();
  private blockKey = '';
  private addLogoRow!: HTMLElement;

  private wmText!: TextAreaHandle;
  private wmFont!: SegmentedHandle<FontFamily>;
  private wmSize!: SliderHandle;
  private wmColor!: ColorHandle;
  private wmEmpty!: HTMLElement;

  private fontSection!: SectionHandle;
  private readonly fontInput: HTMLInputElement;
  private fontUploadButton!: HTMLButtonElement;
  private fontList!: HTMLElement;
  private fontEmpty!: HTMLElement;
  private fontRows = new Map<string, HTMLElement>();
  private fontKey = '';
  private fontBusy = false;

  private logoSection!: SectionHandle;
  private logoEmpty!: HTMLElement;
  private logoFilled!: HTMLElement;
  private logoPreviewImg!: HTMLImageElement;
  private logoWidth!: SliderHandle;
  private lastLogoSrc = '';
  private lastThumb: string | null = null;

  constructor(editor: Editor) {
    this.editor = editor;
    this.presetDialog = new PresetDialog(editor);
    this.photoInput = this.makeFileInput('image/*', (files) => void editor.importFiles(files), true);
    this.fontInput = this.makeFileInput('.ttf,.otf', (files) => {
      const file = files[0];
      if (file) void editor.uploadFont(file);
    });
    this.logoInput = this.makeFileInput('image/png,image/jpeg,image/webp', (files) => {
      const file = files[0];
      if (file) void editor.uploadLogo(file);
    });

    const head = h('div', { class: 'panel-head' }, [
      h('span', { class: 'panel-title mono', text: '控制' }),
      h('div', { class: 'panel-head-actions' }, [
        iconButton({
          name: 'close',
          label: '关闭控制栏',
          className: 'drawer-close',
          onClick: () => editor.closeDrawers(),
        }),
      ]),
    ]);

    const photo = this.buildPhotoSection();
    const frame = this.buildFrameSection();
    const blocks = this.buildBlocksSection();
    const watermark = this.buildWatermarkSection();
    const font = this.buildFontSection();
    const logo = this.buildLogoSection();

    this.root = h('aside', { class: 'panel panel-left', ariaLabel: '控制栏' }, [
      head,
      this.photoInput,
      this.logoInput,
      h('div', { class: 'panel-scroll' }, [
        photo,
        frame.root,
        blocks,
        watermark.root,
        font.root,
        logo.root,
        h('p', { class: 'panel-foot mono', text: '框影 FRAMED · BUILD 0.1.0' }),
      ]),
    ]);

    editor.subscribe((state) => this.update(state));
    this.update(editor.state);
  }

  private makeFileInput(
    accept: string,
    onPick: (files: File[]) => void,
    multiple = false,
  ): HTMLInputElement {
    const input = h('input', {
      class: 'visually-hidden',
      attrs: { type: 'file', accept, tabindex: '-1', ...(multiple ? { multiple: '' } : {}) },
    });
    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? []);
      if (files.length) onPick(files);
      input.value = '';
    });
    return input;
  }

  // ------------------------------------------------------------------ 照片

  private buildPhotoSection(): HTMLElement {
    this.photoThumb = h('img', { class: 'photo-thumb', attrs: { alt: '当前照片' } });
    this.photoBadge = h('span', { class: 'photo-badge mono', text: '—' });
    this.photoEmpty = h('span', { class: 'photo-empty', html: `${icon('image', 22)}<span>尚未载入照片</span>` });
    const thumbWrap = h('div', { class: 'photo-thumb-wrap' }, [this.photoThumb, this.photoBadge, this.photoEmpty]);

    this.photoName = h('span', { class: 'photo-name', text: '尚未载入照片' });
    this.photoSub = h('span', { class: 'photo-sub mono', text: '拖入 / 粘贴多张照片开始' });

    const exifGrid = h('div', { class: 'exif-grid' });
    const rows: [string, string][] = [
      ['camera', '机型'],
      ['lens', '镜头'],
      ['exposure', '曝光'],
      ['date', '时间'],
    ];
    for (const [key, label] of rows) {
      const value = h('span', { class: 'exif-value mono', text: '—' });
      this.exifValues.set(key, value);
      exifGrid.append(
        h('div', { class: 'exif-item' }, [
          h('span', { class: 'exif-label', text: label }),
          value,
        ]),
      );
    }

    this.importButton = textButton('导入照片', {
      icon: 'upload',
      className: 'btn-block',
      title: '导入照片（可多选）',
      onClick: () => this.photoInput.click(),
    });

    this.libraryGrid = h('div', { class: 'library-grid', role: 'list', ariaLabel: '照片库' });
    this.reorder = new LibraryReorder(
      this.libraryGrid,
      () => this.editor.state.library.map((entry) => ({ id: entry.id, name: entry.name })),
      (from, to) => this.editor.movePhoto(from, to),
      (id) => this.focusLibraryItem(id),
    );
    this.libraryCount = h('span', { class: 'library-count mono', text: '0 张' });
    this.libraryClear = h('button', {
      class: 'library-clear',
      text: '清空',
      ariaLabel: '清空照片库',
      attrs: { type: 'button' },
    });
    this.libraryClear.addEventListener('click', () => this.editor.clearLibrary());
    this.libraryProgressText = h('span', { class: 'library-progress-text mono', text: '正在导入…' });
    this.libraryProgress = h('div', { class: 'library-progress', hidden: true }, [
      h('span', { class: 'mini-spinner', ariaHidden: true }),
      this.libraryProgressText,
    ]);
    this.libraryEmpty = h('p', {
      class: 'library-empty-note',
      text: `拖入照片开始，或粘贴 / 导入多张（最多 ${LIBRARY_LIMIT} 张）。`,
    });
    this.batchModeField = segmentedField<BatchMode>({
      label: '参数',
      options: [
        { value: 'uniform', label: '统一' },
        { value: 'separate', label: '单独' },
      ],
      value: 'uniform',
      ariaLabel: '批量参数模式',
      onChange: (mode) => this.editor.setSharedParams(mode === 'uniform'),
    });
    this.batchModeNote = h('p', { class: 'batch-mode-note', text: '' });
    this.applyAllButton = textButton('应用当前参数到全部', {
      icon: 'frame',
      className: 'btn-block btn-ghost apply-all-btn',
      title: '把当前照片的全部参数同步到其他照片（EXIF 文本各自保留）',
      onClick: () => this.editor.applyCurrentToAll(),
    });
    this.applyAllButton.hidden = true;
    const library = h('div', { class: 'library-block' }, [
      h('div', { class: 'library-head' }, [
        h('span', { class: 'library-title mono', text: '照片库' }),
        this.libraryCount,
        h('span', { class: 'library-head-spacer' }),
        this.libraryClear,
      ]),
      h('div', { class: 'batch-mode-block' }, [
        this.batchModeField.root,
        this.batchModeNote,
        this.applyAllButton,
      ]),
      this.libraryProgress,
      this.libraryEmpty,
      this.libraryGrid,
    ]);

    const sampleStrip = h('div', { class: 'sample-strip', role: 'group', ariaLabel: '示例照片' });
    for (const sample of SAMPLES) {
      sampleStrip.append(this.buildSampleChip(sample.id, sample.label));
    }

    const body = h('div', {}, [
      h('div', { class: 'photo-card' }, [
        thumbWrap,
        h('div', { class: 'photo-info' }, [this.photoName, this.photoSub]),
      ]),
      exifGrid,
      this.importButton,
      h('p', { class: 'sec-note', text: '支持多选、拖拽到任意位置、粘贴多张。' }),
      library,
      h('span', { class: 'sample-strip-label mono', text: '示例照片' }),
      sampleStrip,
    ]);

    this.photoSection = section({ index: '01', title: '照片', open: true, body });
    return this.photoSection.root;
  }

  private buildLibraryItem(entry: LibraryPhoto): LibraryItemHandle {
    const img = h('img', { attrs: { alt: '', loading: 'lazy', draggable: 'false' } });
    img.src = entry.thumbUrl;
    const thumb = h(
      'button',
      {
        class: 'library-thumb-btn',
        title: entry.name,
        ariaLabel: `切换到 ${entry.name}`,
        attrs: { type: 'button' },
      },
      [
        img,
        h('span', { class: 'library-scrim', ariaHidden: true }),
        h('span', { class: 'library-name', text: entry.name }),
      ],
    );
    thumb.addEventListener('click', () => {
      if (this.reorder.consumeClickSuppress()) return;
      void this.editor.switchPhoto(entry.id);
    });

    const remove = h('button', {
      class: 'library-remove',
      html: icon('close', 10),
      title: '删除照片',
      ariaLabel: `删除 ${entry.name}`,
      attrs: { type: 'button' },
    });
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      void this.editor.deletePhoto(entry.id);
    });

    const root = h('div', { class: 'library-item', role: 'listitem', data: { id: entry.id } }, [
      thumb,
      remove,
    ]);
    this.reorder.register(entry.id, root, thumb, entry.name);
    return { root, thumb, remove };
  }

  private syncLibrary(state: EditorState): void {
    const ids = state.library.map((entry) => entry.id).join('|');
    if (ids !== this.libraryIds) {
      this.libraryIds = ids;
      this.libraryActive = null;
      this.libraryItems.clear();
      this.libraryGrid.replaceChildren();
      for (const entry of state.library) {
        const item = this.buildLibraryItem(entry);
        this.libraryItems.set(entry.id, item);
        this.libraryGrid.append(item.root);
      }
    }

    const importing = state.importing;
    const busy = importing !== null;
    if (this.libraryImporting !== busy) {
      this.libraryImporting = busy;
      this.importButton.disabled = busy;
      this.libraryClear.disabled = busy;
    }
    setText(this.libraryCount, `已导入 ${state.library.length} 张`);
    this.photoSection.setBadge(state.library.length > 0 ? `${state.library.length} 张` : null);
    this.libraryClear.hidden = state.library.length === 0;
    this.libraryEmpty.hidden = state.library.length > 0 || busy;
    this.libraryProgress.hidden = !importing;
    if (importing) {
      setText(this.libraryProgressText, `正在导入 ${importing.done}/${importing.total}`);
    }

    if (this.libraryActive !== state.activePhotoId) {
      this.libraryActive = state.activePhotoId;
      for (const [id, item] of this.libraryItems) {
        const active = id === state.activePhotoId;
        toggleClass(item.root, 'is-active', active);
        item.thumb.setAttribute('aria-current', active ? 'true' : 'false');
      }
    }
    for (const item of this.libraryItems.values()) {
      item.thumb.disabled = busy;
      item.remove.disabled = busy;
    }
  }

  private focusLibraryItem(id: string): void {
    const item = this.libraryItems.get(id);
    if (item) item.thumb.focus({ preventScroll: true });
  }

  private buildSampleChip(id: SampleId, label: string): HTMLElement {
    const img = h('img', { attrs: { alt: '', loading: 'lazy' } });
    img.src = sampleUrl(id);
    this.attachSampleFallback(img, id);
    const button = h(
      'button',
      {
        class: 'sample-mini',
        title: `载入示例：${label}`,
        attrs: { type: 'button' },
      },
      [img, h('span', { class: 'sample-mini-label mono', text: label })],
    );
    button.addEventListener('click', () => void this.editor.loadSample(id));
    return button;
  }

  private attachSampleFallback(image: HTMLImageElement, id: SampleId): void {
    let fallback = false;
    image.addEventListener('error', () => {
      if (fallback) return;
      fallback = true;
      void sampleThumb(id).then((url) => {
        image.src = url;
      });
    });
  }

  // ------------------------------------------------------------------ 边框

  private buildFrameSection(): SectionHandle {
    const cards = h('div', { class: 'template-grid', role: 'group', ariaLabel: '边框模板' });
    for (const template of TEMPLATE_ORDER) {
      const card = h(
        'button',
        {
          class: `tpl-card tpl-${template}`,
          attrs: { type: 'button', 'aria-label': `${TEMPLATE_LABELS[template]}边框` },
          ariaPressed: false,
        },
        [
          h('span', { class: 'tpl-mini' }, [h('span', { class: 'tpl-mini-photo' })]),
          h('span', { class: 'tpl-name', text: TEMPLATE_LABELS[template] }),
        ],
      );
      card.addEventListener('click', () => void this.editor.setTemplate(template));
      this.templateCards.set(template, card);
      cards.append(card);
    }

    this.marginField = sliderField({
      label: '边距',
      min: 0.02,
      max: 0.12,
      step: 0.001,
      value: 0.045,
      format: (value) => percent(value, 1),
      ariaLabel: '边框边距',
      onInput: (value) => this.editor.setFrame({ margin: value }),
    });
    this.bottomField = sliderField({
      label: '底栏倍率',
      min: 1,
      max: 6,
      step: 0.1,
      value: 3,
      format: (value) => `${value.toFixed(1)}×`,
      ariaLabel: '底栏倍率',
      onInput: (value) => this.editor.setFrame({ bottomRatio: value }),
    });
    this.backgroundField = colorField({
      label: '边框底色',
      value: '#f6f3ee',
      onChange: (value) => this.editor.setFrame({ background: value }),
    });
    this.radiusField = sliderField({
      label: '照片圆角',
      min: 0,
      max: 0.06,
      step: 0.001,
      value: 0,
      format: (value) => percent(value, 1),
      ariaLabel: '照片圆角',
      onInput: (value) => this.editor.setFrame({ radius: value }),
    });
    this.holesField = toggleField({
      label: '胶片齿孔',
      checked: true,
      hint: '在边框上绘制胶片齿孔',
      onChange: (checked) => this.editor.setFrame({ filmHoles: checked }),
    });
    this.holesRow = this.holesField.root;
    this.holesRow.hidden = true;

    const brandStrip = h('div', { class: 'brand-style-strip', role: 'group', ariaLabel: '品牌样式' });
    for (const style of BRAND_STYLES) {
      const mini = h('span', { class: 'brand-mini', ariaHidden: true }, [
        h('img', {
          class: 'brand-mini-img',
          attrs: {
            src: `/brand-previews/${style.id}.jpg`,
            alt: '',
            loading: 'lazy',
            decoding: 'async',
          },
        }),
      ]);
      mini.style.background = style.preview.background;

      const card = h(
        'button',
        {
          class: 'brand-card',
          title: `${style.name} · ${style.tagline}`,
          ariaLabel: `应用${style.name}风格`,
          attrs: { type: 'button' },
        },
        [
          mini,
          h('span', { class: 'brand-card-info' }, [
            h('span', { class: 'brand-name', text: style.name }),
            h('span', { class: 'brand-tag', text: style.tagline }),
          ]),
        ],
      );
      card.style.setProperty('--brand', style.accent);
      card.dataset.styleId = style.id;
      card.addEventListener('click', () => void this.editor.applyBrandStyle(style));
      this.brandCards.push({ card, id: style.id });
      brandStrip.append(card);
    }

    this.paramSizeField = sliderField({
      label: '参数文字大小',
      min: 0.6,
      max: 1.8,
      step: 0.02,
      value: 1,
      format: (value) => `${value.toFixed(2)}×`,
      ariaLabel: '整体缩放相机、参数、日期文字大小',
      onInput: (value) => this.scaleParameters(value),
    });

    this.photoScaleField = sliderField({
      label: '照片缩放',
      min: 1,
      max: 2.5,
      step: 0.01,
      value: 1,
      format: (value) => `${value.toFixed(2)}×`,
      ariaLabel: '照片缩放（构图）',
      onInput: (value) => this.editor.setPhotoTransform({ scale: value }),
    });
    this.photoOffsetXField = sliderField({
      label: '水平位置',
      min: -1,
      max: 1,
      step: 0.01,
      value: 0,
      format: (value) => `${Math.round(value * 100)}%`,
      ariaLabel: '照片水平位置',
      onInput: (value) => this.editor.setPhotoTransform({ offsetX: value }),
    });
    this.photoOffsetYField = sliderField({
      label: '垂直位置',
      min: -1,
      max: 1,
      step: 0.01,
      value: 0,
      format: (value) => `${Math.round(value * 100)}%`,
      ariaLabel: '照片垂直位置',
      onInput: (value) => this.editor.setPhotoTransform({ offsetY: value }),
    });
    this.photoDragToggle = toggleField({
      label: '拖动照片',
      checked: false,
      hint: '开启后在画布上拖动可平移照片；P 键切换',
      onChange: () => this.editor.togglePhotoDrag(),
    });
    const resetPhotoButton = textButton('重置构图', {
      icon: 'refresh',
      className: 'btn-small btn-ghost',
      onClick: () => this.editor.resetPhotoTransform(),
    });
    const photoTransformBlock = h('div', { class: 'photo-transform-block' }, [
      h('p', { class: 'sec-mini-label mono', text: '照片构图' }),
      this.photoScaleField.root,
      this.photoOffsetXField.root,
      this.photoOffsetYField.root,
      this.photoDragToggle.root,
      h('div', { class: 'row-actions photo-transform-actions' }, [resetPhotoButton]),
    ]);

    this.paramColorField = colorField({
      label: '参数颜色',
      value: '#5f5a52',
      onChange: (value) => this.editor.setParameterStyle({ color: value }),
    });
    const themeRow = h('div', {
      class: 'color-themes',
      role: 'group',
      ariaLabel: '颜色主题',
    });
    for (const theme of COLOR_THEMES) {
      const dots = h('span', { class: 'theme-dots', ariaHidden: true }, [
        h('span', { class: 'theme-dot' }),
        h('span', { class: 'theme-dot' }),
        h('span', { class: 'theme-dot' }),
      ]);
      const dotEls = dots.querySelectorAll<HTMLElement>('.theme-dot');
      dotEls[0]?.style.setProperty('background', theme.paramColor);
      dotEls[1]?.style.setProperty('background', theme.brandColor);
      dotEls[2]?.style.setProperty('background', theme.background);
      const chip = h(
        'button',
        {
          class: 'color-theme',
          title: `${theme.name} · 参数 ${theme.paramColor} / 字标 ${theme.brandColor} / 底色 ${theme.background}`,
          ariaLabel: `应用颜色主题：${theme.name}`,
          attrs: { type: 'button' },
        },
        [dots, h('span', { class: 'theme-name', text: theme.name })],
      );
      chip.addEventListener('click', () => this.editor.applyColorTheme(theme));
      this.themeButtons.set(theme.id, chip);
      themeRow.append(chip);
    }

    const paramSwatches = h('div', {
      class: 'color-swatches',
      role: 'group',
      ariaLabel: '参数颜色快捷选择',
    });
    for (const color of this.paramColors) {
      const swatch = h('button', {
        class: 'color-swatch',
        title: `参数颜色 ${color}`,
        ariaLabel: `参数颜色 ${color}`,
        attrs: { type: 'button' },
      });
      swatch.style.setProperty('--swatch', color);
      swatch.addEventListener('click', () => this.editor.setParameterStyle({ color }));
      this.paramSwatches.set(color, swatch);
      paramSwatches.append(swatch);
    }
    this.paramWeightField = segmentedField<'400' | '600' | '700'>({
      label: '参数粗细',
      options: [
        { value: '400', label: '常规' },
        { value: '600', label: '中粗' },
        { value: '700', label: '粗体' },
      ],
      value: '400',
      ariaLabel: '相机参数文字粗细',
      onChange: (value) => this.editor.setParameterStyle({ weight: Number(value) as 400 | 600 | 700 }),
    });
    this.brandToggle = toggleField({
      label: '品牌字标',
      checked: true,
      hint: '关闭后隐藏品牌字标与副标，只保留参数排版',
      onChange: (checked) => this.editor.setBrandVisible(checked),
    });

    this.brandWordColorField = colorField({
      label: '字标颜色',
      value: '#141414',
      onChange: (value) => this.editor.setBrandTextStyle('wordmark', { color: value }),
    });
    this.brandWordSizeField = sliderField({
      label: '字标大小',
      min: 0.2,
      max: 4,
      step: 0.02,
      value: 2.2,
      format: (value) => `${value.toFixed(2)}×`,
      ariaLabel: '品牌字标大小',
      onInput: (value) => this.editor.setBrandTextStyle('wordmark', { size: value }),
    });
    this.brandTagColorField = colorField({
      label: '副标颜色',
      value: '#c8102e',
      onChange: (value) => this.editor.setBrandTextStyle('tagline', { color: value }),
    });
    this.brandTagSizeField = sliderField({
      label: '副标大小',
      min: 0.2,
      max: 3,
      step: 0.02,
      value: 0.6,
      format: (value) => `${value.toFixed(2)}×`,
      ariaLabel: '品牌副标大小',
      onInput: (value) => this.editor.setBrandTextStyle('tagline', { size: value }),
    });
    this.brandWordFontField = segmentedField<'sans' | 'mono' | 'cjk'>({
      label: '字标字体',
      options: [
        { value: 'sans', label: '无衬线' },
        { value: 'mono', label: '等宽' },
        { value: 'cjk', label: '中文' },
      ],
      value: 'sans',
      ariaLabel: '品牌字标字体',
      onChange: (value) => this.editor.setBrandTextStyle('wordmark', { font: value }),
    });
    this.brandTagFontField = segmentedField<'sans' | 'mono' | 'cjk'>({
      label: '副标字体',
      options: [
        { value: 'sans', label: '无衬线' },
        { value: 'mono', label: '等宽' },
        { value: 'cjk', label: '中文' },
      ],
      value: 'mono',
      ariaLabel: '品牌副标字体',
      onChange: (value) => this.editor.setBrandTextStyle('tagline', { font: value }),
    });
    this.brandTextDetails = h('details', { class: 'brand-text-adjust' }, [
      h('summary', { text: '单独调整字标 / 副标' }),
      h('div', { class: 'brand-text-adjust-body' }, [
        this.brandWordColorField.root,
        this.brandWordSizeField.root,
        this.brandWordFontField.root,
        this.brandTagColorField.root,
        this.brandTagSizeField.root,
        this.brandTagFontField.root,
      ]),
    ]);

    this.shadowToggle = toggleField({
      label: '照片阴影',
      checked: false,
      hint: '外阴影 / 内阴影，方向、距离、模糊可调',
      onChange: (checked) => this.setShadow({ enabled: checked }),
    });
    this.shadowModeField = segmentedField<ShadowMode>({
      label: '阴影类型',
      options: [
        { value: 'outer', label: '外' },
        { value: 'inner', label: '内' },
        { value: 'both', label: '内外' },
      ],
      value: 'outer',
      ariaLabel: '照片阴影类型',
      onChange: (mode) => this.setShadow({ mode }),
    });
    this.shadowAngleField = sliderField({
      label: '阴影方向',
      min: 0,
      max: 360,
      step: 1,
      value: 120,
      format: (value) => `${Math.round(value)}°`,
      ariaLabel: '照片阴影方向',
      onInput: (value) => this.setShadow({ angle: value }),
    });
    this.shadowDistanceField = sliderField({
      label: '阴影距离',
      min: 0,
      max: 0.2,
      step: 0.001,
      value: 0.012,
      format: (value) => percent(value, 1),
      ariaLabel: '照片阴影距离',
      onInput: (value) => this.setShadow({ distance: value }),
    });
    this.shadowBlurField = sliderField({
      label: '阴影模糊',
      min: 0,
      max: 0.2,
      step: 0.001,
      value: 0.02,
      format: (value) => percent(value, 1),
      ariaLabel: '照片阴影模糊',
      onInput: (value) => this.setShadow({ blur: value }),
    });
    this.shadowSpreadField = sliderField({
      label: '阴影扩散',
      min: -0.1,
      max: 0.2,
      step: 0.001,
      value: 0,
      format: (value) => percent(value, 1),
      ariaLabel: '照片阴影扩散',
      onInput: (value) => this.setShadow({ spread: value }),
    });
    this.shadowOpacityField = sliderField({
      label: '阴影不透明度',
      min: 0,
      max: 1,
      step: 0.01,
      value: 0.28,
      format: (value) => `${Math.round(value * 100)}%`,
      ariaLabel: '照片阴影不透明度',
      onInput: (value) => this.setShadow({ opacity: value }),
    });
    this.shadowColorField = colorField({
      label: '阴影颜色',
      value: '#000000',
      onChange: (value) => this.setShadow({ color: value }),
    });
    this.shadowParams = h('div', { class: 'shadow-params', hidden: true }, [
      this.shadowModeField.root,
      this.shadowAngleField.root,
      this.shadowDistanceField.root,
      this.shadowBlurField.root,
      this.shadowSpreadField.root,
      this.shadowOpacityField.root,
      this.shadowColorField.root,
    ]);
    this.shadowBlock = h('div', { class: 'shadow-block' }, [this.shadowToggle.root, this.shadowParams]);

    const presetButton = h('button', {
      class: 'sec-action-btn',
      html: `${icon('sparkle', 12)}<span>预设</span>`,
      title: '自定义预设 / 模板',
      ariaLabel: '打开自定义预设',
      attrs: { type: 'button' },
    });
    presetButton.addEventListener('click', () => this.presetDialog.open());

    this.frameSection = section({
      index: '02',
      title: '边框',
      badge: TEMPLATE_LABELS.white,
      open: true,
      actions: [presetButton],
      body: h('div', {}, [
        h('p', { class: 'sec-mini-label mono', text: '品牌样式' }),
        brandStrip,
        this.brandToggle.root,
        this.brandTextDetails,
        cards,
        this.marginField.root,
        this.bottomField.root,
        this.backgroundField.root,
        this.radiusField.root,
        photoTransformBlock,
        this.paramSizeField.root,
        h('p', { class: 'sec-mini-label mono', text: '颜色主题' }),
        themeRow,
        this.paramColorField.root,
        h('p', { class: 'sec-mini-label mono', text: '参数色' }),
        paramSwatches,
        this.paramWeightField.root,
        this.holesRow,
        this.shadowBlock,
      ]),
    });
    return this.frameSection;
  }

  private scaleParameters(scale: number): void {
    const config = this.editor.state.config;
    if (!config) return;
    if (!this.paramBaseSizes) {
      const base: Record<string, number> = {};
      const hasBrand = config.blocks.some((block) => block.id === 'tagline');
      for (const block of config.blocks) {
        if (block.type !== 'text') continue;
        if (['camera', 'gear', 'date', 'tagline'].includes(block.id)) {
          base[block.id] = block.size;
        } else if (block.id === 'watermark' && hasBrand) {
          base[block.id] = block.size;
        }
      }
      this.paramBaseSizes = base;
    }
    this.editor.setParameterScale(scale, this.paramBaseSizes);
  }

  private setShadow(patch: Partial<PhotoShadowConfig>): void {
    const frame = this.editor.state.config?.frame;
    if (!frame) return;
    this.editor.setFrame({ photoShadow: { ...frame.photoShadow, ...patch } });
  }

  // ------------------------------------------------------------------ 内容块

  private buildBlocksSection(): HTMLElement {
    this.blockList = h('div', { class: 'block-list', role: 'group', ariaLabel: '内容块列表' });
    this.addLogoRow = h('div', { class: 'block-add', hidden: true }, [
      textButton('添加 Logo', {
        icon: 'plus',
        className: 'btn-block btn-ghost',
        onClick: () => this.logoInput.click(),
      }),
    ]);

    this.blocksSection = section({
      index: '03',
      title: '内容块',
      open: true,
      body: h('div', {}, [
        this.blockList,
        this.addLogoRow,
        h('p', {
          class: 'sec-note',
          text: '点击选中，画布上可拖拽移动；眼睛图标控制显隐。',
        }),
      ]),
    });
    return this.blocksSection.root;
  }

  private buildBlockRow(block: Block): BlockRow {
    const iconWrap = h('span', { class: 'block-ico', html: icon(BLOCK_ICONS[block.id] ?? 'text', 14) });
    const name = h('span', { class: 'block-name', text: block.name });
    const preview = h('span', { class: 'block-preview mono', text: '' });
    const main = h('button', { class: 'block-main', attrs: { type: 'button' } }, [
      iconWrap,
      h('span', { class: 'block-texts' }, [name, preview]),
    ]);
    main.addEventListener('click', (event) => {
      this.editor.select(block.id, {
        additive: event.shiftKey || event.metaKey || event.ctrlKey,
      });
      this.editor.openInspectorForSelection();
    });

    const eye = iconButton({
      name: 'eye',
      label: `隐藏 ${block.name}`,
      className: 'block-eye',
    });
    eye.addEventListener('click', (event) => {
      event.stopPropagation();
      this.editor.toggleVisibility(block.id);
    });

    const row = h('div', { class: 'block-row' }, [main, eye]);
    const edit = h('div', { class: 'block-edit', hidden: true });
    let textarea: HTMLTextAreaElement | null = null;
    let logoImg: HTMLImageElement | null = null;

    if (block.type === 'text') {
      textarea = h('textarea', {
        class: 'input textarea block-textarea',
        attrs: {
          rows: 2,
          spellcheck: 'false',
          'aria-label': `${block.name}文本`,
          placeholder: '输入文本，支持换行',
        },
      });
      textarea.value = block.text;
      textarea.addEventListener('input', () => {
        this.editor.updateTextBlock(block.id, { text: textarea?.value ?? '' });
      });
      edit.append(
        textarea,
        h('p', { class: 'block-edit-hint mono', text: '内容即时生效 · 完整排版在右侧检查器' }),
      );
    } else {
      logoImg = h('img', { class: 'block-logo-img', attrs: { alt: '当前 Logo' } });
      if (block.src) logoImg.src = block.src;
      const replace = textButton('更换', {
        icon: 'upload',
        className: 'btn-small',
        onClick: () => this.logoInput.click(),
      });
      const remove = textButton('删除', {
        icon: 'trash',
        className: 'btn-small btn-danger-ghost',
        onClick: () => this.editor.removeLogo(),
      });
      edit.append(
        h('div', { class: 'block-logo-row' }, [logoImg]),
        h('div', { class: 'row-actions' }, [replace, remove]),
      );
    }

    const root = h('div', { class: 'block-item', data: { id: block.id } }, [row, edit]);
    const handle: BlockRow = { root, main, eye, iconWrap, name, preview, edit, textarea, logoImg };
    this.blockRows.set(block.id, handle);
    this.blockList.append(root);
    return handle;
  }

  private syncBlocks(state: EditorState): void {
    const blocks = state.config?.blocks ?? [];
    const key = blocks.map((block) => block.id).join('|');
    if (key !== this.blockKey) {
      this.blockKey = key;
      this.blockRows.clear();
      this.blockList.replaceChildren();
      for (const block of blocks) this.buildBlockRow(block);
    }
    const hasLogo = blocks.some((block) => block.type === 'logo');
    this.addLogoRow.hidden = hasLogo || !state.config;
    this.blocksSection.setBadge(blocks.length ? String(blocks.length) : null);

    const selectedIds = new Set(state.selectedIds);
    for (const block of blocks) {
      const row = this.blockRows.get(block.id);
      if (!row) continue;
      const selected = selectedIds.has(block.id);
      const primary = state.selectedId === block.id;
      toggleClass(row.root, 'is-selected', primary);
      toggleClass(row.root, 'is-selected-multi', selected && !primary);
      toggleClass(row.root, 'is-hidden', !block.visible);
      row.main.setAttribute('aria-pressed', String(selected));
      setText(row.name, block.name);
      if (block.type === 'text') {
        const flat = block.text.replace(/\n+/g, ' · ');
        setText(row.preview, flat || '（空）');
        if (row.textarea) setValue(row.textarea, block.text);
      } else {
        setText(row.preview, `PNG · ${percent(block.width, 1)}`);
        if (row.logoImg && row.logoImg.src !== block.src) row.logoImg.src = block.src;
      }
      row.eye.innerHTML = icon(block.visible ? 'eye' : 'eyeOff', 14);
      row.eye.setAttribute('aria-label', `${block.visible ? '隐藏' : '显示'} ${block.name}`);
      row.eye.setAttribute('aria-pressed', String(block.visible));
      const showEdit = primary && state.config !== null;
      if (row.edit.hidden === showEdit) row.edit.hidden = !showEdit;
    }
  }

  // ------------------------------------------------------------------ 水印

  private watermarkBlock(state: EditorState): Block | null {
    return state.config?.blocks.find((block) => block.id === 'watermark') ?? null;
  }

  private buildWatermarkSection(): SectionHandle {
    this.wmText = textareaField({
      label: '水印文字',
      value: '© muxiner',
      rows: 2,
      hint: '支持多行；输入即时反映到画布',
      onInput: (value) => {
        const block = this.watermarkBlock(this.editor.state);
        if (block) this.editor.updateTextBlock(block.id, { text: value });
      },
    });
    this.wmFont = segmentedField<FontFamily>({
      label: '字体',
      options: [
        { value: 'sans', label: FONT_LABELS.sans },
        { value: 'mono', label: FONT_LABELS.mono },
        { value: 'cjk', label: FONT_LABELS.cjk },
      ],
      value: 'sans',
      onChange: (value) => {
        const block = this.watermarkBlock(this.editor.state);
        // 选择内置字体时清空自定义字体引用（与检查器的字体下拉一致）。
        if (block) this.editor.updateTextBlock(block.id, { font: value, customFont: null }, { discrete: true });
      },
    });
    this.wmSize = sliderField({
      label: '字号',
      min: 0.5,
      max: 4,
      step: 0.02,
      value: 1,
      format: (value) => `${value.toFixed(2)}×`,
      ariaLabel: '水印字号',
      onInput: (value) => {
        const block = this.watermarkBlock(this.editor.state);
        if (block) this.editor.updateTextBlock(block.id, { size: value });
      },
    });
    this.wmColor = colorField({
      label: '颜色',
      value: '#1a1a18',
      onChange: (value) => {
        const block = this.watermarkBlock(this.editor.state);
        if (block) this.editor.updateTextBlock(block.id, { color: value });
      },
    });
    this.wmEmpty = h('p', { class: 'sec-note', text: '当前模板没有水印块。', hidden: true });

    return section({
      index: '04',
      title: '水印',
      open: true,
      body: h('div', {}, [
        this.wmEmpty,
        this.wmText.root,
        this.wmFont.root,
        this.wmSize.root,
        this.wmColor.root,
      ]),
    });
  }

  // ------------------------------------------------------------------ Logo

  private logoBlock(state: EditorState): Block | null {
    return state.config?.blocks.find((block) => block.type === 'logo') ?? null;
  }

  private buildFontSection(): SectionHandle {
    this.fontUploadButton = textButton('上传字体', {
      icon: 'upload',
      className: 'btn-block',
      title: '上传 .ttf / .otf 字体（≤8MB）',
      onClick: () => this.fontInput.click(),
    });
    this.fontList = h('div', { class: 'font-list', role: 'list', ariaLabel: '自定义字体' });
    this.fontEmpty = h('div', { class: 'font-empty' }, [
      h('span', { class: 'font-empty-ico', html: icon('text', 20) }),
      h('p', { class: 'font-empty-title', text: '还没有上传字体' }),
      h('p', { class: 'font-empty-hint', text: '上传 ttf / otf 后可在检查器「字体」中选择。' }),
    ]);

    this.fontSection = section({
      index: '05',
      title: '字体',
      open: true,
      body: h('div', {}, [
        this.fontInput,
        this.fontUploadButton,
        h('p', {
          class: 'sec-note',
          text: '支持 ttf / otf，≤8MB；网页端刷新后仍保留。上传时若选中文字块会自动应用。',
        }),
        this.fontEmpty,
        this.fontList,
      ]),
    });
    return this.fontSection;
  }

  private buildFontRow(font: CustomFontMeta): HTMLElement {
    const name = h('span', { class: 'font-name', text: font.name, title: font.name });
    const meta = h('span', {
      class: 'font-meta mono',
      text: `${formatFontSize(font.size)} · ${formatFontDate(font.addedAt)}`,
    });
    const remove = h('button', {
      class: 'font-delete',
      html: icon('close', 12),
      title: '删除字体',
      ariaLabel: `删除字体 ${font.name}`,
      attrs: { type: 'button' },
    });
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      void this.editor.deleteFont(font.id);
    });
    return h('div', { class: 'font-item', role: 'listitem' }, [
      h('div', { class: 'font-info' }, [name, meta]),
      remove,
    ]);
  }

  private syncFonts(state: EditorState): void {
    const key = state.customFonts
      .map((font) => `${font.id}:${font.name}:${font.size}:${font.addedAt}`)
      .join('|');
    if (key !== this.fontKey) {
      this.fontKey = key;
      this.fontRows.clear();
      this.fontList.replaceChildren();
      for (const font of state.customFonts) {
        const row = this.buildFontRow(font);
        this.fontRows.set(font.id, row);
        this.fontList.append(row);
      }
    }
    this.fontEmpty.hidden = state.customFonts.length > 0;
    this.fontList.hidden = state.customFonts.length === 0;
    this.fontSection.setBadge(state.customFonts.length > 0 ? String(state.customFonts.length) : null);
    if (this.fontBusy !== state.fontBusy) {
      this.fontBusy = state.fontBusy;
      this.fontUploadButton.disabled = state.fontBusy;
      const label = this.fontUploadButton.querySelector('span');
      if (label) setText(label, state.fontBusy ? '上传中…' : '上传字体');
    }
  }

  private buildLogoSection(): SectionHandle {
    this.logoEmpty = h(
      'button',
      {
        class: 'logo-drop',
        attrs: { type: 'button' },
        ariaLabel: '上传 Logo 图片',
      },
      [
        h('span', { class: 'logo-drop-ico', html: icon('upload', 18) }),
        h('strong', { text: '上传 PNG Logo' }),
        h('span', { class: 'logo-drop-hint', text: '透明背景效果最佳 · 自动缩至 800px' }),
      ],
    );
    this.logoEmpty.addEventListener('click', () => this.logoInput.click());

    this.logoPreviewImg = h('img', { class: 'logo-preview-img', attrs: { alt: 'Logo 预览' } });
    const replace = textButton('更换', {
      icon: 'upload',
      className: 'btn-small',
      onClick: () => this.logoInput.click(),
    });
    const remove = textButton('删除', {
      icon: 'trash',
      className: 'btn-small btn-danger-ghost',
      onClick: () => this.editor.removeLogo(),
    });
    this.logoWidth = sliderField({
      label: '宽度',
      min: 0.03,
      max: 0.4,
      step: 0.005,
      value: 0.14,
      format: (value) => percent(value, 1),
      ariaLabel: 'Logo 宽度',
      onInput: (value) => {
        const block = this.logoBlock(this.editor.state);
        if (block) this.editor.updateLogoBlock(block.id, { width: value });
      },
    });
    this.logoFilled = h('div', { class: 'logo-filled', hidden: true }, [
      h('div', { class: 'logo-preview' }, [this.logoPreviewImg]),
      h('div', { class: 'row-actions' }, [replace, remove]),
      this.logoWidth.root,
    ]);

    this.logoSection = section({
      index: '06',
      title: 'Logo',
      open: true,
      body: h('div', {}, [
        this.logoEmpty,
        this.logoFilled,
        h('p', { class: 'sec-note', text: '位置与不透明度在右侧检查器中调整。' }),
      ]),
    });
    return this.logoSection;
  }

  // ------------------------------------------------------------------ 更新

  private update(state: EditorState): void {
    toggleClass(this.root, 'is-open', state.leftOpen);

    // 照片
    if (state.photoThumb !== this.lastThumb) {
      this.lastThumb = state.photoThumb;
      if (state.photoThumb) this.photoThumb.src = state.photoThumb;
      else this.photoThumb.removeAttribute('src');
      toggleClass(this.photoThumb.parentElement ?? this.photoThumb, 'has-photo', Boolean(state.photoThumb));
    }
    const photo = state.photo;
    setText(
      this.photoBadge,
      photo ? `${photo.width} × ${photo.height}` : '—',
    );
    setText(this.photoName, state.photoName || '尚未载入照片');
    setText(
      this.photoSub,
      photo ? `${fileExt(state.photoName)} · 已载入渲染内核` : '拖入 / 粘贴多张照片开始',
    );
    this.photoEmpty.hidden = photo !== null;
    this.setExif('camera', photo?.exif.camera || '—');
    this.setExif('lens', photo?.exif.lens || '—');
    this.setExif('exposure', exposureLine(state));
    this.setExif('date', photo?.exif.date || '—');
    this.syncLibrary(state);
    const libraryCount = state.library.length;
    this.importButton.disabled = state.importing !== null || state.status === 'boot';
    this.batchModeField.setValue(state.sharedParams ? 'uniform' : 'separate');
    setText(
      this.batchModeNote,
      state.sharedParams
        ? '编辑同步到全部照片，EXIF 文本各自保留。'
        : '每张照片独立参数，可用下方按钮一次性同步。',
    );
    const showApplyAll = !state.sharedParams && libraryCount >= 2;
    this.applyAllButton.hidden = !showApplyAll;
    this.applyAllButton.disabled = !showApplyAll;
    setText(
      this.applyAllButton.querySelector('span') ?? this.applyAllButton,
      `应用当前参数到全部（${libraryCount} 张）`,
    );

    // 边框
    const config = state.config;
    const frame = config?.frame;
    const template = frame?.template ?? state.template;
    for (const [key, card] of this.templateCards) {
      const active = key === template;
      toggleClass(card, 'is-active', active);
      card.setAttribute('aria-pressed', String(active));
    }
    this.frameSection.setBadge(TEMPLATE_LABELS[template]);
    const hasFrame = frame !== undefined;
    const isNone = template === 'none';
    this.marginField.setDisabled(!hasFrame || isNone);
    this.bottomField.setDisabled(!hasFrame || isNone || template === 'black');
    this.backgroundField.setDisabled(!hasFrame || isNone);
    this.radiusField.setDisabled(!hasFrame || isNone);
    this.holesRow.hidden = template !== 'film';
    if (frame) {
      this.marginField.setValue(frame.margin);
      this.bottomField.setValue(frame.bottomRatio);
      this.backgroundField.setValue(frame.background);
      this.radiusField.setValue(frame.radius);
      this.holesField.setValue(frame.filmHoles);
      const photoShadow = frame.photoShadow;
      this.shadowToggle.setValue(photoShadow.enabled);
      this.shadowModeField.setValue(photoShadow.mode);
      this.shadowAngleField.setValue(photoShadow.angle);
      this.shadowDistanceField.setValue(photoShadow.distance);
      this.shadowBlurField.setValue(photoShadow.blur);
      this.shadowSpreadField.setValue(photoShadow.spread);
      this.shadowOpacityField.setValue(photoShadow.opacity);
      this.shadowColorField.setValue(photoShadow.color);
      this.shadowParams.hidden = !photoShadow.enabled;
    }
    for (const entry of this.brandCards) {
      entry.card.disabled = !hasFrame;
      toggleClass(entry.card, 'is-active', state.activeStyleId === entry.id);
    }
    if (frame) {
      this.photoScaleField.setValue(frame.photoTransform.scale);
      this.photoOffsetXField.setValue(frame.photoTransform.offsetX);
      this.photoOffsetYField.setValue(frame.photoTransform.offsetY);
    }
    this.photoScaleField.setDisabled(!hasFrame);
    this.photoOffsetXField.setDisabled(!hasFrame);
    this.photoOffsetYField.setDisabled(!hasFrame);
    this.photoDragToggle.setDisabled(!hasFrame);
    this.photoDragToggle.setValue(state.photoDragMode);
    const cameraBlock = config?.blocks.find(
      (block) => block.id === 'camera' && block.type === 'text',
    );
    if (cameraBlock && cameraBlock.type === 'text') {
      this.paramColorField.setValue(cameraBlock.color);
      this.paramWeightField.setValue(String(cameraBlock.weight) as '400' | '600' | '700');
    }
    this.paramColorField.setDisabled(!hasFrame);
    this.paramWeightField.setDisabled(!hasFrame);
    this.paramSizeField.setDisabled(!hasFrame);
    const watermarkVisible = config?.blocks.find(
      (block) => block.id === 'watermark' && block.type === 'text',
    );
    const hasBrandBlocks = config?.blocks.some((block) => block.id === 'tagline') ?? false;
    this.brandToggle.setDisabled(!hasBrandBlocks);
    this.brandTextDetails.hidden = !hasBrandBlocks;
    if (watermarkVisible && watermarkVisible.type === 'text') {
      this.brandToggle.setValue(watermarkVisible.visible);
      this.brandWordColorField.setValue(watermarkVisible.color);
      this.brandWordSizeField.setValue(watermarkVisible.size);
      this.brandWordFontField.setValue(watermarkVisible.font);
      this.brandWordColorField.setDisabled(!hasBrandBlocks);
      this.brandWordSizeField.setDisabled(!hasBrandBlocks);
      this.brandWordFontField.setDisabled(!hasBrandBlocks);
    }
    const taglineBlock = config?.blocks.find(
      (block) => block.id === 'tagline' && block.type === 'text',
    );
    if (taglineBlock && taglineBlock.type === 'text') {
      this.brandTagColorField.setValue(taglineBlock.color);
      this.brandTagSizeField.setValue(taglineBlock.size);
      this.brandTagFontField.setValue(taglineBlock.font);
      this.brandTagColorField.setDisabled(false);
      this.brandTagSizeField.setDisabled(false);
      this.brandTagFontField.setDisabled(false);
    } else {
      this.brandTagColorField.setDisabled(true);
      this.brandTagSizeField.setDisabled(true);
      this.brandTagFontField.setDisabled(true);
    }
    const background = frame?.background;
    for (const [id, chip] of this.themeButtons) {
      const theme = COLOR_THEMES.find((item) => item.id === id);
      const active =
        theme !== undefined &&
        cameraBlock?.type === 'text' &&
        cameraBlock.color === theme.paramColor &&
        watermarkVisible?.type === 'text' &&
        watermarkVisible.color === theme.brandColor &&
        background === theme.background;
      toggleClass(chip, 'is-active', active);
    }
    for (const [color, swatch] of this.paramSwatches) {
      toggleClass(swatch, 'is-active', cameraBlock?.type === 'text' && cameraBlock.color === color);
    }
    if (state.activeStyleId && state.activeStyleId !== this.paramLastStyleId) {
      this.paramBaseSizes = null;
      this.paramSizeField.setValue(1);
    }
    this.paramLastStyleId = state.activeStyleId;
    if (state.activePhotoId !== this.paramLastPhotoId) {
      this.paramBaseSizes = null;
      this.paramSizeField.setValue(1);
      this.paramLastPhotoId = state.activePhotoId;
    }

    // 内容块
    this.syncBlocks(state);

    // 字体
    this.syncFonts(state);

    // 水印
    const watermark = this.watermarkBlock(state);
    const hasWatermark = watermark !== null && watermark.type === 'text';
    this.wmEmpty.hidden = hasWatermark || state.config === null;
    this.wmText.setDisabled(!hasWatermark);
    this.wmFont.setDisabled(!hasWatermark);
    this.wmSize.setDisabled(!hasWatermark);
    this.wmColor.setDisabled(!hasWatermark);
    if (watermark && watermark.type === 'text') {
      this.wmText.setValue(watermark.text);
      this.wmFont.setValue(watermark.font);
      this.wmSize.setValue(watermark.size);
      this.wmColor.setValue(watermark.color);
    }

    // Logo
    const logo = this.logoBlock(state);
    this.logoSection.setBadge(logo ? '已添加' : null);
    this.logoEmpty.hidden = logo !== null;
    this.logoFilled.hidden = logo === null;
    if (logo && logo.type === 'logo') {
      if (logo.src !== this.lastLogoSrc) {
        this.lastLogoSrc = logo.src;
        this.logoPreviewImg.src = logo.src;
      }
      this.logoWidth.setValue(logo.width);
      this.logoWidth.setDisabled(false);
    } else {
      this.logoWidth.setDisabled(true);
      if (this.lastLogoSrc) {
        this.lastLogoSrc = '';
        this.logoPreviewImg.removeAttribute('src');
      }
    }
  }

  private setExif(key: string, value: string): void {
    const el = this.exifValues.get(key);
    if (el) setText(el, value);
  }
}
