// POST /api/replay/save  { seed, packed } -> { id }
// Keeps a finished game's replay behind a short link, /?r=<id>. packed is
// the answers as js/record.js packs them for the long link, which is checked
// with the same code before it is kept. The same game shared twice gets the
// same id.

import { randomInt } from "node:crypto";
import { endpoint, HttpError, limit } from "../_lib/http.js";
import { rpc } from "../_lib/supabase.js";
import { parseSeed } from "../../js/seed.js";
import { unpackAnswers } from "../../js/record.js";

const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const ID_LENGTH = 7;

const newId = () => Array.from({ length: ID_LENGTH }, () => ID_ALPHABET[randomInt(ID_ALPHABET.length)]).join("");

export default endpoint("POST", async ({ req, body }) => {
  const seed = parseSeed(body.seed);
  if (!seed) throw new HttpError(400, "bad_seed");
  const answers = typeof body.packed === "string" ? unpackAnswers(seed, body.packed) : null;
  if (!answers || answers.length !== seed.count) throw new HttpError(400, "bad_replay", "Only a finished game can be shared.");

  await limit(req, "replay", 600, 30);

  // A clash with another replay's id is all but impossible at 62^7, and is
  // simply tried again.
  for (let tries = 0; tries < 3; tries++) {
    const id = await rpc("colorguessr_save_replay", { p_id: newId(), p_seed: seed.text, p_packed: body.packed });
    if (typeof id === "string") return { id };
  }
  throw new HttpError(500, "server");
});
