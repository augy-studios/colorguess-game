// Scoring. The score grows as the game goes on, one answer at a time, and
// the API recomputes it from the seed and the answers; it never takes a
// score from a browser. Integers throughout, so the page and the server
// always agree.
//
// Each answer is worth up to 100 points, scaled by:
//   how right it was     accuracy(), all or nothing outside Expert
//   how quickly          100% answering at once, down to 50% at the buzzer
//   the difficulty       Normal 100%, Hard 160%, Expert 250%
//   how far in it is     the first question 100%, rising evenly to 150%
//                        on the last
// The game's total is then scaled by its length: 5 questions or fewer 100%,
// each one more adding 5/3 of a percent, up to 150% from 35 questions.

import { LEVELS, accuracy, question } from "./quiz.js";

const BASE = 100;

export function speedPermille(t, limit) {
  const used = Math.max(0, Math.min(limit, t));
  return 500 + Math.floor((500 * (limit - used)) / limit);
}

export function progressPercent(index, count) {
  return count > 1 ? 100 + Math.floor((50 * index) / (count - 1)) : 100;
}

export function lengthPercent(count) {
  return 100 + Math.min(50, Math.max(0, Math.floor(((count - 5) * 5) / 3)));
}

// Points for one answer to question `q` of the seed's game.
export function answerPoints(seed, q, [pick, t]) {
  const level = LEVELS[seed.difficulty];
  const acc = accuracy(q, pick);
  if (!acc) return 0;
  return Math.floor(
    (BASE * acc * speedPermille(t, level.limit) * level.percent * progressPercent(q.index, seed.count)) / 1e10
  );
}

// Everything about a game's answers so far. `total` includes the length
// bonus only once every question has an answer.
export function tally(seed, answers) {
  const points = [];
  const accs = [];
  for (let i = 0; i < answers.length; i++) {
    const q = question(seed, i);
    accs.push(accuracy(q, answers[i][0]));
    points.push(answerPoints(seed, q, answers[i]));
  }
  const subtotal = points.reduce((a, b) => a + b, 0);
  const complete = answers.length === seed.count;
  const bonus = complete ? lengthPercent(seed.count) : 100;
  return {
    points,
    accs,
    subtotal,
    lengthPercent: bonus,
    total: Math.floor((subtotal * bonus) / 100),
    // Average accuracy in percent: the share answered right, or in Expert
    // how close the picks were on average.
    accuracy: answers.length ? Math.floor(accs.reduce((a, b) => a + b, 0) / answers.length / 10) : 0,
    right: accs.filter((a) => a === 1000).length,
  };
}
