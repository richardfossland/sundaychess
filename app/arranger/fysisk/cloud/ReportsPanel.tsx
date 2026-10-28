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

function useRoundReports(t: PhysicalTournament) {
  const st = useCloudState(t.id);
  const round = openRound(t);
  const active = st.status !== "unpublished" && round?.status === "published";
  const { reports, refresh } = useReports(t.id, !!active);
  return { round, byBoard: active ? relevantReports(t, reports) : new Map<number, ReportDto[]>(), refresh };
}

/** Før resultatet lokalt (setResult, kilde player_report), og si fra til skyen etterpå (best effort). */
async function approveReport(
  t: PhysicalTournament,
  apply: (body: PhysicalEventBody) => void,
  list: ReportDto[],
  rep: ReportDto,
  refresh: () => void,
) {
  apply({ type: "setResult", round: rep.round, board: rep.board, result: rep.result, source: "player_report" });
  const cloud = getCloud(t.id);
  await Promise.all(list.map((x) => cloud.decideReport(x.id, x.result === rep.result ? "approve" : "reject")));
  refresh();
}

/**
 * Oppsummering over runde-tabellen: antall ventende meldinger og «Godkjenn alle samstemte».
 * `<ReportsPanel t={t} apply={apply} />`
 */
export function ReportsPanel({ t, apply }: { t: PhysicalTournament; apply: (body: PhysicalEventBody) => void }) {
  const { byBoard, refresh } = useRoundReports(t);
  if (byBoard.size === 0) return null;
  const agreed = agreedBoards(byBoard);
  return (
    <div className="spread" data-testid="reports-panel" role="status">
      <b>{L.reportsTitle} <span className="badge badge-live">{byBoard.size}</span></b>
      {agreed.length > 0 && (
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={async () => {
            for (const board of agreed) await approveReport(t, apply, byBoard.get(board)!, byBoard.get(board)![0], refresh);
          }}
        >
          {L.approveAgreed}
        </button>
      )}
    </div>
  );
}

/**
 * Ventende meldinger for ETT brett, med godkjenn/avvis. Rendres rett under brettraden i RoundPanel:
 * `<BoardReports t={t} board={g.board} apply={apply} />`
 */
export function BoardReports({ t, board, apply }: { t: PhysicalTournament; board: number; apply: (body: PhysicalEventBody) => void }) {
  const { round, byBoard, refresh } = useRoundReports(t);
  const list = byBoard.get(board);
  if (!list || !round) return null;
  const agree = agreedBoards(byBoard).includes(board);
  const disagree = list.length >= 2 && !list.every((x) => x.result === list[0].result);
  return (
    <div role="row" className="card" style={{ padding: 8, margin: "0 0 4px" }} data-testid={`report-board-${board}`}>
      <div role="cell" className="stack" style={{ gap: 6 }}>
        <div className="spread" style={{ gap: 8 }}>
          <span className="badge badge-live">{L.reportsTitle}</span>
          {agree && <span className="badge badge-done">{L.reportAgree}</span>}
          {disagree && <span className="badge badge-error">{L.reportDisagree}</span>}
        </div>
        {list.map((rep) => (
          <div key={rep.id} className="spread" style={{ gap: 8 }}>
            <span>
              <b>{resultText(rep.result)}</b> <span className="muted" style={{ fontSize: 12 }}>({L.reportFrom[rep.reporter]})</span>
            </span>
            <span className="row" style={{ gap: 4 }}>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => approveReport(t, apply, list, rep, refresh)}>{L.approve}</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={async () => { await getCloud(t.id).decideReport(rep.id, "reject"); refresh(); }}>{L.reject}</button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
