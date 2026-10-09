# Color Guess Game

Read a hex code and pick its colour: from four swatches, from six close
shades, or at Expert on a full colour wheel. Play alone or with up to seven
friends on the same wifi. Every game has a seed that can be copied and played
again, ends with an instant replay that can be shared, and can go on a
leaderboard.

Live at <https://colorguessr.uwuapps.org>. A PWA: once opened, it plays
offline.

## What runs where

| Part | Runs on |
| --- | --- |
| `main-site/`, the PWA and its API (`main-site/api/`) | Vercel, root directory `main-site` |
| Database, `colorguessr_*` tables | The shared uwuapps Supabase project |
| Multiplayer | Browser to browser over WebRTC. PeerJS's public broker introduces the devices; nothing of ours is in between |

There is nothing on the VPS.

## Layout

```text
README.md
migrations/      SQL to run in the Supabase SQL editor, in number order
scripts/         pre-deploy checks and the game tests
main-site/       the site Vercel deploys, including api/
```

The `uwuapps-*.md`, `update-bar-spec.md` and `STUN-p2p-spec.md` files at the
root are the specs this is built to. `main-site/README.md` covers the app
itself.

## Migrations

SQL for the shared uwuapps Supabase project. Paste each file into the SQL
editor and run it once, in number order. Each is safe to run again.

**Never edit a file once it has been run.** Every change is a new file with
the next number.

| File | What it does |
| --- | --- |
| `001_colorguessr_schema.sql` | The `colorguessr_` tables (games, tickets, leaderboard, replays, rate limits), the best and total leaderboard views, and the start, join, finish, submit, save replay and prune functions. |

Every table has row level security on with no policies. Only the service role
key, used by the Vercel functions, can read or write.

## First setup

1. Run `migrations/001_colorguessr_schema.sql` in the Supabase SQL editor of
   the shared uwuapps project.
2. On the Vercel project (root directory `main-site`), set the variables in
   `main-site/.env.example`: `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`.
3. Add the domain `colorguessr.uwuapps.org` to the Vercel project.
4. Deploy.

Without the variables the site still works in full; the API answers
`not_configured`, every game says it is not scored, and shared replays use
the long links that need no server.

## Before every deploy

1. Bump `VERSION` in `main-site/sw.js`. Without it, returning visitors keep
   the previous build and never see the update bar.
2. Run the checks, from the repo root, with Node 20 or later and nothing to
   install:

```text
node scripts/check-sw.mjs          # the worker only activates when asked
node scripts/check-precache.mjs    # everything the app loads works offline
node scripts/check-theme.mjs       # pre-paint script matches js/theme.js
node scripts/test-game.mjs         # seeds, questions, scoring, links, API checks
```

**If you change `js/seed.js`, `js/color.js`, `js/quiz.js`, `js/score.js` or
`js/record.js`,** seeds, scores and replay links from the old build stop
meaning the same thing: the API rebuilds every game with the code it has now,
and a kept replay would play back differently. Change them only when that is
acceptable.
