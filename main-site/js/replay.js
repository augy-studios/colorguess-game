// The instant replay: a finished game played back one question at a time,
// each shown for as long as it was really looked at, with the timer running
// down beside it, then answered. Play, pause, a step either way, a jump to
// any question from the list or the slider, and four speeds.

import { hydrateIcons, store } from "./ui.js";

// The same speeds as Word Rain's and the sudoku game's replay. The one
// picked last is remembered in this browser.
const SPEEDS = [0.5, 1, 2, 4];
const SPEED_STORAGE = "colorguessr.replaySpeed";
// How long an answer stays up before the next question, at 1x.
const ANSWER_MS = 1400;

const $ = (id) => document.getElementById(id);

export class Replay {
  // render(index, stage, ms): draw question `index`, either as it was asked
  // ("ask", with `ms` to run its timer down over) or answered ("answer").
  constructor(render) {
    this.render = render;
    this.timer = null;
    this.index = 0;
    this.count = 0;
    this.times = [];
    this.active = false;
    const saved = Number(store.get(SPEED_STORAGE));
    this.speed = SPEEDS.includes(saved) ? saved : 1;
    this.syncSpeed();

    $("rpSpeed").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-speed]");
      if (btn) this.setSpeed(Number(btn.dataset.speed));
    });
    $("rpStart").addEventListener("click", () => this.jump(0));
    $("rpBack").addEventListener("click", () => this.step(-1));
    $("rpForward").addEventListener("click", () => this.step(1));
    $("rpEnd").addEventListener("click", () => this.jump(this.count - 1));
    $("rpPlay").addEventListener("click", () => (this.playing ? this.pause() : this.play()));
    $("rpScrub").addEventListener("input", (e) => this.jump(Number(e.target.value)));
    $("rpList").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-q]");
      if (btn) this.jump(Number(btn.dataset.q));
    });
    document.addEventListener("keydown", (e) => {
      if (!this.active || e.target.closest("input, textarea, button, .modal-backdrop:not(.hidden)")) return;
      if (e.key === "ArrowLeft") this.step(-1);
      else if (e.key === "ArrowRight") this.step(1);
      else if (e.key === " ") this.playing ? this.pause() : this.play();
      else return;
      e.preventDefault();
    });
  }

  // times: how long each answer took, in ms. items: the list's entries, as
  // { icon, text }. Starts at the end, or from the first question and
  // playing when `autoplay` is set.
  load(times, items, { autoplay = false } = {}) {
    this.pause();
    this.active = true;
    this.times = times;
    this.count = times.length;
    $("rpScrub").max = String(Math.max(0, this.count - 1));
    $("rpList").innerHTML = items
      .map(
        (it, i) =>
          `<li><button type="button" class="q-btn" data-q="${i}"><span class="q-num">${i + 1}</span><span class="q-mark" data-icon="${it.icon}"></span><span class="q-text">${it.text}</span></button></li>`
      )
      .join("");
    hydrateIcons($("rpList"));
    if (autoplay && this.count) {
      this.index = 0;
      this.play();
    } else {
      this.show(this.count - 1);
    }
  }

  stop() {
    this.pause();
    this.active = false;
  }

  show(i, stage = "answer") {
    if (i < 0 || i >= this.count) return;
    this.index = i;
    this.render(i, stage, stage === "ask" ? this.askMs(i) : 0);
    $("rpScrub").value = String(i);
    $("rpLabel").textContent = `Question ${i + 1} of ${this.count}`;
    const list = $("rpList");
    list.querySelectorAll(".q-btn").forEach((b) => {
      const on = Number(b.dataset.q) === i;
      b.classList.toggle("current", on);
      if (on) b.setAttribute("aria-current", "step");
      else b.removeAttribute("aria-current");
    });
    // Keep the current question in view within the list, not the page.
    const current = list.querySelector(".q-btn.current");
    if (current) {
      const left = current.offsetLeft - list.offsetLeft;
      if (left < list.scrollLeft || left > list.scrollLeft + list.clientWidth - 60) list.scrollLeft = left - 60;
    }
    $("rpBack").disabled = $("rpStart").disabled = i === 0;
    $("rpForward").disabled = $("rpEnd").disabled = i === this.count - 1;
  }

  askMs(i) {
    return this.times[i] / this.speed;
  }

  step(delta) {
    this.pause();
    this.show(Math.max(0, Math.min(this.count - 1, this.index + delta)));
  }

  jump(i) {
    this.pause();
    this.show(Math.max(0, Math.min(this.count - 1, i)));
  }

  // Remembered in this browser. A replay that is playing picks the new pace
  // up from its next question.
  setSpeed(speed) {
    if (!SPEEDS.includes(speed)) return;
    this.speed = speed;
    store.set(SPEED_STORAGE, String(speed));
    this.syncSpeed();
  }

  syncSpeed() {
    document.querySelectorAll("#rpSpeed [data-speed]").forEach((el) => {
      el.setAttribute("aria-checked", String(Number(el.dataset.speed) === this.speed));
    });
  }

  get playing() {
    return this.timer !== null;
  }

  // Each question is asked, then answered, then the next one comes.
  play() {
    clearTimeout(this.timer);
    // Played to the end already: start over.
    if (this.index >= this.count - 1 && this.stage !== "ask") this.index = 0;
    this.syncPlayButton(true);
    const ask = (i) => {
      this.stage = "ask";
      this.show(i, "ask");
      this.timer = setTimeout(() => answer(i), this.askMs(i));
    };
    const answer = (i) => {
      this.stage = "answer";
      this.show(i, "answer");
      if (i >= this.count - 1) {
        this.timer = setTimeout(() => this.pause(), 0);
        return;
      }
      this.timer = setTimeout(() => ask(i + 1), ANSWER_MS / this.speed);
    };
    ask(this.index);
  }

  pause() {
    clearTimeout(this.timer);
    this.timer = null;
    this.stage = null;
    this.syncPlayButton(false);
  }

  syncPlayButton(playing) {
    const btn = $("rpPlay");
    btn.setAttribute("aria-label", playing ? "Pause" : "Play");
    btn.querySelector("[data-icon]").setAttribute("data-icon", playing ? "pause" : "play");
    hydrateIcons(btn);
  }
}
