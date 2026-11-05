# Migrasjon 0019: `players.status = 'kicked'` (M3)

Kjøres for hånd i **SQL-editoren**. Additiv og idempotent; rører bare `public.players`.

## Rekkefølge
1. Migrasjonen kan kjøres FØR eller ETTER koden. Anbefalt: **før** deploy.
2. Før 0019 er kjørt faller `/api/lobby/kick` (med `reason: "teacher"`) tilbake til status `left` (med advarsel i loggen). Da er kicken fortsatt angrebar for eleven, akkurat som i dag. Ingenting feiler.

## Hva den gjør
- `players_status_check` utvides fra `('active','left')` til `('active','left','kicked')`.
- Kode: lærerens kick (`reason: "teacher"`) setter `kicked`, alt annet `left`; `/api/lobby/rejoin` svarer 403 `kicked`; ghost-sveipet (host-klienten sender `reason: "ghost"`) bruker fortsatt `left`.

## Sjekkliste etter SQL
```sql
select pg_get_constraintdef(oid) from pg_constraint where conname = 'players_status_check'; -- inneholder 'kicked'
```
- [ ] Stemmer.

## Tilbakerulling
```sql
update public.players set status = 'left' where status = 'kicked';
alter table public.players drop constraint if exists players_status_check;
alter table public.players add constraint players_status_check check (status in ('active','left'));
```
Rull tilbake koden først. En åpen host-fane med gammel JS sender kick uten `reason` og gir `left`, så en låst telefon blir aldri kastet ut for godt.

## Hva «endelig» betyr

Kicket gjelder identiteten: eleven kan ikke angre det selv. Med PIN-en kan eleven fortsatt logge ut og bli med på nytt som en ny spiller, og læreren må da kaste ut på nytt. Mens turneringen er i lobbyen er det bevisst slik.
