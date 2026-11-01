# Designaudit — SundayChess (2026-11-01)

Grunnlag: Playwright mot produksjonsbygg av main `cfc7ca3` (D0–D2 inne), lokalt mot prod-DB.
Tre ZZTEST-turneringer (8 spillere, Monrad 5 runder, alle partier avsluttet med oppgivelse)
ble opprettet, brukt og slettet (0 igjen). Bredder: 1280×820 og 375×812, mørkt og lyst tema.
Storskjerm (`?visning=tavle`): 1280×720 og 1920×1080.

Alvorlighet: **A** = feil som stopper eller villeder · **B** = vanskelig for nye brukere · **C** = finpuss.

Inngang (D1), spillvisning (D2) og fysisk modus (D5) er dekket i egne PR-er og står ikke her.

## A — feil

| # | Hvor | Hva skjer |
|---|------|-----------|
| A1 | Arrangør `/host/[id]` på telefon (lobby, runde, etter runde) | **Horisontal scroll.** Toppfeltets knapper («Vis på storskjerm», «Last ned turneringsfil», «Diagnostikk», PIN-chip) ligger oppå logoen og turneringsnavnet. I runde-visningen kuttes stillingstabellen til høyre, og «Neste runde» er halvt skjult bak kanten. |
| A2 | Storskjerm 1280×720 i runde | Siden er 792 px. **Scroller på projektor.** |
| A3 | Storskjerm resultat (1280×720 og 1920×1080) | 1362 px / 1675 px. Pallen og tabellen står under hverandre i én smal kolonne. Tabellen kuttes på projektor. |
| A4 | Arrangør toppfelt på PC | Knappene står med tekst på to linjer («Diagnostikk / Vis vertskode», «Last ned turneringsfil / localhost…/play 129679»). Turneringsnavnet havner under knappene i lobbyen. |

## B — forståelse og luft

- **Lobby (arrangør):** spillerchipsene har kast-ut-knapper (×) under 40 px. «Rediger notat» og «Vis vertskode» er små. Spillerlista på telefon er venstrestilte chips med stor tom flate til høyre.
- **Runde (arrangør):** «Tving fullføring» står rødt ved siden av «Neste runde» uten forklaring. Hjelpeteksten «Alle partier må være ferdige før neste runde» står under knappene i stedet for ved den deaktiverte knappen.
- **Stillingstabell:** «Buchholz» er sjargong som kolonnetittel (forklaring finnes bare under sluttabellen). Bruk «Motstand» eller «Buchholz» med forklaring under alle tabeller.
- **Resultat (arrangør):** én smal kolonne midt på en bred skjerm. Pallen kan stå ved siden av tabellen på brede skjermer.
- **Storskjerm-veksler «Tavle / Live»** vises i presentasjonsvisningen. Navnet «Tavle» bryter ordlisten (Storskjerm).
- **Elev mellom runder / slutt:** «Turneringen er ferdig» ser ut som en deaktivert knapp. «Ikke deg? Bytt spiller», «Vis koden min» og «Logg ut» er like store sekundærknapper, uten hierarki.
- **Elev slutt:** «Du ble nr. 7 av 8 · 2 poeng» er god informasjon, men står lavt og lite. Den bør være hovedbudskapet.
- **Inline-stiler:** host-visningene 22–62 per side (LobbyView, LeagueView, FinishedView).

## C — finpuss

- «Sjakknøtt mens du venter» er fint, men står like tungt som resten. Kan være mer dempet.
- Pallen viser poeng i små runde merker. Større tall på storskjerm.

## Ordliste (gjelder D3, D4, D6, D7)

| I dag | Ny |
|-------|-----|
| Tavle (veksler, knapper) | Storskjerm |
| Tiebreaks | Rangering ved likt poeng |
| Buchholz (kolonne) | Buchholz, med forklaring under tabellen |
| Tving fullføring | Avslutt gjenstående partier (med bekreftelse og forklaring) |
| Vertskode | Arrangørkode (bare for deg) |
| Bli-med-PIN | PIN for å bli med |

## Fordeling

- **D3 Elevreisen:** WaitingRoom (venter, mellom runder, slutt), hierarki av knapper, resultatet som hovedbudskap.
- **D4 Arrangør digital:** A1, A4, lobby, runde, resultat på PC og telefon, modaler, veiviser (`Wizard.tsx`, Stepper).
- **D6 Storskjerm:** A2, A3, presentasjonsvisningen i runde, lobby og resultat passer i én skjermhøyde på 1280×720 og 1920×1080.

Skjermbilder: `da-*.png` i økt-scratchpad. Auditskript: `audit.mjs` (oppretter ZZTEST via offentlige ruter),
opprydding: `cleanup.mjs` (sletter kun tittel `ZZTEST%` i `public.tournaments`).
