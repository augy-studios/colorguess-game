# main-site

What Vercel deploys, served at <https://colorguessr.uwuapps.org>. No build
step: the files are served as they are, and `api/` holds the serverless
functions.

| Path | What it is |
| --- | --- |
| `index.html` | The only page. Its `<head>` is the template for any page added later. |
| `404.html`, `404.css` | The shared not-found page. |
| `sw.js` | Service worker: the offline shell, and the update bar's waiting worker. |
| `manifest.json` | PWA manifest. |
| `css/theme.css` | The uwuapps theme, verbatim from `uwuapps-theme.md`, time-based mode included. |
| `css/style.css` | Layout and components. Fixed-meaning colours (the marks, swatch labels, QR) are tokens at the top. |
| `js/` | ES modules, below. |
| `api/` | The API, below. Vercel does not route `api/_lib/`. |
| `images/` | Manifest screenshots, at the sizes `manifest.json` gives. |

## js

Every file here is precached; `scripts/check-precache.mjs` fails if one is
not. The first five are pure, with no DOM, and the API imports them too, so
the browser and the server always agree on a game.

| File | What it does |
| --- | --- |
| `seed.js` | Seeds, and the integer random numbers every question is drawn from. |
| `color.js` | Colours as integers, the distance between two, and the wheel's HSV maths. |
| `quiz.js` | The rules: the levels, a seed's questions, what a valid answer is, how right it is. |
| `score.js` | Scoring (below). |
| `record.js` | Packs a game's answers into a replay link, and back. |
| `view.js`, `wheel.js` | Drawing a question: the swatches, or Expert's colour wheel and brightness slider. |
| `game.js` | The game screen: setup, play, the result, submitting, sharing, watching a shared replay. |
| `replay.js` | The instant replay. |
| `net.js` | Pairing over PeerJS, STUN only, from `STUN-p2p-spec.md`. |
| `multiplayer.js` | Multiplayer on top of `net.js`: hosting, joining, and the messages. |
| `qr.js` | QR encoder for the join link, from uwuPromptr, so it works offline. |
| `api.js`, `leaderboard.js`, `settings.js` | The API client, and the leaderboard and settings windows, after MRT Station Guesser's. |
| `theme.js`, `icons.js`, `ui.js`, `update-bar.js`, `app.js` | Theme, inline SVG icons, modal and storage helpers, the update bar, and boot. |

## The game

**Asking.** A hex code is shown, and the clock runs. Pick a swatch with a tap
or the number keys, or at Expert find the colour on the wheel and lock it in.
The answer shows for 1.5 seconds, with the right swatch ticked and a wrong
pick crossed, then the next question comes; Next skips the wait.

| Level | What it asks | Time | Points |
| --- | --- | --- | --- |
| Normal | Four swatches, never two alike | 10 s | 100% |
| Hard | Six close shades of the answer | 12 s | 160% |
| Expert | Any colour, on a hue and saturation wheel with a brightness slider | 25 s | 250% |

**Length.** 5, 10 or 20 questions, or any number from 1 to 50.

**Seeds.** A seed looks like `H10-BXK4-M9TR`: the level's letter (N, H or X),
the number of questions, then the seed proper. It decides every question, so
the same seed is always the same game. It shows during play and at the end,
where it can be copied; paste one into the new-game screen to play that game
again, and its level and length come with it.

**Scoring.** The score grows with every answer. Each is worth up to 100
points, scaled by:

| | |
| --- | --- |
| How right | All or nothing on swatches. At Expert, full marks for a pick that looks the same, falling evenly to nothing for one clearly different |
| How quick | 100% answering at once, down to 50% at the buzzer |
| The level | as above |
| How far in | The first question 100%, rising evenly to 150% on the last |

The game's total is then scaled by its length: 5 questions or fewer 100%, 10
questions 108%, 20 questions 125%, and 150% from 35 questions. The API
recomputes all of it from the seed and the answers.

**Replay.** When a game ends it plays back by itself (a setting turns this
off): each question shown for as long as it was really looked at, the timer
running down beside it, then the answer. Play, pause, a question back or
forward, the slider, or a question from the list; Space and the arrow keys
work too. It plays at 0.5x, 1x, 2x or 4x, as Word Rain's does, remembered in
this browser.

**Sharing a replay.** Share replay makes a link through the device's share
sheet where it has one, and the clipboard otherwise. Online, the API keeps
the game and the link is short: `/?r=AbC12xY`. Offline, or if that fails,
the link carries the whole game: `/?watch=<answers>&seed=H10-BXK4-M9TR`, a
few bytes an answer, which opens offline once the site has been visited.
Opening either plays the replay; Play this seed fills in the new-game screen.

**Multiplayer.** Up to 8 players: the host and seven more, on the same wifi
or one phone's hotspot. The host picks the level, length and seed, shares a
six character code, a link or a QR code, and starts when everyone is in.
Every device is asked the same question at the same time; the question ends
when everyone has answered or the time is up, then everyone sees the answer
and the scores. The host is authoritative and sends the state 20 times a
second; guests send only their picks. A guest that reloads comes back to its
own seat. Late arrivals play from the next game.

## Leaderboard and anti-cheat

Two boards, as MRT Station Guesser's: each name's **best** game, and its
**total** points over every game. Solo games and multiplayer games both
count, on a seed the server picked or one the player pasted, as long as the
game started while online: starting asks `/api/game/start` for a ticket,
whose time comes from the server. Each multiplayer guest takes its own ticket
with `/api/game/join`. Games started offline play the same, and say they are
not scored.

The page reports a game the moment it ends (`/api/game/finish`), which stops
that player's clock, so watching the replay or typing a name costs nothing.
The host of a multiplayer game reports every seat's answers with its own.

On submit the API trusts nothing but the name. It rebuilds the questions from
the seed, checks every answer against them, and computes the score itself.
It refuses a game that:

| Code | When |
| --- | --- |
| `clock` | claims more answering time than had passed on the server |
| `over_time` | took far longer than its answers say: a solo game is allowed its answers' time plus 2.5 s a question and 20 s; a multiplayer game, every question at full length plus 6 s each and a minute |
| `too_fast` | has more than two right answers quicker than 0.3 s, or at Expert good picks quicker than 1 s |
| `mismatch` | differs from the answers reported when it ended, or a guest's from the host's record of its seat |
| `host_pending` | is a guest's, sent before the host reported the game; the page tries again, and after 30 s it goes through unchecked |

The database then refuses a submission that:

| Code | When |
| --- | --- |
| `not_yours` | comes from a browser holding no ticket for the game |
| `already_submitted` | is already on the board |
| `too_fast` | finished sooner than half a second a question, or 3 seconds |
| `same_name` | puts two seats of one multiplayer game under one name |
| `overlap` | was played at the same time as another game under the same name |
| `seed_used` | repeats a pasted seed that name already has on the board |

Everything is rate limited by hashed address. None of this proves a person
picked the colours: anyone can read a hex code. It is meant to stop forged
scores, scripted reflexes and games played at leisure.

## Offline and updates

Everything the page loads is precached, the Jua font included, so the site
opens and plays with no connection. The leaderboard, short replay links and
multiplayer need the network; PeerJS loads from cdnjs only when somebody
hosts or joins, and is never cached. Nothing under `/api/` is ever cached.

A new service worker installs and waits. The update bar offers Reload or Not
now, and nothing reloads until the reader asks. Bump `VERSION` in `sw.js` on
every change to anything in this directory.

## API

| Endpoint | Body | Returns |
| --- | --- | --- |
| `POST /api/game/start` | `client_key, mode, seed?, difficulty?, count?` | `game_id, seed, server_seed, created_at` |
| `POST /api/game/join` | `game_id, client_key, seat` | `seat` |
| `POST /api/game/finish` | `game_id, client_key, answers, record?` | `elapsed_ms` |
| `POST /api/game/submit` | `game_id, client_key, name, answers` | `name, score, accuracy, elapsed_ms, rank, best_score, total, games, total_rank` |
| `POST /api/replay/save` | `seed, packed` | `id` |
| `GET /api/replay` | `?id=` | `seed, packed`, cached at the edge |
| `POST /api/leaderboard/name` | `name` | `name`, cleaned, or a `400` saying why not |
| `GET /api/leaderboard` | `?board=best` or `?board=total` | `board, entries`, cached 30 s |

`mode` is `solo` or `multi`. With no `seed`, start picks one at `difficulty`
(`normal`, `hard` or `expert`) and `count` questions. An answer is
`[pick, t]`: the swatch's index or, at Expert, the colour as a number, or -1
for no answer; and the time taken in hundredths of a second. `record` is the
host's `[{ seat, answers }]`. Errors are `{ error, message? }` with a matching
status. Start, join and finish are limited to 60 an address per 10 minutes,
submit and replay saves to 30.

## Environment variables (Vercel)

Documented in `.env.example`. `.vercelignore` keeps every env file out of
deployments, since anything in this directory would otherwise be served.

| Variable | Used for |
| --- | --- |
| `SUPABASE_URL` | The shared uwuapps project. |
| `SUPABASE_SERVICE_KEY` | Service role key. Server side only, never sent to a browser. |
