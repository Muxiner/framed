// 照片库缩略图排序：Pointer Events 实现（鼠标 + 触摸长按），
// 只调整 library 顺序，不改 activePhotoId、不触发渲染、不进撤销历史。

type DragState = {
  pointerId: number;
  fromIndex: number;
  lastX: number;
  lastY: number;
  startX: number;
  startY: number;
  started: boolean;
  targetIndex: number;
  longPress: number;
  ghost: HTMLElement | null;
  line: HTMLElement | null;
  dragRoot: HTMLElement | null;
  cleanup?: () => void;
};

const DRAG_THRESHOLD = 6;
const TOUCH_HOLD_MS = 180;
const EDGE_SCROLL = 36;

export class LibraryReorder {
  private drag: DragState | null = null;
  private suppressClick = false;

  constructor(
    private readonly grid: HTMLElement,
    private readonly getEntries: () => Array<{ id: string; name: string }>,
    private readonly move: (fromIndex: number, toIndex: number) => void,
    private readonly focusItem: (id: string) => void,
  ) {}

  /** 每次重建缩略图时调用，绑定拖拽与键盘排序。 */
  register(id: string, root: HTMLElement, thumb: HTMLElement, name: string): void {
    thumb.setAttribute('aria-label', this.itemLabel(id, name));
    thumb.addEventListener('pointerdown', (event) => this.onPointerDown(event, id, root, thumb));
    thumb.addEventListener(
      'keydown',
      (event) => {
        if (!event.altKey) return;
        const entries = this.getEntries();
        const index = entries.findIndex((entry) => entry.id === id);
        if (index < 0) return;
        const delta =
          event.key === 'ArrowLeft' || event.key === 'ArrowUp'
            ? -1
            : event.key === 'ArrowRight' || event.key === 'ArrowDown'
              ? 1
              : 0;
        if (delta === 0) return;
        const to = Math.max(0, Math.min(entries.length - 1, index + delta));
        if (to === index) return;
        event.preventDefault();
        event.stopPropagation();
        this.move(index, to);
        window.requestAnimationFrame(() => this.focusItem(id));
      },
      { capture: true },
    );
  }

  /** 拖拽松手后紧跟着的 click 需要吞掉，避免误切换照片。 */
  consumeClickSuppress(): boolean {
    if (!this.suppressClick) return false;
    this.suppressClick = false;
    return true;
  }

  private itemLabel(id: string, name: string): string {
    const entries = this.getEntries();
    const index = entries.findIndex((entry) => entry.id === id);
    const total = entries.length;
    const hint = total > 1 ? '，可拖拽排序（Alt+左右方向键移动）' : '';
    return `${name}，第 ${index + 1} / ${total} 张${hint}`;
  }

  private onPointerDown(event: PointerEvent, id: string, root: HTMLElement, thumb: HTMLElement): void {
    if (this.drag) return;
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest('.library-remove')) return;
    const entries = this.getEntries();
    if (entries.length < 2) return;
    const fromIndex = entries.findIndex((entry) => entry.id === id);
    if (fromIndex < 0) return;

    const drag: DragState = {
      pointerId: event.pointerId,
      fromIndex,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      started: false,
      targetIndex: fromIndex,
      longPress: 0,
      ghost: null,
      line: null,
      dragRoot: root,
    };
    this.drag = drag;

    const moveHandler = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== drag.pointerId) return;
      this.onPointerMove(moveEvent, drag, thumb);
    };
    const upHandler = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== drag.pointerId) return;
      this.finishDrag(drag, true);
    };
    const cancelHandler = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId !== drag.pointerId) return;
      this.finishDrag(drag, false);
    };
    const keyHandler = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== 'Escape') return;
      this.finishDrag(drag, false);
    };

    drag.cleanup = () => {
      window.removeEventListener('pointermove', moveHandler);
      window.removeEventListener('pointerup', upHandler);
      window.removeEventListener('pointercancel', cancelHandler);
      window.removeEventListener('keydown', keyHandler, true);
      if (this.drag === drag) this.drag = null;
    };

    window.addEventListener('pointermove', moveHandler, { passive: false });
    window.addEventListener('pointerup', upHandler);
    window.addEventListener('pointercancel', cancelHandler);
    window.addEventListener('keydown', keyHandler, true);

    if (event.pointerType === 'touch') {
      drag.longPress = window.setTimeout(() => {
        if (this.drag === drag && !drag.started) this.startDrag(drag, thumb);
      }, TOUCH_HOLD_MS);
    }
  }

  private onPointerMove(event: PointerEvent, drag: DragState, thumb: HTMLElement): void {
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;

    if (!drag.started) {
      if (event.pointerType === 'touch') {
        // 触摸端：长按 180ms 后进入拖拽；短距离移动视为滚动/点击。
        if (drag.longPress === 0) return;
        if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 10) {
          this.startDrag(drag, thumb);
        }
      } else {
        if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_THRESHOLD) {
          return;
        }
        this.startDrag(drag, thumb);
      }
    }
    if (!drag.started) return;
    event.preventDefault();
    this.positionGhost(drag);
    this.updateDropTarget(drag);
    this.autoScroll(drag);
  }

  private startDrag(drag: DragState, thumb: HTMLElement): void {
    if (drag.started) return;
    drag.started = true;
    if (drag.longPress) {
      window.clearTimeout(drag.longPress);
      drag.longPress = 0;
    }
    drag.dragRoot?.classList.add('is-dragging');
    this.grid.classList.add('is-reordering');
    document.body.classList.add('is-photo-dragging');

    const rect = thumb.getBoundingClientRect();
    const ghost = document.createElement('div');
    ghost.className = 'library-ghost';
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    const img = thumb.querySelector('img');
    if (img) ghost.append(img.cloneNode(true));
    const label = document.createElement('span');
    label.className = 'library-ghost-name';
    label.textContent = thumb.getAttribute('title') ?? '';
    ghost.append(label);
    document.body.append(ghost);
    drag.ghost = ghost;

    const line = document.createElement('div');
    line.className = 'library-drop-line';
    this.grid.append(line);
    drag.line = line;

    this.positionGhost(drag);
    this.updateDropTarget(drag);
  }

  private positionGhost(drag: DragState): void {
    if (!drag.ghost) return;
    const width = drag.ghost.offsetWidth;
    const height = drag.ghost.offsetHeight;
    drag.ghost.style.transform = `translate(${drag.lastX - width / 2}px, ${drag.lastY - height / 2}px)`;
  }

  private updateDropTarget(drag: DragState): void {
    if (!drag.line) return;
    const gridRect = this.grid.getBoundingClientRect();
    const items = [...this.grid.querySelectorAll<HTMLElement>('.library-item')];
    if (items.length === 0) return;

    let insert = items.length;
    for (let index = 0; index < items.length; index += 1) {
      const rect = items[index]!.getBoundingClientRect();
      const beforeRow = drag.lastY < rect.top + rect.height / 2;
      const sameRowBefore = drag.lastY <= rect.bottom && drag.lastX < rect.left + rect.width / 2;
      if (beforeRow || sameRowBefore) {
        insert = index;
        break;
      }
    }
    const target = insert > drag.fromIndex ? insert - 1 : insert;
    drag.targetIndex = Math.max(0, Math.min(items.length - 1, target));

    const clamped = drag.targetIndex;
    items.forEach((item, index) => item.classList.toggle('is-drop-target', index === clamped));
    const targetRect = items[clamped]!.getBoundingClientRect();
    drag.line.style.left = `${targetRect.left - gridRect.left - 2}px`;
    drag.line.style.top = `${targetRect.top - gridRect.top}px`;
    drag.line.style.height = `${targetRect.height}px`;
  }

  private autoScroll(drag: DragState): void {
    const scroller = scrollParent(this.grid);
    if (!scroller) return;
    const rect = scroller.getBoundingClientRect();
    let delta = 0;
    if (drag.lastY < rect.top + EDGE_SCROLL) delta = -10;
    else if (drag.lastY > rect.bottom - EDGE_SCROLL) delta = 10;
    if (delta === 0) return;
    scroller.scrollBy({ top: delta });
    window.requestAnimationFrame(() => {
      if (this.drag === drag) this.updateDropTarget(drag);
    });
  }

  private finishDrag(drag: DragState, commit: boolean): void {
    if (drag.started) {
      const from = drag.fromIndex;
      const to = drag.targetIndex;
      drag.ghost?.remove();
      drag.line?.remove();
      drag.ghost = null;
      drag.line = null;
      drag.dragRoot?.classList.remove('is-dragging');
      this.grid.classList.remove('is-reordering');
      document.body.classList.remove('is-photo-dragging');
      this.grid
        .querySelectorAll('.library-item.is-drop-target')
        .forEach((item) => item.classList.remove('is-drop-target'));

      // 拖拽后的 click 不应触发切换照片。
      this.suppressClick = true;
      const consuming = this;
      window.setTimeout(() => {
        consuming.suppressClick = false;
      }, 0);
      this.cleanupDrag(drag);
      if (commit && to !== from) this.move(from, to);
      return;
    }
    this.cleanupDrag(drag);
  }

  private cleanupDrag(drag: DragState): void {
    if (drag.longPress) window.clearTimeout(drag.longPress);
    drag.longPress = 0;
    drag.cleanup?.();
  }
}

function scrollParent(element: HTMLElement): HTMLElement | null {
  let current = element.parentElement;
  while (current) {
    const style = window.getComputedStyle(current);
    if (/(auto|scroll)/.test(style.overflowY)) return current;
    current = current.parentElement;
  }
  return null;
}
