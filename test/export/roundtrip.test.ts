import { describe, expect, it } from "vitest";
import { buildTournamentFile, tournamentFileText } from "@/lib/export/json";
import { canonicalJson, sha256Hex, sha256HexJs } from "@/lib/export/hash";
import { classifyConflict, asNewCopy } from "@/lib/import/apply";
import { migrateFile } from "@/lib/import/migrate";
import { parseTournamentFile, findRematches } from "@/lib/import/parse";
import { no } from "@/lib/locale/no";
import { randomTournament } from "./gen";
import { newTournament, playRound } from "../physical/helpers";

describe("sha256", () => {
  it("JS-fallback = WebCrypto", async () => {
    for (const s of ["", "abc", "æøå ½ ✓", "x".repeat(55), "x".repeat(56), "x".repeat(64), "x".repeat(1000)]) {
      expect(sha256HexJs(new TextEncoder().encode(s))).toBe(await sha256Hex(s));
    }
    expect(sha256HexJs(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("kanonisk JSON er uavhengig av nøkkelrekkefølge", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: undefined }] })).toBe('{"a":[2,{"d":1}],"b":1}');
  });
});

describe("rundtur import(export(t))", () => {
  it("er dypt lik for 60 tilfeldige turneringer", async () => {
    let withRounds = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const t = randomTournament(seed);
      if (t.rounds.length) withRounds++;
      const res = await parseTournamentFile(await tournamentFileText(t));
      if (!res.ok) throw new Error(`seed ${seed}: ${res.error}`);
      expect(res.hashOk, `seed ${seed}`).toBe(true);
      expect(res.snapshotOk, `seed ${seed}`).toBe(true);
      expect(res.needsConfirm).toBe(false);
      expect(res.tournament, `seed ${seed}`).toEqual(t);
    }
    expect(withRounds).toBeGreaterThan(40);
  });
});

describe("validering", () => {
  const base = async () => JSON.parse(await tournamentFileText(playRound(newTournament())));

  it("endret logg → hash-advarsel som krever bekreftelse", async () => {
    const f = await base();
    const ev = f.tournament.events.find((e: { type: string }) => e.type === "setResult");
    ev.result = ev.result === "1-0" ? "0-1" : "1-0";
    const res = await parseTournamentFile(JSON.stringify(f));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.hashOk).toBe(false);
      expect(res.needsConfirm).toBe(true);
      expect(res.snapshotOk).toBe(false); // snapshot sier fortsatt det gamle
    }
  });
  it("endret kun snapshot → advarsel, loggen vinner", async () => {
    const f = await base();
    f.tournament.snapshot.standings[0].score += 1;
    const res = await parseTournamentFile(JSON.stringify(f));
    expect(res.ok && res.hashOk && !res.snapshotOk && res.needsConfirm).toBe(true);
  });
  it("manglende hash regnes som endret", async () => {
    const f = await base();
    delete f.sha256;
    const res = await parseTournamentFile(JSON.stringify(f));
    expect(res.ok && !res.hashOk && res.needsConfirm).toBe(true);
  });
  it("ugyldig hendelse → norsk feil med nummer", async () => {
    const f = await base();
    const i = f.tournament.events.findIndex((e: { type: string }) => e.type === "setResult");
    f.tournament.events[i].board = 99;
    const res = await parseTournamentFile(JSON.stringify(f));
    expect(res).toEqual({ ok: false, error: no.physical.file.errors.eventFailed(i + 1, "setResult", no.physical.errors.boardNotFound) });
  });
  it("feil format, ikke JSON, tom, ingen hendelser", async () => {
    const f = await base();
    expect((await parseTournamentFile("{ikke json")).ok).toBe(false);
    expect(await parseTournamentFile("")).toEqual({ ok: false, error: no.physical.file.errors.empty });
    expect(await parseTournamentFile(JSON.stringify({ ...f, format: "annet" }))).toEqual({ ok: false, error: no.physical.file.errors.notSundayChess });
    expect(await parseTournamentFile(JSON.stringify({ ...f, tournament: { ...f.tournament, events: [] } }))).toEqual({ ok: false, error: no.physical.file.errors.noEvents });
  });
  it("versjon: for ny, mangler, ugyldig", async () => {
    const f = await base();
    expect(await parseTournamentFile(JSON.stringify({ ...f, schemaVersion: 2 }))).toEqual({ ok: false, error: no.physical.file.errors.versionTooNew(2) });
    expect((await parseTournamentFile(JSON.stringify({ ...f, schemaVersion: undefined }))).ok).toBe(false);
    expect((await parseTournamentFile(JSON.stringify({ ...f, schemaVersion: 0 }))).ok).toBe(false);
  });
  it("migreringskroken kjører trinnvis, og mangler gir feil", () => {
    const m = { 1: (x: Record<string, unknown>) => ({ ...x, migrated: true }) };
    const out = migrateFile({ schemaVersion: 1 }, 2, m);
    expect(out).toMatchObject({ schemaVersion: 2, migrated: true });
    expect(() => migrateFile({ schemaVersion: 1 }, 3, m)).toThrow(no.physical.file.errors.versionUnsupported(2));
  });
  it("BOM foran JSON tåles", async () => {
    const res = await parseTournamentFile("﻿" + (await tournamentFileText(playRound(newTournament()))));
    expect(res.ok).toBe(true);
  });
  it("umerkede gjentatte parringer varsles", () => {
    const t = playRound(playRound(newTournament({ system: "monrad", rounds: 3 }, 4)));
    expect(findRematches(t)).toEqual([]);
    const r2 = t.rounds[1];
    const copy = structuredClone(t);
    copy.rounds[1].pairings = structuredClone(t.rounds[0].pairings);
    expect(findRematches(copy).length).toBeGreaterThan(0);
    void r2;
  });
});

describe("konflikter", () => {
  it("klassifiserer lokal vs fil", () => {
    const a = playRound(newTournament());
    const b = playRound(a);
    expect(classifyConflict(null, a.events).kind).toBe("none");
    expect(classifyConflict(a.events, a.events).kind).toBe("same");
    const newer = classifyConflict(b.events, a.events);
    expect(newer.kind).toBe("localNewer");
    expect(newer.localExtra).toBe(b.events.length - a.events.length);
    expect(classifyConflict(a.events, b.events).kind).toBe("fileNewer");
    const fork = { ...b.events[b.events.length - 1], id: "annen" };
    expect(classifyConflict([...a.events, fork], b.events).kind).toBe("diverged");
  });
  it("ny kopi får ny id og kopi-tittel, men samme innhold ellers", () => {
    const t = playRound(newTournament());
    const c = asNewCopy(t, "ny-id");
    expect(c.id).toBe("ny-id");
    expect(c.title).toBe(t.title + no.physical.file.copySuffix);
    expect(c.rounds).toEqual(t.rounds);
  });
  it("buildTournamentFile har forventede felt", async () => {
    const f = await buildTournamentFile(newTournament(), "2026-10-28T12:00:00.000Z");
    expect(f).toMatchObject({ format: "sundaychess-tournament", schemaVersion: 1, exportedAt: "2026-10-28T12:00:00.000Z" });
    expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(f.app.version).toMatch(/^\d/);
  });
});
