"use client";

import { no } from "@/lib/locale/no";
import { totalRounds } from "@/lib/physical/reducer";
import { crosstableByRound } from "@/lib/physical/roundView";
import type { PhysicalTournament } from "@/lib/physical/schema";
import { standings } from "@/lib/physical/selectors";

const p = no.physical;
const fmt = (n: number | null) => (n === null ? "–" : Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ""));
const pts = (n: number | null) => (n === null ? "·" : n === 0.5 ? "½" : String(n));

export function StandingsPanel({ t }: { t: PhysicalTournament }) {
  const done = t.rounds.filter((r) => r.status === "completed").length;
  const open = t.rounds.find((r) => r.status === "published");
  const hasData = t.rounds.some((r) => r.status !== "draft");
  const rows = standings(t, { includeOpen: true });
  const tbs = t.settings.tiebreaks;
  const heading = open ? p.liveStandings(open.number) : done > 0 ? p.standingsAfter(done) : p.standings;
  if (!hasData) return <span className="muted">{p.noStandings}</span>;
  return (
    <section className="stack" aria-label={p.standings}>
      <p className="eyebrow">{heading}</p>
      <div className="px-scroll">
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
      {tbs.length > 0 && (
        <details>
          <summary style={{ cursor: "pointer", minHeight: 44, display: "flex", alignItems: "center", fontWeight: 700 }}>{p.tiebreakExplain}</summary>
          <dl className="px-explain">
            {tbs.map((k) => (
              <div key={k}>
                <dt>{no.tiebreaks[k].label}</dt>
                <dd>{no.tiebreaks[k].help}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </section>
  );
}

export function CrosstablePanel({ t }: { t: PhysicalTournament }) {
  const x = crosstableByRound(t);
  if (x.rounds.length === 0) return <span className="muted">{p.crosstableEmpty}</span>;
  return (
    <section className="stack" aria-label={p.crosstableTitle}>
      <p className="eyebrow">{p.crosstableTitle}</p>
      <div className="px-scroll">
        <table className="table">
          <thead>
            <tr>
              <th className="num">{p.rank}</th>
              <th className="num">{p.startNo}</th>
              <th>{p.name}</th>
              {x.rounds.map((r) => <th key={r} className="px-cell">R{r}</th>)}
              <th className="num">{p.points}</th>
            </tr>
          </thead>
          <tbody>
            {x.rows.map((row) => (
              <tr key={row.player.id}>
                <td className="num">{row.rank}</td>
                <td className="num">{row.player.startNo}</td>
                <td>{row.player.name}</td>
                {row.cells.map((c) => (
                  <td key={c.round} className="px-cell" data-kind={c.kind}>
                    {c.kind === "game" || c.kind === "pending" ? (
                      <>
                        {c.opp}
                        <small aria-label={c.colour === "W" ? p.white : p.black}>{c.colour === "W" ? p.colourW : p.colourB}</small>
                        <span className="px-pts">{pts(c.points)}{c.forfeit ? "+" : ""}</span>
                      </>
                    ) : c.kind === "bye" ? (
                      <>{p.crossBye}<span className="px-pts">{pts(c.points)}</span></>
                    ) : (
                      <>–{c.points ? <span className="px-pts">{pts(c.points)}</span> : null}</>
                    )}
                  </td>
                ))}
                <td className="num"><b>{fmt(row.score)}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <span className="muted" style={{ fontSize: 13 }}>{p.crosstableLegend}</span>
    </section>
  );
}

export function BracketPanel({ t }: { t: PhysicalTournament }) {
  const total = totalRounds(t);
  if (t.rounds.length === 0) return <span className="muted">{p.bracketEmpty}</span>;
  const name = (id: string | null) => (id ? t.players.find((x) => x.id === id)?.name ?? "?" : null);
  const winSide = (res: string | null | undefined): "white" | "black" | null => (res === "1-0" || res === "+-" ? "white" : res === "0-1" || res === "-+" ? "black" : null);
  return (
    <section className="stack" aria-label={p.bracketTitle}>
      <p className="eyebrow">{p.bracketTitle}</p>
      <div className="pb-cols">
        {t.rounds.map((r) => (
          <div key={r.number} className="pb-col">
            <b>{p.bracketRound(r.number, Math.max(total, r.number))}</b>
            {r.pairings.map((g) => {
              const w = g.black === null ? "white" : winSide(g.result);
              return (
                <div key={g.board} className="pb-match" aria-label={p.boardLabel(g.board)}>
                  <div className="pb-side" data-win={w === "white"} data-lose={w === "black"}>
                    <span>{name(g.white)}</span>
                    {w === "white" && <span aria-label={p.bracketWinner}>✓</span>}
                  </div>
                  <div className="pb-side" data-win={w === "black"} data-lose={w === "white"}>
                    <span>{g.black === null ? <i className="muted">{p.bye}</i> : name(g.black)}</span>
                    {w === "black" && <span aria-label={p.bracketWinner}>✓</span>}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}
