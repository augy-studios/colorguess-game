// The API. Games are played entirely in the browser; the API hands out
// start tickets, records when a game ended, checks and scores finished
// games, and keeps replays behind short links.

const KEY_STORAGE = "colorguessr.clientKey";

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

// A random id tying this browser's submissions to the games it started. Not
// an identity: it grants nothing and is never shown.
function makeKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

let memoryKey = null;

export function clientKey() {
  try {
    let key = localStorage.getItem(KEY_STORAGE);
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(key ?? "")) {
      key = makeKey();
      localStorage.setItem(KEY_STORAGE, key);
    }
    return key;
  } catch {
    memoryKey ??= makeKey();
    return memoryKey;
  }
}

// `timeout` in ms: a call the game waits on before it can start gives up
// rather than leave the player looking at a spinner.
async function call(method, path, body, { timeout = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let response;
  try {
    response = await fetch(path, {
      method,
      signal: controller.signal,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "offline", "That needs a connection.");
  } finally {
    clearTimeout(timer);
  }
  let data = null;
  try {
    data = await response.json();
  } catch {
    // An HTML error page from the platform, not the API.
  }
  if (!response.ok) throw new ApiError(response.status, data?.error ?? "server", data?.message);
  return data;
}

export const api = {
  // No seed: the server picks one, at this difficulty and length.
  start: ({ mode, seed, difficulty, count }) =>
    call("POST", "/api/game/start", { client_key: clientKey(), mode, seed, difficulty, count }, { timeout: 5000 }),
  join: (gameId, seat) => call("POST", "/api/game/join", { game_id: gameId, client_key: clientKey(), seat }),
  finish: (body) => call("POST", "/api/game/finish", { ...body, client_key: clientKey() }),
  submit: (body) => call("POST", "/api/game/submit", { ...body, client_key: clientKey() }),
  checkName: (name) => call("POST", "/api/leaderboard/name", { name }),
  leaderboard: (board) => call("GET", `/api/leaderboard?board=${encodeURIComponent(board)}`),
  saveReplay: (seed, packed) => call("POST", "/api/replay/save", { seed, packed }, { timeout: 5000 }),
  replay: (id) => call("GET", `/api/replay?id=${encodeURIComponent(id)}`),
};
