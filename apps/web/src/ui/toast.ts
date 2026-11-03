// 轻量 toast：底部居中的暗房提示条。aria-live 保证读屏可感知。
import { h } from './dom';
import { icon } from './icons';

export type ToastKind = 'info' | 'success' | 'error';

interface ToastEntry {
  message: string;
  kind: ToastKind;
  el: HTMLElement;
  timer: number;
}

let container: HTMLElement | null = null;
const active: ToastEntry[] = [];
const MAX_VISIBLE = 3;

function ensureContainer(): HTMLElement {
  if (container) return container;
  container = h('div', {
    class: 'toasts',
    role: 'status',
    ariaLive: 'polite',
  });
  document.body.append(container);
  return container;
}

function remove(entry: ToastEntry): void {
  const index = active.indexOf(entry);
  if (index >= 0) active.splice(index, 1);
  entry.el.classList.add('is-leaving');
  window.setTimeout(() => entry.el.remove(), 200);
}

export function dismissToasts(): void {
  for (const entry of active.slice()) remove(entry);
}

export function toast(message: string, kind: ToastKind = 'info', duration = 3200): void {
  const root = ensureContainer();
  const existing = active.find((entry) => entry.message === message && entry.kind === kind);
  if (existing) {
    window.clearTimeout(existing.timer);
    existing.timer = window.setTimeout(() => remove(existing), duration);
    return;
  }

  const iconName = kind === 'error' ? 'warning' : kind === 'success' ? 'check' : 'info';
  const el = h('div', { class: `toast toast-${kind}`, role: 'status' }, [
    h('span', { class: 'toast-ico', html: icon(iconName, 14) }),
    h('span', { class: 'toast-msg', text: message }),
  ]);
  root.append(el);
  while (active.length >= MAX_VISIBLE) {
    const oldest = active[0];
    if (oldest) remove(oldest);
    else break;
  }
  const entry: ToastEntry = { message, kind, el, timer: 0 };
  entry.timer = window.setTimeout(() => remove(entry), duration);
  active.push(entry);
}
