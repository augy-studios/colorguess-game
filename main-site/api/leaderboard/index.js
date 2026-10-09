// GET /api/leaderboard?board=best|total
//   best  (default) -> { board, entries: [{ rank, name, score, accuracy, mode, difficulty, questions }] }
//   total           -> { board, entries: [{ rank, name, total, games }] }
// Public, no login, one row per name, cached briefly at the edge. The same
// two boards as MRT Station Guesser's.

import { endpoint, HttpError } from "../_lib/http.js";
import { rest } from "../_lib/supabase.js";

const LIMIT = 100;

const BOARDS = {
  best: {
    query: `colorguessr_leaderboard_best?select=name,score,accuracy,mode,difficulty,questions&order=score.desc,created_at.asc&limit=${LIMIT}`,
    row: (r) => ({
      name: r.name,
      score: r.score,
      accuracy: r.accuracy,
      mode: r.mode,
      difficulty: r.difficulty,
      questions: r.questions,
    }),
  },
  total: {
    query: `colorguessr_leaderboard_total?select=name,total,games&order=total.desc,games.asc,last_at.asc&limit=${LIMIT}`,
    // bigint sums arrive as numbers well within range for this game.
    row: (r) => ({ name: r.name, total: Number(r.total), games: r.games }),
  },
};

export default endpoint("GET", async ({ req, res }) => {
  const board = req.query?.board ?? "best";
  const spec = BOARDS[board];
  if (!spec) throw new HttpError(400, "bad_board", "board is best or total.");

  const rows = await rest(spec.query);
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=30, stale-while-revalidate=60");
  return { board, entries: (rows ?? []).map((r, i) => ({ rank: i + 1, ...spec.row(r) })) };
});
