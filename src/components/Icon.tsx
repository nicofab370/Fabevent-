/*
 * Icônes de FabEvent : un seul jeu, dessiné au trait (24 × 24, trait 1,8, coins arrondis),
 * à la couleur et à la taille du texte. Jamais d'emoji dans l'interface.
 */

const P: Record<string, string> = {
  x: 'M6 6l12 12M18 6L6 18',
  search: 'M10.5 17a6.5 6.5 0 100-13 6.5 6.5 0 000 13zM20 20l-4.8-4.8',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
  'eye-off': 'M3 3l18 18M10.6 6.1A9.6 9.6 0 0112 6c6 0 9.5 6 9.5 6a16 16 0 01-2.9 3.5M6.4 7.6A15.5 15.5 0 002.5 12s3.5 6 9.5 6a9 9 0 004.1-1M9.9 9.9a3 3 0 004.2 4.2',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  palette: 'M12 3a9 9 0 000 18c1.1 0 1.6-.8 1.6-1.6 0-.9-.6-1.3-.6-2.1 0-.9.7-1.5 1.6-1.5H17a4 4 0 004-4c0-4.9-4-8.8-9-8.8zM7.5 11.5h.01M10 7.5h.01M14.5 7.5h.01M17 11h.01',
  check: 'M5 12.5l4.5 4.5L19 7',
  minus: 'M6 12h12',
  plus: 'M12 5v14M5 12h14',
  'chevron-right': 'M9 6l6 6-6 6',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-left': 'M15 6l-6 6 6 6',
  'arrow-left': 'M19 12H5M11 6l-6 6 6 6',
  'arrow-right': 'M5 12h14M13 6l6 6-6 6',
  'arrow-up': 'M12 19V5M6 11l6-6 6 6',
  'arrow-down': 'M12 5v14M6 13l6 6 6-6',
  corner: 'M7 5v8a3 3 0 003 3h9M16 13l3 3-3 3',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 16.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7z',
  tag: 'M3 12V4h8l10 10-8 8zM7.5 9a1.5 1.5 0 100-3 1.5 1.5 0 000 3z',
  info: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v5.5M12 7.6v.2',
  printer: 'M7 9V3h10v6M7 17H4v-8h16v8h-3M7 14h10v7H7z',
  pin: 'M12 21s-7-6.2-7-11.5a7 7 0 0114 0C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
  wrench: 'M14.7 6.3a4 4 0 00-5.4 5.4L3.5 17.5a1.4 1.4 0 002 2l5.8-5.8a4 4 0 005.4-5.4l-2.5 2.5-2.1-.4-.4-2.1z',
  mail: 'M4 5h16a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1zM3.5 6.5L12 13l8.5-6.5',
  send: 'M21 3L10.5 13.5M21 3l-6.5 18-4-7.5L3 9.5z',
  book: 'M6 3h12a1 1 0 011 1v16a1 1 0 01-1 1H6a2 2 0 01-2-2V5a2 2 0 012-2zM12 11a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM8 16a4 4 0 018 0',
  swap: 'M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4',
  clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3.5 2',
  hourglass: 'M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9s8 4 8 9',
  chat: 'M4 5h16v11H9l-5 4z',
  folder: 'M3 6a1 1 0 011-1h5l2 2h9a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1z',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  reset: 'M4 12a8 8 0 108-8H8M8 4L5 7l3 3',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5',
  warning: 'M12 4L2.5 20h19zM12 10v4.5M12 17.2v.2',
  bolt: 'M13 3L5 14h6l-1 7 8-11h-6z',
  clip: 'M20 11.5l-8.2 8.2a5 5 0 01-7-7L13 4.5a3.5 3.5 0 015 5l-8.2 8.2a2 2 0 01-2.8-2.8L14.5 7.4',
  copy: 'M9 9h11v11H9zM15 9V4H4v11h5',
  menu: 'M4 6h16M4 12h16M4 18h16',
  circle: 'M12 19a7 7 0 100-14 7 7 0 000 14z',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  calendar: 'M4 6a1 1 0 011-1h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1zM4 10h16M8 3v4M16 3v4',
  box: 'M3 7.5L12 3l9 4.5v9L12 21l-9-4.5zM3 7.5L12 12l9-4.5M12 12v9',
  scan: 'M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3M7 12h10',
  transfer: 'M7 20V4M3 8l4-4 4 4M17 4v16M13 16l4 4 4-4',
  users: 'M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2.5 20a6.5 6.5 0 0113 0M16 4.2a3.5 3.5 0 010 6.6M21.5 20a6.5 6.5 0 00-4-6',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
  'user-check': 'M10 12a4 4 0 100-8 4 4 0 000 8zM3 21a7 7 0 0111.5-5.4M15 19l2 2 4-4',
  truck: 'M2 6h12v10H2zM14 10h4l3 3v3h-7M6.5 20a2 2 0 100-4 2 2 0 000 4zM17.5 20a2 2 0 100-4 2 2 0 000 4z',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h4',
  chart: 'M4 20V10M10 20V4M16 20v-7M2 20h20',
  upload: 'M12 15V3M7 8l5-5 5 5M4 15v4a1 1 0 001 1h14a1 1 0 001-1v-4',
  file: 'M6 2h9l5 5v14a1 1 0 01-1 1H6a1 1 0 01-1-1V3a1 1 0 011-1zM14 2v6h6M9 13h7M9 17h5',
  sliders: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 8a2 2 0 100-4 2 2 0 000 4zM9 14a2 2 0 100-4 2 2 0 000 4zM17 20a2 2 0 100-4 2 2 0 000 4z',
  checklist: 'M9 6h11M9 12h11M9 18h11M3.5 6l1.5 1.5L7.5 5M3.5 12l1.5 1.5 2.5-2.5M3.5 18l1.5 1.5 2.5-2.5',
  home: 'M4 11l8-7 8 7v9a1 1 0 01-1 1h-4v-6H9v6H5a1 1 0 01-1-1z',
  building: 'M4 21V5a1 1 0 011-1h9a1 1 0 011 1v16M15 9h4a1 1 0 011 1v11M2 21h20M8 8h3M8 12h3M8 16h3',
};
/** Icônes pleines (points) */
const DOTS: Record<string, [number, number, number][]> = {
  more: [[5, 12, 1.6], [12, 12, 1.6], [19, 12, 1.6]],
  dot: [[12, 12, 5]],
};

export type IconName = keyof typeof P | keyof typeof DOTS;

export function Icon({ name, title, className, size }: { name: IconName; title?: string; className?: string; size?: number | string }) {
  const s = size ?? '1.15em';
  return (
    <svg className={'ico' + (className ? ' ' + className : '')} viewBox="0 0 24 24" width={s} height={s} aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}
      fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      {title && <title>{title}</title>}
      {P[name] && <path d={P[name]} />}
      {DOTS[name]?.map(([cx, cy, r], i) => <circle key={i} cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />)}
    </svg>
  );
}

/** Même dessin en texte SVG (pour les pages générées en HTML). */
export function iconSvg(name: IconName, size = 18): string {
  const d = P[name] ? `<path d="${P[name]}"/>` : '';
  const c = (DOTS[name] || []).map(([cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="currentColor" stroke="none"/>`).join('');
  return `<svg class="ico" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}${c}</svg>`;
}
