// Small line icons for packaging shapes. 24x24, stroke uses currentColor.

import type { ShapeClass } from '../core/types.ts';

const P = (d: string) => `<path d="${d}"/>`;

const SHAPES: Partial<Record<ShapeClass, string>> = {
  bottle: P('M10 2h4v3l2 3v12a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V8l2-3z') + P('M8 12h8'),
  jar: P('M7 4h10v3H7z') + P('M6 7h12v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z'),
  can: P('M7 4h10v16H7z') + P('M7 7h10M7 17h10'),
  'aerosol-can': P('M8 7h8v13a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1z') + P('M10 7V4h4v3M14 4h3'),
  cap: P('M5 10h14v6H5z') + P('M7 10V8h10v2M8 13h0M11 13h0M14 13h0'),
  seal: P('M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16z') + P('M12 8a4 4 0 1 0 0 8'),
  label: P('M6 5h12v14H6z') + P('M9 9h6M9 12h6M9 15h3'),
  box: P('M3 8l9-4 9 4v9l-9 4-9-4z') + P('M3 8l9 4 9-4M12 12v9'),
  brick: P('M7 6l3-3h4l3 3v15H7z') + P('M7 6h10M10 3v3'),
  tray: P('M3 10h18l-2 7H5z') + P('M6 10V9M18 10V9'),
  pot: P('M5 6h14l-2 14H7z') + P('M4 6h16'),
  cup: P('M6 5h12l-1.5 15h-9z') + P('M5 5h14'),
  bag: P('M5 8h14l-1 13H6z') + P('M9 8V6a3 3 0 0 1 6 0v2'),
  film: P('M4 6c4-2 12 2 16 0v12c-4 2-12-2-16 0z'),
  sachet: P('M6 3h12v18H6z') + P('M6 6h12M6 18h12'),
  blister: P('M4 5h16v14H4z') + P('M8 9a1.5 1.5 0 1 0 0 .1M16 9a1.5 1.5 0 1 0 0 .1M8 15a1.5 1.5 0 1 0 0 .1M16 15a1.5 1.5 0 1 0 0 .1'),
  tube: P('M8 3h8l-1 3v15H9V6z') + P('M10 3V1h4v2'),
  capsule: P('M7 8h10l-2 10H9z') + P('M6 8h12'),
  cutlery: P('M8 3v18M6 3v5a2 2 0 0 0 4 0V3M16 3c-2 2-2 6 0 8v10'),
  straw: P('M14 2l-3 4M11 6h4l-2 16h-1z'),
};

export function shapeIcon(shape: ShapeClass): string {
  const body = SHAPES[shape] ?? P('M5 5h14v14H5z') + P('M9 10a3 3 0 1 1 3 3v2M12 18h0');
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export const ICON_SCAN = `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3M7 8v8M10 8v8M13 8v8M16 8v8"/></svg>`;
export const ICON_IMAGE = `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 16l5-5 4 4 3-3 6 6"/><circle cx="16" cy="9" r="1.5"/></svg>`;
export const ICON_LINK = `<svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>`;
export const ICON_CLOSE = `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`;
