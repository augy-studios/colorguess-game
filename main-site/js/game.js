// The game screen: choosing a game, playing it, the result, adding it to the
// leaderboard, sharing it, and watching a shared replay. A network game is
// driven from multiplayer.js through `multi` at the bottom; everything else
// starts here.

import { COUNTS, DIFFICULTIES, MAX_QUESTIONS, newSeed, parseSeed, validCount } from "./seed.js";
import { LEVELS, question } from "./quiz.js";
import { tally } from "./score.js";
import { packAnswers, unpackAnswers } from "./record.js";
import { api } from "./api.js";
import { getSettings, saveSettings } from "./settings.js";
import { openLeaderboard } from "./leaderboard.js";
import { initView, redrawWheel, showAnswer, showPending, showQuestion } from "./view.js";
import { Replay } from "./replay.js";
import { copyText, escapeHtml, hydrateIcons, store } from "./ui.js";

const SETUP_KEY = "colorguessr.setup";
// How long an answer stays up before the next question in a game on one
// device. Next skips it. The API allows for it when it checks a game's time.
const REVEAL_MS = 1500;
// A refused submission that only needs the host to report the game first is
// tried again this often, this many times.
const PENDING_RETRY_MS = 3000;
const PENDING_TRIES = 6;

const $ = (id) => document.getElementById(id);

const ORDINAL = (n) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

let setup = { mode: "solo", difficulty: "normal", count: "10", custom: 30 };
// The game being played or just finished. See newGame().
let g = null;
// A shared replay being watched: { seed, answers, shortId? }.
let watching = null;
// multiplayer.js's side of a network game; see setNet().
let net = null;
let replayer = null;
let launching = false;
let revealTimer = null;
let deadlineTimer = null;
let quitArmed = null;

/* ---- panels ---- */

export function showPanel(name) {
  for (const id of ["setup", "net", "play"]) $(id).classList.toggle("hidden", id !== name);
  if (name === "play") redrawWheel();
}

export function setNet(adapter) {
  net = adapter;
}

export const current = () => g;

// From a join link: the new-game screen set to multiplayer.
export function setMode(mode) {
  setup.mode = mode;
  saveSetup();
  renderSetup();
}

/* ---- choosing a game ---- */

function loadSetup() {
  const saved = store.getJSON(SETUP_KEY) ?? {};
  if (saved.mode === "solo" || saved.mode === "multi") setup.mode = saved.mode;
  if (DIFFICULTIES.includes(saved.difficulty)) setup.difficulty = saved.difficulty;
  if ([...COUNTS.map(String), "custom"].includes(saved.count)) setup.count = saved.count;
  if (validCount(saved.custom)) setup.custom = saved.custom;
}

function saveSetup() {
  store.set(SETUP_KEY, setup);
}

function chosenCount() {
  return setup.count === "custom" ? setup.custom : Number(setup.count);
}

const LEVEL_NOTES = {
  normal: "Four swatches, 10 seconds a question.",
  hard: "Six close shades, 12 seconds a question, 160% points.",
  expert: "Find it on the colour wheel, 25 seconds a question, 250% points, scored by how close you get.",
};

function radio(groupId, attr, value) {
  document.querySelectorAll(`#${groupId} [data-${attr}]`).forEach((el) => {
    el.setAttribute("aria-checked", String(el.dataset[attr] === value));
  });
}

function renderSetup() {
  radio("modePick", "pick", setup.mode);
  radio("levelPick", "level", setup.difficulty);
  radio("countPick", "count", setup.count);
  $("customBox").classList.toggle("hidden", setup.count !== "custom");
  $("customCount").value = String(setup.custom);
  $("levelNote").textContent = LEVEL_NOTES[setup.difficulty];
  const multi = setup.mode === "multi";
  $("playNote").textContent = multi ? "Up to 8 players on the same wifi, or on one phone's hotspot." : "";
  $("startLabel").textContent = multi ? "Host a game" : "Start game";
  $("joinForm").classList.toggle("hidden", !multi);
  renderSeedNote();
}

// The seed field, read: { seed } for a usable one, { seed: null } when it is
// empty, { error } when it holds something that is not a seed.
function readSeedInput() {
  const text = $("seedInput").value.trim();
  if (!text) return { seed: null };
  const seed = parseSeed(text, { difficulty: setup.difficulty, count: chosenCount() });
  return seed ? { seed } : { error: true };
}

function renderSeedNote() {
  const note = $("seedNote");
  const read = readSeedInput();
  note.classList.toggle("error", Boolean(read.error));
  if (read.error) note.textContent = "That is not a seed. A seed looks like N10-BXK4-M9TR.";
  else if (read.seed) note.textContent = `Plays ${LEVELS[read.seed.difficulty].name}, ${read.seed.count} questions: ${read.seed.text}.`;
  else note.textContent = "Leave it empty for a new game, or paste a seed to play that game again.";
}

function shake(el) {
  el.classList.remove("shake");
  void el.offsetWidth;
  el.classList.add("shake");
  el.focus();
}

async function onStart() {
  const read = readSeedInput();
  if (read.error) return shake($("seedInput"));
  if (setup.count === "custom" && !validCount(setup.custom)) return shake($("customCount"));

  const plan = {
    seed: read.seed,
    difficulty: read.seed?.difficulty ?? setup.difficulty,
    count: read.seed?.count ?? chosenCount(),
  };
  if (setup.mode === "multi") {
    net?.host(plan);
    return;
  }
  if (launching) return;
  launching = true;
  $("startBtn").disabled = true;
  $("startLabel").textContent = "Starting";
  try {
    const { seed, ticket } = await getTicket("solo", plan);
    begin(seed, { mode: "solo", ticket });
    ask(0);
  } finally {
    launching = false;
    $("startBtn").disabled = false;
    renderSetup();
  }
}

// A start ticket from the API, with the seed it settled on. With no seed in
// the plan the server picks one. Offline, or with the API down, the game
// plays the same on a seed picked here and simply is not scored.
export async function getTicket(mode, plan) {
  try {
    const res = await api.start({ mode, seed: plan.seed?.text, difficulty: plan.difficulty, count: plan.count });
    const seed = parseSeed(res.seed);
    if (seed) return { seed, ticket: { gameId: res.game_id, serverSeed: res.server_seed } };
  } catch {
    // Falls through to an unscored game.
  }
  return { seed: plan.seed ?? newSeed(plan.difficulty, plan.count), ticket: null };
}

/* ---- playing ---- */

// mode: "solo" or "multi". role: "host" or "guest" in a network game.
function newGame(seed, { mode, role = null, ticket = null }) {
  return {
    seed,
    mode,
    role,
    ticket,
    answers: [],
    index: -1,
    phase: "ready",
    shownAt: 0,
    finish: null,
    submitted: null,
    shortId: null,
    standings: [],
  };
}

function begin(seed, opts) {
  closeWatch({ show: false });
  stopReplay();
  g = newGame(seed, opts);
  showPanel("play");
  resetResult();
  $("levelChip").textContent = LEVELS[seed.difficulty].name;
  $("seedChip").textContent = seed.text;
  $("liveActions").classList.remove("hidden");
  $("nextBtn").classList.add("hidden");
  $("standings").classList.toggle("hidden", opts.mode !== "multi");
  disarmQuit();
  renderChips();
}

function renderChips() {
  if (!g) return;
  const shown = Math.max(0, g.index) + 1;
  $("qChip").textContent = `Question ${Math.min(shown, g.seed.count)} of ${g.seed.count}`;
  $("scoreChip").textContent = `Score ${tally(g.seed, g.answers).subtotal}`;
}

function clearTimers() {
  clearTimeout(revealTimer);
  clearTimeout(deadlineTimer);
  revealTimer = deadlineTimer = null;
}

// Asks question i. `msLeft` is how long there is to answer: the level's
// limit, or in a network game whatever the host says is left.
function ask(i, msLeft) {
  clearTimers();
  const level = LEVELS[g.seed.difficulty];
  const limitMs = level.limit * 10;
  const left = Math.max(0, Math.min(limitMs, msLeft ?? limitMs));
  g.index = i;
  g.phase = "ask";
  const q = question(g.seed, i);
  showQuestion(g.seed, q, { interactive: true });
  $("nextBtn").classList.add("hidden");
  setStatus(g.mode === "multi" ? "Pick before the time runs out." : "");
  renderChips();
  // The clock starts when the question is on screen, not when it was built.
  g.shownAt = performance.now() + (limitMs - left);
  requestAnimationFrame(() => {
    if (g?.phase !== "ask" || g.index !== i) return;
    g.shownAt = performance.now() - (limitMs - left);
    runBar(left / limitMs, 0, left);
    deadlineTimer = setTimeout(() => onPick(-1), left);
  });
}

// An answer from the view, or -1 when the time runs out.
function onPick(pick) {
  if (!g || g.phase !== "ask") return;
  const level = LEVELS[g.seed.difficulty];
  const i = g.index;
  const t = pick === -1 ? level.limit : Math.min(level.limit, Math.max(0, Math.round((performance.now() - g.shownAt) / 10)));
  clearTimeout(deadlineTimer);

  if (g.mode === "multi") {
    // The host decides how it went; until then the pick is just held.
    g.phase = "pending";
    stopBar();
    showPending(pick);
    setStatus(pick === -1 ? "Time's up. Waiting for the others." : "Answer in. Waiting for the others.");
    if (pick !== -1) net?.answer(i, pick, t);
    return;
  }
  g.answers.push([pick, t]);
  reveal(i);
}

function describeAnswer(seed, q, answer, points) {
  const [pick] = answer;
  if (pick === -1) return "Time's up.";
  if (!q.options) {
    const acc = tally(seed, [answer]).accs[0];
    return `${Math.floor(acc / 10)}% close, +${points}`;
  }
  return q.options[pick] === q.answer ? `Right, +${points}` : "Not that one.";
}

function reveal(i) {
  clearTimers();
  g.phase = "answer";
  const q = question(g.seed, i);
  const answer = g.answers[i] ?? [-1, LEVELS[g.seed.difficulty].limit];
  showAnswer(g.seed, q, answer);
  setBar(1 - answer[1] / LEVELS[g.seed.difficulty].limit);
  const { points } = tally(g.seed, g.answers);
  setStatus(describeAnswer(g.seed, q, answer, points[i] ?? 0));
  renderChips();
  if (g.mode === "multi") return;

  const last = i === g.seed.count - 1;
  $("nextLabel").textContent = last ? "See results" : "Next";
  $("nextBtn").classList.remove("hidden");
  revealTimer = setTimeout(next, REVEAL_MS);
}

function next() {
  if (!g || g.phase !== "answer" || g.mode === "multi") return;
  if (g.index + 1 < g.seed.count) ask(g.index + 1);
  else over();
}

function setStatus(text) {
  $("status").textContent = text;
}

/* ---- the timer bar ---- */

let barFrame = 0;

// The seed whose clock the bar shows: the replay's, or the game's.
const barLimitMs = () => LEVELS[(replaySource ?? g)?.seed.difficulty ?? "normal"].limit * 10;

function paintBar(frac, msLeft) {
  $("timerFill").style.transform = `scaleX(${Math.max(0, Math.min(1, frac))})`;
  $("timerBar").classList.toggle("low", frac < 0.3);
  $("timerBar").setAttribute("aria-valuenow", String(Math.round(frac * 100)));
  if (msLeft !== undefined) $("timerText").textContent = `${Math.ceil(msLeft / 1000)}s`;
}

// From one fill to another over `ms`, counting the seconds down as it goes.
function runBar(from, to, ms) {
  cancelAnimationFrame(barFrame);
  const start = performance.now();
  const limitMs = barLimitMs();
  const tick = () => {
    const k = ms > 0 ? Math.min(1, (performance.now() - start) / ms) : 1;
    const frac = from + (to - from) * k;
    paintBar(frac, frac * limitMs);
    if (k < 1) barFrame = requestAnimationFrame(tick);
  };
  tick();
}

function stopBar() {
  cancelAnimationFrame(barFrame);
}

function setBar(frac) {
  stopBar();
  paintBar(frac, frac * barLimitMs());
}

/* ---- the end ---- */

function over({ record } = {}) {
  clearTimers();
  stopBar();
  g.phase = "over";
  g.index = g.seed.count - 1;
  $("liveActions").classList.add("hidden");
  $("nextBtn").classList.add("hidden");
  $("standings").classList.add("hidden");
  renderChips();

  // The server's clock stops now, not whenever the game is submitted, so
  // watching the replay or typing a name costs nothing.
  if (g.ticket) {
    const mine = g;
    g.finish = api
      .finish({ game_id: g.ticket.gameId, answers: g.answers, record: record ?? undefined })
      .catch(() => null)
      .then((res) => {
        mine.finished = res;
        return res;
      });
  }
  showResult();
  const s = getSettings();
  if (g.ticket && s.auto_submit && s.name) submit(s.name);
}

function resetResult() {
  $("result").classList.add("hidden");
  $("replayBar").classList.add("hidden");
  $("submitMsg").textContent = "";
  $("submitted").classList.add("hidden");
  $("notScored").classList.add("hidden");
  $("submitForm").classList.add("hidden");
  $("resultStandings").innerHTML = "";
  $("copySeedLabel").textContent = "Copy seed";
  $("shareLabel").textContent = "Share replay";
}

function resultLine(seed, answers, t) {
  const level = LEVELS[seed.difficulty];
  const avg = (answers.reduce((a, [, cs]) => a + cs, 0) / Math.max(1, answers.length) / 100).toFixed(1);
  const how = seed.difficulty === "expert" ? `Average closeness ${t.accuracy}%` : `${t.right} of ${seed.count} right`;
  const bonus = t.lengthPercent > 100 ? `, +${t.lengthPercent - 100}% for ${seed.count} questions` : "";
  return `${how}, ${avg}s on average. ${level.name}${bonus}.`;
}

function titleFor(t) {
  if (t.accuracy >= 90) return "Brilliant";
  if (t.accuracy >= 60) return "Nicely done";
  if (t.accuracy >= 30) return "Not bad";
  return "Game over";
}

function showResult() {
  const t = tally(g.seed, g.answers);
  showPanel("play");
  resetResult();
  setStatus("");
  if (g.mode === "multi" && g.standings.length) {
    const sorted = [...g.standings].sort((a, b) => b.score - a.score);
    const place = sorted.findIndex((p) => p.me) + 1;
    $("resultTitle").textContent = place === 1 ? "You won" : `You came ${ORDINAL(place)} of ${sorted.length}`;
    renderStandings($("resultStandings"), sorted, { final: true });
  } else {
    $("resultTitle").textContent = titleFor(t);
  }
  $("resultScore").textContent = `${t.total} points`;
  $("resultReason").textContent = resultLine(g.seed, g.answers, t);
  $("resultSeed").textContent = `Seed ${g.seed.text}`;

  if (g.ticket) {
    $("submitForm").classList.remove("hidden");
    $("nameInput").value = getSettings().name ?? "";
    $("submitBtn").disabled = false;
  } else {
    $("notScored").textContent =
      g.mode === "multi"
        ? "This game could not reach the leaderboard when it started, so it is not scored."
        : "This game started offline, or the leaderboard could not be reached, so it is not scored.";
    $("notScored").classList.remove("hidden");
  }

  const guest = g.mode === "multi" && g.role === "guest";
  $("againBtn").classList.toggle("hidden", guest);
  $("againLabel").textContent = "Play again";
  $("newGameLabel").textContent = g.mode === "multi" ? "Leave" : "New game";
  $("result").classList.remove("hidden");
  hydrateIcons($("play"));
  $("resultTitle").focus({ preventScroll: true });
  startReplay(g.seed, g.answers, getSettings().auto_replay);
}

async function submit(name) {
  if (!g?.ticket || g.submitted) return;
  const mine = g;
  const msg = $("submitMsg");
  $("submitBtn").disabled = true;
  msg.textContent = "Adding.";
  try {
    await mine.finish;
    let res = null;
    for (let tries = 0; ; tries++) {
      try {
        res = await api.submit({ game_id: mine.ticket.gameId, name, answers: mine.answers });
        break;
      } catch (err) {
        if (err.code !== "host_pending" || tries >= PENDING_TRIES) throw err;
        msg.textContent = "Waiting for the host to report the game.";
        await new Promise((r) => setTimeout(r, PENDING_RETRY_MS));
      }
    }
    mine.submitted = res;
    saveSettings({ name: res.name });
    if (g !== mine) return;
    msg.textContent = "";
    $("submitForm").classList.add("hidden");
    $("submittedText").textContent = `Added as ${res.name}, ${res.score} points. Best ${res.best_score}, ${ORDINAL(res.rank)} place. Total ${res.total} over ${res.games} games, ${ORDINAL(res.total_rank)} place.`;
    $("submitted").classList.remove("hidden");
  } catch (err) {
    if (g !== mine) return;
    msg.textContent = err.code === "offline" ? "Adding a game needs a connection. Try again when you are back online." : err.message || "That did not go through. Try again in a moment.";
    $("submitBtn").disabled = false;
  }
}

/* ---- standings in a network game ---- */

function renderStandings(el, list, { final = false } = {}) {
  el.innerHTML = list
    .map(
      (p, i) =>
        `<li class="${p.me ? "me" : ""}${p.connected === false ? " gone" : ""}"><span class="st-place">${final ? i + 1 : ""}</span><span class="st-name">${escapeHtml(
          p.name
        )}${p.me ? " (you)" : ""}</span>${
          !final && p.answered ? `<span class="st-done" data-icon="check" aria-label="answered"></span>` : `<span class="st-done"></span>`
        }<span class="st-score">${p.score}</span></li>`
    )
    .join("");
  hydrateIcons(el);
}

/* ---- the replay ---- */

let replaySource = null;

function startReplay(seed, answers, autoplay) {
  replaySource = { seed, answers };
  const { points, accs } = tally(seed, answers);
  const items = answers.map((a, i) => ({
    icon: accs[i] === 1000 ? "correct" : accs[i] === 0 ? "incorrect" : "target",
    text: `+${points[i]}`,
  }));
  $("replayBar").classList.remove("hidden");
  replayer.load(
    answers.map(([, t]) => t * 10),
    items,
    { autoplay }
  );
}

function stopReplay() {
  replayer?.stop();
  replaySource = null;
}

function renderReplay(i, stage, ms) {
  if (!replaySource) return;
  const { seed, answers } = replaySource;
  const q = question(seed, i);
  const answer = answers[i];
  const limit = LEVELS[seed.difficulty].limit;
  showQuestion(seed, q, { interactive: false });
  $("qChip").textContent = `Question ${i + 1} of ${seed.count}`;
  const { points, subtotal } = tally(seed, answers.slice(0, stage === "answer" ? i + 1 : i));
  $("scoreChip").textContent = `Score ${subtotal}`;
  if (stage === "ask") {
    runBar(1, 1 - answer[1] / limit, ms);
    setStatus("");
  } else {
    showAnswer(seed, q, answer);
    setBar(1 - answer[1] / limit);
    setStatus(describeAnswer(seed, q, answer, points[i] ?? 0));
  }
}

/* ---- sharing ---- */

function longLink(seed, answers) {
  const params = new URLSearchParams({ watch: packAnswers(seed, answers), seed: seed.text });
  return `${location.origin}/?${params}`;
}

// A short link when the API can keep the replay, the whole game in the link
// when it cannot, which always works offline.
async function replayLink(src) {
  if (!src.shortId) {
    try {
      const res = await api.saveReplay(src.seed.text, packAnswers(src.seed, src.answers));
      if (/^[A-Za-z0-9]{4,16}$/.test(res?.id ?? "")) src.shortId = res.id;
    } catch {
      // The long link, below.
    }
  }
  return src.shortId ? `${location.origin}/?r=${src.shortId}` : longLink(src.seed, src.answers);
}

async function onShare() {
  const src = watching ?? g;
  if (!src) return;
  const label = $("shareLabel");
  label.textContent = "Making a link";
  const url = await replayLink(src);
  label.textContent = "Share replay";
  if (navigator.share) {
    try {
      await navigator.share({ title: "Color Guess Game replay", text: `Watch this colour guessing game, seed ${src.seed.text}.`, url });
      label.textContent = "Shared";
      return;
    } catch (err) {
      // Dismissed: nothing to say. Refused or unsupported here: copy instead.
      if (err?.name === "AbortError") {
        label.textContent = "Share replay";
        return;
      }
    }
  }
  label.textContent = (await copyText(url)) ? "Link copied" : "Copy failed";
}

// A replay link's parameters: /?watch=...&seed=... carries the whole game,
// /?r=ID points at one the API keeps. Returns what to watch, { id } to
// fetch, { damaged: true }, or null if this is not a replay link.
export function readReplayLink(params) {
  if (params.has("r")) {
    const id = params.get("r");
    return /^[A-Za-z0-9]{4,16}$/.test(id) ? { id } : { damaged: true };
  }
  if (!params.has("watch")) return null;
  const seed = parseSeed(params.get("seed"));
  const answers = seed && unpackAnswers(seed, params.get("watch"));
  return answers ? { seed, answers } : { damaged: true };
}

async function openLink(link) {
  if (link.damaged) return setupMessage("That replay link is damaged, so it cannot be shown.");
  if (!link.id) return watch(link);
  setupMessage("Loading the replay.");
  try {
    const res = await api.replay(link.id);
    const seed = parseSeed(res.seed);
    const answers = seed && unpackAnswers(seed, res.packed);
    if (!answers) throw new Error("damaged");
    watch({ seed, answers, shortId: link.id });
  } catch (err) {
    setupMessage(
      err.code === "offline"
        ? "Opening this replay needs a connection."
        : err.code === "not_found"
          ? "That replay could not be found."
          : "That replay did not load. Try again in a moment."
    );
  }
}

function setupMessage(text) {
  showPanel("setup");
  renderSetup();
  const note = $("linkNote");
  note.textContent = text;
  note.classList.toggle("hidden", !text);
}

function watch(link) {
  if (g && g.phase !== "over") return;
  $("linkNote").classList.add("hidden");
  watching = link;
  showPanel("play");
  resetResult();
  const t = tally(link.seed, link.answers);
  $("levelChip").textContent = LEVELS[link.seed.difficulty].name;
  $("seedChip").textContent = link.seed.text;
  $("liveActions").classList.add("hidden");
  $("standings").classList.add("hidden");
  $("resultTitle").textContent = "A shared replay";
  $("resultScore").textContent = `${t.total} points`;
  $("resultReason").textContent = resultLine(link.seed, link.answers, t);
  $("resultSeed").textContent = `Seed ${link.seed.text}`;
  $("againBtn").classList.remove("hidden");
  $("againLabel").textContent = "Play this seed";
  $("newGameLabel").textContent = "Close replay";
  $("result").classList.remove("hidden");
  hydrateIcons($("play"));
  startReplay(link.seed, link.answers, true);
}

// Leaves a shared replay: the address loses the link, and the page goes
// back to choosing a game.
function closeWatch({ show = true } = {}) {
  if (!watching) return;
  watching = null;
  stopReplay();
  const params = new URLSearchParams(location.search);
  for (const key of ["watch", "seed", "r"]) params.delete(key);
  const rest = params.toString();
  history.replaceState(null, "", location.pathname + (rest ? `?${rest}` : "") + location.hash);
  if (show) toSetup();
}

// "Play this seed": the new-game screen with the seed filled in.
function playSeed(seed) {
  setup.mode = "solo";
  setup.difficulty = seed.difficulty;
  if (COUNTS.includes(seed.count)) setup.count = String(seed.count);
  else {
    setup.count = "custom";
    setup.custom = seed.count;
  }
  saveSetup();
  $("seedInput").value = seed.text;
  toSetup();
  $("startBtn").focus();
}

function toSetup() {
  stopReplay();
  showPanel("setup");
  renderSetup();
}

/* ---- leaving a game ---- */

function disarmQuit() {
  clearTimeout(quitArmed);
  quitArmed = null;
  $("quitBtn").classList.remove("armed");
  $("quitLabel").textContent = "Quit";
}

// Two taps, so a stray one does not throw a game away.
function onQuit() {
  if (!quitArmed) {
    $("quitBtn").classList.add("armed");
    $("quitLabel").textContent = "Tap again to quit";
    quitArmed = setTimeout(disarmQuit, 3000);
    return;
  }
  disarmQuit();
  endGame();
}

// Back to choosing a game, leaving any network game.
export function endGame() {
  clearTimers();
  stopBar();
  if (g?.mode === "multi") net?.leave();
  g = null;
  toSetup();
}

function onAgain() {
  if (watching) return playSeed(watching.seed);
  if (!g) return;
  if (g.mode === "multi") return net?.nextGame();
  // A new game at the same difficulty and length.
  setup.difficulty = g.seed.difficulty;
  $("seedInput").value = "";
  if (COUNTS.includes(g.seed.count)) setup.count = String(g.seed.count);
  else {
    setup.count = "custom";
    setup.custom = g.seed.count;
  }
  setup.mode = "solo";
  saveSetup();
  renderSetup();
  onStart();
}

/* ---- network games, driven by multiplayer.js ---- */

export const multi = {
  // A game starting: the play screen, waiting for the first question.
  begin({ seed, role, ticket = null, netGame }) {
    begin(seed, { mode: "multi", role, ticket });
    g.netGame = netGame;
    g.phase = "ready";
    $("promptHex").textContent = "Get ready";
    $("options").classList.add("hidden");
    $("wheelBox").classList.add("hidden");
    $("compare").classList.add("hidden");
    $("quitLabel").textContent = "Leave";
    setStatus("The first question is coming.");
    return g;
  },
  setTicket(ticket) {
    if (g) g.ticket = ticket;
  },
  countdown(msLeft) {
    if (!g || g.phase !== "ready") return;
    setStatus(`The first question in ${Math.max(1, Math.ceil(msLeft / 1000))}.`);
  },
  // Safe to call on every snapshot: only a new question redraws.
  ask(i, msLeft) {
    if (!g || g.phase === "over") return;
    if (g.index === i && (g.phase === "ask" || g.phase === "pending")) return;
    ask(i, msLeft);
  },
  reveal(i, answers) {
    if (!g || g.phase === "over" || (g.index === i && g.phase === "answer")) return;
    g.index = i;
    g.answers = answers.slice(0, i + 1);
    reveal(i);
  },
  over(answers, record) {
    if (!g || g.phase === "over") return;
    g.answers = answers;
    over({ record });
  },
  standings(list) {
    if (!g) return;
    g.standings = list;
    const sorted = [...list].sort((a, b) => b.score - a.score);
    if (g.phase === "over") renderStandings($("resultStandings"), sorted, { final: true });
    else renderStandings($("standings"), sorted);
  },
  isPlaying: () => Boolean(g && g.mode === "multi" && g.phase !== "over"),
  // A network game on screen, under way or finished.
  inGame: () => Boolean(g && g.mode === "multi"),
};

/* ---- wiring ---- */

export function initGame({ replayLink: shared } = {}) {
  loadSetup();
  initView(onPick);
  replayer = new Replay(renderReplay);

  $("modePick").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-pick]");
    if (!btn) return;
    setup.mode = btn.dataset.pick;
    saveSetup();
    renderSetup();
  });
  $("levelPick").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-level]");
    if (!btn) return;
    setup.difficulty = btn.dataset.level;
    saveSetup();
    renderSetup();
  });
  $("countPick").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-count]");
    if (!btn) return;
    setup.count = btn.dataset.count;
    saveSetup();
    renderSetup();
    if (setup.count === "custom") $("customCount").focus();
  });
  $("customCount").max = String(MAX_QUESTIONS);
  $("customCount").addEventListener("input", (e) => {
    const n = Number(e.target.value);
    if (validCount(n)) {
      setup.custom = n;
      saveSetup();
    }
    renderSeedNote();
  });
  $("seedInput").addEventListener("input", renderSeedNote);
  $("seedClear").addEventListener("click", () => {
    $("seedInput").value = "";
    renderSeedNote();
    $("seedInput").focus();
  });
  $("seedInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") onStart();
  });
  $("startBtn").addEventListener("click", onStart);

  $("nextBtn").addEventListener("click", next);
  $("quitBtn").addEventListener("click", onQuit);
  $("againBtn").addEventListener("click", onAgain);
  $("newGameBtn").addEventListener("click", () => (watching ? closeWatch() : endGame()));
  $("resultBoardBtn").addEventListener("click", () => openLeaderboard());
  $("shareBtn").addEventListener("click", onShare);

  const shownSeed = () => (watching ?? g)?.seed;
  const copySeed = async (labelEl) => {
    const seed = shownSeed();
    if (!seed) return;
    const ok = await copyText(seed.text);
    if (labelEl) labelEl.textContent = ok ? "Copied" : "Copy failed";
  };
  $("copySeedBtn").addEventListener("click", () => copySeed($("copySeedLabel")));
  $("seedChip").addEventListener("click", () => copySeed(null));

  $("submitForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("nameInput").value.trim();
    if (!name) {
      $("submitMsg").textContent = "Enter a name.";
      $("nameInput").focus();
      return;
    }
    submit(name);
  });

  // Number keys pick a swatch.
  document.addEventListener("keydown", (e) => {
    if (!g || g.phase !== "ask" || e.target.closest("input, textarea, .modal-backdrop:not(.hidden)")) return;
    const n = Number(e.key);
    const q = question(g.seed, g.index);
    if (q.options && Number.isInteger(n) && n >= 1 && n <= q.options.length) {
      e.preventDefault();
      onPick(n - 1);
    }
  });

  renderSetup();
  showPanel("setup");
  if (shared) openLink(shared);
}
