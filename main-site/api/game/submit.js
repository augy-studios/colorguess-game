// POST /api/game/submit  { game_id, client_key, name, answers }
//   -> { name, score, accuracy, elapsed_ms, rank, best_score, total, games,
//        total_rank }
// answers is the whole game, [pick, t] per question. The score is computed
// here from the seed, the answers and the server's own times; see verify.js
// for the checks on the game and the SQL functions for the rest.

import { endpoint, HttpError, clientKey, gameId, limit } from "../_lib/http.js";
import { cleanName } from "../_lib/names.js";
import { rest, rpc } from "../_lib/supabase.js";
import { judge, readAnswers, sameAnswers, seedOf } from "../_lib/verify.js";

// A guest may submit before the host has reported the game. For this long
// after the guest's own report, it is asked to wait; after that, it goes
// through without the host's record to check against.
const HOST_WAIT_MS = 30000;

const REFUSALS = {
  not_found: [404, "That game does not exist."],
  expired: [410, "That game started more than 6 hours ago."],
  not_yours: [403, "That game was started in a different browser."],
  already_submitted: [409, "That game is already on the leaderboard."],
  mismatch: [409, "Those answers do not match the ones reported when the game ended."],
  too_fast: [409, "That game was played too quickly to count."],
  same_name: [409, "Another player in that game is already on the leaderboard under that name. Pick another."],
  overlap: [409, "That game was played at the same time as another one already on the leaderboard under this name."],
  seed_used: [409, "That name already has this seed on the leaderboard. Try a new seed."],
};

export default endpoint("POST", async ({ req, body }) => {
  const id = gameId(body.game_id);
  const key = clientKey(body.client_key);
  const name = cleanName(body.name);

  await limit(req, "submit", 600, 30);

  const [game] = (await rest(`colorguessr_games?id=eq.${id}&select=*`)) ?? [];
  if (!game) throw new HttpError(404, "not_found", REFUSALS.not_found[1]);
  const [ticket] =
    (await rest(`colorguessr_tickets?game_id=eq.${id}&client_key=eq.${encodeURIComponent(key)}&select=*`)) ?? [];
  if (!ticket) throw new HttpError(403, "not_yours", REFUSALS.not_yours[1]);

  const seed = seedOf(game);
  const answers = readAnswers(seed, body.answers);

  // The game's end as the server saw it: when the page reported it, if the
  // answers then are these answers, and otherwise now.
  const reported = ticket.finished_at && sameAnswers(ticket.answers, answers);
  const endedAt = reported ? Date.parse(ticket.finished_at) : Date.now();
  const elapsed = endedAt - Date.parse(ticket.created_at);

  // A multiplayer guest is held to what the host saw of its seat.
  if (game.mode === "multi" && ticket.seat > 0) {
    const entry = Array.isArray(game.host_record) ? game.host_record.find((e) => e?.seat === ticket.seat) : null;
    if (game.host_record && (!entry || !sameAnswers(entry.answers, answers))) {
      throw new HttpError(409, "mismatch", "Those answers do not match the host's record of the game.");
    }
    if (!game.host_record && Date.now() - endedAt < HOST_WAIT_MS) {
      throw new HttpError(409, "host_pending", "Waiting for the host to report the game.");
    }
  }

  const result = judge(game, seed, answers, elapsed);

  const [row] =
    (await rpc("colorguessr_submit", {
      p_game_id: id,
      p_client_key: key,
      p_name: name,
      p_answers: answers,
      p_score: result.total,
      p_accuracy: result.accuracy,
    })) ?? [];
  if (row?.status !== "ok") {
    const [status, message] = REFUSALS[row?.status] ?? [500, "Could not submit."];
    throw new HttpError(status, REFUSALS[row?.status] ? row.status : "server", message);
  }

  return {
    name,
    score: result.total,
    accuracy: result.accuracy,
    elapsed_ms: elapsed,
    rank: Number(row.rank),
    best_score: row.best_score,
    total: Number(row.total),
    games: row.games,
    total_rank: Number(row.total_rank),
  };
});
