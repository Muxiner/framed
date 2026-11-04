// 平台相关的快捷键展示文案（仅用于 tooltip / 快捷键面板，不影响实际按键处理）。
const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
const platform = typeof navigator === 'undefined' ? '' : (navigator.platform ?? '');

export const IS_MAC =
  /Macintosh|Mac OS X|iPhone|iPad|iPod/i.test(userAgent) || /^Mac/i.test(platform);

export const MOD_KEY = IS_MAC ? '⌘' : 'Ctrl';
export const UNDO_SHORTCUT = IS_MAC ? '⌘Z' : 'Ctrl+Z';
export const REDO_SHORTCUT = IS_MAC ? '⇧⌘Z' : 'Ctrl+Shift+Z';
export const REDO_ALT_SHORTCUT = 'Ctrl+Y';
