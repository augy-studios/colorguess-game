// GET /api/replay?id=<id> -> { seed, packed }
// A replay kept by /api/replay/save. Kept replays never change, so the
// answer is cached at the edge for a long time.

import { endpoint, HttpError } from "../_lib/http.js";
import { rest } from "../_lib/supabase.js";

export default endpoint("GET", async ({ req, res }) => {
  const id = String(req.query?.id ?? "");
  if (!/^[A-Za-z0-9]{7}$/.test(id)) throw new HttpError(400, "bad_id");

  const [row] = (await rest(`colorguessr_replays?id=eq.${id}&select=seed,packed`)) ?? [];
  if (!row) throw new HttpError(404, "not_found", "That replay could not be found.");

  res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=31536000, immutable");
  return { seed: row.seed, packed: row.packed };
});
