// 极简 DOM 工具：无运行时框架，靠这里的小助手构建与增量更新界面。
// 原则：构建后只做局部更新，绝不整树重建输入控件（避免丢焦点）。

export type Child = Node | string | number | null | undefined | false;

export interface ElAttrs {
  class?: string;
  id?: string;
  text?: string;
  html?: string;
  title?: string;
  role?: string;
  tabindex?: number;
  hidden?: boolean;
  ariaLabel?: string;
  ariaPressed?: boolean | string;
  ariaExpanded?: boolean;
  ariaChecked?: boolean | string;
  ariaSelected?: boolean;
  ariaHidden?: boolean;
  ariaLive?: 'polite' | 'assertive' | 'off';
  ariaControls?: string;
  data?: Record<string, string>;
  style?: Record<string, string>;
  on?: Record<string, EventListener>;
  attrs?: Record<string, string | number | boolean | null | undefined>;
  children?: Child[];
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: ElAttrs = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs.class) el.className = attrs.class;
  if (attrs.id) el.id = attrs.id;
  if (attrs.title !== undefined) el.title = attrs.title;
  if (attrs.role) el.setAttribute('role', attrs.role);
  if (attrs.tabindex !== undefined) el.tabIndex = attrs.tabindex;
  if (attrs.hidden) el.hidden = true;
  if (attrs.text !== undefined) el.textContent = attrs.text;
  if (attrs.html !== undefined) el.innerHTML = attrs.html;

  if (attrs.ariaLabel) el.setAttribute('aria-label', attrs.ariaLabel);
  if (attrs.ariaPressed !== undefined) {
    el.setAttribute('aria-pressed', attrs.ariaPressed === true ? 'true' : attrs.ariaPressed === false ? 'false' : attrs.ariaPressed);
  }
  if (attrs.ariaExpanded !== undefined) el.setAttribute('aria-expanded', String(attrs.ariaExpanded));
  if (attrs.ariaChecked !== undefined) {
    el.setAttribute('aria-checked', attrs.ariaChecked === true ? 'true' : attrs.ariaChecked === false ? 'false' : attrs.ariaChecked);
  }
  if (attrs.ariaSelected !== undefined) el.setAttribute('aria-selected', String(attrs.ariaSelected));
  if (attrs.ariaHidden !== undefined) el.setAttribute('aria-hidden', String(attrs.ariaHidden));
  if (attrs.ariaLive) el.setAttribute('aria-live', attrs.ariaLive);
  if (attrs.ariaControls) el.setAttribute('aria-controls', attrs.ariaControls);

  if (attrs.data) for (const [key, value] of Object.entries(attrs.data)) el.dataset[key] = value;
  if (attrs.style) {
    for (const [key, value] of Object.entries(attrs.style)) el.style.setProperty(key, value);
  }
  if (attrs.attrs) {
    for (const [key, value] of Object.entries(attrs.attrs)) {
      if (value === null || value === undefined || value === false) el.removeAttribute(key);
      else el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  if (attrs.on) {
    for (const [type, fn] of Object.entries(attrs.on)) el.addEventListener(type, fn);
  }
  if (children.length) append(el, children);
  return el;
}

export function append(parent: Element, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function setText(el: Element, value: string): void {
  if (el.textContent !== value) el.textContent = value;
}

export function setHidden(el: HTMLElement, hidden: boolean): void {
  if (el.hidden !== hidden) el.hidden = hidden;
}

export function setAttr(el: Element, name: string, value: string | null): void {
  if (value === null) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  } else if (el.getAttribute(name) !== value) {
    el.setAttribute(name, value);
  }
}

export function toggleClass(el: Element, name: string, on: boolean): void {
  if (el.classList.contains(name) !== on) el.classList.toggle(name, on);
}

/** 只在值变化且控件未聚焦时写入，避免打断输入光标 / range 拖拽。 */
export function setValue(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
): void {
  if (document.activeElement === el) return;
  if (el.value !== value) el.value = value;
}

export function setChecked(el: HTMLInputElement, checked: boolean): void {
  if (el.checked !== checked) el.checked = checked;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** 0.045 -> "4.5%"; 1 -> "100%" */
export function percent(value: number, digits = 1): string {
  const scaled = value * 100;
  const text = scaled.toFixed(digits);
  return `${text.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')}%`;
}

export function fixed(value: number, digits = 2): string {
  return value.toFixed(digits);
}

export function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
