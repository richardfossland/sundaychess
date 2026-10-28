# Migrasjoner 0014 + 0015 og PAIR_SECRET (F0b)

Supabase CLI SIGKILL-er på denne maskinen, så migrasjonene kjøres for hånd i
**SQL-editoren** (Dashboard → SQL Editor). Begge er additive og idempotente
(`create or replace` / `drop policy if exists` / `if not exists`) og trygge å
kjøre FØR ny kode deployes: gamle offentlige kanaler påvirkes ikke.

> Supabase-prosjektet er DELT med andre Sunday-apper. Policyene i 0014 er
> avgrenset til topics som starter med `chess:` og rører ikke andre apper.
> Ikke slå av public channels prosjektbredt.

## Rekkefølge (bindende)

1. **Migrasjoner FØRST** (0014, så 0015) i SQL-editoren. Additive og trygge mens
   gammel kode kjører.
2. **Secret** `PAIR_SECRET`.
3. **Kode ETTERPÅ** (deploy Worker fra `wt/<app>-deploy` med `nvm exec 22`).
   Ny bunt abonnerer med `private: true`; uten 0014-policyene i databasen
   avvises alle joins.
4. Røyktest + verifiseringssjekkliste under.

**Deploy aldri koden før 0014 er kjørt og verifisert.** Siden delt
Supabase-prosjekt: ikke rør andre apper sine policyer.

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

### Verifiseringssjekkliste (etter SQL, før deploy; gjenta etter deploy)

```sql
select policyname, cmd from pg_policies
 where schemaname = 'realtime' and policyname like 'chess_rt_%';   -- 3 rader
select public.chess_rt_topic_ok('chess:lobby:not-a-uuid');          -- false
select public.code_blocked('test', '1.2.3.4', 600, 20);             -- false (som service_role)
```

- [ ] 3 `chess_rt_*`-policyer finnes (spørringen over).
- [ ] **Dashboard → Realtime → Settings: «Allow public access» (prosjektbredt
      «public channels») står fortsatt PÅ.** Andre Sunday-apper i det delte
      prosjektet bruker offentlige kanaler; slås det av, dør de. (Denne appen
      trenger det ikke lenger etter at `LEGACY_PUBLIC_COPY` er fjernet, men
      innstillingen skal ikke endres av denne utrullingen.)
- [ ] Etter deploy: åpne en turnering som lærer + én elev; lobby og brett
      oppdateres live (ikke bare via polling). Nettleserens konsoll skal ikke
      vise gjentatte `CHANNEL_ERROR`.
- [ ] Etter deploy: `client_events` har ingen bølge av `channel_error`-hendelser.
- [ ] `/api/tournament/open` med feil kode ×3 gir 404, riktig kode 200 (0015 virker).

## Rollback

**Viktig – rekkefølgen avhenger av om ny kode er deployet.**

- **Ny bunt er IKKE deployet ennå:** policyene kan droppes uten konsekvens, de
  gamle klientene bruker offentlige kanaler:

  ```sql
  drop policy if exists "chess_rt_receive" on realtime.messages;
  drop policy if exists "chess_rt_game_send" on realtime.messages;
  drop policy if exists "chess_rt_presence_send" on realtime.messages;
  ```

- **Ny bunt ER deployet: IKKE dropp 0014-policyene først.** Da avvises alle
  private joins (`CHANNEL_ERROR`) for ALLE klienter, og appen faller tilbake til
  ren polling (klientene tar nå gradvis lengre pauser mellom forsøk, og sender én
  `channel_error`-hendelse). Riktig rollback er motsatt rekkefølge:
  1. Redeploy forrige Worker-bunt (`wrangler rollback` eller forrige
     versjon fra `wt/<app>-deploy`). Den bruker offentlige kanaler.
  2. Først deretter, om nødvendig, drop policyene over.

- **Rollback av 0015** (kodeblokkeringen; trygt når som helst, koden er
  fail-open og logger bare `[code_blocked] fail-open`):

  ```sql
  drop function if exists public.code_blocked(text, text, int, int);
  drop function if exists public.register_code_failure(text, text, int, int);
  drop table if exists public.code_attempts;
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
  på samme skole-IP. Oppslag via `/api/tournament/open` teller per ENHET (httpOnly-cookie `sc_dev`,
  scope `open:d:<id>`, 20 feil / 10 min) og har et mye høyere IP-tak (scope `open`,
  200 feil / 10 min), slik at elevers feilgjetting på skole-IP-en ikke låser
  læreren ute.
- Feiler RPC-ene (f.eks. 0015 ikke kjørt), logges det og vernet åpner seg
  (fail-open) — det tar aldri ned en turnering.
