-- 0019: players.status får verdien 'kicked' (M3).
-- Lærerens kick (/api/lobby/kick uten reason) er endelig: eleven kan ikke selv
-- angre det via /api/lobby/rejoin. Spøkelsessveipet bruker fortsatt 'left'.
-- Additiv og idempotent. Rører bare public.players.

alter table public.players drop constraint if exists players_status_check;
alter table public.players
  add constraint players_status_check
  check (status in ('active', 'left', 'kicked'));
