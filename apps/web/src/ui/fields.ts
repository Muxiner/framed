// 可复用的表单控件：分区、滑杆、颜色、分段选择、开关、数字输入、图标按钮。
// 每个控件句柄都提供 setValue/setDisabled 之类的增量更新方法，避免重建 DOM。
import { clamp, h, percent, setAttr, setText, setValue, toggleClass } from './dom';
import { icon } from './icons';

let uid = 0;
function nextId(prefix: string): string {
  uid += 1;
  return `${prefix}-${uid}`;
}

// --------------------------------------------------------------------------- 分区

export interface SectionHandle {
  root: HTMLElement;
  body: HTMLElement;
  setBadge(text: string | null): void;
}

export function section(opts: {
  index?: string;
  title: string;
  badge?: string;
  open?: boolean;
  body: HTMLElement;
}): SectionHandle {
  const id = nextId('sec');
  const badge = h('span', { class: 'sec-badge', text: opts.badge ?? '', hidden: !opts.badge });
  const chevron = h('span', { class: 'sec-chevron', html: icon('chevronDown', 12) });
  let open = opts.open !== false;

  const body = h('div', { class: 'sec-body', id }, [opts.body]);
  const toggle = h(
    'button',
    {
      class: 'sec-toggle',
      attrs: { type: 'button' },
      ariaLabel: `${opts.title}分区`,
      ariaExpanded: open,
    },
    [
      opts.index ? h('span', { class: 'sec-index mono', text: opts.index }) : null,
      h('span', { class: 'sec-title', text: opts.title }),
      badge,
      chevron,
    ],
  );
  const root = h('section', { class: 'sec' }, [h('div', { class: 'sec-head' }, [toggle]), body]);

  const apply = (): void => {
    toggleClass(root, 'is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    body.hidden = !open;
  };
  toggle.addEventListener('click', () => {
    open = !open;
    apply();
  });
  apply();

  return {
    root,
    body,
    setBadge(text: string | null) {
      setText(badge, text ?? '');
      badge.hidden = !text;
    },
  };
}

// --------------------------------------------------------------------------- 滑杆

export interface SliderOptions {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format?: (value: number) => string;
  ariaLabel?: string;
  hint?: string;
  onInput: (value: number) => void;
  onCommit?: (value: number) => void;
}

export interface SliderHandle {
  root: HTMLElement;
  setValue(value: number): void;
  setDisabled(disabled: boolean): void;
}

export function sliderField(opts: SliderOptions): SliderHandle {
  const id = nextId('range');
  const format = opts.format ?? ((value: number) => percent(value));
  const valueEl = h('span', { class: 'field-value mono', text: format(opts.value) });
  const input = h('input', {
    class: 'range',
    attrs: {
      id,
      type: 'range',
      min: opts.min,
      max: opts.max,
      step: opts.step,
      value: opts.value,
      'aria-label': opts.ariaLabel ?? opts.label,
    },
  });
  const root = h('div', { class: 'field' }, [
    h('div', { class: 'field-head' }, [
      h('label', { class: 'field-label', text: opts.label, attrs: { for: id } }),
      valueEl,
    ]),
    input,
    opts.hint ? h('p', { class: 'field-hint', text: opts.hint }) : null,
  ]);

  const paint = (value: number): void => {
    const ratio = (value - opts.min) / (opts.max - opts.min);
    input.style.setProperty('--fill', `${(clamp(ratio, 0, 1) * 100).toFixed(2)}%`);
    setText(valueEl, format(value));
    setAttr(input, 'aria-valuetext', format(value));
  };
  paint(opts.value);

  input.addEventListener('input', () => {
    const value = Number(input.value);
    if (!Number.isFinite(value)) return;
    paint(value);
    opts.onInput(value);
  });
  if (opts.onCommit) {
    input.addEventListener('change', () => opts.onCommit?.(Number(input.value)));
  }
  input.addEventListener('dblclick', () => {
    /* 双击滑杆不做额外行为，保留系统默认 */
  });

  return {
    root,
    setValue(value: number) {
      if (document.activeElement !== input) {
        const text = String(value);
        if (input.value !== text) input.value = text;
        paint(value);
      }
    },
    setDisabled(disabled: boolean) {
      if (input.disabled !== disabled) input.disabled = disabled;
      toggleClass(root, 'is-disabled', disabled);
    },
  };
}

// --------------------------------------------------------------------------- 颜色

export interface ColorOptions {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
}

export interface ColorHandle {
  root: HTMLElement;
  setValue(value: string): void;
  setDisabled(disabled: boolean): void;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

export function colorField(opts: ColorOptions): ColorHandle {
  const id = nextId('color');
  const swatchInput = h('input', {
    attrs: { type: 'color', value: opts.value, 'aria-label': `${opts.label}（取色器）` },
  });
  const hexInput = h('input', {
    class: 'input input-hex mono',
    attrs: {
      type: 'text',
      value: opts.value,
      maxlength: 7,
      spellcheck: 'false',
      'aria-label': `${opts.label}（十六进制）`,
      autocomplete: 'off',
    },
  });
  const swatch = h('label', { class: 'color-swatch', attrs: { for: id } }, [swatchInput]);
  swatchInput.id = id;
  const root = h('div', { class: 'field' }, [
    h('div', { class: 'field-head' }, [
      h('span', { class: 'field-label', text: opts.label }),
    ]),
    h('div', { class: 'color-row' }, [swatch, hexInput]),
    opts.hint ? h('p', { class: 'field-hint', text: opts.hint }) : null,
  ]);

  const paint = (value: string): void => {
    swatch.style.setProperty('--swatch', value);
    if (document.activeElement !== swatchInput) swatchInput.value = value;
    if (document.activeElement !== hexInput && hexInput.value !== value) hexInput.value = value;
  };
  paint(opts.value);

  swatchInput.addEventListener('input', () => {
    const value = swatchInput.value;
    paint(value);
    opts.onChange(value);
  });
  const commitHex = (): void => {
    const raw = hexInput.value.trim();
    const normalized = raw.startsWith('#') ? raw : `#${raw}`;
    if (HEX.test(normalized)) {
      paint(normalized.toLowerCase());
      opts.onChange(normalized.toLowerCase());
    } else {
      hexInput.value = opts.value;
    }
  };
  hexInput.addEventListener('blur', commitHex);
  hexInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      commitHex();
      hexInput.blur();
    }
  });

  return {
    root,
    setValue(value: string) {
      if (document.activeElement === hexInput) return;
      paint(value);
    },
    setDisabled(disabled: boolean) {
      swatchInput.disabled = disabled;
      hexInput.disabled = disabled;
      toggleClass(root, 'is-disabled', disabled);
    },
  };
}

// --------------------------------------------------------------------------- 分段选择

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: string;
  title?: string;
}

export interface SegmentedOptions<T extends string> {
  label?: string;
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
  iconOnly?: boolean;
  compact?: boolean;
}

export interface SegmentedHandle<T extends string> {
  root: HTMLElement;
  setValue(value: T): void;
  setDisabled(disabled: boolean): void;
}

export function segmentedField<T extends string>(opts: SegmentedOptions<T>): SegmentedHandle<T> {
  const buttons = new Map<T, HTMLButtonElement>();
  const group = h('div', {
    class: `segmented${opts.iconOnly ? ' is-icon-only' : ''}${opts.compact ? ' is-compact' : ''}`,
    role: 'group',
    ariaLabel: opts.ariaLabel ?? opts.label ?? '选项',
  });
  for (const option of opts.options) {
    const content = `${option.icon ? icon(option.icon, 14) : ''}${opts.iconOnly ? '' : `<span>${option.label}</span>`}`;
    const button = h('button', {
      class: 'segmented-btn',
      html: content,
      title: option.title ?? option.label,
      attrs: { type: 'button', 'aria-label': option.label },
      ariaPressed: option.value === opts.value,
    });
    button.addEventListener('click', () => {
      opts.onChange(option.value);
    });
    buttons.set(option.value, button);
    group.append(button);
  }
  const root = opts.label
    ? h('div', { class: 'field' }, [
        h('div', { class: 'field-head' }, [h('span', { class: 'field-label', text: opts.label })]),
        group,
      ])
    : group;

  const apply = (value: T): void => {
    for (const [key, button] of buttons) {
      const active = key === value;
      toggleClass(button, 'is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  };
  apply(opts.value);

  return {
    root,
    setValue: apply,
    setDisabled(disabled: boolean) {
      for (const button of buttons.values()) button.disabled = disabled;
      toggleClass(group, 'is-disabled', disabled);
    },
  };
}

// --------------------------------------------------------------------------- 开关

export interface ToggleOptions {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
  ariaLabel?: string;
}

export interface ToggleHandle {
  root: HTMLElement;
  setValue(checked: boolean): void;
  setDisabled(disabled: boolean): void;
}

export function toggleField(opts: ToggleOptions): ToggleHandle {
  const button = h(
    'button',
    {
      class: 'switch',
      role: 'switch',
      ariaChecked: opts.checked,
      ariaLabel: opts.ariaLabel ?? opts.label,
      attrs: { type: 'button' },
    },
    [h('span', { class: 'switch-knob' })],
  );
  const root = h('div', { class: 'field field-toggle' }, [
    h('div', { class: 'field-head' }, [
      h('span', { class: 'field-label', text: opts.label }),
      button,
    ]),
    opts.hint ? h('p', { class: 'field-hint', text: opts.hint }) : null,
  ]);
  const apply = (checked: boolean): void => {
    button.setAttribute('aria-checked', String(checked));
    toggleClass(button, 'is-on', checked);
  };
  apply(opts.checked);
  button.addEventListener('click', () => {
    const next = button.getAttribute('aria-checked') !== 'true';
    apply(next);
    opts.onChange(next);
  });
  return {
    root,
    setValue(checked: boolean) {
      apply(checked);
    },
    setDisabled(disabled: boolean) {
      button.disabled = disabled;
      toggleClass(root, 'is-disabled', disabled);
    },
  };
}

// --------------------------------------------------------------------------- 数字输入

export interface NumberFieldOptions {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  digits?: number;
  suffix?: string;
  ariaLabel?: string;
  onChange: (value: number) => void;
}

export interface NumberFieldHandle {
  root: HTMLElement;
  setValue(value: number): void;
}

export function numberField(opts: NumberFieldOptions): NumberFieldHandle {
  const id = nextId('num');
  const digits = opts.digits ?? 3;
  const input = h('input', {
    class: 'input num-input mono',
    attrs: {
      id,
      type: 'number',
      value: opts.value.toFixed(digits),
      min: opts.min ?? 0,
      max: opts.max ?? 1,
      step: opts.step ?? 0.001,
      inputmode: 'decimal',
      'aria-label': opts.ariaLabel ?? opts.label,
    },
  });
  const root = h('div', { class: 'field field-inline' }, [
    h('label', { class: 'field-label', text: opts.label, attrs: { for: id } }),
    h('div', { class: 'num-wrap' }, [
      input,
      opts.suffix ? h('span', { class: 'num-suffix mono', text: opts.suffix }) : null,
    ]),
  ]);
  input.addEventListener('input', () => {
    const value = Number(input.value);
    if (!Number.isFinite(value)) return;
    const min = opts.min ?? 0;
    const max = opts.max ?? 1;
    opts.onChange(clamp(value, min, max));
  });
  input.addEventListener('blur', () => {
    const value = clamp(Number(input.value) || 0, opts.min ?? 0, opts.max ?? 1);
    input.value = value.toFixed(digits);
    opts.onChange(value);
  });
  return {
    root,
    setValue(value: number) {
      if (document.activeElement === input) return;
      const text = value.toFixed(digits);
      if (input.value !== text) input.value = text;
    },
  };
}

// --------------------------------------------------------------------------- 下拉选择

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

export interface SelectFieldOptions<T extends string> {
  label: string;
  options: SelectOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
}

export interface SelectHandle<T extends string> {
  root: HTMLElement;
  setValue(value: T): void;
}

export function selectField<T extends string>(opts: SelectFieldOptions<T>): SelectHandle<T> {
  const id = nextId('select');
  const select = h('select', {
    class: 'input select',
    attrs: { id, 'aria-label': opts.ariaLabel ?? opts.label },
  });
  for (const option of opts.options) {
    select.append(h('option', { text: option.label, attrs: { value: option.value } }));
  }
  select.value = opts.value;
  select.addEventListener('change', () => opts.onChange(select.value as T));
  const root = h('div', { class: 'field field-inline' }, [
    h('label', { class: 'field-label', text: opts.label, attrs: { for: id } }),
    select,
  ]);
  return {
    root,
    setValue(value: T) {
      if (document.activeElement === select) return;
      if (select.value !== value) select.value = value;
    },
  };
}

// --------------------------------------------------------------------------- 多行文本

export interface TextAreaOptions {
  label: string;
  value: string;
  rows?: number;
  placeholder?: string;
  hint?: string;
  ariaLabel?: string;
  onInput: (value: string) => void;
}

export interface TextAreaHandle {
  root: HTMLElement;
  input: HTMLTextAreaElement;
  setValue(value: string): void;
  setDisabled(disabled: boolean): void;
}

export function textareaField(opts: TextAreaOptions): TextAreaHandle {
  const id = nextId('ta');
  const input = h('textarea', {
    class: 'input textarea',
    attrs: {
      id,
      rows: opts.rows ?? 2,
      placeholder: opts.placeholder ?? '',
      spellcheck: 'false',
      'aria-label': opts.ariaLabel ?? opts.label,
    },
  });
  input.value = opts.value;
  input.addEventListener('input', () => opts.onInput(input.value));
  const root = h('div', { class: 'field' }, [
    h('div', { class: 'field-head' }, [
      h('label', { class: 'field-label', text: opts.label, attrs: { for: id } }),
    ]),
    input,
    opts.hint ? h('p', { class: 'field-hint', text: opts.hint }) : null,
  ]);
  return {
    root,
    input,
    setValue(value: string) {
      if (document.activeElement === input) return;
      if (input.value !== value) input.value = value;
    },
    setDisabled(disabled: boolean) {
      input.disabled = disabled;
      toggleClass(root, 'is-disabled', disabled);
    },
  };
}

// --------------------------------------------------------------------------- 图标按钮

export interface IconButtonOptions {
  name: string;
  label: string;
  title?: string;
  className?: string;
  onClick?: (event: MouseEvent) => void;
  size?: number;
}

export function iconButton(opts: IconButtonOptions): HTMLButtonElement {
  const button = h('button', {
    class: `icon-btn${opts.className ? ` ${opts.className}` : ''}`,
    html: icon(opts.name, opts.size ?? 16),
    title: opts.title ?? opts.label,
    ariaLabel: opts.label,
    attrs: { type: 'button' },
  });
  if (opts.onClick) button.addEventListener('click', (event) => opts.onClick?.(event));
  return button;
}

export function textButton(
  label: string,
  opts: { className?: string; icon?: string; onClick?: (event: MouseEvent) => void; title?: string } = {},
): HTMLButtonElement {
  const button = h('button', {
    class: `btn${opts.className ? ` ${opts.className}` : ''}`,
    html: `${opts.icon ? icon(opts.icon, 14) : ''}<span>${label}</span>`,
    title: opts.title ?? label,
    attrs: { type: 'button' },
  });
  if (opts.onClick) button.addEventListener('click', (event) => opts.onClick?.(event));
  return button;
}

/** 用同一套 setValue 语义更新 range（颜色输入等）——集中在这里避免重复。 */
export function setInputValue(el: HTMLInputElement, value: string): void {
  setValue(el, value);
}
