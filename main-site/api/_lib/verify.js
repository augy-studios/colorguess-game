// Rebuilds a submitted game from its seed with the same modules the browser
// plays with, and works out what it is worth. Nothing a browser says about a
// game is taken on trust: the questions come from the seed, the answers are
// checked against them, their claimed times are held against the server's
// own clock, and the score is computed here.
//
// What this cannot do is prove a person picked the colours: anyone can read
// a hex code. It is meant to stop forged scores, scripted reflexes and games
// played at leisure, not to prove who was playing.

import { parseSeed } from "../../js/seed.js";
import { LEVELS, accuracy, cleanAnswers, question, validAnswers } from "../../js/quiz.js";
import { tally } from "../../js/score.js";
import { HttpError } from "./http.js";

// Answers can claim this much more time than the server saw pass: the start
// ticket's round trip, and a little drift.
const EARLY_SLACK_MS = 3000;
// A solo game may run this much longer than its answers add up to: per
// question, the 1.5 s the answer stays up and time to draw the next, then a
// little more for the whole game.
const SOLO_GAP_MS = 2500;
const SOLO_SLACK_MS = 20000;
// A multiplayer game waits on the slowest player, so it is held to the time
// limit instead: every question at full length, the countdown, the 2.5 s
// reveal and the network's grace, then some.
const MULTI_GAP_MS = 6000;
const MULTI_SLACK_MS = 60000;
// Right answers quicker than these, in hundredths, are reflexes nobody has.
// A couple are allowed, for a lucky tap on the right swatch.
const QUICK_CS = 30;
const EXPERT_QUICK_CS = 100;
const QUICK_ALLOWED = 2;

export function seedOf(game) {
  const seed = parseSeed(game.seed);
  if (!seed) throw new HttpError(500, "bad_seed");
  return seed;
}

// A whole game's answers, from a request.
export function readAnswers(seed, value) {
  if (!validAnswers(seed, value, { complete: true })) {
    throw new HttpError(400, "bad_answers", "Those answers could not be read.");
  }
  return cleanAnswers(value);
}

// The host's record of every seat, from a request, or null.
export function readRecord(seed, value) {
  if (value == null) return null;
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) throw new HttpError(400, "bad_record");
  const seats = new Set();
  return value.map((entry) => {
    const seat = entry?.seat;
    if (!Number.isInteger(seat) || seat < 0 || seat > 7 || seats.has(seat)) throw new HttpError(400, "bad_record");
    seats.add(seat);
    return { seat, answers: readAnswers(seed, entry.answers) };
  });
}

export const sameAnswers = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Holds a game's timing against the server's clock, then scores it.
// elapsedMs: from the player's ticket to the game's end.
export function judge(game, seed, answers, elapsedMs) {
  const claimed = answers.reduce((sum, [, t]) => sum + t * 10, 0);
  if (claimed > elapsedMs + EARLY_SLACK_MS) {
    throw new HttpError(409, "clock", "That game claims more time than had passed.");
  }
  const allowed =
    game.mode === "multi"
      ? seed.count * (LEVELS[seed.difficulty].limit * 10 + MULTI_GAP_MS) + MULTI_SLACK_MS
      : claimed + seed.count * SOLO_GAP_MS + SOLO_SLACK_MS;
  if (elapsedMs > allowed) {
    throw new HttpError(409, "over_time", "That game took far longer than its answers say.");
  }

  let quick = 0;
  answers.forEach(([pick, t], i) => {
    const acc = accuracy(question(seed, i), pick);
    if (seed.difficulty === "expert" ? acc >= 500 && t < EXPERT_QUICK_CS : acc === 1000 && t < QUICK_CS) quick++;
  });
  if (quick > QUICK_ALLOWED) {
    throw new HttpError(409, "too_fast", "Too many answers came quicker than anyone can react.");
  }

  return tally(seed, answers);
}
