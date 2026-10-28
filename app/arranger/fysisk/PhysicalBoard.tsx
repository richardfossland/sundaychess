"use client";

import { NavLink } from "./nav";
import { useState } from "react";
import { no } from "@/lib/locale/no";
import { Icon } from "@/lib/client/Icon";
import { makeEvent, newId } from "@/lib/physical/events";
import { canUndo, reduce, totalRounds } from "@/lib/physical/reducer";
import { RESULT_CODES, type PhysicalPairing, type PhysicalTournament, type ResultCode } from "@/lib/physical/schema";
import { nextRoundPairing, openRound, standings } from "@/lib/physical/selectors";
import { usePhysicalTournament } from "./usePhysical";
import { PrintMenu } from "./print/PrintMenu";

const fmt = (n: number | null) => (n === null ? "–" : Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ""));

export function PhysicalBoard({ id }: { id: string }) {
  const { state: t, status, error, setError, apply, run, undo, storeKind, saveFailed } = usePhysicalTournament(id);
  const p = no.physical;

  if (status === "loading") return <main className="center-screen"><span className="spin" /></main>;
  if (status !== "ready" || !t) {
    return (
      <main className="center-screen">
        <div className="card card-narrow stack">
          <div className="banner banner-error">{status === "corrupt" ? p.loadFailed : p.notFound}</div>
          <NavLink href="/arranger/fysisk" className="btn btn-block">{p.backToList}</NavLink>
        </div>
      </main>
    );
  }

  const open = openRound(t);
  const total = totalRounds(t);
  const canPair = t.status === "running" && !open && t.rounds.length < total && t.players.length >= 2;
  const allDone = t.status === "running" && !open && t.rounds.length > 0;
  const name = (pid: string | null) => (pid ? t.players.find((x) => x.id === pid)?.name ?? "?" : "–");

  function pair() {
    run((cur) => {
      const { round, pairings } = nextRoundPairing(cur);
      return reduce(cur, makeEvent({ type: "pairRound", round, pairings }));
    });
  }

  return (
    <main className="center-screen" style={{ alignItems: "flex-start" }}>
      <div className="card stack scale-in" style={{ width: "min(100%, 860px)" }}>
        <div className="spread">
          <div>
            <p className="eyebrow">{p.entryTitle} · {p.systems[t.settings.system].label}</p>
            <h1 style={{ margin: 0, fontSize: 24 }}>{t.title}</h1>
            {t.status === "finished" && <span className="badge badge-done">{p.finishedNote}</span>}
          </div>
          <div className="row" style={{ gap: 6 }}>
            <PrintMenu id={t.id} />
            <button type="button" className="btn btn-sm btn-ghost" onClick={undo} disabled={!canUndo(t)}>
              <Icon name="undo" size={14} /> {p.undo}
            </button>
            <NavLink href="/arranger/fysisk" className="btn btn-sm btn-ghost">{p.backToList}</NavLink>
          </div>
        </div>

        {storeKind === "memory" && <div className="banner banner-error">{p.storageMemoryWarn}</div>}
        {saveFailed && <div className="banner banner-error">{p.saveFailed}</div>}
        {error && <div className="banner banner-error" role="alert" onClick={() => setError(null)}>{error}</div>}

        {/* Runde */}
        <section className="stack" aria-label="Runde">
          {t.rounds.length > 0 && (
            <div className="stack" style={{ gap: 20 }}>
              {[...t.rounds].reverse().slice(0, 1).map((r) => (
                <div key={r.number} className="stack" style={{ gap: 8 }}>
                  <div className="spread">
                    <b>{p.roundN(r.number)} / {total}</b>
                    <span className={`badge ${r.status === "completed" ? "badge-done" : "badge-live"}`}>
                      {r.status === "draft" ? "Utkast" : r.status === "published" ? "Publisert" : "Fullført"}
                    </span>
                  </div>
                  {r.status === "draft" && <span className="muted" style={{ fontSize: 13 }}>{p.draftNote}</span>}
                  <table className="table">
                    <thead>
                      <tr>
                        <th>{p.board}</th><th>{p.white}</th><th>{p.black}</th><th>{p.result}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.pairings.map((g) => (
                        <PairingRow key={g.board} g={g} t={t} round={r.number} locked={r.status !== "published"} nameOf={name}
                          onSet={(res) => (res ? apply({ type: "setResult", round: r.number, board: g.board, result: res }) : apply({ type: "clearResult", round: r.number, board: g.board }))} />
                      ))}
                    </tbody>
                  </table>
                  {r.status === "draft" && (
                    <button type="button" className="btn btn-primary" onClick={() => apply({ type: "publishRound", round: r.number })}>{p.publishRound}</button>
                  )}
                  {r.status === "published" && (
                    <button type="button" className="btn btn-primary" onClick={() => apply({ type: "completeRound", round: r.number })}>{p.completeRound}</button>
                  )}
                </div>
              ))}
            </div>
          )}
          {canPair && (
            <button type="button" className="btn btn-primary btn-lg" onClick={pair}>{p.pairRound(t.rounds.length + 1)}</button>
          )}
          {allDone && (
            <button type="button" className="btn" onClick={() => apply({ type: "finishTournament" })}>{p.finishTournament}</button>
          )}
        </section>

        {/* Stilling */}
        <section className="stack" aria-label={p.standings}>
          <p className="eyebrow">{t.rounds.some((r) => r.status === "completed") ? p.standingsAfter(t.rounds.filter((r) => r.status === "completed").length) : p.standings}</p>
          {t.rounds.some((r) => r.status === "completed") ? <StandingsTable t={t} /> : <span className="muted">{p.noStandings}</span>}
        </section>

        {/* Spillere */}
        <PlayersSection t={t} apply={apply} nameOf={name} />
      </div>
    </main>
  );
}

function PairingRow({ g, t, round, locked, nameOf, onSet }: {
  g: PhysicalPairing; t: PhysicalTournament; round: number; locked: boolean; nameOf: (id: string | null) => string; onSet: (r: ResultCode | null) => void;
}) {
  const p = no.physical;
  const ko = t.settings.system === "knockout";
  const completed = t.rounds.find((r) => r.number === round)?.status === "completed";
  return (
    <tr>
      <td className="num">{g.board}</td>
      <td>{nameOf(g.white)}</td>
      <td>{g.black === null ? <i className="muted">{p.bye}</i> : nameOf(g.black)}{g.rematch ? <span className="muted" title={p.rematchNote}> ⚠</span> : null}</td>
      <td>
        {g.black === null ? (
          <span className="muted">{g.byeType === "half" ? "½" : g.byeType === "zero" ? "0" : "1"}</span>
        ) : (
          <select className="input" aria-label={`${p.result} ${p.board} ${g.board}`} value={g.result ?? ""} disabled={locked || completed}
            onChange={(e) => onSet((e.target.value || null) as ResultCode | null)}>
            <option value="">{p.noResult}</option>
            {RESULT_CODES.filter((c) => !(ko && (c === "½-½" || c === "="))).map((c) => (
              <option key={c} value={c}>{p.results[c]}</option>
            ))}
          </select>
        )}
      </td>
    </tr>
  );
}

function StandingsTable({ t }: { t: PhysicalTournament }) {
  const p = no.physical;
  const rows = standings(t);
  const tbs = t.settings.tiebreaks;
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="table">
        <thead>
          <tr>
            <th className="num">{p.rank}</th>
            <th>{p.name}</th>
            <th className="num">{p.points}</th>
            {tbs.map((k) => <th key={k} className="num" title={no.tiebreaks[k].help}>{no.tiebreaks[k].label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.playerId}>
              <td className="num">{r.rank}</td>
              <td>{r.player.name}{r.player.status === "withdrawn" ? <span className="muted"> ({p.statusWithdrawn})</span> : null}</td>
              <td className="num"><b>{fmt(r.score)}</b></td>
              {tbs.map((k) => <td key={k} className="num">{fmt(r.values[k])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PlayersSection({ t, apply, nameOf }: {
  t: PhysicalTournament; apply: (b: import("@/lib/physical/schema").PhysicalEventBody) => void; nameOf: (id: string | null) => string;
}) {
  const p = no.physical;
  const [pName, setPName] = useState("");
  const [pRating, setPRating] = useState("");
  const [localErr, setLocalErr] = useState<string | null>(null);
  const nextRound = t.rounds.length + 1;
  const canAdd = t.status === "running" && (t.rounds.length === 0 || (t.settings.allowLateEntry && (t.settings.system === "monrad" || t.settings.system === "swiss")));
  const canBye = t.status === "running" && t.settings.system !== "knockout" && nextRound <= totalRounds(t);

  function add() {
    if (!pName.trim()) return;
    const r = pRating.trim() === "" ? undefined : Number(pRating);
    if (r !== undefined && (!Number.isInteger(r) || r < 0 || r > 3500)) return setLocalErr(p.errors.badRating);
    setLocalErr(null);
    apply({ type: "addPlayer", playerId: newId(), name: pName, ...(r !== undefined ? { rating: r } : {}) });
    setPName("");
    setPRating("");
  }
  const byeFor = (pid: string) => t.byeRequests.find((b) => b.playerId === pid && b.round === nextRound);
  void nameOf;
  return (
    <section className="stack" aria-label={p.overviewPlayers}>
      <p className="eyebrow">{p.overviewPlayers} ({p.playerCount(t.players.length)})</p>
      <div style={{ overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr><th className="num">{p.startNo}</th><th>{p.name}</th><th className="num">{p.rating}</th><th>{t.settings.groupLabel ?? "Klubb"}</th><th>{p.status}</th><th /></tr>
          </thead>
          <tbody>
            {t.players.map((pl) => {
              const bye = byeFor(pl.id);
              return (
                <tr key={pl.id}>
                  <td className="num">{pl.startNo}</td>
                  <td>{pl.name}</td>
                  <td className="num">{pl.rating ?? ""}</td>
                  <td>{pl.club ?? ""}</td>
                  <td>{pl.status === "active" ? p.statusActive : p.statusWithdrawn}{bye ? <span className="muted"> · {p.byeRequested(bye.round, bye.byeType)}</span> : null}</td>
                  <td>
                    <span className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
                      {t.status === "running" && pl.status === "active" && canBye && (
                        bye ? <button type="button" className="btn btn-sm btn-ghost" onClick={() => apply({ type: "cancelByeRequest", playerId: pl.id, round: nextRound })}>{p.cancelBye}</button>
                          : <button type="button" className="btn btn-sm btn-ghost" onClick={() => apply({ type: "requestBye", playerId: pl.id, round: nextRound, byeType: "half" })}>{p.requestHalfBye}</button>
                      )}
                      {t.status === "running" && (pl.status === "active"
                        ? <button type="button" className="btn btn-sm btn-ghost" onClick={() => apply({ type: "withdrawPlayer", playerId: pl.id })}>{p.withdraw}</button>
                        : <button type="button" className="btn btn-sm btn-ghost" onClick={() => apply({ type: "reinstatePlayer", playerId: pl.id })}>{p.reinstate}</button>)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {canAdd && (
        <div className="row">
          <input className="input grow" aria-label={p.playerName} placeholder={p.playerName} value={pName} onChange={(e) => setPName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
          <input className="input" style={{ width: 110 }} inputMode="numeric" aria-label={p.playerRating} placeholder={p.rating} value={pRating} onChange={(e) => setPRating(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
          <button type="button" className="btn" onClick={add} disabled={!pName.trim()}>{t.rounds.length ? p.addLate : p.addPlayer}</button>
        </div>
      )}
      {localErr && <div className="banner banner-error">{localErr}</div>}
    </section>
  );
}

