// Expert's colour picker: a hue and saturation wheel drawn on a canvas, and
// a brightness slider under it, so any hex code can be reached. Drag or tap
// the wheel, or focus it and use the arrow keys: left and right turn the
// hue, up and down change the saturation.
//
// The wheel and the slider's track show colours for what they are, so like
// the swatches they are a fixed-meaning exception to the theme's tokens.

import { colorToHsv, hsvToColor, toHex } from "./color.js";

const KEY_HUE = 5;
const KEY_SAT = 0.05;

export class Wheel {
  // els: { wrap, canvas, slider, marker, target, preview }
  constructor(els, onChange) {
    this.els = els;
    this.onChange = onChange;
    this.h = 0;
    this.s = 0;
    this.v = 0.5;
    this.interactive = false;
    this.drawnFor = null;

    const { wrap, slider } = els;
    wrap.addEventListener("pointerdown", (e) => {
      if (!this.interactive) return;
      wrap.setPointerCapture(e.pointerId);
      this.pointAt(e);
      wrap.focus({ preventScroll: true });
      e.preventDefault();
    });
    wrap.addEventListener("pointermove", (e) => {
      if (this.interactive && wrap.hasPointerCapture(e.pointerId)) this.pointAt(e);
    });
    wrap.addEventListener("keydown", (e) => {
      if (!this.interactive) return;
      const turn = { ArrowLeft: KEY_HUE, ArrowRight: -KEY_HUE }[e.key];
      const sat = { ArrowUp: KEY_SAT, ArrowDown: -KEY_SAT }[e.key];
      if (turn === undefined && sat === undefined) return;
      e.preventDefault();
      if (turn) this.h = (this.h + turn + 360) % 360;
      if (sat) this.s = Math.max(0, Math.min(1, this.s + sat));
      this.changed();
    });
    slider.addEventListener("input", () => {
      this.v = Number(slider.value) / 100;
      this.changed();
    });
    window.addEventListener("resize", () => {
      this.drawnFor = null;
      if (!wrap.closest(".hidden")) this.draw();
    });
  }

  get color() {
    return hsvToColor(this.h, this.s, this.v);
  }

  // A fresh pick for a new question: mid grey, in the middle of the wheel.
  reset() {
    this.h = 0;
    this.s = 0;
    this.v = 0.5;
    this.els.target.classList.add("hidden");
    this.changed();
  }

  setInteractive(on) {
    this.interactive = on;
    this.els.wrap.classList.toggle("locked", !on);
    this.els.wrap.tabIndex = on ? 0 : -1;
    this.els.slider.disabled = !on;
  }

  // For the reveal and the replay: the wheel at the pick's brightness, with
  // the pick and the colour asked for both marked on it.
  show(pick, target) {
    const at = colorToHsv(pick === -1 ? target : pick);
    this.h = at.h;
    this.s = at.s;
    this.v = at.v;
    this.changed({ quiet: true });
    if (pick === -1) this.els.marker.classList.add("hidden");
    const t = colorToHsv(target);
    this.place(this.els.target, t.h, t.s);
    this.els.target.classList.remove("hidden");
  }

  pointAt(e) {
    const rect = this.els.wrap.getBoundingClientRect();
    const r = rect.width / 2;
    const x = (e.clientX - rect.left - r) / r;
    const y = (rect.top + r - e.clientY) / r;
    this.h = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
    this.s = Math.min(1, Math.hypot(x, y));
    this.changed();
  }

  place(el, h, s) {
    const a = (h * Math.PI) / 180;
    el.style.left = `${50 + 50 * s * Math.cos(a)}%`;
    el.style.top = `${50 - 50 * s * Math.sin(a)}%`;
  }

  changed({ quiet = false } = {}) {
    const { slider, marker, preview, wrap } = this.els;
    slider.value = String(Math.round(this.v * 100));
    slider.style.setProperty("--wheel-top", toHex(hsvToColor(this.h, this.s, 1)));
    marker.classList.remove("hidden");
    this.place(marker, this.h, this.s);
    marker.style.background = toHex(this.color);
    preview.style.background = toHex(this.color);
    wrap.setAttribute(
      "aria-valuetext",
      `Hue ${Math.round(this.h)} degrees, saturation ${Math.round(this.s * 100)} percent, brightness ${Math.round(this.v * 100)} percent`
    );
    this.draw();
    if (!quiet) this.onChange?.(this.color);
  }

  // Redrawn only when the brightness or the size changes.
  draw() {
    const { canvas } = this.els;
    const size = Math.round(canvas.clientWidth * (window.devicePixelRatio || 1));
    if (!size) return;
    const key = `${size}|${this.v.toFixed(2)}`;
    if (this.drawnFor === key) return;
    this.drawnFor = key;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(size, size);
    const r = size / 2;
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const x = (px + 0.5 - r) / r;
        const y = (r - py - 0.5) / r;
        const d = Math.hypot(x, y);
        // A pixel's worth of soft edge, so the rim is not jagged.
        const alpha = Math.max(0, Math.min(1, (1 - d) * r));
        if (!alpha) continue;
        const c = hsvToColor(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360, Math.min(1, d), this.v);
        const i = (py * size + px) * 4;
        img.data[i] = (c >> 16) & 255;
        img.data[i + 1] = (c >> 8) & 255;
        img.data[i + 2] = c & 255;
        img.data[i + 3] = Math.round(alpha * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
  }
}
