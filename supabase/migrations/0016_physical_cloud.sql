-- 0016: fysisk turneringsmodus i skyen (M5a). Additiv og idempotent.
--
-- «Publiser» laster den lokale hendelsesloggen (samme kanoniske logg som i
-- .sundaychess.json) opp til `physical_tournaments`. Spillere melder resultat
-- via QR på bordkortet -> `physical_result_reports`; arrangøren godkjenner, og
-- ARRANGØR-KLIENTEN skriver `setResult` i loggen (serveren skriver aldri
-- resultater selv).
--
-- Som alle andre chess-tabeller: RLS på, INGEN policyer, kun service_role.
-- Delt Supabase-prosjekt: tabellene ligger i `public` med prefikset physical_,
-- og ingenting her rører andre apper (TTT bor i schema `tictactoe`).

create table if not exists public.physical_tournaments (
  -- = lokal turnerings-id (uuid generert i nettleseren)
  id          uuid        primary key,
  host_code   text        not null,
  title       text        not null,
  event_log   jsonb       not null,
  log_version int         not null default 1,
  log_hash    text        not null,
  -- Avledet offentlig visning (lib/physical/snapshot.ts), beregnet ved publisering/PUT.
  -- Offentlig GET og rapport-POST leser denne og spiller ALDRI av loggen på nytt.
  public_snapshot jsonb,
  -- Navnepolicy for den offentlige siden: initials = «Ola N.» uten klubb/klasse.
  public_names text       not null default 'initials' check (public_names in ('full', 'initials')),
  -- Turnerings-id inne i loggen når den avviker fra `id` (cloud-id etter id-kollisjon ved publisering).
  local_id    uuid,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);
alter table public.physical_tournaments add column if not exists public_snapshot jsonb;
alter table public.physical_tournaments add column if not exists public_names text not null default 'initials';
alter table public.physical_tournaments add column if not exists local_id uuid;
create index if not exists physical_tournaments_updated_idx
  on public.physical_tournaments (updated_at);

create table if not exists public.physical_result_reports (
  id            uuid        primary key default gen_random_uuid(),
  tournament_id uuid        not null references public.physical_tournaments(id) on delete cascade,
  round         int         not null check (round >= 1),
  board         int         not null check (board >= 1),
  result        text        not null check (result in ('1-0', '0-1', '½-½')),
  reporter      text        not null check (reporter in ('white', 'black', 'unknown')),
  request_id    text        not null unique,
  -- Tilfeldig enhets-id fra melderens telefon. Ventende meldinger erstattes per
  -- (runde, brett, device_id), aldri per «reporter» alene.
  device_id     text        not null default '',
  -- «<hvit-id>|<svart-id>» slik parringen sto i public_snapshot da meldingen kom.
  pairing_fp    text        not null default '',
  status        text        not null default 'pending'
                            check (status in ('pending', 'approved', 'rejected', 'superseded')),
  created_at    timestamptz not null default now(),
  decided_at    timestamptz
);
alter table public.physical_result_reports add column if not exists device_id text not null default '';
alter table public.physical_result_reports add column if not exists pairing_fp text not null default '';
create index if not exists physical_result_reports_board_idx
  on public.physical_result_reports (tournament_id, round, board, status);

alter table public.physical_tournaments enable row level security;
alter table public.physical_result_reports enable row level security;
-- Ingen policyer med vilje: kun service_role (som omgår RLS).
revoke all on public.physical_tournaments from anon, authenticated;
revoke all on public.physical_result_reports from anon, authenticated;
grant select, insert, update, delete on public.physical_tournaments to service_role;
grant select, insert, update, delete on public.physical_result_reports to service_role;

-- Retensjon: 30 dagers inaktivitet (updated_at = siste publisering/opplasting
-- fra ARRANGØREN). Spillermeldinger forlenger IKKE oppbevaringen: da kunne
-- hvem som helst med et bordkort holde barnas data i live for alltid.
-- Egen funksjon i stedet for å endre cleanup_old_tournaments() (0013): da kan
-- ikke denne migrasjonen ødelegge 0013 sine revoke/grants. Rapportene følger
-- med via on delete cascade.
create or replace function public.cleanup_physical_tournaments()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  with doomed as (
    delete from public.physical_tournaments t
     where t.updated_at < now() - interval '30 days'
    returning 1
  )
  select count(*) into removed from doomed;
  return removed;
end;
$$;

revoke execute on function public.cleanup_physical_tournaments() from public, anon, authenticated;
grant execute on function public.cleanup_physical_tournaments() to service_role;

-- Daglig rydding (som cleanup-old-tournaments, men en time senere).
do $$
begin
  perform cron.unschedule('cleanup-physical-tournaments');
exception when others then
  null; -- var ikke planlagt ennå
end $$;

select cron.schedule(
  'cleanup-physical-tournaments',
  '0 5 * * *',
  $$select public.cleanup_physical_tournaments();$$
);
