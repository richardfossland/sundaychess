import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

// 0018 på ekte (in-memory) Postgres: start_round er atomisk (alt-eller-ingenting
// ved feil midt i opprettelsen), dobbeltklikk gir conflict='exists' med riktig
// complete-flagg, og M6-låsen gjør RPC-ene service_role-only.
const MIGRATIONS = join(__dirname, "..", "supabase", "migrations");
const sqlOf = (f: string) => readFileSync(join(MIGRATIONS, f), "utf8").replace(/create extension if not exists pg_cron;/gi, "");
const T = "11111111-2222-4333-8444-555555555555";
const P = [1, 2, 3, 4, 5].map((i) => `aaaaaaaa-2222-4333-8444-55555555555${i}`);
const MISSING = "ffffffff-2222-4333-8444-555555555555";
const FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
let db: PGlite;
let prevRound: string;

const startRound = async (number: number, games: unknown[], prev: string | null = null, phase = "league", status: string | null = null) => {
  const r = await db.query<{ r: Record<string, unknown> }>("select public.start_round($1,$2,$3,$4,$5::jsonb,$6) as r", [
    T, number, phase, prev, JSON.stringify(games), status,
  ]);
  return r.rows[0].r;
};
const g = (white: string, black: string | null, slot: number, extra: Record<string, unknown> = {}) => ({ white, black, fen: FEN, slot, status: null, result_source: null, ...extra });
const count = async (sql: string, params: unknown[] = []) => Number((await db.query<{ n: string }>(sql, params)).rows[0].n);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema realtime;
    create function realtime.topic() returns text language sql stable as $$ select nullif(current_setting('realtime.topic', true), '') $$;
    create table realtime.messages (id uuid primary key default gen_random_uuid(), topic text not null, extension text not null, payload jsonb, event text, private boolean default true);
    alter table realtime.messages enable row level security;
    grant execute on function realtime.topic() to anon, authenticated;
    create schema cron;
    create function cron.schedule(text, text, text) returns bigint language sql as 'select 1::bigint';
    create function cron.unschedule(text) returns boolean language sql as 'select true';
  `);
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith(".sql")).sort()) await db.exec(sqlOf(f));
  await db.exec(sqlOf("0018_atomic_rounds_lockdown.sql")); // idempotent
  await db.query("insert into public.tournaments (id, join_pin, host_code, status, current_round) values ($1,'123456','AAAA-11','league',1)", [T]);
  for (const [i, id] of P.entries()) {
    await db.query("insert into public.players (id, tournament_id, display_name, resume_code) values ($1,$2,$3,$4)", [id, T, `p${i}`, `R${i}`]);
  }
  const r = await db.query<{ id: string }>("insert into public.rounds (tournament_id, number, phase, status) values ($1,1,'league','live') returning id", [T]);
  prevRound = r.rows[0].id;
  await db.query("insert into public.games (tournament_id, round_id, white_player_id, black_player_id, fen, status, slot) values ($1,$2,$3,$4,$5,'white_win',0)", [T, prevRound, P[0], P[1], FEN]);
});

describe("start_round (atomisk)", () => {
  it("feil midt i opprettelsen ruller ALT tilbake; retry lykkes uten unik-brudd", async () => {
    // Siste parti peker på en spiller som ikke finnes -> FK-brudd ETTER at runde
    // og første parti er satt inn og forrige runde er satt til done.
    await expect(startRound(2, [g(P[0], P[1], 0), g(P[2], P[3], 1), g(MISSING, P[4], 2)], prevRound)).rejects.toThrow();
    expect(await count("select count(*) n from public.rounds where tournament_id=$1 and number=2", [T])).toBe(0);
    expect(await count("select count(*) n from public.games where tournament_id=$1 and round_id <> $2", [T, prevRound])).toBe(0);
    const prev = await db.query<{ status: string }>("select status from public.rounds where id=$1", [prevRound]);
    expect(prev.rows[0].status).toBe("live"); // ikke halvveis markert done
    const t = await db.query<{ current_round: number }>("select current_round from public.tournaments where id=$1", [T]);
    expect(t.rows[0].current_round).toBe(1);

    // Retry med riktige data: ingen "runde finnes allerede"-tilstand.
    const ok = await startRound(2, [g(P[0], P[1], 0), g(P[2], P[3], 1), g(P[4], null, 2)], prevRound);
    expect(ok.ok).toBe(true);
  });

  it("den vellykkede runden: forrige done, alle partier (inkl. frirunde), current_round, poeng", async () => {
    const prev = await db.query<{ status: string }>("select status from public.rounds where id=$1", [prevRound]);
    expect(prev.rows[0].status).toBe("done");
    expect(await count("select count(*) n from public.games g join public.rounds r on r.id=g.round_id where r.number=2")).toBe(3);
    const bye = await db.query<{ status: string; result_source: string }>("select status, result_source from public.games where black_player_id is null");
    expect(bye.rows[0]).toEqual({ status: "bye", result_source: "bye" });
    const t = await db.query<{ current_round: number }>("select current_round from public.tournaments where id=$1", [T]);
    expect(t.rows[0].current_round).toBe(2);
    const sc = await db.query<{ score: string }>("select score from public.players where id=$1", [P[4]]);
    expect(Number(sc.rows[0].score)).toBe(1); // frirunde -> recompute_scores kjørt i samme transaksjon
  });

  it("dobbeltklikk: andre kall får exists + complete=true og endrer ingenting", async () => {
    const r = await startRound(2, [g(P[0], P[1], 0)], prevRound);
    expect(r).toMatchObject({ ok: false, conflict: "exists", complete: true });
    expect(await count("select count(*) n from public.games g join public.rounds r on r.id=g.round_id where r.number=2")).toBe(3);
  });

  it("halvbygd runde (arv): exists men complete=false", async () => {
    await db.query("insert into public.rounds (tournament_id, number, phase, status) values ($1,3,'league','live')", [T]);
    const r = await startRound(3, [g(P[0], P[1], 0)]);
    expect(r).toMatchObject({ ok: false, conflict: "exists", complete: false });
  });

  it("tom partiliste avvises (ingen tom, fastlåst runde)", async () => {
    expect(await startRound(4, [])).toMatchObject({ ok: false, conflict: "no_games" });
    expect(await count("select count(*) n from public.rounds where number=4")).toBe(0);
  });

  it("halv frirunde (draw/physical) og turneringsstatus settes i samme steg", async () => {
    const r = await startRound(1, [g(P[0], P[1], 0), g(P[2], null, 1, { status: "draw", result_source: "physical" })], null, "playoff", "playoff");
    expect(r.ok).toBe(true);
    const t = await db.query<{ status: string; current_round: number }>("select status, current_round from public.tournaments where id=$1", [T]);
    expect(t.rows[0]).toEqual({ status: "playoff", current_round: 1 });
    const half = await db.query<{ status: string }>("select g.status from public.games g join public.rounds r on r.id=g.round_id where r.phase='playoff' and g.black_player_id is null");
    expect(half.rows[0].status).toBe("draw");
  });
});

describe("M6: RPC-ene er service_role-only", () => {
  const fns = [
    "public.apply_move(uuid,text,text,text,text,text,text,text,uuid)",
    "public.resolve_game(uuid,text,text,boolean)",
    "public.recompute_scores(uuid)",
    "public.extend_round(uuid)",
    "public.join_team_player(uuid,text,text,text[])",
    "public.start_round(uuid,int,text,uuid,jsonb,text)",
  ];
  for (const fn of fns) {
    it(`${fn}: kun service_role kan kjøre`, async () => {
      const priv = async (role: string) =>
        (await db.query<{ p: boolean }>("select has_function_privilege($1, $2, 'execute') as p", [role, fn])).rows[0].p;
      expect(await priv("anon")).toBe(false);
      expect(await priv("authenticated")).toBe(false);
      expect(await priv("public")).toBe(false);
      expect(await priv("service_role")).toBe(true);
    });
  }
});

// 0019 (M3): players.status kjenner 'kicked', men fortsatt ikke vilkårlige verdier.
describe("0019: players.status = 'kicked'", () => {
  it("godtar kicked, avviser søppel, er idempotent", async () => {
    await db.exec(sqlOf("0019_player_kicked.sql"));
    await db.query("update public.players set status = 'kicked' where id = $1", [P[0]]);
    await expect(db.query("update public.players set status = 'bogus' where id = $1", [P[0]])).rejects.toThrow();
    await db.query("update public.players set status = 'left' where id = $1", [P[0]]);
  });
});
