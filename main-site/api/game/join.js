// POST /api/game/join  { game_id, client_key, seat } -> { seat }
// A multiplayer guest's own ticket, for the seat the host gave it, so each
// player's game is timed and submitted from their own browser.

import { endpoint, HttpError, clientKey, gameId, limit } from "../_lib/http.js";
import { rpc } from "../_lib/supabase.js";

const REFUSALS = {
  not_found: [404, "That game does not exist."],
  not_multi: [409, "That is not a multiplayer game."],
  expired: [410, "That game started more than 6 hours ago."],
  same_device: [409, "That game was started in this browser."],
  seat_taken: [409, "That seat is taken."],
};

export default endpoint("POST", async ({ req, body }) => {
  const id = gameId(body.game_id);
  const key = clientKey(body.client_key);
  const seat = body.seat;
  if (!Number.isInteger(seat) || seat < 1 || seat > 7) throw new HttpError(400, "bad_seat");

  await limit(req, "join", 600, 60);

  const status = await rpc("colorguessr_join", { p_game_id: id, p_client_key: key, p_seat: seat });
  if (status !== "ok") {
    const [code, message] = REFUSALS[status] ?? [500, "Could not join."];
    throw new HttpError(code, REFUSALS[status] ? status : "server", message);
  }
  return { seat };
});
