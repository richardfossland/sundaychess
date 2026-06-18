-- 0011 — Sunday Account host ownership.
--
-- The `tournaments.host_user_id` column already exists (0001). It holds the
-- Sunday Account (issuer-project auth.users) UUID of the arrangør who created a
-- tournament while signed in. It stays NULLABLE on purpose: anonymous create
-- (host-code-only flow) leaves it null, so anonymous play is never broken.
--
-- This migration is idempotent and additive:
--   1. (defensive) ensure the column exists, in case an older DB predates 0001's
--      host_user_id (no-op on a current schema).
--   2. add an index so the host dashboard's "my tournaments" query
--      (where host_user_id = $me order by created_at desc) stays fast as the
--      table grows (the casual-1v1 feature mints one row per game).
--
-- NOTE: there is intentionally NO foreign key to auth.users — that table lives
-- in the SEPARATE issuer/Sunday Account Supabase project, not this data project,
-- so a cross-database FK is impossible (and unnecessary: ownership is checked in
-- the server route via requireHost()).

alter table public.tournaments
  add column if not exists host_user_id uuid;

create index if not exists tournaments_host_user_idx
  on public.tournaments (host_user_id, created_at desc);
