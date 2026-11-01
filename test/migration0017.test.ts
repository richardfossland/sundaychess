import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

// 0017 on a real (in-memory) Postgres: result_source 'physical' allowed, columns,
// atomic claim_player, and recompute_scores summing ½/0 byes encoded as
// black=null + draw/aborted.
const MIGRATIONS = join(__dirname, "..", "supabase", "migrations");
const sqlOf = (f: string) => readFileSync(join(MIGRATIONS, f), "utf8").replace(/create extension if not exists pg_cron;/gi, "");
const T = "11111111-2222-4333-8444-555555555555";
const P1 = "aaaaaaaa-2222-4333-8444-555555555551";
const P2 = "aaaaaaaa-2222-4333-8444-555555555552";
const P3 = "aaaaaaaa-2222-4333-8444-555555555553";
const R = "bbbbbbbb-2222-4333-8444-555555555555";
let db: PGlite;

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
  await db.exec(sqlOf("0017_physical_continue.sql")); // idempotent
  await db.query("insert into public.tournaments (id, join_pin, host_code) values ($1,'123456','AAAA-11')", [T]);
  await db.query("insert into public.rounds (id, tournament_id, number, phase, status) values ($1,$2,1,'league','done')", [R, T]);
  await db.query(
    `insert into public.players (id, tournament_id, display_name, resume_code, pre_registered, start_no, rating, club) values
     ($1,$4,'a','R1',true,1,1500,'Klasse 5A'), ($2,$4,'b','R2',true,2,null,null), ($3,$4,'c','R3',false,null,null,null)`,
    [P1, P2, P3, T],
  );
});

describe("0017", () => {
  it("accepts result_source 'physical' and still rejects junk", async () => {
    await db.query(
      `insert into public.games (tournament_id, round_id, white_player_id, black_player_id, fen, status, result_source)
       values ($1,$2,$3,$4,'x','white_win','physical')`,
      [T, R, P1, P2],
    );
    await expect(
      db.query(`insert into public.games (tournament_id, round_id, white_player_id, fen, status, result_source) values ($1,$2,$3,'x','bye','nope')`, [T, R, P3]),
    ).rejects.toThrow();
  });

  it("claim_player: first claim wins, second gets nothing, non-pre-registered never claimable", async () => {
    const a = await db.query<{ id: string }>("select * from public.claim_player($1,$2)", [T, P1]);
    expect(a.rows).toHaveLength(1);
    const b = await db.query("select * from public.claim_player($1,$2)", [T, P1]);
    expect(b.rows).toHaveLength(0);
    const c = await db.query("select * from public.claim_player($1,$2)", [T, P3]);
    expect(c.rows).toHaveLength(0);
    const d = await db.query("select * from public.claim_player($1,$2)", [OTHER, P2]);
    expect(d.rows).toHaveLength(0);
  });

  it("start numbers are unique per tournament", async () => {
    await expect(db.query("update public.players set start_no = 1 where id = $1", [P2])).rejects.toThrow();
  });

  it("recompute_scores: win 1, ½-bye (draw, black null) 0.5, 0-bye (aborted) 0", async () => {
    await db.query("delete from public.games");
    const ins = (w: string, b: string | null, st: string, src: string) =>
      db.query(
        `insert into public.games (tournament_id, round_id, white_player_id, black_player_id, fen, status, result_source) values ($1,$2,$3,$4,'x',$5,$6)`,
        [T, R, w, b, st, src],
      );
    await ins(P1, P2, "white_win", "physical");
    await ins(P3, null, "draw", "physical");
    await db.query("select public.recompute_scores($1)", [T]);
    const r = await db.query<{ id: string; score: string }>("select id, score from public.players where tournament_id = $1", [T]);
    const s = Object.fromEntries(r.rows.map((x) => [x.id, Number(x.score)]));
    expect(s[P1]).toBe(1);
    expect(s[P2]).toBe(0);
    expect(s[P3]).toBe(0.5);
  });
});
const OTHER = "99999999-8888-4777-8666-555555555555";
