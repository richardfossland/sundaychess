# Migrasjoner 0014 + 0015 og PAIR_SECRET (F0b)

Supabase CLI SIGKILL-er på denne maskinen, så migrasjonene kjøres for hånd i
**SQL-editoren** (Dashboard → SQL Editor). Begge er additive og idempotente
(`create or replace` / `drop policy if exists` / `if not exists`) og trygge å
kjøre FØR ny kode deployes: gamle offentlige kanaler påvirkes ikke.

> Supabase-prosjektet er DELT med andre Sunday-apper. Policyene i 0014 er
> avgrenset til topics som starter med `chess:` og rører ikke andre apper.
> Ikke slå av public channels prosjektbredt.

## Rekkefølge

1. **SQL først** (denne PR-en kan merges før eller etter, men deploy kommer etter steg 1–2).
2. **Secret** `PAIR_SECRET`.
3. **Deploy** Worker fra `wt/<app>-deploy` med `nvm exec 22`.
4. Røyktest.

## 1. SQL

I SQL-editoren, kjør innholdet av disse to filene, i denne rekkefølgen
(lim inn hele filen, trykk Run):

1. `supabase/migrations/0014_realtime_private.sql`
   - funksjon `public.chess_rt_topic_ok(text)` (security definer)
   - `grant usage on schema realtime` + `grant select, insert on realtime.messages` til anon/authenticated
   - tre policyer på `realtime.messages`: `chess_rt_receive`, `chess_rt_game_send`, `chess_rt_presence_send`
2. `supabase/migrations/0015_code_attempts.sql`
   - tabell `public.code_attempts` (RLS på, ingen policyer, kun service_role)
   - funksjonene `register_code_failure` og `code_blocked` (kun service_role)

Verifiser etterpå:

```sql
select policyname, cmd from pg_policies
 where schemaname = 'realtime' and policyname like 'chess_rt_%';   -- 3 rader
select public.chess_rt_topic_ok('chess:lobby:not-a-uuid');          -- false
select public.code_blocked('test', '1.2.3.4', 600, 20);             -- false (som service_role)
```

Rollback (kun om noe er galt; klientene på gammel bunt bruker public channels og
merker ingenting):

```sql
drop policy if exists "chess_rt_receive" on realtime.messages;
drop policy if exists "chess_rt_game_send" on realtime.messages;
drop policy if exists "chess_rt_presence_send" on realtime.messages;
```

## 2. Secret PAIR_SECRET

Stateløs HMAC-nøkkel for enhets-paringstoken (`x-pair-token`). Generer en lang
tilfeldig streng og sett den på Workeren:

```bash
openssl rand -base64 32          # kopier verdien
nvm exec 22 npx wrangler secret put PAIR_SECRET
```

Mangler secreten i produksjon, slås tokenene av (én loggline `[pair] PAIR_SECRET
missing…`), og kodeblokkeringen gjelder som vanlig — ingen krasj. Roteres
secreten, må lærerne åpne turneringen på nytt (token fornyes ved `/open`).

## 3. Hva som endres for brukerne

- Klienter abonnerer med `private: true`. Serveren sender hver hint to ganger i
  én release-syklus (`LEGACY_PUBLIC_COPY = true` i `lib/server/broadcast.ts`) slik
  at åpne faner med gammel bunt fortsatt får live-oppdateringer. Fjern flagget
  (og kopien) i neste PR.
- `hostRateLimit` (per-isolate, 90/min) er erstattet av DB-basert telling av
  FEIL koder (20 feil / 10 min per tournament og IP; IPv6 per /64). Riktige
  koder telles aldri, og lærerens enhet (token) blir aldri utestengt av elever
  på samme skole-IP. Oppslag via `/api/tournament/open` bruker scope `open`.
- Feiler RPC-ene (f.eks. 0015 ikke kjørt), logges det og vernet åpner seg
  (fail-open) — det tar aldri ned en turnering.
