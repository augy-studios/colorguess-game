// Colours as 24 bit integers, 0xRRGGBB. Everything the score depends on is
// integer arithmetic, so the page and the server always agree; the HSV
// conversions at the bottom are for drawing the Expert wheel only.

export const MAX_COLOR = 0xffffff;

export const isColor = (n) => Number.isInteger(n) && n >= 0 && n <= MAX_COLOR;

export function toHex(n) {
  return `#${n.toString(16).padStart(6, "0").toUpperCase()}`;
}

export function channels(n) {
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function fromChannels(r, g, b) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return (c(r) << 16) | (c(g) << 8) | c(b);
}

// Integer square root, exact whatever the engine's Math.sqrt rounds to.
function isqrt(n) {
  let r = Math.floor(Math.sqrt(n));
  while (r * r > n) r--;
  while ((r + 1) * (r + 1) <= n) r++;
  return r;
}

// How far apart two colours look, by the "redmean" weighting of RGB: close
// to perceptual for its cost, and integer throughout. The result is 16 times
// the usual redmean distance, so black to white is 12240.
export const DIST_SCALE = 16;

export function distance(a, b) {
  const [r1, g1, b1] = channels(a);
  const [r2, g2, b2] = channels(b);
  const rmean = (r1 + r2) >> 1;
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return isqrt((512 + rmean) * dr * dr + 1024 * dg * dg + (767 - rmean) * db * db);
}

// Dark or light text for a label sitting on `n`. Rec. 709 luma, in integers.
export function inkOn(n) {
  const [r, g, b] = channels(n);
  return 2126 * r + 7152 * g + 722 * b > 1400000 ? "dark" : "light";
}

/* ---- the wheel's own maths, display only ---- */

// h in degrees, s and v from 0 to 1.
export function hsvToColor(h, s, v) {
  const f = (k) => {
    const x = (k + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(x, 4 - x, 1));
  };
  return fromChannels(f(5) * 255, f(3) * 255, f(1) * 255);
}

export function colorToHsv(n) {
  const [r, g, b] = channels(n).map((c) => c / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}
