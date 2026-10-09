// A game's answers packed into a few bytes, for replay links. Pure, so the
// API checks a replay it is asked to keep with the same code that opens it.
//
// Each answer is two bytes: three bits of what was picked and thirteen of
// the time taken in hundredths. Normal and Hard put the swatch's index plus
// one in the three bits, 0 for no answer. Expert puts 1 there and the colour
// in three more bytes, or 0 for no answer and nothing more. The whole is
// base64url. A damaged link unpacks to null, never to a different game.

import { validAnswers } from "./quiz.js";

function toBase64Url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text) {
  if (typeof text !== "string" || !/^[A-Za-z0-9_-]*$/.test(text) || text.length > 400) return null;
  try {
    const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

export function packAnswers(seed, answers) {
  const expert = seed.difficulty === "expert";
  const bytes = [];
  for (const [pick, t] of answers) {
    const code = pick === -1 ? 0 : expert ? 1 : pick + 1;
    const head = (code << 13) | t;
    bytes.push(head >> 8, head & 255);
    if (expert && pick !== -1) bytes.push((pick >> 16) & 255, (pick >> 8) & 255, pick & 255);
  }
  return toBase64Url(bytes);
}

// The answers a packed string stands for, or null if it is damaged.
export function unpackAnswers(seed, packed) {
  const bytes = fromBase64Url(packed);
  if (!bytes) return null;
  const expert = seed.difficulty === "expert";
  const answers = [];
  let i = 0;
  while (i < bytes.length) {
    if (i + 2 > bytes.length) return null;
    const head = (bytes[i] << 8) | bytes[i + 1];
    i += 2;
    const code = head >> 13;
    const t = head & 0x1fff;
    if (code === 0) {
      answers.push([-1, t]);
    } else if (expert) {
      if (code !== 1 || i + 3 > bytes.length) return null;
      answers.push([(bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2], t]);
      i += 3;
    } else {
      answers.push([code - 1, t]);
    }
  }
  return validAnswers(seed, answers) ? answers : null;
}
