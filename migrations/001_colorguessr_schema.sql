-- Color Guess Game (colorguessr.uwuapps.org) schema, in the shared uwuapps
-- Supabase project. Paste into the Supabase SQL editor and run once. Safe to
-- run again: everything is "if not exists" or "or replace".
--
-- Access model: only the Vercel functions touch these tables, with the
-- service role key. RLS is on with no policies, so an anon key reads nothing.
--
-- The rules of the game are not in here. The API rebuilds every submitted
-- game from its seed with the same code the browser plays with, checks its
-- timing, recomputes its score, and only then calls colorguessr_submit, which
-- does the checks that need the database.

-- One row per game that could go on the leaderboard: started while online,
-- solo or multiplayer. created_at is the server's clock.
create table if not exists colorguessr_games (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('solo', 'multi')),
  seed text not null,                   -- "N10-BXK4-M9TR", canonical form
  difficulty text not null check (difficulty in ('normal', 'hard', 'expert')),
  questions smallint not null check (questions between 1 and 50),
  server_seed boolean not null,         -- false: a seed the player pasted
  host_key text not null,               -- the client_key that started it
  created_at timestamptz not null default now(),
  -- Multiplayer: every seat's answers as the host recorded them, sent by
  -- the host when the game ends. A guest's submission must match its seat.
  host_record jsonb
);

create index if not exists colorguessr_games_created on colorguessr_games (created_at);

-- A player's ticket into a game: seat 0 is whoever started it, and in a
-- multiplayer game seats 1 to 7 are the guests, each joining from their own
-- browser. created_at starts that player's clock.
create table if not exists colorguessr_tickets (
  game_id uuid not null references colorguessr_games(id) on delete cascade,
  seat smallint not null check (seat between 0 and 7),
  client_key text not null,
  created_at timestamptz not null default now(),
  -- Set when the page reports the game over, which stops the clock.
  answers jsonb,
  finished_at timestamptz,
  submitted boolean not null default false,
  primary key (game_id, seat),
  unique (game_id, client_key)
);

create table if not exists colorguessr_leaderboard (
  id bigserial primary key,
  name text not null,
  score int not null check (score >= 0),
  accuracy smallint not null check (accuracy between 0 and 100),
  game_id uuid not null references colorguessr_games(id) on delete cascade,
  seat smallint not null,
  mode text not null,
  difficulty text not null,
  questions smallint not null,
  seed text not null,
  server_seed boolean not null,
  started_at timestamptz not null,      -- the ticket's clock, for overlap
  ended_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (game_id, seat)
);

create index if not exists colorguessr_lb_name on colorguessr_leaderboard (lower(name), score desc);

-- Each name's best game. The earliest of an equal top score wins, and the
-- casing shown is the one attached to that score.
create or replace view colorguessr_leaderboard_best
with (security_invoker = true) as
select distinct on (lower(name)) name, score, accuracy, mode, difficulty, questions, created_at
from colorguessr_leaderboard
order by lower(name), score desc, created_at asc;

-- Every submitted game added up per name. The casing shown is the most
-- recent one.
create or replace view colorguessr_leaderboard_total
with (security_invoker = true) as
select
  (array_agg(name order by created_at desc))[1] as name,
  sum(score)::bigint as total,
  count(*)::int as games,
  max(created_at) as last_at
from colorguessr_leaderboard
group by lower(name);

-- Replays behind short links: /?r=<id>. The same game shared twice gets the
-- same id. Kept indefinitely; a row is a few hundred bytes.
create table if not exists colorguessr_replays (
  id text primary key check (id ~ '^[A-Za-z0-9]{7}$'),
  seed text not null,
  packed text not null check (length(packed) <= 400),
  created_at timestamptz not null default now(),
  unique (seed, packed)
);

-- Fixed window counters for rate limiting by (hashed) IP. There are no
-- accounts to limit against, and Vercel functions share no memory.
create table if not exists colorguessr_rate_limits (
  bucket text primary key,
  window_start timestamptz not null,
  hits int not null
);

alter table colorguessr_games enable row level security;
alter table colorguessr_tickets enable row level security;
alter table colorguessr_leaderboard enable row level security;
alter table colorguessr_replays enable row level security;
alter table colorguessr_rate_limits enable row level security;

-- True while the bucket is under its limit. One statement, so concurrent
-- hits cannot both read the old count.
create or replace function colorguessr_hit(p_bucket text, p_window_seconds int, p_max int)
returns boolean
language sql
volatile
as $$
  insert into colorguessr_rate_limits as r (bucket, window_start, hits)
  values (p_bucket, now(), 1)
  on conflict (bucket) do update set
    window_start = case
      when r.window_start < now() - make_interval(secs => p_window_seconds) then now()
      else r.window_start end,
    hits = case
      when r.window_start < now() - make_interval(secs => p_window_seconds) then 1
      else r.hits + 1 end
  returning hits <= p_max;
$$;

-- A new game and its starter's ticket, together.
create or replace function colorguessr_start(
  p_mode text,
  p_seed text,
  p_difficulty text,
  p_questions int,
  p_server_seed boolean,
  p_client_key text
)
returns table (game_id uuid, created_at timestamptz)
language plpgsql
volatile
as $$
#variable_conflict use_column
declare
  v_id uuid;
  v_created timestamptz;
begin
  insert into colorguessr_games (mode, seed, difficulty, questions, server_seed, host_key)
  values (p_mode, p_seed, p_difficulty, p_questions, p_server_seed, p_client_key)
  returning colorguessr_games.id, colorguessr_games.created_at into v_id, v_created;

  insert into colorguessr_tickets (game_id, seat, client_key, created_at)
  values (v_id, 0, p_client_key, v_created);

  return query select v_id, v_created;
end;
$$;

-- A guest taking its seat in a multiplayer game:
--
--   not_found    no such game
--   not_multi    a solo game
--   expired      started more than 6 hours ago
--   same_device  the browser that started the game, which already has seat 0
--   seat_taken   another browser has that seat, or this one has another
create or replace function colorguessr_join(p_game_id uuid, p_client_key text, p_seat smallint)
returns text
language plpgsql
volatile
as $$
declare
  v_game colorguessr_games%rowtype;
  v_seat smallint;
begin
  select * into v_game from colorguessr_games where id = p_game_id for update;
  if not found then return 'not_found'; end if;
  if v_game.mode <> 'multi' then return 'not_multi'; end if;
  if v_game.created_at < now() - interval '6 hours' then return 'expired'; end if;
  if p_client_key = v_game.host_key then return 'same_device'; end if;
  if p_seat < 1 or p_seat > 7 then return 'seat_taken'; end if;

  select t.seat into v_seat from colorguessr_tickets t where t.game_id = p_game_id and t.client_key = p_client_key;
  if found then
    return case when v_seat = p_seat then 'ok' else 'seat_taken' end;
  end if;
  if exists (select 1 from colorguessr_tickets t where t.game_id = p_game_id and t.seat = p_seat) then
    return 'seat_taken';
  end if;

  insert into colorguessr_tickets (game_id, seat, client_key) values (p_game_id, p_seat, p_client_key);
  return 'ok';
end;
$$;

-- The page reporting a game over, which stops that player's clock. The first
-- report stands; a later one with other answers is a mismatch. The host of a
-- multiplayer game also hands over every seat's answers.
create or replace function colorguessr_finish(p_game_id uuid, p_client_key text, p_answers jsonb, p_record jsonb)
returns table (status text, started_at timestamptz, finished_at timestamptz)
language plpgsql
volatile
as $$
#variable_conflict use_column
declare
  v_game colorguessr_games%rowtype;
  v_ticket colorguessr_tickets%rowtype;
begin
  select * into v_game from colorguessr_games g where g.id = p_game_id for update;
  if not found then
    return query select 'not_found'::text, null::timestamptz, null::timestamptz;
    return;
  end if;
  if v_game.created_at < now() - interval '6 hours' then
    return query select 'expired'::text, null::timestamptz, null::timestamptz;
    return;
  end if;

  select * into v_ticket from colorguessr_tickets t
  where t.game_id = p_game_id and t.client_key = p_client_key for update;
  if not found then
    return query select 'not_yours'::text, null::timestamptz, null::timestamptz;
    return;
  end if;

  if v_ticket.finished_at is null then
    update colorguessr_tickets t set answers = p_answers, finished_at = now()
    where t.game_id = p_game_id and t.seat = v_ticket.seat
    returning t.finished_at into v_ticket.finished_at;
  elsif v_ticket.answers <> p_answers then
    return query select 'mismatch'::text, null::timestamptz, null::timestamptz;
    return;
  end if;

  if v_game.mode = 'multi' and v_ticket.seat = 0 and p_record is not null and v_game.host_record is null then
    update colorguessr_games g set host_record = p_record where g.id = p_game_id;
  end if;

  return query select 'ok'::text, v_ticket.created_at, v_ticket.finished_at;
end;
$$;

-- Puts one player's verified game on the board. The API has already rebuilt
-- the game from its seed, checked its timing and the host's record, and
-- computed the score; this checks what only the database can:
--
--   not_found          no such game
--   expired            started more than 6 hours ago
--   not_yours          this browser holds no ticket for the game
--   already_submitted  this ticket is already on the board
--   mismatch           answers other than the ones reported when it ended
--   too_fast           over sooner than half a second a question, or 3 s
--   same_name          two seats of one multiplayer game under one name
--   overlap            played while another game on the board under this
--                      name was also being played
--   seed_used          a pasted seed this name already has on the board, so
--                      a memorised game cannot be farmed
create or replace function colorguessr_submit(
  p_game_id uuid,
  p_client_key text,
  p_name text,
  p_answers jsonb,
  p_score int,
  p_accuracy int
)
returns table (status text, best_score int, rank bigint, total bigint, games int, total_rank bigint)
language plpgsql
volatile
as $$
#variable_conflict use_column
declare
  v_game colorguessr_games%rowtype;
  v_ticket colorguessr_tickets%rowtype;
  v_end timestamptz;
  v_best int;
  v_best_at timestamptz;
  v_total bigint;
  v_games int;
begin
  select * into v_game from colorguessr_games g where g.id = p_game_id for update;
  if not found then
    return query select 'not_found'::text, null::int, null::bigint, null::bigint, null::int, null::bigint;
    return;
  end if;
  if v_game.created_at < now() - interval '6 hours' then
    return query select 'expired'::text, null::int, null::bigint, null::bigint, null::int, null::bigint;
    return;
  end if;

  select * into v_ticket from colorguessr_tickets t
  where t.game_id = p_game_id and t.client_key = p_client_key for update;
  if not found then
    return query select 'not_yours'::text, null::int, null::bigint, null::bigint, null::int, null::bigint;
    return;
  end if;
  if v_ticket.submitted then
    return query select 'already_submitted'::text, null::int, null::bigint, null::bigint, null::int, null::bigint;
    return;
  end if;
  if v_ticket.answers is not null and v_ticket.answers <> p_answers then
    return query select 'mismatch'::text, null::int, null::bigint, null::bigint, null::int, null::bigint;
    return;
  end if;

  v_end := coalesce(v_ticket.finished_at, now());
  if v_end - v_ticket.created_at < make_interval(secs => greatest(3, v_game.questions * 0.5)) then
    return query select 'too_fast'::text, null::int, null::bigint, null::bigint, null::int, null::bigint;
    return;
  end if;

  -- One submission per name at a time, so two sent together cannot both
  -- miss each other in the checks below.
  perform pg_advisory_xact_lock(hashtext('colorguessr_submit:' || lower(p_name)));

  if exists (
    select 1 from colorguessr_leaderboard l
    where l.game_id = p_game_id and lower(l.name) = lower(p_name)
  ) then
    return query select 'same_name'::text, null::int, null::bigint, null::bigint, null::int, null::bigint;
    return;
  end if;

  if exists (
    select 1 from colorguessr_leaderboard l
    where lower(l.name) = lower(p_name)
      and l.game_id <> p_game_id
      and l.started_at < v_end
      and l.ended_at > v_ticket.created_at
  ) then
    return query select 'overlap'::text, null::int, null::bigint, null::bigint, null::int, null::bigint;
    return;
  end if;

  if not v_game.server_seed and exists (
    select 1 from colorguessr_leaderboard l
    where lower(l.name) = lower(p_name) and l.seed = v_game.seed
  ) then
    return query select 'seed_used'::text, null::int, null::bigint, null::bigint, null::int, null::bigint;
    return;
  end if;

  update colorguessr_tickets t
  set submitted = true, answers = coalesce(t.answers, p_answers), finished_at = v_end
  where t.game_id = p_game_id and t.seat = v_ticket.seat;

  insert into colorguessr_leaderboard
    (name, score, accuracy, game_id, seat, mode, difficulty, questions, seed, server_seed, started_at, ended_at)
  values
    (p_name, p_score, p_accuracy, p_game_id, v_ticket.seat, v_game.mode, v_game.difficulty, v_game.questions,
     v_game.seed, v_game.server_seed, v_ticket.created_at, v_end);

  select l.score, l.created_at into v_best, v_best_at
  from colorguessr_leaderboard l
  where lower(l.name) = lower(p_name)
  order by l.score desc, l.created_at asc
  limit 1;

  select sum(l.score)::bigint, count(*)::int into v_total, v_games
  from colorguessr_leaderboard l
  where lower(l.name) = lower(p_name);

  return query
  select
    'ok'::text,
    v_best,
    (
      select count(*) + 1
      from colorguessr_leaderboard_best b
      where b.score > v_best or (b.score = v_best and b.created_at < v_best_at)
    ),
    v_total,
    v_games,
    (
      select count(*) + 1
      from colorguessr_leaderboard_total t
      where lower(t.name) <> lower(p_name)
        and (
          t.total > v_total
          or (t.total = v_total and t.games < v_games)
          -- This name's total was only just reached, so an equal one got there first.
          or (t.total = v_total and t.games = v_games)
        )
    );
end;
$$;

-- Keeps a replay, or finds the one already kept for the same game. Returns
-- its id, or null if p_id was taken by a different replay, in which case the
-- API tries again with another.
create or replace function colorguessr_save_replay(p_id text, p_seed text, p_packed text)
returns text
language plpgsql
volatile
as $$
declare
  v_id text;
begin
  insert into colorguessr_replays (id, seed, packed)
  values (p_id, p_seed, p_packed)
  on conflict do nothing;

  select r.id into v_id from colorguessr_replays r where r.seed = p_seed and r.packed = p_packed;
  return v_id;
end;
$$;

-- Housekeeping, called now and then by /api/game/start: old counters, and
-- games nobody submitted that are past any use. Replays are kept.
create or replace function colorguessr_prune()
returns void
language sql
volatile
as $$
  delete from colorguessr_rate_limits where window_start < now() - interval '1 day';
  delete from colorguessr_games g
  where g.created_at < now() - interval '2 days'
    and not exists (select 1 from colorguessr_leaderboard l where l.game_id = g.id);
$$;

-- Service role only.
revoke all on function colorguessr_hit(text, int, int) from public, anon, authenticated;
revoke all on function colorguessr_start(text, text, text, int, boolean, text) from public, anon, authenticated;
revoke all on function colorguessr_join(uuid, text, smallint) from public, anon, authenticated;
revoke all on function colorguessr_finish(uuid, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function colorguessr_submit(uuid, text, text, jsonb, int, int) from public, anon, authenticated;
revoke all on function colorguessr_save_replay(text, text, text) from public, anon, authenticated;
revoke all on function colorguessr_prune() from public, anon, authenticated;
grant execute on function colorguessr_hit(text, int, int) to service_role;
grant execute on function colorguessr_start(text, text, text, int, boolean, text) to service_role;
grant execute on function colorguessr_join(uuid, text, smallint) to service_role;
grant execute on function colorguessr_finish(uuid, text, jsonb, jsonb) to service_role;
grant execute on function colorguessr_submit(uuid, text, text, jsonb, int, int) to service_role;
grant execute on function colorguessr_save_replay(text, text, text) to service_role;
grant execute on function colorguessr_prune() to service_role;
