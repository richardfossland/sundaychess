"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { no } from "@/lib/locale/no";
import type { ReportResult, Reporter } from "@/lib/physical/cloudTypes";
import { newId } from "@/lib/physical/events";
import { getDeviceId, sendReport } from "@/lib/physical/reportClient";
import type { PublicSnapshot } from "@/lib/physical/snapshot";

const L = no.physicalCloud;
const SIDES: { value: ReportResult; label: string }[] = [
  { value: "1-0", label: L.resultWhite },
  { value: "½-½", label: L.resultDraw },
  { value: "0-1", label: L.resultBlack },
];

// Ett requestId per (brett, resultat, melder), husket i sessionStorage: laster spilleren siden på
// nytt midt i en sending, brukes samme id, og serveren tar det som samme melding.
function requestIdFor(key: string): string {
  try {
    const have = sessionStorage.getItem(key);
    if (have) return have;
    const id = newId();
    sessionStorage.setItem(key, id);
    return id;
  } catch {
    return newId();
  }
}
const noopSubscribe = () => () => {};
function readSent(key: string): boolean {
  try {
    return !!localStorage.getItem(key);
  } catch {
    return false;
  }
}
const sentKey = (id: string, round: number, board: number) => `sc-report-sent:${id}:${round}:${board}`;

const ERR: Record<string, string> = {
  bad_key: L.repBadKey,
  already_has_result: L.repHasResult,
  round_closed: L.repClosed,
  round_not_open: L.repNotOpen,
  board_not_found: L.repNotFound,
  not_found: L.repNotFound,
  reports_unavailable: L.repUnavailable,
  rate_limited: L.repRateLimited,
  pairing_changed: L.repPairingChanged,
};

/** Mobilside for QR på bordkortet: tre store knapper, bekreftelse, tåler dårlig nett. */
export function ReportView({ id, round, board }: { id: string; round: number; board: number }) {
  // Leses fra adressefeltet/lagring på klienten uten hydreringsavvik (server = undefined).
  const k = useSyncExternalStore(noopSubscribe, () => new URLSearchParams(window.location.search).get("k"), () => undefined);
  const sentBefore = useSyncExternalStore(noopSubscribe, () => readSent(sentKey(id, round, board)), () => false);
  const [forgot, setForgot] = useState(false);
  const [snap, setSnap] = useState<PublicSnapshot | null>(null);
  const [missing, setMissing] = useState(false);
  const [reporter, setReporter] = useState<Reporter>("unknown");
  const [picked, setPicked] = useState<ReportResult | null>(null);
  const [phase0, setPhase] = useState<"form" | "sending" | "sent">("form");
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/physical/${id}`, { cache: "no-store" })
      .then(async (r) => {
        if (!alive) return;
        if (r.status === 404) return setMissing(true);
        if (r.ok) setSnap((await r.json()) as PublicSnapshot);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [id]);

  if (k === undefined) return <main className="center-screen"><span className="spin" /></main>;

  const rd = snap?.rounds.find((r) => r.number === round);
  const pairing = rd?.pairings.find((p) => p.board === board);
  const name = (pid: string | null) => snap?.players.find((p) => p.id === pid)?.name ?? "";

  async function send() {
    if (!picked || !k) return;
    setPhase("sending");
    setError(null);
    const requestId = requestIdFor(`sc-report-req:${id}:${round}:${board}:${picked}:${reporter}`);
    const out = await sendReport(
      {
        id,
        round,
        board,
        result: picked,
        reporter,
        requestId,
        deviceId: getDeviceId(),
        // Parringen slik denne siden viste den: serveren avviser hvis arrangøren har byttet den siden.
        ...(pairing?.black ? { fp: `${pairing.white}|${pairing.black}` } : {}),
        k,
      },
      { onRetry: () => setRetrying(true) },
    );
    setRetrying(false);
    if (out.ok) {
      try {
        localStorage.setItem(sentKey(id, round, board), picked);
      } catch {
        /* ignorer */
      }
      setPhase("sent");
    } else {
      setError(ERR[out.code] ?? L.repGeneric);
      setPhase("form");
    }
  }

  function again() {
    try {
      localStorage.removeItem(sentKey(id, round, board));
    } catch {
      /* ignorer */
    }
    setForgot(true);
    setPicked(null);
    setError(null);
    setPhase("form");
  }

  const phase = phase0 === "form" && sentBefore && !forgot ? "sent" : phase0;
  const resultLabel = SIDES.find((s) => s.value === picked)?.label ?? "";
  const alreadyDone = !!pairing?.result;

  return (
    <main className="center-screen" style={{ alignItems: "flex-start" }}>
      <div className="card card-narrow stack" style={{ gap: 14 }} data-testid="report-view">
        <div>
          <p className="eyebrow">{snap?.title ?? "SundayChess"}</p>
          <h1 style={{ margin: 0, fontSize: 24 }}>{L.repTitle}</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            {no.physicalPrint.cardRound(round)} · {no.physicalPrint.cardBoard(board)}
          </p>
        </div>

        {missing && <div className="banner banner-error">{L.pubNotFound}</div>}
        {!k && !missing && <div className="banner banner-error">{L.repMissingKey}</div>}
        {pairing && pairing.black && (
          <div className="card" style={{ padding: 10 }}>
            <div>⚪ <b>{name(pairing.white)}</b></div>
            <div>⚫ <b>{name(pairing.black)}</b></div>
          </div>
        )}
        {snap && !rd && <div className="banner">{L.repNotOpen}</div>}
        {rd?.status === "completed" && phase !== "sent" && <div className="banner">{L.repClosed}</div>}
        {alreadyDone && phase !== "sent" && <div className="banner">{L.repHasResult}</div>}

        {phase === "sent" && (
          <div className="stack" style={{ gap: 10 }}>
            <div className="banner banner-ok" role="status" data-testid="report-sent">{L.repThanks}</div>
            {!alreadyDone && rd?.status !== "completed" && (
              <button type="button" className="btn btn-ghost" onClick={again}>{L.repChange}</button>
            )}
          </div>
        )}

        {phase !== "sent" && k && !missing && !alreadyDone && rd?.status !== "completed" && (
          <>
            <div className="stack" style={{ gap: 6 }}>
              <span className="muted" style={{ fontSize: 13 }}>{L.repWhoAmI}</span>
              <div className="row" style={{ gap: 8 }}>
                {([["white", L.repIWhite], ["black", L.repIBlack]] as const).map(([v, label]) => (
                  <button key={v} type="button" className={`btn grow ${reporter === v ? "btn-primary" : "btn-ghost"}`} aria-pressed={reporter === v} onClick={() => setReporter(reporter === v ? "unknown" : v)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="stack" style={{ gap: 8 }}>
              <span className="muted" style={{ fontSize: 13 }}>{L.repPickResult}</span>
              {SIDES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  className={`btn btn-lg btn-block ${picked === s.value ? "btn-primary" : ""}`}
                  style={{ minHeight: 64, fontSize: 20 }}
                  aria-pressed={picked === s.value}
                  disabled={phase === "sending"}
                  onClick={() => setPicked(s.value)}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {picked && (
              <div className="stack" style={{ gap: 8 }}>
                <b>{L.repConfirmLine(resultLabel)}</b>
                <button type="button" className="btn btn-primary btn-lg btn-block" disabled={phase === "sending"} onClick={send}>
                  {phase === "sending" ? L.repSending : L.repSend}
                </button>
              </div>
            )}
            {retrying && <div className="banner" role="status">{L.repRetrying}</div>}
            {error && <div className="banner banner-error" role="alert">{error}</div>}
          </>
        )}
      </div>
    </main>
  );
}
