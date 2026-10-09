// Network games for up to eight players: one device hosts and up to seven
// join with a six character code, over net.js. The host is authoritative,
// per STUN-p2p-spec.md: every player is shown the same question at the same
// time, guests send their picks, and the host decides when a question ends,
// records every answer and sends the whole state back, 20 times a second and
// on every change. A guest shows nothing as decided until a snapshot says so.
//
// The questions themselves never travel: every device builds them from the
// seed, so a snapshot says only which one is up and how long is left.
//
// Messages, beyond the spec's hello, state, bye and full:
//
//   { type: "answer", q, pick, t }   guest to host, a pick for question q
//   { type: "ping" }                 guest to host, the guest's heartbeat
//   { type: "old", v }               host to guest, a different protocol
//
// Seats are kept by a random key each browser holds, sent when it connects,
// so a guest whose page reloads comes back to its own seat and answers.

import { Host, Guest, generateCode, isValidCode, normaliseCode, CODE_LENGTH, PROTOCOL_VERSION } from "./net.js";
import * as game from "./game.js";
import { parseSeed, MAX_QUESTIONS } from "./seed.js";
import { LEVELS, validAnswer, validAnswers } from "./quiz.js";
import { tally } from "./score.js";
import { api } from "./api.js";
import { getSettings } from "./settings.js";
import { qrToSvg } from "./qr.js";
import { copyText, escapeHtml, hydrateIcons, store } from "./ui.js";

const HOST_CODE_KEY = "colorguessr.hostCode";
const LAST_CODE_KEY = "colorguessr.lastCode";
const SEAT_KEY = "colorguessr.seatKey";
const MAX_GUESTS = 7;
const SNAPSHOT_MS = 50;
const TICK_MS = 100;
const PING_MS = 1000;
const HOST_SILENCE_MS = 8000;
// Time, not missed snapshots: at 20 a second a few missed ones is an
// ordinary wifi stall, and a background host tab only ticks once a second.
const GUEST_STALE_MS = 2000;
const COUNTDOWN_MS = 3000;
const REVEAL_MS = 2500;
// Allowed for a pick to travel to the host, on top of the time limit.
const GRACE_MS = 400;
const NAME_MAX = 20;
const PHASES = ["lobby", "countdown", "ask", "answer", "over"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const $ = (id) => document.getElementById(id);

let role = null; // "host" | "guest" | null
let host = null;
let guest = null;
let code = "";
// host: the next game, { seed, difficulty, count }; seed null for the server
// to pick.
let plan = null;
// host: who is connected, by peer id: { id, key, name, lastHeard }.
let players = new Map();
// host: the game under way or just finished. See startGame().
let sess = null;
let netGame = 0;
let starting = false;
let retriedTaken = false;
// guest
let lastState = 0;
let reconnects = 0;
let joinedFor = null;
let wakeLock = null;

/* ---- names and keys ---- */

function cleanName(value, fallback) {
  const name = typeof value === "string" ? Array.from(value.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim()).slice(0, NAME_MAX).join("").trim() : "";
  return name || fallback;
}

function myName() {
  return getSettings().name ?? (role === "host" ? "Host" : "Guest");
}

function seatKey() {
  let key = store.get(SEAT_KEY);
  if (!/^[A-Za-z0-9]{12}$/.test(key ?? "")) {
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    key = Array.from(bytes, (b) => "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"[b % 56]).join("");
    store.set(SEAT_KEY, key);
  }
  return key;
}

/* ---- the adapter game.js calls ---- */

const adapter = {
  host(next) {
    startHosting(next);
  },
  answer(i, pick, t) {
    if (role === "host") recordAnswer(sess?.seats[0], i, pick, t);
    else guest?.send({ type: "answer", q: i, pick, t });
  },
  leave() {
    if (role === "host") stopHosting();
    else if (role === "guest") leaveGuest();
  },
  nextGame() {
    if (role === "host") startGame();
  },
};

/* ---- hosting ---- */

function readStored(key) {
  const value = store.get(key);
  return isValidCode(value) ? normaliseCode(value) : null;
}

function joinLink(c) {
  return `${location.origin}/?join=${c}`;
}

async function startHosting(next) {
  closeAll();
  role = "host";
  plan = { ...next };
  players = new Map();
  sess = null;
  code = readStored(HOST_CODE_KEY) ?? generateCode();
  store.set(HOST_CODE_KEY, code);

  game.showPanel("net");
  $("netTitle").textContent = "Host a game";
  $("hostView").classList.remove("hidden");
  $("hostCode").textContent = code;
  $("hostQr").innerHTML = qrToSvg(joinLink(code));
  $("copyLinkLabel").textContent = "Copy link";
  $("newCodeBtn").classList.remove("hidden");
  $("netStartBtn").classList.remove("hidden");
  $("netRetryBtn").classList.add("hidden");
  renderLobby();
  setNetStatus(navigator.onLine === false ? "Multiplayer needs a connection to pair." : "Setting up the code.");

  const mine = new Host({ maxGuests: MAX_GUESTS });
  host = mine;
  mine.addEventListener("status", ({ detail }) => {
    if (host !== mine) return;
    if (detail.taken && !retriedTaken) {
      // Another tab holds it, or the broker has not let go of it yet.
      retriedTaken = true;
      restartWithFreshCode();
      return;
    }
    if (detail.status === "waiting") retriedTaken = false;
    onHostStatus(detail);
  });
  mine.addEventListener("join", ({ detail }) => {
    if (host === mine) onJoin(detail.id, detail.metadata);
  });
  mine.addEventListener("leave", ({ detail }) => {
    if (host === mine) onLeave(detail.id);
  });
  mine.addEventListener("message", ({ detail }) => {
    if (host === mine) onHostMessage(detail.message, detail.from);
  });

  try {
    await mine.start(code);
  } catch {
    if (host !== mine) return;
    host = null;
    setNetStatus("Could not load pairing. Check your connection.", true);
  }
}

function onHostStatus({ status, message }) {
  if (status === "error") {
    if (game.multi.isPlaying()) renderBar(message);
    else setNetStatus(message, true);
    return;
  }
  if (status === "connected") acquireWakeLock();
  renderLobby();
  renderBar();
}

function onJoin(id, metadata) {
  const key = typeof metadata?.key === "string" && /^[A-Za-z0-9]{12}$/.test(metadata.key) ? metadata.key : id;
  // The same browser twice: the newer link takes over.
  for (const [otherId, p] of players) {
    if (p.key === key && otherId !== id) {
      players.delete(otherId);
      const link = host?.links.get(otherId);
      if (link) host.drop(link);
    }
  }
  const name = cleanName(metadata?.name, `Player ${players.size + 2}`);
  players.set(id, { id, key, name, lastHeard: Date.now() });
  // Back in its seat, if it had one.
  const seat = sess?.seats.find((s) => s.key === key);
  if (seat) {
    seat.id = id;
    seat.connected = true;
    pushStandings();
  }
  renderLobby();
  broadcast();
}

function onLeave(id) {
  players.delete(id);
  const seat = sess?.seats.find((s) => s.id === id);
  if (seat) {
    seat.connected = false;
    pushStandings();
  }
  renderLobby();
  renderBar();
  broadcast();
}

function restartWithFreshCode() {
  store.remove(HOST_CODE_KEY);
  startHosting(plan);
}

function stopHosting() {
  host?.close();
  host = null;
  role = null;
  sess = null;
  players = new Map();
  releaseWakeLock();
}

function renderLobby() {
  const list = $("players");
  const entries =
    role === "host"
      ? [{ name: myName(), me: true, host: true }, ...[...players.values()].map((p) => ({ name: p.name }))]
      : lobbyFromHost ?? [];
  list.innerHTML = entries
    .map(
      (p) =>
        `<li><span data-icon="user"></span><span class="pl-name">${escapeHtml(p.name)}</span>${p.host ? `<span class="pl-tag">host</span>` : ""}${
          p.me ? `<span class="pl-tag">you</span>` : ""
        }</li>`
    )
    .join("");
  hydrateIcons(list);
  if (role !== "host") return;
  const n = players.size;
  $("netStartBtn").disabled = n === 0 || starting;
  if (host?.status === "waiting" || host?.status === "connected") {
    setNetStatus(n === 0 ? "Waiting for players to join." : `${n + 1} of 8 players. Start when everyone is in.`);
  }
}

// The game starts when the host says so, with everyone connected then.
// Later players wait for the next game.
async function startGame() {
  if (role !== "host" || starting) return;
  const guests = [...players.values()].slice(0, MAX_GUESTS);
  if (!guests.length) {
    // Everyone left after the last game: back to the code, to wait for more.
    sess = null;
    game.showPanel("net");
    renderLobby();
    setNetStatus("Wait for at least one other player to join.", true);
    return;
  }
  starting = true;
  $("netStartBtn").disabled = true;
  setNetStatus("Starting.");
  try {
    const { seed, ticket } = await game.getTicket("multi", plan);
    sess = {
      netGame: ++netGame,
      seed,
      gameId: ticket?.gameId ?? null,
      seats: [
        { seat: 0, id: null, key: null, name: myName(), answers: [], connected: true },
        ...guests.map((p, i) => ({ seat: i + 1, id: p.id, key: p.key, name: p.name, answers: [], connected: true })),
      ],
      phase: "countdown",
      q: -1,
      askedAt: 0,
      phaseEnds: Date.now() + COUNTDOWN_MS,
      board: [],
    };
    // Every game after the first gets a fresh seed the server picks.
    plan.seed = null;
    game.multi.begin({ seed, role: "host", ticket, netGame: sess.netGame });
    pushStandings();
    broadcast();
    renderBar();
  } finally {
    starting = false;
    renderLobby();
  }
}

const limitMs = () => LEVELS[sess.seed.difficulty].limit * 10;

function askNext(i) {
  sess.phase = "ask";
  sess.q = i;
  sess.askedAt = Date.now();
  sess.phaseEnds = sess.askedAt + limitMs() + GRACE_MS;
  game.multi.ask(i, limitMs());
  pushStandings();
  broadcast();
}

function revealNow() {
  const limit = LEVELS[sess.seed.difficulty].limit;
  for (const s of sess.seats) if (s.answers.length <= sess.q) s.answers.push([-1, limit]);
  sess.phase = "answer";
  sess.phaseEnds = Date.now() + REVEAL_MS;
  game.multi.reveal(sess.q, sess.seats[0].answers);
  pushStandings();
  broadcast();
}

function finishGame() {
  sess.phase = "over";
  pushStandings();
  // The host reports every seat's answers with its own, so the API can check
  // each guest's submission against what the host saw.
  game.multi.over(
    sess.seats[0].answers,
    sess.seats.map((s) => ({ seat: s.seat, answers: s.answers }))
  );
  broadcast();
}

function recordAnswer(seat, i, pick, t) {
  if (!sess || sess.phase !== "ask" || !seat || i !== sess.q || seat.answers.length !== i || pick === -1) return;
  if (!Number.isInteger(t)) return;
  // A pick can claim to be no quicker than the host could have seen it.
  const seen = Math.round((Date.now() - sess.askedAt + GRACE_MS) / 10);
  const answer = [pick, Math.max(0, Math.min(t, seen, LEVELS[sess.seed.difficulty].limit))];
  if (!validAnswer(sess.seed, answer)) return;
  seat.answers.push(answer);
  pushStandings();
  broadcast();
}

// Scores change only when an answer comes in or a question ends, so they are
// worked out then, not for every snapshot.
function pushStandings() {
  const over = sess.phase === "over";
  sess.board = sess.seats.map((s) => {
    const t = tally(sess.seed, s.answers);
    return {
      seat: s.seat,
      name: s.name,
      score: over ? t.total : t.subtotal,
      answered: sess.phase === "ask" && s.answers.length > sess.q,
      connected: s.connected,
    };
  });
  game.multi.standings(sess.board.map((p) => ({ ...p, me: p.seat === 0 })));
}

function snapshotFor(id) {
  if (!sess) {
    return {
      type: "state",
      game: 0,
      phase: "lobby",
      q: -1,
      msLeft: 0,
      seed: null,
      gameId: null,
      seat: null,
      players: [
        { name: myName(), score: 0, host: true },
        ...[...players.values()].map((p) => ({ name: p.name, score: 0, me: p.id === id })),
      ],
      mine: [],
    };
  }
  const mine = sess.seats.find((s) => s.id === id && s.seat > 0) ?? null;
  const now = Date.now();
  const msLeft = sess.phase === "ask" ? Math.max(0, sess.phaseEnds - GRACE_MS - now) : Math.max(0, sess.phaseEnds - now);
  return {
    type: "state",
    game: sess.netGame,
    phase: sess.phase,
    q: sess.q,
    msLeft: sess.phase === "over" ? 0 : msLeft,
    seed: sess.seed.text,
    gameId: sess.gameId,
    seat: mine ? mine.seat : null,
    players: sess.board.map((p) => ({ name: p.name, score: p.score, answered: p.answered, connected: p.connected, me: mine?.seat === p.seat })),
    mine: mine ? mine.answers : [],
  };
}

function broadcast() {
  if (role !== "host" || !host) return;
  for (const id of host.links.keys()) host.send(snapshotFor(id), id);
}

function onHostMessage(message, from) {
  const p = players.get(from);
  if (p) p.lastHeard = Date.now();

  switch (message.type) {
    case "hello":
      if (message.v !== PROTOCOL_VERSION) {
        host.send({ type: "old", v: PROTOCOL_VERSION }, from);
        return;
      }
      host.send(snapshotFor(from), from);
      return;
    case "answer": {
      const seat = sess?.seats.find((s) => s.id === from && s.seat > 0);
      if (Number.isInteger(message.q) && Number.isInteger(message.t)) recordAnswer(seat, message.q, message.pick, message.t);
      return;
    }
    case "bye": {
      // Leaving on purpose: the seat is freed, and the code stays live for
      // everyone else.
      const link = host.links.get(from);
      if (link) host.drop(link);
      onLeave(from);
      return;
    }
    default:
      // ping, and anything this build does not know: ignored, never thrown on.
      return;
  }
}

function hostTick() {
  if (role !== "host" || !host) return;
  const now = Date.now();
  // A guest silent this long has probably gone; its link is closed.
  for (const [id, p] of players) {
    if (now - p.lastHeard > HOST_SILENCE_MS) {
      const link = host.links.get(id);
      if (link) host.drop(link);
      onLeave(id);
    }
  }
  if (!sess) return;
  if (sess.phase === "countdown") {
    game.multi.countdown(sess.phaseEnds - now);
    if (now >= sess.phaseEnds) askNext(0);
  } else if (sess.phase === "ask") {
    const everyone = sess.seats.filter((s) => s.connected || s.seat === 0).every((s) => s.answers.length > sess.q);
    if (everyone || now >= sess.phaseEnds) revealNow();
  } else if (sess.phase === "answer" && now >= sess.phaseEnds) {
    if (sess.q + 1 < sess.seed.count) askNext(sess.q + 1);
    else finishGame();
  }
}

/* ---- joining ---- */

let lobbyFromHost = null;

export async function join(input) {
  const c = normaliseCode(input);
  if (!isValidCode(c)) {
    const field = $("joinInput");
    field.classList.remove("shake");
    void field.offsetWidth;
    field.classList.add("shake");
    field.focus();
    $("joinNote").textContent = `A code is ${CODE_LENGTH} characters.`;
    return;
  }
  $("joinNote").textContent = "";
  if (role !== "guest" || code !== c) reconnects = 0;
  closeAll();
  role = "guest";
  code = c;
  lastState = 0;

  if (!game.multi.inGame()) {
    game.showPanel("net");
    $("netTitle").textContent = "Join a game";
    $("hostView").classList.add("hidden");
    $("newCodeBtn").classList.add("hidden");
    $("netStartBtn").classList.add("hidden");
    lobbyFromHost = null;
    renderLobby();
  }
  $("netRetryBtn").classList.add("hidden");
  setNetStatus(navigator.onLine === false ? "Multiplayer needs a connection to pair." : `Connecting to ${c}.`);

  const mine = new Guest();
  guest = mine;
  mine.addEventListener("status", ({ detail }) => {
    if (guest === mine) onGuestStatus(detail);
  });
  mine.addEventListener("message", ({ detail }) => {
    if (guest === mine) onGuestMessage(detail.message);
  });

  try {
    await mine.connect(c, { name: myName(), key: seatKey() });
    store.set(LAST_CODE_KEY, c);
  } catch {
    if (guest !== mine) return;
    guest = null;
    setNetStatus("Could not load pairing. Check your connection.", true);
    $("netRetryBtn").classList.remove("hidden");
  }
}

const UNREACHABLE =
  "Could not reach the other device. Both have to be on the same network: join the same wifi, or turn on a hotspot on one and join it from the other. Check the code is still the one on screen.";

function onGuestStatus({ status, message }) {
  const inGame = game.multi.isPlaying();
  if (status === "connected") {
    reconnects = 0;
    acquireWakeLock();
    if (!inGame) setNetStatus("Connected. Waiting for the host to start.");
  } else if (status === "dropped") {
    // Probably coming back: try again quietly a few times.
    if (reconnects < 3) {
      reconnects++;
      setTimeout(() => role === "guest" && guest?.status === "dropped" && join(code), 1500);
    } else if (!inGame) {
      setNetStatus("The connection dropped.", true);
      $("netRetryBtn").classList.remove("hidden");
    }
  } else if (status === "unreachable" || status === "error") {
    const text = status === "unreachable" ? UNREACHABLE : message;
    if (inGame) {
      renderBar(text);
    } else {
      setNetStatus(text, true);
      $("netRetryBtn").classList.remove("hidden");
    }
  }
  renderBar();
}

function cleanPlayers(list) {
  return list.map((p) => ({
    name: cleanName(p.name, "Player"),
    score: p.score,
    answered: p.answered === true,
    connected: p.connected !== false,
    me: p.me === true,
    host: p.host === true,
  }));
}

function validSnapshot(s) {
  if (!Number.isInteger(s.game) || s.game < 0 || !PHASES.includes(s.phase)) return false;
  if (!Number.isInteger(s.q) || s.q < -1 || s.q >= MAX_QUESTIONS) return false;
  if (typeof s.msLeft !== "number" || !(s.msLeft >= 0 && s.msLeft <= 60000)) return false;
  if (!Array.isArray(s.players) || s.players.length < 1 || s.players.length > MAX_GUESTS + 1) return false;
  const okPlayer = (p) =>
    p && typeof p === "object" && typeof p.name === "string" && p.name.length <= 64 && Number.isInteger(p.score) && p.score >= 0 && p.score < 1e8;
  if (!s.players.every(okPlayer)) return false;
  if (s.phase === "lobby") return true;
  const seed = parseSeed(s.seed);
  if (!seed || s.q >= seed.count) return false;
  if (s.seat !== null && !(Number.isInteger(s.seat) && s.seat >= 1 && s.seat <= MAX_GUESTS)) return false;
  if (s.gameId !== null && !(typeof s.gameId === "string" && UUID.test(s.gameId))) return false;
  return validAnswers(seed, s.mine);
}

function onGuestMessage(message) {
  switch (message.type) {
    case "state":
      if (!validSnapshot(message)) return;
      lastState = Date.now();
      applySnapshot(message);
      return;
    case "full":
      setNetStatus("That game already has eight players.", true);
      return;
    case "old":
      setNetStatus("The host's device is on a different version. Reload both and try again.", true);
      return;
    default:
      return;
  }
}

function applySnapshot(s) {
  const list = cleanPlayers(s.players);
  if (s.phase === "lobby" || s.seat === null) {
    lobbyFromHost = list;
    if (!game.multi.inGame()) {
      game.showPanel("net");
      renderLobby();
      setNetStatus(
        s.phase === "lobby" || s.phase === "over"
          ? "Connected. Waiting for the host to start."
          : "A game is under way. You will play in the next one."
      );
    }
    return;
  }

  const seed = parseSeed(s.seed);
  let g = game.current();
  if (!g || g.mode !== "multi" || g.netGame !== s.game) {
    g = game.multi.begin({ seed, role: "guest", netGame: s.game });
    joinedFor = null;
  }
  // This player's own start ticket, for the leaderboard.
  if (s.gameId && joinedFor !== s.game) {
    joinedFor = s.game;
    const forGame = g;
    api
      .join(s.gameId, s.seat)
      .then(() => {
        if (game.current() === forGame) game.multi.setTicket({ gameId: s.gameId });
      })
      .catch(() => {
        // Not scored for this player; the game plays the same.
      });
  }
  const mine = s.mine.map(([pick, t]) => [pick, t]);
  if (s.phase === "countdown") game.multi.countdown(s.msLeft);
  else if (s.phase === "ask") game.multi.ask(s.q, s.msLeft);
  else if (s.phase === "answer") game.multi.reveal(s.q, mine);
  else if (s.phase === "over") game.multi.over(mine);
  game.multi.standings(list);
  renderBar();
}

function leaveGuest() {
  guest?.leave();
  guest = null;
  role = null;
  store.remove(LAST_CODE_KEY);
  releaseWakeLock();
}

/* ---- both ---- */

function closeAll() {
  host?.close();
  host = null;
  guest?.close();
  guest = null;
  sess = null;
}

function setNetStatus(text, error = false) {
  const el = $("netStatus");
  el.textContent = text;
  el.classList.toggle("error", error);
}

// The line under the question in a network game.
function renderBar(problem) {
  const bar = $("netBar");
  const g = game.current();
  if (!g || g.mode !== "multi") {
    bar.classList.add("hidden");
    return;
  }
  let tone = "busy";
  let text;
  if (role === "host") {
    const n = host?.links.size ?? 0;
    tone = n ? "ok" : "warn";
    text = n ? `Hosting, ${n} connected` : `Nobody connected. They can rejoin with ${code}.`;
  } else if (role === "guest") {
    const fresh = Date.now() - lastState < GUEST_STALE_MS;
    if (guest?.status === "connected" && fresh) {
      tone = "ok";
      text = "Connected to the host";
    } else if (guest?.status === "connected") {
      tone = "warn";
      text = "The connection looks stale.";
    } else if (guest?.status === "connecting" || guest?.status === "dropped") {
      text = "Reconnecting.";
    } else {
      tone = "error";
      text = "Disconnected.";
    }
  } else {
    tone = "error";
    text = "Not connected.";
  }
  if (problem) {
    tone = "error";
    text = problem;
  }
  bar.dataset.tone = tone;
  $("netBarText").textContent = text;
  bar.classList.remove("hidden");
}

async function acquireWakeLock() {
  try {
    if (!wakeLock && "wakeLock" in navigator && document.visibilityState === "visible") {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => {
        wakeLock = null;
      });
    }
  } catch {
    // Refused or unsupported: the screen may sleep, nothing else changes.
  }
}

function releaseWakeLock() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

export function initMultiplayer({ joinCode } = {}) {
  game.setNet(adapter);

  $("joinForm").addEventListener("submit", (e) => {
    e.preventDefault();
    join($("joinInput").value);
  });
  $("joinInput").addEventListener("input", (e) => {
    const c = normaliseCode(e.target.value);
    if (c !== e.target.value) e.target.value = c;
  });
  $("copyLinkBtn").addEventListener("click", async () => {
    $("copyLinkLabel").textContent = (await copyText(joinLink(code))) ? "Copied" : "Copy failed";
  });
  $("newCodeBtn").addEventListener("click", () => {
    if (role === "host" && !sess) restartWithFreshCode();
  });
  $("netStartBtn").addEventListener("click", startGame);
  $("netRetryBtn").addEventListener("click", () => {
    if (code) join(code);
  });
  $("netCancelBtn").addEventListener("click", () => {
    adapter.leave();
    game.endGame();
  });

  // The steady beat, which doubles as the host's heartbeat.
  setInterval(() => role === "host" && sess && broadcast(), SNAPSHOT_MS);
  setInterval(() => {
    hostTick();
    if (role === "guest") renderBar();
  }, TICK_MS);
  setInterval(() => role === "guest" && guest?.send({ type: "ping" }), PING_MS);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (role && (host?.links.size || guest?.status === "connected")) acquireWakeLock();
    // Back from the background with a channel that died meanwhile.
    if (role === "guest" && guest?.status === "dropped") join(code);
  });

  // From a join link, or from last time.
  const initial = normaliseCode(joinCode) || readStored(LAST_CODE_KEY) || "";
  if (initial) {
    $("joinInput").value = initial;
    if (joinCode) game.setMode("multi");
  }
  hydrateIcons($("net"));
}
