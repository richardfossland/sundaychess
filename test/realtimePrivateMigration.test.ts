import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

// Applies every migration (0001…0015) to an in-memory Postgres with a stubbed
// Supabase `realtime` schema, then replays what Realtime does at join time: a
// SELECT / INSERT on realtime.messages AS the subscriber's role with
// realtime.topic() set to the channel topic. Proves the allow/deny matrix of
// 0014's policies and the behaviour of 0015's code_attempts functions.

const MIGRATIONS = join(__dirname, "..", "supabase", "migrations");
const T = "11111111-2222-4333-8444-555555555555";
const G = "aaaaaaaa-2222-4333-8444-555555555555";
const OTHER = "99999999-8888-4777-8666-555555555555"; // no such tournament/game

const sqlOf = (f: string) =>
  readFileSync(join(MIGRATIONS, f), "utf8").replace(/create extension if not exists pg_cron;/gi, "");

let db: PGlite;

async function asAnon<R>(topic: string, fn: () => Promise<R>): Promise<R> {
  await db.exec("begin");
  try {
    await db.query("select set_config('realtime.topic', $1, true)", [topic]);
    await db.exec("set local role anon");
    return await fn();
  } finally {
    await db.exec("rollback");
  }
}

async function canRead(topic: string): Promise<boolean> {
  return asAnon(topic, async () => {
    const r = await db.query<{ n: number }>(
      "select count(*)::int as n from realtime.messages where topic = $1",
      [topic],
    );
    return r.rows[0].n > 0;
  });
}

async function canSend(topic: string, extension: "broadcast" | "presence"): Promise<boolean> {
  return asAnon(topic, async () => {
    try {
      await db.query(
        "insert into realtime.messages (topic, extension, payload) values ($1, $2, '{}')",
        [topic, extension],
      );
      return true;
    } catch (e) {
      if (/row-level security/i.test(String(e))) return false;
      throw e;
    }
  });
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema realtime;
    create function realtime.topic() returns text language sql stable
      as $$ select nullif(current_setting('realtime.topic', true), '') $$;
    create table realtime.messages (
      id uuid primary key default gen_random_uuid(),
      topic text not null,
      extension text not null,
      payload jsonb,
      event text,
      private boolean default true
    );
    alter table realtime.messages enable row level security;
    grant execute on function realtime.topic() to anon, authenticated;
    -- pg_cron is a Supabase extension PGlite lacks (0004/0010/0012 schedule jobs).
    create schema cron;
    create function cron.schedule(text, text, text) returns bigint language sql as 'select 1::bigint';
    create function cron.unschedule(text) returns boolean language sql as 'select true';
  `);
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  expect(files.at(-1)).toBe("0017_physical_continue.sql");
  for (const f of files) await db.exec(sqlOf(f));
  // Re-applying must be a no-op (idempotent).
  await db.exec(sqlOf("0014_realtime_private.sql"));
  await db.exec(sqlOf("0015_code_attempts.sql"));
  await db.exec(sqlOf("0016_physical_cloud.sql"));
  await db.exec(sqlOf("0017_physical_continue.sql"));

  await db.query(
    "insert into public.tournaments (id, join_pin, host_code) values ($1, '123456', 'AAAA-11')",
    [T],
  );
  await db.query("insert into public.rounds (id, tournament_id, number) values ($1, $2, 1)", [G, T]);
  await db.query(
    `insert into public.players (id, tournament_id, display_name, resume_code)
     values ($1, $2, 'a', 'R1'), ($3, $2, 'b', 'R2')`,
    ["bbbbbbbb-2222-4333-8444-555555555555", T, "cccccccc-2222-4333-8444-555555555555"],
  );
  await db.query(
    `insert into public.games (id, tournament_id, round_id, white_player_id, black_player_id, fen)
     values ($1, $2, $1, 'bbbbbbbb-2222-4333-8444-555555555555', 'cccccccc-2222-4333-8444-555555555555', 'x')`,
    [G, T],
  );
  for (const t of [
    `chess:lobby:${T}`,
    `chess:spectate:${T}`,
    `chess:presence:${T}`,
    `chess:game:${G}`,
    `chess:lobby:${OTHER}`,
    `chess:game:${OTHER}`,
    `chess:game:${T}`, // a tournament id is not a game id
    "t:other-app",
    `t:${T}`,
  ]) {
    await db.query("insert into realtime.messages (topic, extension) values ($1, 'broadcast')", [t]);
  }
});

describe("0014 realtime private channels", () => {
  it("anon receives on all four topic shapes of an existing tournament/game", async () => {
    for (const t of [`chess:lobby:${T}`, `chess:spectate:${T}`, `chess:presence:${T}`, `chess:game:${G}`]) {
      expect(await canRead(t)).toBe(true);
    }
  });

  it("anon cannot receive unknown ids, mixed-up id kinds, or other apps' topics", async () => {
    expect(await canRead(`chess:lobby:${OTHER}`)).toBe(false);
    expect(await canRead(`chess:game:${OTHER}`)).toBe(false);
    expect(await canRead(`chess:game:${T}`)).toBe(false);
    expect(await canRead("t:other-app")).toBe(false);
    expect(await canRead(`t:${T}`)).toBe(false); // sister app's shape: not ours to grant
  });

  it("anon cannot send hints on lobby/spectate topics", async () => {
    for (const t of [`chess:lobby:${T}`, `chess:spectate:${T}`]) {
      expect(await canSend(t, "broadcast")).toBe(false);
      expect(await canSend(t, "presence")).toBe(false);
    }
  });

  it("anon can send reactions on a game and track presence, each only on its own topic", async () => {
    expect(await canSend(`chess:game:${G}`, "broadcast")).toBe(true);
    expect(await canSend(`chess:presence:${T}`, "presence")).toBe(true);
    expect(await canSend(`chess:game:${G}`, "presence")).toBe(false);
    expect(await canSend(`chess:presence:${T}`, "broadcast")).toBe(false);
    expect(await canSend(`chess:game:${OTHER}`, "broadcast")).toBe(false);
  });

  it("the policies are all scoped to chess: topics only", async () => {
    const r = await db.query<{ qual: string }>(
      "select coalesce(qual,'') || coalesce(with_check,'') as qual from pg_policies where schemaname='realtime' and policyname like 'chess_rt_%'",
    );
    expect(r.rows).toHaveLength(3);
    for (const row of r.rows) expect(row.qual).toContain("chess:");
  });

  it("a junk topic is false, not an error", async () => {
    const r = await db.query<{ ok: boolean }>("select public.chess_rt_topic_ok('chess:lobby:not-a-uuid') as ok");
    expect(r.rows[0].ok).toBe(false);
  });
});

describe("0015 code_attempts", () => {
  const call = async (fn: string, scope: string, ip: string, max = 3) =>
    (await db.query<{ r: boolean }>(`select public.${fn}($1,$2,600,$3) as r`, [scope, ip, max])).rows[0].r;

  it("blocks an IP only after max wrong codes, per scope and per IP", async () => {
    expect(await call("code_blocked", "s1", "1.1.1.1")).toBe(false);
    expect(await call("register_code_failure", "s1", "1.1.1.1")).toBe(false);
    expect(await call("register_code_failure", "s1", "1.1.1.1")).toBe(false);
    expect(await call("register_code_failure", "s1", "1.1.1.1")).toBe(true);
    expect(await call("code_blocked", "s1", "1.1.1.1")).toBe(true);
    expect(await call("code_blocked", "s1", "2.2.2.2")).toBe(false);
    expect(await call("code_blocked", "s2", "1.1.1.1")).toBe(false);
  });

  it("an expired window starts over", async () => {
    await call("register_code_failure", "s3", "3.3.3.3");
    await db.query("update public.code_attempts set window_start = now() - interval '11 minutes', failures = 99 where scope='s3'");
    expect(await call("code_blocked", "s3", "3.3.3.3")).toBe(false);
    expect(await call("register_code_failure", "s3", "3.3.3.3")).toBe(false);
  });

  it("anon/authenticated cannot call the functions or read the table", async () => {
    for (const q of [
      "select public.code_blocked('s','i',600,3)",
      "select public.register_code_failure('s','i',600,3)",
      "select * from public.code_attempts",
    ]) {
      await db.exec("begin");
      try {
        await db.exec("set local role anon");
        await expect(db.query(q)).rejects.toThrow(/permission denied/i);
      } finally {
        await db.exec("rollback");
      }
    }
  });
});

describe("0016 physical cloud", () => {
  const P = "dddddddd-2222-4333-8444-555555555555";
  const report = (id: string, rid: string, result = "1-0") =>
    db.query(
      "insert into public.physical_result_reports (tournament_id, round, board, result, reporter, request_id) values ($1, 1, 1, $3, 'white', $2)",
      [id, rid, result],
    );

  it("enforces result/reporter/status checks and unique request_id", async () => {
    await db.query(
      "insert into public.physical_tournaments (id, host_code, title, event_log, log_hash) values ($1, 'AAAA-11', 't', '[]', 'h')",
      [P],
    );
    await report(P, "req-1");
    await expect(report(P, "req-1")).rejects.toThrow(/unique|duplicate/i);
    await expect(report(P, "req-2", "2-0")).rejects.toThrow(/check/i);
    await expect(
      db.query(
        "insert into public.physical_result_reports (tournament_id, round, board, result, reporter, request_id) values ($1,1,1,'1-0','mom','req-3')",
        [P],
      ),
    ).rejects.toThrow(/check/i);
    await expect(report("99999999-8888-4777-8666-555555555555", "req-4")).rejects.toThrow(/foreign key/i);
  });

  it("anon/authenticated cannot touch the tables or the cleanup function", async () => {
    for (const q of [
      "select * from public.physical_tournaments",
      "select * from public.physical_result_reports",
      "delete from public.physical_tournaments",
      "select public.cleanup_physical_tournaments()",
    ]) {
      for (const role of ["anon", "authenticated"]) {
        await db.exec("begin");
        try {
          await db.exec(`set local role ${role}`);
          await expect(db.query(q)).rejects.toThrow(/permission denied/i);
        } finally {
          await db.exec("rollback");
        }
      }
    }
  });

  it("service_role can use the tables", async () => {
    await db.exec("begin");
    try {
      await db.exec("set local role service_role");
      const r = await db.query<{ n: number }>("select count(*)::int as n from public.physical_tournaments");
      expect(r.rows[0].n).toBeGreaterThan(0);
    } finally {
      await db.exec("rollback");
    }
  });

  it("cleanup removes only 30-day-inactive tournaments and cascades reports", async () => {
    const OLD = "eeeeeeee-2222-4333-8444-555555555555";
    await db.query(
      "insert into public.physical_tournaments (id, host_code, title, event_log, log_hash, updated_at) values ($1,'BBBB-22','old','[]','h', now() - interval '31 days')",
      [OLD],
    );
    await report(OLD, "req-old");
    await db.query("update public.physical_result_reports set created_at = now() - interval '31 days' where request_id = 'req-old'");
    const r = await db.query<{ n: number }>("select public.cleanup_physical_tournaments() as n");
    expect(r.rows[0].n).toBe(1);
    const left = await db.query<{ id: string }>("select id from public.physical_tournaments");
    expect(left.rows.map((x) => x.id)).toEqual([P]);
    const reps = await db.query<{ n: number }>("select count(*)::int as n from public.physical_result_reports where request_id='req-old'");
    expect(reps.rows[0].n).toBe(0);
  });

  it("a fresh player report does NOT extend retention (only host writes bump updated_at)", async () => {
    const STALE = "ffffffff-2222-4333-8444-555555555555";
    await db.query(
      "insert into public.physical_tournaments (id, host_code, title, event_log, log_hash, updated_at) values ($1,'CCCC-33','stale','[]','h', now() - interval '31 days')",
      [STALE],
    );
    await report(STALE, "req-fresh"); // created_at = now()
    const r = await db.query<{ n: number }>("select public.cleanup_physical_tournaments() as n");
    expect(r.rows[0].n).toBe(1);
    const left = await db.query<{ id: string }>("select id from public.physical_tournaments where id = $1", [STALE]);
    expect(left.rows).toHaveLength(0);
  });

  it("has the snapshot/name/device/fingerprint columns, defaults and the superseded status", async () => {
    const Q = "abababab-2222-4333-8444-555555555555";
    await db.query("insert into public.physical_tournaments (id, host_code, title, event_log, log_hash) values ($1,'DDDD-44','q','[]','h')", [Q]);
    const t = await db.query<{ public_names: string; public_snapshot: unknown; local_id: unknown }>("select public_names, public_snapshot, local_id from public.physical_tournaments where id = $1", [Q]);
    expect(t.rows[0]).toEqual({ public_names: "initials", public_snapshot: null, local_id: null });
    await expect(db.query("update public.physical_tournaments set public_names = 'everything' where id = $1", [Q])).rejects.toThrow(/check/i);
    await db.query("insert into public.physical_result_reports (tournament_id, round, board, result, reporter, request_id, device_id, pairing_fp, status) values ($1,1,1,'1-0','unknown','req-sup','dev-1','a|b','superseded')", [Q]);
    const r = await db.query<{ device_id: string; pairing_fp: string }>("select device_id, pairing_fp from public.physical_result_reports where request_id = 'req-sup'");
    expect(r.rows[0]).toEqual({ device_id: "dev-1", pairing_fp: "a|b" });
  });

  it("is idempotent: the whole file can be run twice", async () => {
    await db.exec(sqlOf("0016_physical_cloud.sql"));
  await db.exec(sqlOf("0017_physical_continue.sql"));
  });

  it("does not disturb 0013's revoke on cleanup_old_tournaments", async () => {
    await db.exec("begin");
    try {
      await db.exec("set local role anon");
      await expect(db.query("select public.cleanup_old_tournaments()")).rejects.toThrow(/permission denied/i);
    } finally {
      await db.exec("rollback");
    }
  });
});
