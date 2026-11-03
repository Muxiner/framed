// 中央舞台：预览位图 + 独立 overlay（12×12 参考线、选中虚线框、拖拽/吸附）+ 悬浮工具条。
import { TEMPLATE_LABELS, type Block, type BlockRect } from '../types';
import { h, setAttr, setHidden, setText, toggleClass } from './dom';
import type { Editor, EditorState } from './editor';
import { iconButton } from './fields';
import { brandMark, icon } from './icons';
import { SAMPLES, sampleThumb, sampleUrl, type SampleId } from './samples';

interface DragState {
  pointerId: number;
  id: string;
  startClientX: number;
  startClientY: number;
  anchorX: number;
  anchorY: number;
  moved: boolean;
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

export class Stage {
  readonly root: HTMLElement;

  private readonly editor: Editor;
  private readonly scroll: HTMLElement;
  private readonly stack: HTMLElement;
  private readonly preview: HTMLCanvasElement;
  private readonly overlay: HTMLCanvasElement;
  private readonly empty: HTMLElement;
  private readonly loading: HTMLElement;
  private readonly dropVeil: HTMLElement;
  private readonly hud: HTMLElement;
  private readonly busy: HTMLElement;
  private readonly toolbar: HTMLElement;
  private readonly fitButton: HTMLButtonElement;
  private readonly zoomLabel: HTMLButtonElement;
  private readonly gridButton: HTMLButtonElement;
  private readonly snapButton: HTMLButtonElement;
  private readonly previewCtx: CanvasRenderingContext2D;

  private drag: DragState | null = null;
  private hoverId: string | null = null;
  private lastMeta: EditorState['meta'] = null;
  private lastBitmap: EditorState['bitmap'] = null;
  private lastConfig: EditorState['config'] = null;
  private lastSelected: string | null = null;
  private lastZoom: 'fit' | number = 'fit';

  constructor(editor: Editor) {
    this.editor = editor;

    this.preview = h('canvas', { class: 'canvas-preview', ariaHidden: true });
    this.overlay = h('canvas', {
      class: 'canvas-overlay',
      tabindex: 0,
      ariaLabel: '画布预览：拖拽移动选中元素，方向键微调',
    });
    const previewCtx = this.preview.getContext('2d');
    if (!previewCtx) throw new Error('Canvas 2D 不可用');
    this.previewCtx = previewCtx;

    this.stack = h('div', { class: 'canvas-stack' }, [this.preview, this.overlay]);
    this.scroll = h('div', { class: 'stage-scroll' }, [
      h('div', { class: 'stage-pad' }, [this.stack]),
    ]);

    this.empty = this.buildEmpty();
    this.loading = h('div', { class: 'stage-loading', hidden: true }, [
      h('div', { class: 'spinner', ariaHidden: true }),
      h('p', { class: 'stage-loading-text', text: '正在载入照片…' }),
    ]);
    this.dropVeil = h('div', { class: 'drop-veil', hidden: true }, [
      h('div', { class: 'drop-inner' }, [
        h('span', { class: 'drop-ico', html: icon('upload', 22) }),
        h('p', { text: '松开以载入照片' }),
        h('span', { class: 'drop-hint mono', text: 'JPEG / PNG / WebP / GIF / TIFF' }),
      ]),
    ]);
    this.hud = h('div', { class: 'stage-hud', hidden: true }, [
      h('span', { class: 'hud-dims mono' }),
      h('span', { class: 'hud-sep mono', text: '·' }),
      h('span', { class: 'hud-template mono' }),
    ]);
    this.busy = h('div', { class: 'stage-busy mono', hidden: true }, [
      h('span', { class: 'status-dot is-rendering' }),
      h('span', { text: '渲染中' }),
    ]);

    this.fitButton = iconButton({
      name: 'fit',
      label: '适应窗口',
      title: '适应窗口 (F)',
      onClick: () => this.editor.setZoom('fit'),
    });
    const zoomOut = iconButton({
      name: 'zoomOut',
      label: '缩小',
      title: '缩小',
      onClick: () => this.editor.zoomBy(1 / 1.25),
    });
    this.zoomLabel = h('button', {
      class: 'zoom-label mono',
      text: '适合',
      title: '点击适应窗口',
      ariaLabel: '当前缩放，点击适应窗口',
      attrs: { type: 'button' },
    });
    this.zoomLabel.addEventListener('click', () => this.editor.setZoom('fit'));
    const zoomIn = iconButton({
      name: 'zoomIn',
      label: '放大',
      title: '放大',
      onClick: () => this.editor.zoomBy(1.25),
    });
    this.gridButton = iconButton({
      name: 'grid',
      label: '12×12 参考线',
      title: '显示 12×12 参考线 (G)',
      onClick: () => this.editor.toggleGrid(),
    });
    this.snapButton = iconButton({
      name: 'magnet',
      label: '吸附 1/12 栅格',
      title: '吸附 1/12 栅格 (S)',
      onClick: () => this.editor.toggleSnap(),
    });
    this.toolbar = h('div', { class: 'stage-toolbar', role: 'toolbar', ariaLabel: '画布工具' }, [
      this.fitButton,
      h('span', { class: 'tool-divider' }),
      zoomOut,
      this.zoomLabel,
      zoomIn,
      h('span', { class: 'tool-divider' }),
      this.gridButton,
      this.snapButton,
    ]);

    this.root = h('section', { class: 'stage', ariaLabel: '画布舞台' }, [
      this.scroll,
      this.empty,
      this.loading,
      this.dropVeil,
      this.hud,
      this.busy,
      this.toolbar,
    ]);

    this.bindPointer();
    this.bindWheel();
    const observer = new ResizeObserver(() => this.layout());
    observer.observe(this.scroll);
    window.addEventListener('resize', () => this.layout());

    editor.subscribe((state) => this.update(state));
    this.layout();
  }

  // ------------------------------------------------------------------ 空状态

  private buildEmpty(): HTMLElement {
    const fileInput = h('input', {
      class: 'visually-hidden',
      attrs: { type: 'file', accept: 'image/*', tabindex: '-1' },
    });
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) void this.editor.loadPhoto(file);
      fileInput.value = '';
    });
    document.body.append(fileInput);

    const upload = h('button', {
      class: 'btn btn-accent btn-lg',
      html: `${icon('upload', 15)}<span>上传照片</span>`,
      attrs: { type: 'button' },
    });
    upload.addEventListener('click', () => fileInput.click());

    const useSample = h('button', {
      class: 'btn btn-lg',
      html: `${icon('image', 15)}<span>使用示例照片</span>`,
      attrs: { type: 'button' },
    });
    useSample.addEventListener('click', () => void this.editor.loadSample('mountain'));

    const chips = h('div', { class: 'empty-samples', role: 'group', ariaLabel: '示例照片' });
    for (const sample of SAMPLES) {
      const image = h('img', { attrs: { alt: '', loading: 'lazy' } });
      image.src = sampleUrl(sample.id);
      this.fallbackThumb(image, sample.id);
      const chip = h(
        'button',
        {
          class: 'sample-chip',
          title: `载入示例：${sample.label}`,
          attrs: { type: 'button' },
        },
        [
          image,
          h('span', { class: 'sample-chip-label mono', text: sample.sub }),
          h('span', { class: 'sample-chip-name', text: sample.label }),
        ],
      );
      chip.addEventListener('click', () => void this.editor.loadSample(sample.id));
      chips.append(chip);
    }

    return h('div', { class: 'stage-empty' }, [
      h('div', { class: 'empty-inner' }, [
        h('span', { class: 'empty-mark', html: brandMark(40) }),
        h('p', { class: 'empty-kicker mono', text: 'PHOTO → FRAME → WATERMARK' }),
        h('h1', { class: 'empty-title', text: '把照片放进暗房' }),
        h('p', {
          class: 'empty-desc',
          text: '框影为照片加上相机取景框、拍摄参数与文字水印。拖入一张照片，或先看看示例效果。',
        }),
        h('div', { class: 'empty-actions' }, [upload, useSample]),
        h('div', { class: 'empty-samples-wrap' }, [
          h('span', { class: 'empty-samples-label mono', text: '示例照片' }),
          chips,
        ]),
        h('p', {
          class: 'empty-hints mono',
          text: '拖拽 / 粘贴照片 · G 网格 · S 吸附 · 方向键微调',
        }),
      ]),
    ]);
  }

  private fallbackThumb(image: HTMLImageElement, id: SampleId): void {
    let fallback = false;
    image.addEventListener('error', () => {
      if (fallback) return;
      fallback = true;
      void sampleThumb(id).then((url) => {
        image.src = url;
      });
    });
  }

  // ------------------------------------------------------------------ 更新

  private update(state: EditorState): void {
    const meta = state.meta;
    const bitmap = state.bitmap;
    const metaChanged = meta !== this.lastMeta;
    const bitmapChanged = bitmap !== this.lastBitmap;
    const configChanged = state.config !== this.lastConfig;
    const selectionChanged = state.selectedId !== this.lastSelected;
    const zoomChanged = state.zoom !== this.lastZoom;

    if (metaChanged || bitmapChanged || zoomChanged) {
      this.layout();
    } else if (configChanged || selectionChanged) {
      this.drawOverlay();
    }

    this.lastMeta = meta;
    this.lastConfig = state.config;
    this.lastSelected = state.selectedId;
    this.lastZoom = state.zoom;

    // 空状态 / 载入中
    const showEmpty = state.status === 'empty' || state.status === 'boot';
    const showLoading =
      state.status === 'loading' ||
      (state.status === 'ready' && state.photo !== null && state.bitmap === null);
    setHidden(this.empty, !showEmpty);
    setHidden(this.loading, !showLoading);
    if (showLoading) {
      const label = this.loading.querySelector('.stage-loading-text');
      if (label) setText(label, state.sampleBusy ? '正在准备示例照片…' : '正在载入照片…');
    }
    setHidden(this.hud, !meta);
    setHidden(this.toolbar, !meta);
    setHidden(this.busy, !state.rendering || !meta);
    toggleClass(this.root, 'is-dragover', state.dragOver);
    setHidden(this.dropVeil, !state.dragOver);

    if (meta && state.config) {
      const dims = this.hud.querySelector('.hud-dims');
      const template = this.hud.querySelector('.hud-template');
      if (dims) setText(dims, `${meta.width} × ${meta.height} px`);
      if (template) {
        const label = TEMPLATE_LABELS[state.config.frame.template];
        const original = state.photo ? `原图 ${state.photo.width} × ${state.photo.height}` : '';
        setText(template, label);
        this.hud.title = original;
      }
    }

    // 工具条状态
    const hasConfig = state.config !== null;
    setAttr(this.fitButton, 'aria-pressed', String(state.zoom === 'fit'));
    toggleClass(this.fitButton, 'is-active', state.zoom === 'fit');
    setText(
      this.zoomLabel,
      state.zoom === 'fit' ? '适合' : `${Math.round((state.zoom as number) * 100)}%`,
    );
    this.fitButton.disabled = !meta;
    this.zoomLabel.disabled = !meta;
    for (const button of this.toolbar.querySelectorAll<HTMLButtonElement>('.icon-btn')) {
      if (button === this.gridButton || button === this.snapButton) continue;
      button.disabled = !meta;
    }
    const gridOn = state.config?.grid.visible ?? false;
    const snapOn = state.config?.grid.snap ?? false;
    setAttr(this.gridButton, 'aria-pressed', String(gridOn));
    toggleClass(this.gridButton, 'is-active', gridOn);
    setAttr(this.snapButton, 'aria-pressed', String(snapOn));
    toggleClass(this.snapButton, 'is-active', snapOn);
    this.gridButton.disabled = !hasConfig;
    this.snapButton.disabled = !hasConfig;
  }

  // ------------------------------------------------------------------ 布局与绘制

  private layout(): void {
    const state = this.editor.state;
    const meta = state.meta;
    if (!meta || !state.bitmap) return;
    const rect = this.scroll.getBoundingClientRect();
    const narrow = window.matchMedia('(max-width: 1099px)').matches;
    const padX = narrow ? 18 : 48;
    const padTop = narrow ? 24 : 32;
    const padBottom = narrow ? 78 : 96;
    const availableW = Math.max(80, rect.width - padX * 2);
    const availableH = Math.max(80, rect.height - padTop - padBottom);
    const fit = Math.min(availableW / meta.width, availableH / meta.height);
    this.editor.reportFitScale(fit);
    const scale = state.zoom === 'fit' ? fit : state.zoom;
    const width = Math.max(1, meta.width * scale);
    const height = Math.max(1, meta.height * scale);
    this.stack.style.width = `${width}px`;
    this.stack.style.height = `${height}px`;

    if (this.preview.width !== meta.width || this.preview.height !== meta.height) {
      this.preview.width = meta.width;
      this.preview.height = meta.height;
    }
    if (this.lastBitmap !== state.bitmap) {
      this.previewCtx.clearRect(0, 0, meta.width, meta.height);
      this.previewCtx.drawImage(state.bitmap, 0, 0, meta.width, meta.height);
      this.lastBitmap = state.bitmap;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = Math.round(width);
    const cssH = Math.round(height);
    if (this.overlay.width !== Math.round(cssW * dpr) || this.overlay.height !== Math.round(cssH * dpr)) {
      this.overlay.width = Math.round(cssW * dpr);
      this.overlay.height = Math.round(cssH * dpr);
    }
    const ctx = this.overlay.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    this.drawOverlayContent(ctx, cssW, cssH, scale);
  }

  private drawOverlay(): void {
    const state = this.editor.state;
    const meta = state.meta;
    if (!meta) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = this.overlay.width / dpr;
    const cssH = this.overlay.height / dpr;
    if (cssW <= 0 || cssH <= 0) return;
    const ctx = this.overlay.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    const scale = cssW / meta.width;
    this.drawOverlayContent(ctx, cssW, cssH, scale);
  }

  private drawOverlayContent(
    ctx: CanvasRenderingContext2D,
    cssW: number,
    cssH: number,
    scale: number,
  ): void {
    const state = this.editor.state;
    const config = state.config;
    const meta = state.meta;
    if (!config || !meta) return;

    if (config.grid.visible) {
      const stepX = cssW / 12;
      const stepY = cssH / 12;
      for (let i = 0; i <= 12; i += 1) {
        const accent = i % 3 === 0 ? 0.3 : 0.15;
        ctx.strokeStyle = `rgba(229, 181, 103, ${accent})`;
        ctx.lineWidth = 1;
        const x = Math.round(i * stepX) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, cssH);
        ctx.stroke();
        const y = Math.round(i * stepY) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(cssW, y);
        ctx.stroke();
      }
    }

    const rectById = new Map<string, BlockRect>();
    for (const rect of meta.blocks) rectById.set(rect.id, rect);

    for (const block of config.blocks) {
      if (!block.visible) continue;
      const source = rectById.get(block.id);
      if (!source) continue;
      const rect = this.blockRect(block, source, meta.width, meta.height);
      const isSelected = block.id === state.selectedId;
      const isHover = block.id === this.hoverId && !isSelected && !this.drag;
      if (!isSelected && !isHover) continue;
      const x = rect.x * scale;
      const y = rect.y * scale;
      const w = Math.max(1, rect.w * scale);
      const hgt = Math.max(1, rect.h * scale);

      ctx.save();
      if (isSelected) {
        if (this.drag?.id === block.id && config.grid.snap) {
          ctx.strokeStyle = 'rgba(229, 181, 103, 0.4)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(Math.round(block.x * cssW) + 0.5, 0);
          ctx.lineTo(Math.round(block.x * cssW) + 0.5, cssH);
          ctx.moveTo(0, Math.round(block.y * cssH) + 0.5);
          ctx.lineTo(cssW, Math.round(block.y * cssH) + 0.5);
          ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(229, 181, 103, 0.92)';
        ctx.lineWidth = 1.25;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(x + 0.5, y + 0.5, w, hgt);
        ctx.setLineDash([]);
        // 四角括线
        const arm = Math.min(7, w / 3, hgt / 3);
        ctx.strokeStyle = 'rgba(240, 201, 135, 0.98)';
        ctx.lineWidth = 1.5;
        const corners: [number, number, number, number][] = [
          [x, y, 1, 1],
          [x + w, y, -1, 1],
          [x, y + hgt, 1, -1],
          [x + w, y + hgt, -1, -1],
        ];
        for (const [cx, cy, sx, sy] of corners) {
          ctx.beginPath();
          ctx.moveTo(cx + sx * arm, cy);
          ctx.lineTo(cx, cy);
          ctx.lineTo(cx, cy + sy * arm);
          ctx.stroke();
        }
        // 名称标签
        const label = block.name || block.id;
        ctx.font = '500 10px ui-monospace, "SF Mono", "PingFang SC", monospace';
        const textWidth = ctx.measureText(label).width;
        const chipW = textWidth + 14;
        const chipH = 18;
        let chipX = Math.min(Math.max(x, 2), cssW - chipW - 2);
        let chipY = y - chipH - 6;
        if (chipY < 2) chipY = Math.min(y + 6, cssH - chipH - 2);
        roundRectPath(ctx, chipX, chipY, chipW, chipH, 4);
        ctx.fillStyle = 'rgba(13, 12, 11, 0.88)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(229, 181, 103, 0.4)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = 'rgba(240, 201, 135, 0.95)';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, chipX + 7, chipY + chipH / 2 + 0.5);
      } else {
        ctx.strokeStyle = 'rgba(239, 234, 225, 0.28)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(x + 0.5, y + 0.5, w, hgt);
        ctx.setLineDash([]);
      }
      ctx.restore();
    }
  }

  private blockRect(
    block: Block,
    source: BlockRect,
    metaWidth: number,
    metaHeight: number,
  ): { x: number; y: number; w: number; h: number } {
    const anchorX = block.x * metaWidth;
    const x =
      block.align === 'left'
        ? anchorX
        : block.align === 'center'
          ? anchorX - source.w / 2
          : anchorX - source.w;
    const anchorY = block.y * metaHeight;
    const y =
      block.alignY === 'top'
        ? anchorY
        : block.alignY === 'middle'
          ? anchorY - source.h / 2
          : anchorY - source.h;
    return { x, y, w: source.w, h: source.h };
  }

  // ------------------------------------------------------------------ 交互

  private imagePoint(event: PointerEvent): { x: number; y: number; scale: number } | null {
    const meta = this.editor.state.meta;
    if (!meta) return null;
    const rect = this.overlay.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: ((event.clientX - rect.left) / rect.width) * meta.width,
      y: ((event.clientY - rect.top) / rect.height) * meta.height,
      scale: rect.width / meta.width,
    };
  }

  private hitTest(x: number, y: number, scale: number): string | null {
    const state = this.editor.state;
    const meta = state.meta;
    const config = state.config;
    if (!meta || !config) return null;
    const tolerance = 5 / Math.max(0.05, scale);
    const rectById = new Map<string, BlockRect>();
    for (const rect of meta.blocks) rectById.set(rect.id, rect);
    for (let i = config.blocks.length - 1; i >= 0; i -= 1) {
      const block = config.blocks[i];
      if (!block || !block.visible) continue;
      const source = rectById.get(block.id);
      if (!source) continue;
      const rect = this.blockRect(block, source, meta.width, meta.height);
      if (
        x >= rect.x - tolerance &&
        x <= rect.x + rect.w + tolerance &&
        y >= rect.y - tolerance &&
        y <= rect.y + rect.h + tolerance
      ) {
        return block.id;
      }
    }
    return null;
  }

  private bindPointer(): void {
    const overlay = this.overlay;
    overlay.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const state = this.editor.state;
      if (!state.meta || !state.config) return;
      const point = this.imagePoint(event);
      if (!point) return;
      overlay.focus({ preventScroll: true });
      const hit = this.hitTest(point.x, point.y, point.scale);
      if (!hit) {
        this.editor.select(null);
        return;
      }
      const block = state.config.blocks.find((item) => item.id === hit);
      if (!block) return;
      this.editor.select(hit);
      this.drag = {
        pointerId: event.pointerId,
        id: hit,
        startClientX: event.clientX,
        startClientY: event.clientY,
        anchorX: block.x,
        anchorY: block.y,
        moved: false,
      };
      overlay.setPointerCapture(event.pointerId);
      overlay.classList.add('is-dragging');
      event.preventDefault();
    });

    overlay.addEventListener('pointermove', (event) => {
      const state = this.editor.state;
      if (!state.meta) return;
      if (this.drag && event.pointerId === this.drag.pointerId) {
        const rect = overlay.getBoundingClientRect();
        if (rect.width <= 0) return;
        const dx = (event.clientX - this.drag.startClientX) / rect.width;
        const dy = (event.clientY - this.drag.startClientY) / rect.height;
        if (Math.abs(dx) > 0.0005 || Math.abs(dy) > 0.0005) this.drag.moved = true;
        let x = this.drag.anchorX + dx;
        let y = this.drag.anchorY + dy;
        const grid = state.config?.grid;
        if (grid?.snap && !event.altKey) {
          x = Math.round(x * 12) / 12;
          y = Math.round(y * 12) / 12;
        }
        this.editor.setBlockPosition(this.drag.id, x, y);
        return;
      }
      const point = this.imagePoint(event);
      if (!point) return;
      const hit = this.hitTest(point.x, point.y, point.scale);
      if (hit !== this.hoverId) {
        this.hoverId = hit;
        overlay.style.cursor = hit ? 'grab' : 'default';
        this.drawOverlay();
      }
    });

    const endDrag = (event: PointerEvent): void => {
      if (!this.drag || event.pointerId !== this.drag.pointerId) return;
      this.drag = null;
      overlay.classList.remove('is-dragging');
      overlay.style.cursor = 'default';
      this.drawOverlay();
    };
    overlay.addEventListener('pointerup', endDrag);
    overlay.addEventListener('pointercancel', endDrag);
    overlay.addEventListener('pointerleave', () => {
      if (this.drag) return;
      if (this.hoverId !== null) {
        this.hoverId = null;
        this.drawOverlay();
      }
    });
    overlay.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  private bindWheel(): void {
    this.scroll.addEventListener(
      'wheel',
      (event) => {
        if (!(event.ctrlKey || event.metaKey)) return;
        if (!this.editor.state.meta) return;
        event.preventDefault();
        this.editor.zoomBy(event.deltaY < 0 ? 1.08 : 1 / 1.08);
      },
      { passive: false },
    );
  }
}
