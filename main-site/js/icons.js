// Inline SVG icons. No emoji anywhere in the UI.
// Stroke icons inherit colour through currentColor.

const svg = (inner) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`;

// The right and wrong marks laid over a swatch, from the original game's
// correct.svg and incorrect.svg. They sit on any colour at all, so their
// fills are the fixed-meaning --mark-* tokens in style.css, not currentColor.
const mark = (glyph) =>
  `<svg viewBox="0 0 50 50" aria-hidden="true" focusable="false"><rect class="mark-disc" x="4" y="4" width="42" height="42" rx="21"/><path class="mark-glyph" d="${glyph}"/></svg>`;

export const icons = {
  // sun, moon, close and clock are the theme doc's own paths.
  sun: svg(`<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>`),
  moon: svg(`<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>`),
  close: svg(`<path d="M18 6 6 18M6 6l12 12"/>`),
  clock: svg(`<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>`),

  coffee: svg(
    `<path d="M4 9h13v5.5A4.5 4.5 0 0 1 12.5 19h-4A4.5 4.5 0 0 1 4 14.5V9Z"/><path d="M17 10.5h1.5a2.5 2.5 0 0 1 0 5H17"/><path d="M7 4.5c0 1-.9 1.2-.9 2.2 0 .7.45 1 .45 1M11 4.5c0 1-.9 1.2-.9 2.2 0 .7.45 1 .45 1"/>`
  ),
  trophy: svg(
    `<path d="M8 4h8v5a4 4 0 0 1-8 0V4Z"/><path d="M8 6H5.5A1.5 1.5 0 0 0 4 7.5 3.5 3.5 0 0 0 7.5 11H8M16 6h2.5A1.5 1.5 0 0 1 20 7.5a3.5 3.5 0 0 1-3.5 3.5H16"/><path d="M12 13v4M8.5 20h7M10 17h4"/>`
  ),
  settings: svg(
    `<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>`
  ),
  refresh: svg(`<path d="M20 11a8 8 0 0 0-14.3-4.3L4 8.5"/><path d="M4 4v4.5h4.5"/><path d="M4 13a8 8 0 0 0 14.3 4.3L20 15.5"/><path d="M20 20v-4.5h-4.5"/>`),
  check: svg(`<path d="m5 12.5 4.5 4.5L19 7.5"/>`),
  heartFilled: svg(
    `<path d="M12 20.2 4.9 13a5 5 0 0 1 7.1-7l0 0a5 5 0 0 1 7.1 7L12 20.2Z" fill="currentColor" stroke="none"/>`
  ),

  // The game.
  play: svg(`<path d="M7 5v14l11-7Z"/>`),
  pause: svg(`<path d="M8 5v14M16 5v14"/>`),
  next: svg(`<path d="M5 12h14M13 6l6 6-6 6"/>`),
  stepBack: svg(`<path d="M17 5v14L8 12Z"/><path d="M6 5v14"/>`),
  stepForward: svg(`<path d="M7 5v14l9-7Z"/><path d="M18 5v14"/>`),
  skipBack: svg(`<path d="M19 6v12l-7-6ZM12 6v12l-7-6Z"/>`),
  skipForward: svg(`<path d="M5 6v12l7-6ZM12 6v12l7-6Z"/>`),
  replay: svg(`<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M10 9v6l5-3Z"/>`),
  copy: svg(`<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>`),
  user: svg(`<circle cx="12" cy="8" r="4"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>`),
  wifi: svg(
    `<path d="M2 9.5a15 15 0 0 1 20 0M5 13a10 10 0 0 1 14 0M8.5 16.5a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r=".6" fill="currentColor"/>`
  ),
  link: svg(`<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>`),
  share: svg(`<path d="M12 15V3.5M7.5 8 12 3.5 16.5 8"/><path d="M8 11H6.5A2.5 2.5 0 0 0 4 13.5v5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5v-5a2.5 2.5 0 0 0-2.5-2.5H16"/>`),
  exit: svg(`<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M10 16l-4-4 4-4M6 12h10"/>`),
  target: svg(`<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5"/>`),

  correct: mark(
    "M22.65,32.5a1,1,0,0,1-.73.3,1,1,0,0,1-.72-.3l-5.8-5.79a1.55,1.55,0,0,1,0-2.18l.73-.72a1.52,1.52,0,0,1,2.17,0l3.62,3.61,9.78-9.77a1.53,1.53,0,0,1,2.17,0l.73.72a1.55,1.55,0,0,1,0,2.18Z"
  ),
  incorrect: mark(
    "M28.3,25l6.19-6.19a1.75,1.75,0,0,0,0-2.47l-.83-.83a1.75,1.75,0,0,0-2.47,0L25,21.7l-6.19-6.19a1.75,1.75,0,0,0-2.47,0l-.83.83a1.75,1.75,0,0,0,0,2.47L21.7,25l-6.19,6.19a1.75,1.75,0,0,0,0,2.47l.83.83a1.75,1.75,0,0,0,2.47,0L25,28.3l6.19,6.19a1.75,1.75,0,0,0,2.47,0l.83-.83a1.75,1.75,0,0,0,0-2.47Z"
  ),
};

export function icon(name) {
  return icons[name] || "";
}
