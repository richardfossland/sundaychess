-- Tippemodus: waiting/eliminated players predict live-game results for points.
-- One prediction per (game, player); `correct` is filled in when the game
-- resolves. Same RLS posture as everything else: no policies, service role only.

create table public.predictions (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  game_id       uuid not null references public.games (id) on delete cascade,
  player_id     uuid not null references public.players (id) on delete cascade,
  predicted     text not null check (predicted in ('white','black','draw')),
  correct       boolean,
  created_at    timestamptz not null default now(),
  unique (game_id, player_id)
);
create index predictions_tournament_idx on public.predictions (tournament_id);
create index predictions_game_idx on public.predictions (game_id);

alter table public.predictions enable row level security;
-- No policies on purpose → anon/authenticated get zero direct access.
