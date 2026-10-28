"use client";

import { no } from "@/lib/locale/no";
import type { ReportDto, ReportResult } from "@/lib/physical/cloudTypes";
import type { PhysicalEventBody, PhysicalTournament } from "@/lib/physical/schema";
import { openRound } from "@/lib/physical/selectors";
import { getCloud, useCloudState, useReports } from "./cloudRegistry";

const L = no.physicalCloud;
const resultText = (r: ReportResult) => (r === "1-0" ? L.resultWhite : r === "0-1" ? L.resultBlack : L.resultDraw);

/** Parringens fingerprint (hvit|svart), slik serveren lagrer den i hver melding. */
export const pairingFp = (g: { white: string; black: string | null }) => `${g.white}|${g.black}`;

/**
 * Ventende rapporter for et åpent brett. Bare meldinger som ble gitt for DEN GJELDENDE parringen
 * (fingerprint hvit|svart) vises; ble brettet byttet etter publisering, er eldre meldinger foreldet
 * og krediteres aldri de nye spillerne. (Rent, testbart.)
 */
export function relevantReports(t: PhysicalTournament, reports: ReportDto[]): Map<number, ReportDto[]> {
  const r = openRound(t);
  const out = new Map<number, ReportDto[]>();
  if (!r || r.status !== "published") return out;
  for (const rep of reports) {
    if (rep.status !== "pending" || rep.round !== r.number) continue;
    const p = r.pairings.find((x) => x.board === rep.board);
    if (!p || p.black === null || p.result) continue;
    if (rep.pairingFp !== pairingFp(p)) continue;
    out.set(rep.board, [...(out.get(rep.board) ?? []), rep]);
  }
  return out;
}

/** Ventende meldinger for åpen runde som ikke lenger passer parringen (byttet etter publisering). */
export function staleReports(t: PhysicalTournament, reports: ReportDto[]): ReportDto[] {
  const r = openRound(t);
  if (!r || r.status !== "published") return [];
  return reports.filter((rep) => {
    if (rep.status !== "pending" || rep.round !== r.number) return false;
    const p = r.pairings.find((x) => x.board === rep.board);
    return !p || p.black === null || rep.pairingFp !== pairingFp(p);
  });
}

/** Samme resultat i alle meldinger for brettet? */
export const sameResult = (list: ReportDto[]) => list.length > 0 && list.every((x) => x.result === list[0].result);

/**
 * «Samstemt» = minst en melding fra hvit og en fra svart, fra to ULIKE telefoner (deviceId), og alle
 * meldinger for brettet sier det samme. Én telefon kan aldri bekrefte seg selv, uansett hva den
 * påstår at den spilte.
 */
export function isAgreed(list: ReportDto[]): boolean {
  if (!sameResult(list)) return false;
  for (const w of list) {
    if (w.reporter !== "white") continue;
    for (const b of list) if (b.reporter === "black" && b.deviceId !== w.deviceId) return true;
  }
  return false;
}

/** Brett der begge spillerne har meldt det samme resultatet (se isAgreed). */
export function agreedBoards(byBoard: Map<number, ReportDto[]>): number[] {
  return [...byBoard].filter(([, list]) => isAgreed(list)).map(([board]) => board);
}

function useRoundReports(t: PhysicalTournament) {
  const st = useCloudState(t.id);
  const round = openRound(t);
  const active = st.status !== "unpublished" && round?.status === "published";
  const { reports, refresh } = useReports(t.id, !!active);
  return { round, byBoard: active ? relevantReports(t, reports) : new Map<number, ReportDto[]>(), refresh };
}

type Apply = (body: PhysicalEventBody) => boolean | void;

/**
 * Før resultatet lokalt (setResult, kilde player_report) FØRST. Bare når det lyktes sier vi fra til
 * skyen (godkjent / øvrige avvist, best effort); mislykkes den lokale føringen, røres ikke serveren.
 */
export async function approveReport(
  t: PhysicalTournament,
  apply: Apply,
  list: ReportDto[],
  rep: ReportDto,
  refresh: () => void,
  decide: (id: string, action: "approve" | "reject") => Promise<boolean> = (id, a) => getCloud(t.id).decideReport(id, a),
): Promise<boolean> {
  if (apply({ type: "setResult", round: rep.round, board: rep.board, result: rep.result, source: "player_report" }) === false) return false;
  await Promise.all(list.map((x) => decide(x.id, x.id === rep.id || x.result === rep.result ? "approve" : "reject")));
  refresh();
  return true;
}

/**
 * Oppsummering over runde-tabellen: antall ventende meldinger og «Godkjenn alle samstemte».
 * `<ReportsPanel t={t} apply={apply} />`
 */
export function ReportsPanel({ t, apply }: { t: PhysicalTournament; apply: Apply }) {
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
export function BoardReports({ t, board, apply }: { t: PhysicalTournament; board: number; apply: Apply }) {
  const { round, byBoard, refresh } = useRoundReports(t);
  const list = byBoard.get(board);
  if (!list || !round) return null;
  const agree = isAgreed(list);
  const disagree = list.length >= 2 && !sameResult(list);
  const devices = [...new Set(list.map((x) => x.deviceId))];
  return (
    <div role="row" className="card" style={{ padding: 8, margin: "0 0 4px" }} data-testid={`report-board-${board}`}>
      <div role="cell" className="stack" style={{ gap: 6 }}>
        <div className="spread" style={{ gap: 8 }}>
          <span className="badge badge-live">{L.reportsTitle}</span>
          {agree && <span className="badge badge-done">{L.reportAgree}</span>}
          {disagree && <span className="badge badge-error" role="alert">{L.reportDisagree}</span>}
          {!agree && !disagree && list.length >= 2 && <span className="badge">{L.reportNeedsBoth}</span>}
        </div>
        {list.map((rep) => (
          <div key={rep.id} className="spread" style={{ gap: 8 }}>
            <span>
              <b>{resultText(rep.result)}</b> <span className="muted" style={{ fontSize: 12 }}>({L.reportFrom[rep.reporter]}, {L.reportFromDevice(devices.indexOf(rep.deviceId) + 1)})</span>
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
