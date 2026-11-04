// 内联 SVG 图标：16×16 线性图标，1.5 描边。全部装饰性（aria-hidden），
// 语义交给按钮的 aria-label。

const STROKE = 'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';

const PATHS: Record<string, string> = {
  upload: `<path d="M8 10.6V2.5" ${STROKE}/><path d="m4.9 5.4 3.1-2.9 3.1 2.9" ${STROKE}/><path d="M2.6 10.1v2.4c0 .6.4 1 1 1h8.8c.6 0 1-.4 1-1v-2.4" ${STROKE}/>`,
  download: `<path d="M8 2.5v8.1" ${STROKE}/><path d="m4.9 7.6 3.1 3 3.1-3" ${STROKE}/><path d="M2.6 10.6v1.9c0 .6.4 1 1 1h8.8c.6 0 1-.4 1-1v-1.9" ${STROKE}/>`,
  image: `<rect x="2.2" y="3.2" width="11.6" height="9.6" rx="1.4" ${STROKE}/><circle cx="5.6" cy="6.4" r="1.1" ${STROKE}/><path d="m3.2 11.6 3.1-3 2.4 2.2 1.7-1.6 2.4 2.4" ${STROKE}/>`,
  camera: `<path d="M2.2 5.3h2.1l1-1.6h5.4l1 1.6h2.1v7.1H2.2Z" ${STROKE}/><circle cx="8" cy="8.6" r="2.4" ${STROKE}/>`,
  calendar: `<rect x="2.4" y="3.4" width="11.2" height="10.2" rx="1.2" ${STROKE}/><path d="M2.4 6.6h11.2M5.4 2.2v2.4M10.6 2.2v2.4" ${STROKE}/>`,
  text: `<path d="M2.6 4.2V2.6h10.8v1.6M8 2.6v10.8M5.8 13.4h4.4" ${STROKE}/>`,
  logo: `<path d="m8 1.9 1.9 4 4.3.6-3.1 3 .8 4.3L8 11.8l-3.9 2 .8-4.3-3.1-3 4.3-.6Z" ${STROKE}/>`,
  eye: `<path d="M1.9 8s2.3-4.1 6.1-4.1S14.1 8 14.1 8s-2.3 4.1-6.1 4.1S1.9 8 1.9 8Z" ${STROKE}/><circle cx="8" cy="8" r="1.85" ${STROKE}/>`,
  eyeOff: `<path d="M2.3 2.4 13.7 13.6" ${STROKE}/><path d="M6.2 4.2c.6-.2 1.2-.3 1.8-.3 3.8 0 6.1 4.1 6.1 4.1a11 11 0 0 1-1.9 2.3M4.3 5.1A11.6 11.6 0 0 0 1.9 8s2.3 4.1 6.1 4.1c1 0 1.9-.3 2.7-.7" ${STROKE}/>`,
  chevronDown: `<path d="m4.2 6.1 3.8 3.8 3.8-3.8" ${STROKE}/>`,
  chevronRight: `<path d="m6.1 4.2 3.8 3.8-3.8 3.8" ${STROKE}/>`,
  chevronLeft: `<path d="m9.9 4.2-3.8 3.8 3.8 3.8" ${STROKE}/>`,
  close: `<path d="M3.8 3.8l8.4 8.4M12.2 3.8l-8.4 8.4" ${STROKE}/>`,
  grid: `<rect x="2.4" y="2.4" width="11.2" height="11.2" rx="1.1" ${STROKE}/><path d="M2.4 6.1h11.2M2.4 9.9h11.2M6.1 2.4v11.2M9.9 2.4v11.2" ${STROKE}/>`,
  magnet: `<path d="M3.3 3.2v5a4.7 4.7 0 0 0 9.4 0v-5" ${STROKE}/><path d="M3.3 6.4h3.5M9.2 6.4h3.5" ${STROKE}/>`,
  fit: `<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" ${STROKE}/>`,
  zoomIn: `<circle cx="7" cy="7" r="4.4" ${STROKE}/><path d="m10.3 10.3 3.3 3.3M5 7h4M7 5v4" ${STROKE}/>`,
  zoomOut: `<circle cx="7" cy="7" r="4.4" ${STROKE}/><path d="m10.3 10.3 3.3 3.3M5 7h4" ${STROKE}/>`,
  plus: `<path d="M8 2.8v10.4M2.8 8h10.4" ${STROKE}/>`,
  trash: `<path d="M3 4.4h10M5.9 4.4V2.9h4.2v1.5M4.5 4.4l.6 9.1h5.8l.6-9.1" ${STROKE}/><path d="M6.7 7v4M9.3 7v4" ${STROKE}/>`,
  check: `<path d="m3.4 8.4 3 3 6.2-6.8" ${STROKE}/>`,
  sliders: `<path d="M2.5 4.6h11M2.5 8h11M2.5 11.4h11" ${STROKE}/><circle cx="5.7" cy="4.6" r="1.5" fill="currentColor"/><circle cx="10.3" cy="8" r="1.5" fill="currentColor"/><circle cx="6.8" cy="11.4" r="1.5" fill="currentColor"/>`,
  panelLeft: `<rect x="2.3" y="2.6" width="11.4" height="10.8" rx="1.2" ${STROKE}/><path d="M6.3 2.6v10.8" ${STROKE}/>`,
  panelRight: `<rect x="2.3" y="2.6" width="11.4" height="10.8" rx="1.2" ${STROKE}/><path d="M9.7 2.6v10.8" ${STROKE}/>`,
  refresh: `<path d="M13.2 8A5.2 5.2 0 1 1 11.5 4" ${STROKE}/><path d="M13.6 2.6v3.6H10" ${STROKE}/>`,
  arrowUp: `<path d="M8 3.2 12.6 11H3.4Z" fill="currentColor"/>`,
  arrowDown: `<path d="M8 12.8 3.4 5h9.2Z" fill="currentColor"/>`,
  arrowLeft: `<path d="M3.2 8 11 3.4v9.2Z" fill="currentColor"/>`,
  arrowRight: `<path d="M12.8 8 5 12.6V3.4Z" fill="currentColor"/>`,
  undo: `<path d="M6.2 3.9 2.7 7.4l3.5 3.5" ${STROKE}/><path d="M3 7.4h6.1a3.9 3.9 0 0 1 0 7.8H6.2" ${STROKE}/>`,
  redo: `<path d="M9.8 3.9l3.5 3.5-3.5 3.5" ${STROKE}/><path d="M13 7.4H6.9a3.9 3.9 0 0 0 0 7.8h2.9" ${STROKE}/>`,
  alignLeft: `<path d="M2.5 3.4h11M2.5 8h6.8M2.5 12.6h8.8" ${STROKE}/>`,
  alignCenter: `<path d="M2.5 3.4h11M4.6 8h6.8M3.6 12.6h8.8" ${STROKE}/>`,
  alignRight: `<path d="M2.5 3.4h11M6.7 8h6.8M4.7 12.6h8.8" ${STROKE}/>`,
  alignTop: `<path d="M3.4 2.5v11M8 2.5v6.8M12.6 2.5v8.8" ${STROKE}/>`,
  alignMiddle: `<path d="M3.4 2.5v11M8 4.6v6.8M12.6 3.6v8.8" ${STROKE}/>`,
  alignBottom: `<path d="M3.4 2.5v11M8 6.7v6.8M12.6 4.7v8.8" ${STROKE}/>`,
  info: `<circle cx="8" cy="8" r="5.6" ${STROKE}/><path d="M8 7.4v4" ${STROKE}/><circle cx="8" cy="4.9" r=".85" fill="currentColor"/>`,
  warning: `<path d="M8 2.2 14 12.9H2Z" ${STROKE}/><path d="M8 6.2v3.4" ${STROKE}/><circle cx="8" cy="11.3" r=".8" fill="currentColor"/>`,
  grip: `<circle cx="5.6" cy="4.9" r="1" fill="currentColor"/><circle cx="10.4" cy="4.9" r="1" fill="currentColor"/><circle cx="5.6" cy="8" r="1" fill="currentColor"/><circle cx="10.4" cy="8" r="1" fill="currentColor"/><circle cx="5.6" cy="11.1" r="1" fill="currentColor"/><circle cx="10.4" cy="11.1" r="1" fill="currentColor"/>`,
  frame: `<rect x="2.2" y="2.2" width="11.6" height="11.6" rx="1.4" ${STROKE}/><rect x="5.1" y="5.1" width="5.8" height="5.8" rx=".7" ${STROKE}/>`,
  aperture: `<circle cx="8" cy="8" r="5.7" ${STROKE}/><path d="m8 2.3 2.9 5M13.7 8h-5.8M11.6 12.6 8.7 8M8 13.7l-2.9-5M2.3 8h5.8M4.4 3.4l2.9 5" ${STROKE}/>`,
  sparkle: `<path d="M8 2v4M8 10v4M2 8h4M10 8h4M4.2 4.2l1.7 1.7M10.1 10.1l1.7 1.7M11.8 4.2l-1.7 1.7M5.9 10.1l-1.7 1.7" ${STROKE}/>`,
  share: `<circle cx="4.1" cy="8" r="1.7" ${STROKE}/><circle cx="11.9" cy="4" r="1.7" ${STROKE}/><circle cx="11.9" cy="12" r="1.7" ${STROKE}/><path d="m5.6 7.2 4.8-2.4M5.6 8.8l4.8 2.4" ${STROKE}/>`,
  link: `<path d="M6.4 9.6a3 3 0 0 1 0-4.2l1.5-1.5a3 3 0 0 1 4.2 4.2l-.9.9" ${STROKE}/><path d="M9.6 6.4a3 3 0 0 1 0 4.2l-1.5 1.5a3 3 0 0 1-4.2-4.2l.9-.9" ${STROKE}/>`,
  copy: `<rect x="5.4" y="5.4" width="8" height="8" rx="1.1" ${STROKE}/><path d="M3.4 10.6H2.6V2.6h8v.8" ${STROKE}/>`,
};

export type IconName = keyof typeof PATHS;

export function icon(name: string, size = 16, className = 'ico'): string {
  const body = PATHS[name];
  if (!body) return '';
  return `<svg class="${className}" viewBox="0 0 16 16" width="${size}" height="${size}" aria-hidden="true" focusable="false">${body}</svg>`;
}

/** 品牌标：取景框 + 内框 + 暖金快门点。 */
export function brandMark(size = 26, className = 'brand-mark'): string {
  return `<svg class="${className}" viewBox="0 0 28 28" width="${size}" height="${size}" aria-hidden="true" focusable="false">
    <rect x="2.2" y="2.2" width="23.6" height="23.6" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <rect x="8.1" y="8.1" width="11.8" height="11.8" rx="3" fill="none" stroke="currentColor" stroke-width="1.3" opacity=".55"/>
    <circle cx="21.2" cy="6.9" r="2.1" fill="currentColor"/>
  </svg>`;
}
