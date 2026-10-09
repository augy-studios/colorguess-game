// POST /api/game/start
//   { client_key, mode, seed?, difficulty?, count? }
//   -> { game_id, seed, server_seed, created_at }
// The start ticket. A game can only go on the leaderboard if it began here,
// which is what gives it a start time no browser can move. Games started
// offline play the same; they just have no ticket.
//
// mode is "solo" or "multi"; a multiplayer game's guests then take seats
// with /api/game/join. With no seed, the server picks one at `difficulty`
// ("normal", "hard" or "expert") and `count` questions. A pasted seed
// carries its own, and each name can put it on the board only once.

import { endpoint, HttpError, clientKey, limit } from "../_lib/http.js";
import { rpc } from "../_lib/supabase.js";
import { DIFFICULTIES, newSeed, parseSeed, validCount } from "../../js/seed.js";

export default endpoint("POST", async ({ req, body }) => {
  const key = clientKey(body.client_key);
  const mode = body.mode;
  if (mode !== "solo" && mode !== "multi") throw new HttpError(400, "bad_mode");

  let seed;
  const serverSeed = body.seed == null;
  if (serverSeed) {
    const count = Number(body.count);
    if (!DIFFICULTIES.includes(body.difficulty)) throw new HttpError(400, "bad_difficulty");
    if (!validCount(count)) throw new HttpError(400, "bad_count");
    seed = newSeed(body.difficulty, count);
  } else {
    seed = parseSeed(body.seed);
    if (!seed) throw new HttpError(400, "bad_seed");
  }

  await limit(req, "start", 600, 60);

  const [row] =
    (await rpc("colorguessr_start", {
      p_mode: mode,
      p_seed: seed.text,
      p_difficulty: seed.difficulty,
      p_questions: seed.count,
      p_server_seed: serverSeed,
      p_client_key: key,
    })) ?? [];
  if (!row) throw new HttpError(502, "upstream");

  // Now and then, clear out what nobody will submit.
  if (Math.random() < 0.02) rpc("colorguessr_prune", {}).catch(() => {});

  return { game_id: row.game_id, seed: seed.text, server_seed: serverSeed, created_at: row.created_at };
});
