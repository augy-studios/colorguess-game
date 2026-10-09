// POST /api/game/finish  { game_id, client_key, answers, record? }
//   -> { elapsed_ms }
// Sent by the page the moment a game ends, so the player's clock stops then
// and not whenever somebody gets round to submitting. The host of a
// multiplayer game sends `record` too: every seat's answers as it saw them,
// [{ seat, answers }], which each guest's submission is then held to.

import { endpoint, HttpError, clientKey, gameId, limit } from "../_lib/http.js";
import { rest, rpc } from "../_lib/supabase.js";
import { readAnswers, readRecord, seedOf } from "../_lib/verify.js";

const REFUSALS = {
  not_found: [404, "That game does not exist."],
  expired: [410, "That game started more than 6 hours ago."],
  not_yours: [403, "That game was started in a different browser."],
  mismatch: [409, "That game was already reported with other answers."],
};

export default endpoint("POST", async ({ req, body }) => {
  const id = gameId(body.game_id);
  const key = clientKey(body.client_key);

  await limit(req, "finish", 600, 60);

  const [game] = (await rest(`colorguessr_games?id=eq.${id}&select=seed,mode`)) ?? [];
  if (!game) throw new HttpError(404, "not_found", REFUSALS.not_found[1]);
  const seed = seedOf(game);
  const answers = readAnswers(seed, body.answers);
  const record = game.mode === "multi" ? readRecord(seed, body.record) : null;

  const [row] =
    (await rpc("colorguessr_finish", { p_game_id: id, p_client_key: key, p_answers: answers, p_record: record })) ?? [];
  if (row?.status !== "ok") {
    const [status, message] = REFUSALS[row?.status] ?? [500, "Could not record the end of the game."];
    throw new HttpError(status, REFUSALS[row?.status] ? row.status : "server", message);
  }
  return { elapsed_ms: Date.parse(row.finished_at) - Date.parse(row.started_at) };
});
