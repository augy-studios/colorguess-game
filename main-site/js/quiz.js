// The rules: what each difficulty asks, how a seed becomes its questions,
// what a valid answer looks like, and how right an answer is. Pure, with no
// DOM, so the API imports it and judges a game the way the page played it.
//
// An answer is [pick, t]:
//   pick  Normal and Hard: the index of the swatch picked, or -1 if the time
//         ran out. Expert: the colour picked, 0 to 0xFFFFFF, or -1.
//   t     time taken, in hundredths of a second, 0 to the question's limit.

import { questionRandom } from "./seed.js";
import { distance, isColor, MAX_COLOR } from "./color.js";

export const LEVELS = {
  normal: { name: "Normal", options: 4, limit: 1000, percent: 100 },
  hard: { name: "Hard", options: 6, limit: 1200, percent: 160 },
  expert: { name: "Expert", options: 0, limit: 2500, percent: 250 },
};

// Normal's wrong swatches are at least this far from every other swatch, so
// two never look alike. Hard's sit within HARD_SPREAD of the answer on each
// channel, and at least HARD_MIN from every other swatch, so they look close
// but can still be told apart.
const NORMAL_MIN = 1600;
const HARD_SPREAD = 56;
const HARD_MIN = 420;

// Expert: a pick this close counts in full, and one this far or further
// counts for nothing, with a straight line between. In distance()'s units:
// about 30 and 250 on the usual redmean scale.
export const EXPERT_FULL = 480;
export const EXPERT_ZERO = 4000;

function shuffle(list, rnd) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = rnd() % (i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

const farFromAll = (c, list, min) => list.every((o) => o !== c && distance(o, c) >= min);

function nearby(answer, rnd) {
  const shift = (v) => Math.max(0, Math.min(255, v + (rnd() % (2 * HARD_SPREAD + 1)) - HARD_SPREAD));
  return (shift((answer >> 16) & 255) << 16) | (shift((answer >> 8) & 255) << 8) | shift(answer & 255);
}

// Question `index` of the seed's game: { index, answer, options }, where
// options is null in Expert.
export function question(seed, index) {
  const rnd = questionRandom(seed, index);
  const answer = rnd() & MAX_COLOR;
  const level = LEVELS[seed.difficulty];
  if (!level.options) return { index, answer, options: null };

  const options = [answer];
  // Bounded tries, so a colour in a crowded corner still gets its swatches;
  // past the bound, any distinct colour will do.
  for (let tries = 0; options.length < level.options; tries++) {
    const c = seed.difficulty === "hard" ? nearby(answer, rnd) : rnd() & MAX_COLOR;
    const min = seed.difficulty === "hard" ? HARD_MIN : NORMAL_MIN;
    if (farFromAll(c, options, tries < 400 ? min : 1)) options.push(c);
  }
  return { index, answer, options: shuffle(options, rnd) };
}

export function questions(seed) {
  return Array.from({ length: seed.count }, (_, i) => question(seed, i));
}

// How right an answer is, per mille: 1000 for the right swatch or a close
// enough Expert pick, 0 for a wrong swatch or no answer.
export function accuracy(q, pick) {
  if (pick === -1) return 0;
  if (q.options) return q.options[pick] === q.answer ? 1000 : 0;
  const d = distance(q.answer, pick);
  if (d <= EXPERT_FULL) return 1000;
  if (d >= EXPERT_ZERO) return 0;
  return Math.floor((1000 * (EXPERT_ZERO - d)) / (EXPERT_ZERO - EXPERT_FULL));
}

export function validAnswer(seed, answer) {
  if (!Array.isArray(answer) || answer.length !== 2) return false;
  const [pick, t] = answer;
  const level = LEVELS[seed.difficulty];
  if (!Number.isInteger(t) || t < 0 || t > level.limit) return false;
  if (pick === -1) return true;
  return level.options ? Number.isInteger(pick) && pick >= 0 && pick < level.options : isColor(pick);
}

// A list of answers to the seed's questions, in order. `complete` asks for
// one to every question.
export function validAnswers(seed, answers, { complete = false } = {}) {
  if (!Array.isArray(answers) || answers.length > seed.count) return false;
  if (complete && answers.length !== seed.count) return false;
  return answers.every((a) => validAnswer(seed, a));
}

// A copy holding only what an answer is, so nothing else rides along.
export const cleanAnswers = (answers) => answers.map(([pick, t]) => [pick, t]);
