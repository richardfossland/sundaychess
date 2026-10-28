"use client";

import { no } from "@/lib/locale/no";
import type { ReportDto, ReportResult } from "@/lib/physical/cloudTypes";
import type { PhysicalEventBody, PhysicalTournament } from "@/lib/physical/schema";
import { openRound } from "@/lib/physical/selectors";
import { getCloud, useCloudState, useReports } from "./cloudRegistry";

const L = no.physicalCloud;
const resultText = (r: ReportResult) => (r === "1-0" ? L.resultWhite : r === "0-1" ? L.resultBlack : L.resultDraw);

/** Ventende rapporter for et åpent brett: er det noe å vise? (Rent, testbart.) */
export function relevantReports(t: PhysicalTournament, reports: ReportDto[]): Map<number, ReportDto[]> {
  const r = openRound(t);
  const out = new Map<number, ReportDto[]>();
  if (!r || r.status !== "published") return out;
  for (const rep of reports) {
    if (rep.status !== "pending" || rep.round !== r.number) continue;
    const p = r.pairings.find((x) => x.board === rep.board);
    if (!p || p.black === null || p.result) continue;
    out.set(rep.board, [...(out.get(rep.board) ?? []), rep]);
  }
  return out;
}

/** Brett der begge spillerne har meldt det samme resultatet. */
export function agreedBoards(byBoard: Map<number, ReportDto[]>): number[] {
  const out: number[] = [];
  for (const [board, list] of byBoard) {
    const reporters = new Set(list.map((x) => x.reporter));
    if (list.length >= 2 && reporters.size >= 2 && list.every((x) => x.result === list[0].result)) out.push(board);
  }
  return out;
}

/**
 * Ventende spillermeldinger med godkjenn/avvis. Ett kall i runde-skjermen:
 * `<ReportsPanel t={t} apply={apply} />`. Godkjenning FØRER resultatet lokalt
 * (setResult, kilde player_report) – serveren skriver aldri resultater selv.
 */
export function ReportsPanel({ t, apply }: { t: PhysicalTournament; apply: (body: PhysicalEventBody) => void }) {
  const cloud = getCloud(t.id);
  const st = useCloudState(t.id);
  const round = openRound(t);
  const active = st.status !== "unpublished" && round?.status === "published";
  const { reports, refresh } = useReports(t.id, !!active);
  if (!active || !round) return null;

  const byBoard = relevantReports(t, reports);
  if (byBoard.size === 0) return null;
  const name = (id: string | null) => (id ? t.players.find((p) => p.id === id)?.name ?? "?" : "–");
  const agreed = agreedBoards(byBoard);

  async function approve(board: number, rep: ReportDto) {
    const list = byBoard.get(board) ?? [rep];
    apply({ type: "setResult", round: rep.round, board, result: rep.result, source: "player_report" });
    // Resultatet er ført lokalt først; skyen får beskjed etterpå (best effort – et ført brett filtreres bort uansett).
    await Promise.all(list.map((x) => cloud.decideReport(x.id, x.result === rep.result ? "approve" : "reject")));
    refresh();
  }
  async function reject(rep: ReportDto) {
    await cloud.decideReport(rep.id, "reject");
    refresh();
  }
  async function approveAgreed() {
    for (const board of agreed) await approve(board, byBoard.get(board)![0]);
  }

  return (
    <section className="stack" aria-label={L.reportsTitle} data-testid="reports-panel" style={{ gap: 8 }}>
      <div className="spread">
        <b>{L.reportsTitle} <span className="badge badge-live">{byBoard.size}</span></b>
        {agreed.length > 0 && (
          <button type="button" className="btn btn-sm btn-primary" onClick={approveAgreed}>{L.approveAgreed}</button>
        )}
      </div>
      {[...byBoard.entries()].sort((a, b) => a[0] - b[0]).map(([board, list]) => {
        const p = round.pairings.find((x) => x.board === board)!;
        const agree = agreed.includes(board);
        const disagree = list.length >= 2 && !list.every((x) => x.result === list[0].result);
        return (
          <div key={board} className="card" style={{ padding: 10 }} data-testid={`report-board-${board}`}>
            <div className="spread" style={{ gap: 8 }}>
              <span><b>{L.reportBoard(board)}</b> · {L.reportLine(name(p.white), name(p.black))}</span>
              {agree && <span className="badge badge-done">{L.reportAgree}</span>}
              {disagree && <span className="badge badge-error">{L.reportDisagree}</span>}
            </div>
            {list.map((rep) => (
              <div key={rep.id} className="spread" style={{ gap: 8, marginTop: 6 }}>
                <span>
                  <b>{resultText(rep.result)}</b> <span className="muted" style={{ fontSize: 12 }}>({L.reportFrom[rep.reporter]})</span>
                </span>
                <span className="row" style={{ gap: 4 }}>
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => approve(board, rep)}>{L.approve}</button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => reject(rep)}>{L.reject}</button>
                </span>
              </div>
            ))}
          </div>
        );
      })}
    </section>
  );
}
