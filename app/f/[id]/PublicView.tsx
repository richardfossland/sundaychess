"use client";

import { useEffect, useMemo, useState } from "react";
import { no } from "@/lib/locale/no";
import type { PublicSnapshot } from "@/lib/physical/snapshot";
import { useTabHidden } from "@/lib/client/useTabHidden";
import "../../arranger/fysisk/physical.css";

const L = no.physicalCloud;
const POLL_MS = 15_000;
const SHOWN: Record<string, string> = { "1-0": "1–0", "0-1": "0–1", "½-½": "½–½", "+-": "+ –", "-+": "– +", "=": "0–0", "0-0": "0–0" };

/** Live parringer og tabell for spillere og foresatte. Online, poller hvert 15. sekund. */
export function PublicView({ id }: { id: string }) {
  const [snap, setSnap] = useState<PublicSnapshot | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "missing">("loading");
  const [stale, setStale] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const hidden = useTabHidden();

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/physical/${id}`, { cache: "no-store" });
        if (!alive) return;
        if (res.status === 404) return setState("missing");
        if (!res.ok) throw new Error(String(res.status));
        setSnap((await res.json()) as PublicSnapshot);
        setState("ok");
        setStale(false);
      } catch {
        if (alive) setStale(true);
      }
    };
    void load();
    if (hidden) return () => void (alive = false);
    const iv = window.setInterval(load, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(iv);
    };
  }, [id, hidden]);

  const nameOf = useMemo(() => {
    const m = new Map(snap?.players.map((p) => [p.id, p.name]) ?? []);
    return (pid: string | null) => (pid ? m.get(pid) ?? "?" : "–");
  }, [snap]);

  if (state === "loading") return <main className="center-screen"><span className="spin" /></main>;
  if (state === "missing" || !snap) {
    return <main className="center-screen"><div className="card card-narrow banner banner-error">{L.pubNotFound}</div></main>;
  }

  const round = snap.rounds.find((r) => r.number === picked) ?? snap.rounds[snap.rounds.length - 1] ?? null;

  return (
    <main className="center-screen center-top">
      <div className="card card-form stack" data-testid="public-view">
        <div className="pr-title">
          <p className="eyebrow">SundayChess</p>
          <h1 className="pr-h1">{snap.title}</h1>
          {snap.status === "finished" && <span className="badge badge-done">{L.pubFinished}</span>}
        </div>
        {stale && <div className="banner" role="status">{L.pubOffline}</div>}

        {!round && <p className="muted">{L.pubNoRounds}</p>}
        {round && (
          <section className="stack gap-3" aria-label={L.pubPairings}>
            <div className="spread flex-wrap gap-3">
              <b className="pr-roundtitle">{L.pubRound(round.number, snap.totalRounds)}</b>
              {snap.rounds.length > 1 && (
                <span className="row flex-wrap gap-2">
                  {snap.rounds.map((r) => (
                    <button key={r.number} type="button" className={`btn btn-sm ${r.number === round.number ? "" : "btn-ghost"}`} aria-pressed={r.number === round.number} onClick={() => setPicked(r.number)}>
                      {r.number}
                    </button>
                  ))}
                </span>
              )}
            </div>
            <div className="px-scroll">
              <table className="table" data-testid="public-pairings">
                <thead>
                  <tr><th>{L.pubBoard}</th><th>{L.pubWhite}</th><th>{L.pubBlack}</th><th>{L.pubResult}</th></tr>
                </thead>
                <tbody>
                  {round.pairings.map((g) => (
                    <tr key={g.board}>
                      <td>{g.board}</td>
                      <td>{nameOf(g.white)}</td>
                      <td>{g.black ? nameOf(g.black) : <span className="muted">{L.pubBye}</span>}</td>
                      <td>{g.black ? (g.result ? SHOWN[g.result] ?? g.result : "") : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className="stack gap-3" aria-label={L.pubStandings}>
          <b className="pr-roundtitle">{L.pubStandings}</b>
          <div className="px-scroll">
            <table className="table" data-testid="public-standings">
              <thead>
                <tr><th>{L.pubPlace}</th><th>{L.pubName}</th>{snap.groupLabel && <th>{snap.groupLabel}</th>}<th>{L.pubPoints}</th></tr>
              </thead>
              <tbody>
                {snap.standings.map((r) => (
                  <tr key={r.playerId}>
                    <td>{r.rank}</td>
                    <td>{r.name}</td>
                    {snap.groupLabel && <td>{r.club ?? ""}</td>}
                    <td>{Number.isInteger(r.score) ? r.score : r.score.toFixed(1).replace(/\.0$/, "").replace(".", ",")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <p className="muted fs-xs m-0">{L.pubUpdated}</p>
      </div>
    </main>
  );
}
