// Game seeds. A seed decides every question in a game: each hex code asked,
// and in Normal and Hard the swatches offered and their order. The same seed
// and the same answers are always the same game, which is what lets a seed
// be shared and replayed, and lets the API check a game.
//
// Written as "N10-BXK4-M9TR": the difficulty's letter (N Normal, H Hard,
// X Expert) and the number of questions, then the eight characters of the
// seed proper. Pasting one sets the difficulty and the length too.
//
// Integer arithmetic only. Math.random and the float maths functions can
// differ between browsers, and would make a game replay differently on the
// server.

const ALPHABET = "BCDFGHJKLMNPQRSTVWXYZ23456789";
const BODY_LENGTH = 8;

export const DIFFICULTIES = ["normal", "hard", "expert"];
const LETTER = { normal: "N", hard: "H", expert: "X" };
const FROM_LETTER = { N: "normal", H: "hard", X: "expert" };

// Questions in a game: the presets, and the most a custom game can have.
export const COUNTS = [5, 10, 20];
export const MAX_QUESTIONS = 50;

export const validCount = (n) => Number.isInteger(n) && n >= 1 && n <= MAX_QUESTIONS;

// 32 bit string hash (cyrb53's mixing, one half of it).
export function hashString(text) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 ^ h2) >>> 0;
}

// mulberry32: a small, well mixed generator of unsigned 32 bit integers.
export function randomSource(seedNumber) {
  let a = seedNumber >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
}

function randomBody() {
  // Bytes at or above the limit would make some characters likelier.
  const limit = 256 - (256 % ALPHABET.length);
  let body = "";
  while (body.length < BODY_LENGTH) {
    const [byte] = globalThis.crypto.getRandomValues(new Uint8Array(1));
    if (byte < limit) body += ALPHABET[byte % ALPHABET.length];
  }
  return body;
}

const isBody = (s) => s.length === BODY_LENGTH && [...s].every((c) => ALPHABET.includes(c));

function build(difficulty, count, body) {
  return {
    difficulty,
    count,
    body,
    text: `${LETTER[difficulty]}${count}-${body.slice(0, 4)}-${body.slice(4)}`,
  };
}

export function newSeed(difficulty = "normal", count = 10) {
  if (!DIFFICULTIES.includes(difficulty) || !validCount(count)) return null;
  return build(difficulty, count, randomBody());
}

// Whatever was typed or pasted, forgiving about case, spaces and dashes.
// The last eight characters are the seed proper; before them, the letter and
// the count. Eight characters on their own take the difficulty and count
// from `fallback`, when one is given. null if it is not a seed.
export function parseSeed(input, fallback = null) {
  const raw = String(input ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (raw.length < BODY_LENGTH) return null;
  const body = raw.slice(-BODY_LENGTH);
  if (!isBody(body)) return null;
  const head = raw.slice(0, -BODY_LENGTH);
  if (!head) {
    if (!fallback || !DIFFICULTIES.includes(fallback.difficulty) || !validCount(fallback.count)) return null;
    return build(fallback.difficulty, fallback.count, body);
  }
  const m = /^([NHX])([1-9][0-9]?)$/.exec(head);
  if (!m) return null;
  const count = Number(m[2]);
  return validCount(count) ? build(FROM_LETTER[m[1]], count, body) : null;
}

// The dice for one question. Keyed by the question's number rather than drawn
// from one running stream, so any question can be built on its own.
export function questionRandom(seed, index) {
  return randomSource(hashString(`q|${seed.text}|${index}`));
}
