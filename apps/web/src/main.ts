// 应用入口：组装三栏界面、启动引擎、全局快捷键、拖拽/粘贴、开发期演示参数。
import './style.css';
import type { FrameTemplate } from './types';
import { h, isTextInput } from './ui/dom';
import { Editor } from './ui/editor';
import { Inspector } from './ui/inspector';
import { LeftPanel } from './ui/left-panel';
import { Stage } from './ui/stage';
import { Topbar } from './ui/topbar';
import { brandMark } from './ui/icons';
import type { SampleId } from './ui/samples';
import { toast } from './ui/toast';

const editor = new Editor();
const topbar = new Topbar(editor);
const leftPanel = new LeftPanel(editor);
const stage = new Stage(editor);
const inspector = new Inspector(editor);

const backdrop = h('div', { class: 'drawer-backdrop', hidden: true });
backdrop.addEventListener('click', () => editor.closeDrawers());

const app = h('div', { class: 'app' }, [
  topbar.root,
  h('main', { class: 'workspace' }, [leftPanel.root, stage.root, inspector.root]),
  backdrop,
]);

const bootLayer = h('div', { class: 'boot-layer', role: 'status', ariaLive: 'polite' }, [
  h('div', { class: 'boot-mark', html: brandMark(46) }),
  h('p', { class: 'boot-title', text: '框影 FRAMED' }),
  h('p', { class: 'boot-sub mono', text: 'INITIALIZING RENDER CORE' }),
  h('div', { class: 'boot-track', ariaHidden: true }, [h('span', { class: 'boot-thumb' })]),
]);

const mount = document.getElementById('app');
if (mount) mount.replaceWith(app);
else document.body.append(app);
document.body.append(bootLayer);

editor.subscribe((state) => {
  const drawerOpen = state.leftOpen || state.inspectorOpen;
  backdrop.hidden = !drawerOpen;
  app.classList.toggle('is-drawer-open', drawerOpen);
  if (state.status !== 'boot' && !bootLayer.classList.contains('is-done')) {
    bootLayer.classList.add('is-done');
    window.setTimeout(() => bootLayer.remove(), 460);
  }
});

// --------------------------------------------------------------------------- 全局快捷键

const NUDGE_FINE = 1 / 144;
const NUDGE_COARSE = 1 / 12;

window.addEventListener('keydown', (event) => {
  // 模态弹层（预设等）自己处理 Esc / Tab，并屏蔽全局快捷键。
  if (document.body.classList.contains('modal-open')) return;
  const modifier = event.metaKey || event.ctrlKey;
  const key = event.key.toLowerCase();
  // 撤销 / 重做：输入框聚焦时也走应用级历史（先提交当前文字编辑再退一步）。
  if (modifier && key === 'z') {
    event.preventDefault();
    if (event.shiftKey) editor.redo();
    else editor.undo();
    return;
  }
  if (event.ctrlKey && key === 'y') {
    event.preventDefault();
    editor.redo();
    return;
  }
  if (modifier && key === 'e') {
    event.preventDefault();
    void editor.exportNow();
    return;
  }
  if (isTextInput(event.target)) {
    if (event.key === 'Enter') editor.endCoalescedEdit();
    if (event.key === 'Escape' && event.target instanceof HTMLElement) {
      editor.endCoalescedEdit();
      event.target.blur();
    }
    return;
  }
  if (modifier && key === 'a') {
    event.preventDefault();
    editor.selectAllText();
    return;
  }
  switch (event.key) {
    case 'Escape': {
      if (editor.state.exportOpen) editor.setExportOpen(false);
      else if (editor.state.leftOpen || editor.state.inspectorOpen) editor.closeDrawers();
      else if (editor.state.selectedId) editor.select(null);
      break;
    }
    case 'g':
    case 'G': {
      editor.toggleGrid();
      break;
    }
    case 's':
    case 'S': {
      editor.toggleSnap();
      break;
    }
    case 'f':
    case 'F': {
      editor.setZoom('fit');
      break;
    }
    case 'ArrowLeft':
    case 'ArrowRight':
    case 'ArrowUp':
    case 'ArrowDown': {
      const config = editor.state.config;
      if (!config) return;
      if (editor.state.selectedIds.length === 0 && !editor.state.selectedId) return;
      event.preventDefault();
      const step = event.shiftKey ? NUDGE_COARSE : NUDGE_FINE;
      const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
      const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
      editor.nudgeSelection(dx, dy);
      break;
    }
    default:
      break;
  }
});

// 连续编辑收束：滑杆/取色器释放、文本失焦时立即落一个历史步
document.addEventListener(
  'change',
  (event) => {
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    ) {
      editor.endCoalescedEdit();
    }
  },
  true,
);
window.addEventListener(
  'focusout',
  (event) => {
    if (isTextInput(event.target)) editor.endCoalescedEdit();
  },
  true,
);

// --------------------------------------------------------------------------- 拖拽 / 粘贴照片

let dragDepth = 0;

function hasFiles(event: DragEvent): boolean {
  const types = event.dataTransfer?.types;
  return types ? Array.from(types).includes('Files') : false;
}

function dragFileCount(event: DragEvent): number {
  const transfer = event.dataTransfer;
  if (!transfer) return 1;
  const items = transfer.items;
  if (items && items.length > 0) {
    let count = 0;
    for (const item of Array.from(items)) if (item.kind === 'file') count += 1;
    if (count > 0) return count;
  }
  return Math.max(1, transfer.files?.length ?? 1);
}

window.addEventListener('dragenter', (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  dragDepth += 1;
  editor.setDragOver(true, dragFileCount(event));
});
window.addEventListener('dragover', (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  editor.setDragOver(true, dragFileCount(event));
});
window.addEventListener('dragleave', (event) => {
  if (!hasFiles(event)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) editor.setDragOver(false);
});
window.addEventListener('drop', (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  dragDepth = 0;
  editor.setDragOver(false);
  const files = Array.from(event.dataTransfer?.files ?? []);
  if (files.length) void editor.importFiles(files);
});

window.addEventListener('paste', (event) => {
  const items = event.clipboardData?.items;
  if (!items) return;
  const files: File[] = [];
  for (const item of Array.from(items)) {
    if (!item.type.startsWith('image/')) continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  if (files.length === 0) return;
  event.preventDefault();
  void editor.importFiles(files);
});

// 跨断点时收起抽屉
window.matchMedia('(max-width: 1099px)').addEventListener('change', (event) => {
  if (!event.matches) editor.closeDrawers();
});

// --------------------------------------------------------------------------- 启动

const TEMPLATES: FrameTemplate[] = ['none', 'white', 'polaroid', 'film', 'black'];

function readTemplate(value: string | null): FrameTemplate | null {
  return value && (TEMPLATES as string[]).includes(value) ? (value as FrameTemplate) : null;
}

function readSample(value: string | null): SampleId {
  if (value === 'city' || value === 'portrait') return value;
  return 'mountain';
}

async function applyDemoParams(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const demo = params.get('demo');
  if (demo === null) return;
  const template = readTemplate(params.get('template'));
  if (template) await editor.setTemplate(template);
  await editor.loadSample(readSample(demo === '1' ? null : demo));
  if (params.get('grid') === '1') editor.setGrid({ visible: true });
  if (params.get('snap') === '0') editor.setGrid({ snap: false });
  const select = params.get('select');
  if (select) editor.select(select);
  const drawer = params.get('drawer');
  if (drawer === 'left') editor.toggleLeft();
  else if (drawer === 'inspector') editor.toggleInspector();
  const zoom = params.get('zoom');
  if (zoom) editor.setZoom(zoom === 'fit' ? 'fit' : Number(zoom) || 'fit');
}

async function boot(): Promise<void> {
  await editor.init();
  await applyDemoParams();
}

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason instanceof Error ? event.reason.message : String(event.reason ?? '');
  if (reason) toast(`渲染异常：${reason}`, 'error', 5200);
});

(window as Window & { __FRAMED__?: Editor }).__FRAMED__ = editor;

void boot();
