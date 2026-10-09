// Drawing a question: the hex code asked for, then the swatches (Normal and
// Hard) or the colour wheel (Expert), and once answered, what was right. One
// view for live play, a network guest, and the replay, so all three look
// the same.

import { LEVELS, accuracy } from "./quiz.js";
import { inkOn, toHex } from "./color.js";
import { Wheel } from "./wheel.js";
import { hydrateIcons } from "./ui.js";

const $ = (id) => document.getElementById(id);

let wheel = null;
let onPick = null;
// What is on screen: { seed, q, interactive }.
let shown = null;

export function initView(pick) {
  onPick = pick;
  wheel = new Wheel(
    {
      wrap: $("wheelWrap"),
      canvas: $("wheelCanvas"),
      slider: $("brightness"),
      marker: $("wheelMarker"),
      target: $("wheelTarget"),
      preview: $("pickPreview"),
    },
    null
  );
  $("options").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-pick]");
    if (!btn || !shown?.interactive) return;
    onPick?.(Number(btn.dataset.pick));
  });
  $("lockBtn").addEventListener("click", () => {
    if (shown?.interactive) onPick?.(wheel.color);
  });
}

// The question, waiting for an answer. `interactive` false shows it as the
// replay does, without taking one.
export function showQuestion(seed, q, { interactive = true } = {}) {
  shown = { seed, q, interactive };
  const level = LEVELS[seed.difficulty];
  $("promptHex").textContent = toHex(q.answer);
  $("compare").classList.add("hidden");

  if (q.options) {
    $("wheelBox").classList.add("hidden");
    const opts = $("options");
    opts.classList.remove("hidden");
    opts.dataset.count = String(level.options);
    opts.innerHTML = q.options
      .map(
        (c, i) =>
          `<button type="button" class="swatch-opt" data-pick="${i}" style="--swatch:${toHex(c)}" aria-label="Swatch ${i + 1} of ${q.options.length}"${
            interactive ? "" : " disabled"
          }><span class="opt-hex"></span><span class="mark" aria-hidden="true"></span></button>`
      )
      .join("");
  } else {
    $("options").classList.add("hidden");
    $("wheelBox").classList.remove("hidden");
    wheel.reset();
    wheel.setInteractive(interactive);
    $("lockBtn").classList.toggle("hidden", !interactive);
    $("lockBtn").disabled = !interactive;
  }
}

// Picked, and waiting on a network host to say how it went.
export function showPending(pick) {
  if (!shown) return;
  shown.interactive = false;
  if (shown.q.options) {
    document.querySelectorAll("#options .swatch-opt").forEach((b) => {
      b.disabled = true;
      b.classList.toggle("chosen", Number(b.dataset.pick) === pick);
    });
  } else {
    wheel.setInteractive(false);
    $("lockBtn").disabled = true;
  }
}

// The answer: the right swatch marked, a wrong pick crossed, or in Expert
// the colour asked for beside the colour picked.
export function showAnswer(seed, q, [pick]) {
  shown = { seed, q, interactive: false };
  const acc = accuracy(q, pick);
  if (q.options) {
    document.querySelectorAll("#options .swatch-opt").forEach((b) => {
      const i = Number(b.dataset.pick);
      const color = q.options[i];
      const right = color === q.answer;
      b.disabled = true;
      b.classList.toggle("chosen", i === pick);
      b.classList.toggle("is-right", right);
      b.classList.toggle("is-wrong", i === pick && !right);
      b.classList.toggle("faded", !right && i !== pick);
      b.setAttribute("aria-label", `${toHex(color)}${right ? ", the answer" : ""}${i === pick ? ", picked" : ""}`);
      const hex = b.querySelector(".opt-hex");
      hex.textContent = toHex(color);
      hex.dataset.ink = inkOn(color);
      const mark = b.querySelector(".mark");
      const name = right ? "correct" : i === pick ? "incorrect" : "";
      mark.dataset.icon = name;
      if (!name) {
        mark.innerHTML = "";
        delete mark.dataset.iconRendered;
      }
    });
    hydrateIcons($("options"));
  } else {
    wheel.setInteractive(false);
    $("lockBtn").classList.add("hidden");
    wheel.show(pick, q.answer);
    setSwatch($("askedSwatch"), q.answer);
    setSwatch($("pickedSwatch"), pick);
    $("compare").classList.remove("hidden");
  }
  return acc;
}

function setSwatch(el, color) {
  const none = color === -1;
  el.style.background = none ? "" : toHex(color);
  el.classList.toggle("empty", none);
  const label = el.querySelector(".swatch-hex");
  label.textContent = none ? "None" : toHex(color);
  label.dataset.ink = none ? "" : inkOn(color);
}

export function redrawWheel() {
  wheel?.draw();
}
