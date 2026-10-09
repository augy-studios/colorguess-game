#!/usr/bin/env node
// Tests the modules the browser and the API share: seeds, questions,
// scoring, replay packing, and the API's checks on a finished game, without
// a database.
//
// Run: node scripts/test-game.mjs

import { DIFFICULTIES, MAX_QUESTIONS, newSeed, parseSeed } from "../main-site/js/seed.js";
import { LEVELS, accuracy, question, questions, validAnswers } from "../main-site/js/quiz.js";
import { distance } from "../main-site/js/color.js";
import { lengthPercent, tally } from "../main-site/js/score.js";
import { packAnswers, unpackAnswers } from "../main-site/js/record.js";
import { judge, readAnswers, readRecord } from "../main-site/api/_lib/verify.js";

let failures = 0;
function check(label, ok) {
  if (!ok) {
    failures++;
    console.error(`  FAIL ${label}`);
  }
}

// A game answered by `pick(q, i)` in `t` hundredths a question.
function play(seed, pick, t = 250) {
  return questions(seed).map((q, i) => [pick(q, i), t]);
}
const right = (q) => (q.options ? q.options.indexOf(q.answer) : q.answer);
// In Expert, black or white, whichever is further: at least half of black to
// white away, well past where a pick stops scoring.
const far = (c) => (distance(c, 0) > distance(c, 0xffffff) ? 0 : 0xffffff);
const wrong = (q) => (q.options ? (q.options.indexOf(q.answer) + 1) % q.options.length : far(q.answer));

console.log("seeds");
for (const d of DIFFICULTIES) {
  for (const n of [1, 5, 10, 20, 37, MAX_QUESTIONS]) {
    const s = newSeed(d, n);
    check(`${s.text} parses back`, parseSeed(s.text)?.text === s.text);
    check(`${s.text} forgiving`, parseSeed(` ${s.text.toLowerCase().replace(/-/g, " ")} `)?.text === s.text);
  }
}
check("bare body takes the fallback", parseSeed("BXK4M9TR", { difficulty: "hard", count: 20 })?.text === "H20-BXK4-M9TR");
check("bare body without a fallback is refused", parseSeed("BXK4M9TR") === null);
check("over 50 questions refused", parseSeed("N51-BXK4-M9TR") === null);
check("zero questions refused", parseSeed("N0-BXK4-M9TR") === null);
check("a vowel is refused", parseSeed("N10-BXK4-M9TA") === null);

console.log("questions");
for (const d of DIFFICULTIES) {
  for (let k = 0; k < 40; k++) {
    const s = newSeed(d, 20);
    const a = questions(s);
    const b = questions(parseSeed(s.text));
    check(`${s.text} is the same game twice`, JSON.stringify(a) === JSON.stringify(b));
    for (const q of a) {
      if (!q.options) continue;
      check(`${s.text} q${q.index} has its options`, q.options.length === LEVELS[d].options);
      check(`${s.text} q${q.index} has the answer once`, q.options.filter((c) => c === q.answer).length === 1);
      check(`${s.text} q${q.index} options distinct`, new Set(q.options).size === q.options.length);
    }
  }
}
// A fixed seed always asks the same thing, on every engine.
check("fixed seed, fixed question", question(parseSeed("N10-BXK4-M9TR"), 0).answer === question(parseSeed("n10bxk4m9tr"), 0).answer);

console.log("accuracy and scoring");
const xs = parseSeed("X10-BXK4-M9TR");
const xq = question(xs, 0);
check("exact Expert pick is full marks", accuracy(xq, xq.answer) === 1000);
check("a far Expert pick is nothing", accuracy(xq, far(xq.answer)) === 0);
check("a near Expert pick is partial", (() => {
  const a = accuracy(xq, xq.answer ^ 0x202020);
  return a > 0 && a <= 1000;
})());
check("no pick is nothing", accuracy(xq, -1) === 0);
check("length bonus", lengthPercent(5) === 100 && lengthPercent(10) === 108 && lengthPercent(20) === 125 && lengthPercent(50) === 150);
for (const d of DIFFICULTIES) {
  const s = newSeed(d, 10);
  const perfect = tally(s, play(s, right, 100));
  const slow = tally(s, play(s, right, LEVELS[d].limit));
  const none = tally(s, play(s, wrong));
  check(`${d}: perfect is 100% accurate`, perfect.accuracy === 100);
  check(`${d}: quicker scores more`, perfect.total > slow.total);
  check(`${d}: all wrong scores nothing`, none.total === 0);
  check(`${d}: later questions worth more`, perfect.points[9] > perfect.points[0]);
}
const n10 = newSeed("normal", 10);
const h10 = parseSeed(n10.text.replace(/^N/, "H"));
const x10 = parseSeed(n10.text.replace(/^N/, "X"));
const best = (s) => tally(s, play(s, right, 100)).total;
check("harder levels score more", best(n10) < best(h10) && best(h10) < best(x10));

console.log("replay links");
for (const d of DIFFICULTIES) {
  const s = newSeed(d, MAX_QUESTIONS);
  const answers = play(s, (q, i) => (i % 7 === 3 ? -1 : i % 2 ? right(q) : wrong(q)), 777);
  answers[5] = [-1, LEVELS[d].limit];
  const packed = packAnswers(s, answers);
  check(`${d}: round trip`, JSON.stringify(unpackAnswers(s, packed)) === JSON.stringify(answers));
  check(`${d}: fits the replay table`, packed.length <= 400);
  check(`${d}: damaged link is refused`, unpackAnswers(s, packed.slice(0, -1) + "!") === null);
}
const ns = parseSeed("N5-BXK4-M9TR");
check("a pick past the swatches is refused", unpackAnswers(ns, packAnswers(ns, [[5, 100]])) === null);
check("a time past the limit is refused", !validAnswers(ns, [[0, 1001]]));
check("too many answers are refused", !validAnswers(ns, play(parseSeed("N6-BXK4-M9TR"), right)));

console.log("the API's checks");
const expectCode = (label, code, fn) => {
  try {
    fn();
    check(`${label}: expected ${code}`, code === null);
  } catch (err) {
    check(`${label}: expected ${code}, got ${err.code}`, err.code === code);
  }
};
const solo = { mode: "solo" };
const multi = { mode: "multi" };
const s10 = newSeed("normal", 10);
const fair = play(s10, right, 180);
const claimedMs = 10 * 1800;
expectCode("a fair game", null, () => judge(solo, s10, fair, claimedMs + 10 * 1500));
expectCode("more time claimed than passed", "clock", () => judge(solo, s10, fair, claimedMs - 5000));
expectCode("a game left open for an hour", "over_time", () => judge(solo, s10, fair, 3600000));
expectCode("multiplayer waits on others", null, () => judge(multi, s10, fair, 10 * 10000));
expectCode("inhuman reflexes", "too_fast", () => judge(solo, s10, play(s10, right, 12), 30000));
expectCode("one lucky tap is fine", null, () => {
  const a = play(s10, right, 180);
  a[0] = [a[0][0], 10];
  judge(solo, s10, a, claimedMs + 15000);
});
expectCode("half a game", "bad_answers", () => readAnswers(s10, fair.slice(0, 5)));
expectCode("a record with one seat twice", "bad_record", () => readRecord(s10, [{ seat: 0, answers: fair }, { seat: 0, answers: fair }]));
expectCode("a fair record", null, () => readRecord(s10, [{ seat: 0, answers: fair }, { seat: 3, answers: fair }]));

if (failures) {
  console.error(`\n${failures} failed.`);
  process.exit(1);
}
console.log("\nall passed.");
