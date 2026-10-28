"use client";

import { BoardReports, ReportsPanel } from "./cloud/ReportsPanel";
import { Fragment, useRef, useState } from "react";
import { ConfirmDialog } from "@/lib/client/ConfirmDialog";
import { Icon } from "@/lib/client/Icon";
import { no } from "@/lib/locale/no";
import { totalRounds } from "@/lib/physical/reducer";
import { nextMissingBoard, resultForKey, roundProgress } from "@/lib/physical/roundView";
import type { PhysicalEventBody, PhysicalPairing, PhysicalRound, PhysicalTournament, ResultCode } from "@/lib/physical/schema";
import { nextRoundPairing } from "@/lib/physical/selectors";
import { makeEvent } from "@/lib/physical/events";
import { reduce } from "@/lib/physical/reducer";

type Apply = (b: PhysicalEventBody) => void;
type Run = (fn: (t: PhysicalTournament) => PhysicalTournament) => void;
type Slot = { board: number; side: "white" | "black" };

const p = no.physical;

export function RoundPanel({ t, apply, run }: { t: PhysicalTournament; apply: Apply; run: Run }) {
  const total = totalRounds(t);
  const last = t.rounds[t.rounds.length - 1] ?? null;
  const [viewNo, setViewNo] = useState<number | null>(null);
  const round: PhysicalRound | null = (viewNo !== null && t.rounds.find((r) => r.number === viewNo)) || last;
  const isCurrent = !!round && round === last;
  const running = t.status === "running";
  const knockout = t.settings.system === "knockout";

  const [menuBoard, setMenuBoard] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmEdit, setConfirmEdit] = useState(false);
  const [picked, setPicked] = useState<Slot | null>(null);
  const rows = useRef(new Map<number, HTMLElement>());

  // Ny runde (eller angret runde): tilbake til siste runde og ut av redigering.
  const lastNo = last?.number ?? 0;
  const [seenLast, setSeenLast] = useState(lastNo);
  if (seenLast !== lastNo) {
    setSeenLast(lastNo);
    setViewNo(null);
    setEditing(false);
    setPicked(null);
    setMenuBoard(null);
  }

  const names = (id: string | null) => (id ? t.players.find((x) => x.id === id)?.name ?? "?" : "–");
  const canPair = running && (!last || last.status === "completed") && t.rounds.length < total && t.players.length >= 2;
  const allDone = running && !!last && last.status === "completed" && t.rounds.length >= total;
  const canEditResults = running && isCurrent && round?.status === "published" && !editing;
  const progress = round ? roundProgress(round) : null;

  function pair() {
    run((cur) => {
      const { round: n, pairings } = nextRoundPairing(cur);
      return reduce(cur, makeEvent({ type: "pairRound", round: n, pairings }));
    });
  }

  function setResult(board: number, res: ResultCode | "clear", focusNext = false) {
    if (!round) return;
    if (res === "clear") apply({ type: "clearResult", round: round.number, board });
    else apply({ type: "setResult", round: round.number, board, result: res });
    setMenuBoard(null);
    if (focusNext && res !== "clear") {
      // Neste brett uten resultat (etter at dette er satt), ellers bli.
      const after = { pairings: round.pairings.map((g) => (g.board === board ? { ...g, result: res } : g)) };
      const nb = nextMissingBoard(after, board);
      if (nb !== null) requestAnimationFrame(() => rows.current.get(nb)?.focus());
    }
  }

  function onKey(e: React.KeyboardEvent, g: PhysicalPairing) {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "j" || e.key === "k") {
      e.preventDefault();
      const order = round!.pairings.map((x) => x.board);
      const i = order.indexOf(g.board) + (e.key === "ArrowDown" || e.key === "j" ? 1 : -1);
      const target = order[Math.max(0, Math.min(order.length - 1, i))];
      rows.current.get(target)?.focus();
      return;
    }
    if (!canEditResults || g.black === null) return;
    const res = resultForKey(e.key, knockout);
    if (!res) return;
    e.preventDefault();
    setResult(g.board, res, true);
  }

  function pick(board: number, side: "white" | "black") {
    if (!round) return;
    if (!picked) return setPicked({ board, side });
    if (picked.board === board && picked.side === side) return setPicked(null);
    apply({ type: "swapPairing", round: round.number, a: picked, b: { board, side }, ...(round.status === "published" ? { afterPublish: true } : {}) });
    setPicked(null);
  }

  const statusLabel = (r: PhysicalRound) => (r.status === "draft" ? p.statusDraft : r.status === "published" ? p.statusPublished : p.statusCompleted);

  return (
    <section className="stack" aria-label={p.tabs.round} style={{ gap: 14 }}>
      {t.rounds.length > 1 && (
        <nav className="pr-roundnav" aria-label={p.roundsNav}>
          {t.rounds.map((r) => (
            <button key={r.number} type="button" className="pr-chip" aria-current={r === round} onClick={() => setViewNo(r === last ? null : r.number)}>
              {r.number}
            </button>
          ))}
        </nav>
      )}

      {round && progress && (
        <div className="stack" style={{ gap: 12 }}>
          <div className="spread" style={{ flexWrap: "wrap" }}>
            <b style={{ fontSize: 18 }}>{p.roundN(round.number)} / {total}</b>
            <span className={`badge ${round.status === "completed" ? "badge-done" : "badge-live"}`}>{statusLabel(round)}</span>
          </div>

          {round.status !== "draft" && (
            <div className="pr-progress" aria-live="polite">
              <div className="spread">
                <b data-testid="progress">{p.progress(progress.done, progress.total)}</b>
                <span className="muted" style={{ fontSize: 13 }}>{progress.missing.length === 0 ? p.allResultsIn : p.missingResults(progress.missing.length)}</span>
              </div>
              <div className="pr-bar" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
                <span style={{ width: `${progress.total ? (100 * progress.done) / progress.total : 100}%` }} />
              </div>
            </div>
          )}

          {isCurrent && round.status === "draft" && <div className="banner banner-warn" style={{ textAlign: "left" }}>{p.draftLockNote}</div>}
          {isCurrent && round.status === "published" && !editing && (
            <span className="muted" style={{ fontSize: 13 }}><Icon name="lock" size={13} /> {p.publishedLockNote}</span>
          )}
          {editing && <div className="banner banner-warn" style={{ textAlign: "left" }} role="status">{picked ? p.editPairingPicked(names(picked.side === "white" ? round.pairings.find((g) => g.board === picked.board)!.white : round.pairings.find((g) => g.board === picked.board)!.black)) : p.editPairingHelp}</div>}

          <ReportsPanel t={t} apply={apply} />
          <div className="pr-table" role="table" aria-label={p.roundN(round.number)}>
            <div className="pr-head" role="row">
              <span role="columnheader">{p.board}</span>
              <span role="columnheader"><span>{p.white}</span><span>{p.black}</span></span>
              <span role="columnheader">{p.result}</span>
            </div>
            {round.pairings.map((g) => (
              <Fragment key={g.board}>
              <BoardRow
                g={g}
                names={names}
                knockout={knockout}
                resultsEnabled={canEditResults}
                showResults={round.status !== "draft"}
                editing={editing}
                picked={picked}
                menuOpen={menuBoard === g.board}
                onMenu={() => setMenuBoard(menuBoard === g.board ? null : g.board)}
                onResult={(res) => setResult(g.board, res)}
                onPick={(side) => pick(g.board, side)}
                onKey={(e) => onKey(e, g)}
                setRef={(el) => (el ? rows.current.set(g.board, el) : rows.current.delete(g.board))}
              />
              <BoardReports t={t} board={g.board} apply={apply} />
              </Fragment>
            ))}
          </div>
          {canEditResults && <span className="pr-hint">{p.keyboardHint}</span>}

          {running && isCurrent && (
            <div className="row" style={{ flexWrap: "wrap" }}>
              {round.status === "draft" && !editing && (
                <button type="button" className="btn btn-primary grow" onClick={() => apply({ type: "publishRound", round: round.number, autoForfeit: true })}>{p.publishRound}</button>
              )}
              {round.status === "published" && !editing && (
                <button type="button" className="btn btn-primary btn-lg grow" disabled={progress.missing.length > 0} onClick={() => apply({ type: "completeRound", round: round.number })}>
                  {progress.missing.length > 0 ? p.completeBlocked(progress.missing.length) : p.completeRound}
                </button>
              )}
              {round.status !== "completed" && (
                editing ? (
                  <button type="button" className="btn btn-primary" onClick={() => { setEditing(false); setPicked(null); }}>{p.editPairingDone}</button>
                ) : (
                  <button type="button" className="btn btn-ghost" onClick={() => (round.status === "draft" ? setEditing(true) : setConfirmEdit(true))}>
                    <Icon name="swap" size={16} /> {p.editPairing}
                  </button>
                )
              )}
            </div>
          )}
        </div>
      )}

      {canPair && !editing && (
        <button type="button" className="btn btn-primary btn-lg" onClick={pair}>{p.pairRound(t.rounds.length + 1)}</button>
      )}
      {allDone && (
        <button type="button" className="btn" onClick={() => apply({ type: "finishTournament" })}>{p.finishTournament}</button>
      )}

      {confirmEdit && (
        <ConfirmDialog
          message={`${p.editPairingTitle} ${p.editPairingConfirm}`}
          confirmLabel={p.editPairingStart}
          danger
          onConfirm={() => { setConfirmEdit(false); setEditing(true); }}
          onCancel={() => setConfirmEdit(false)}
        />
      )}
    </section>
  );
}

function BoardRow({ g, names, knockout, resultsEnabled, showResults, editing, picked, menuOpen, onMenu, onResult, onPick, onKey, setRef }: {
  g: PhysicalPairing;
  names: (id: string | null) => string;
  knockout: boolean;
  resultsEnabled: boolean;
  showResults: boolean;
  editing: boolean;
  picked: Slot | null;
  menuOpen: boolean;
  onMenu: () => void;
  onResult: (r: ResultCode | "clear") => void;
  onPick: (side: "white" | "black") => void;
  onKey: (e: React.KeyboardEvent) => void;
  setRef: (el: HTMLElement | null) => void;
}) {
  const bye = g.black === null;
  const missing = !bye && !g.result;
  const isPicked = (side: "white" | "black") => !!picked && picked.board === g.board && picked.side === side;
  const player = (side: "white" | "black") => {
    const id = side === "white" ? g.white : g.black;
    const inner = (
      <>
        <span className={`pr-dot pr-dot-${side === "white" ? "w" : "b"}`} aria-hidden="true" />
        <span>
          <span className="sr-only">{side === "white" ? p.white : p.black}: </span>
          {id === null ? <i className="muted">{p.bye}</i> : names(id)}
          {side === "black" && g.rematch ? <span className="muted" title={p.rematchNote}> ⚠</span> : null}
        </span>
      </>
    );
    if (editing && id !== null) {
      return (
        <button type="button" className="pr-player" aria-pressed={isPicked(side)} onClick={() => onPick(side)}>
          {inner}
        </button>
      );
    }
    return <div className="pr-player" role="cell">{inner}</div>;
  };
  const res = (code: "1-0" | "½-½" | "0-1") => (
    <button
      key={code}
      type="button"
      className="pr-res"
      aria-pressed={g.result === code}
      aria-label={p.setResultLabel(g.board, p.results[code])}
      disabled={!resultsEnabled || (knockout && code === "½-½")}
      // Å trykke på det valgte resultatet skal aldri nullstille det (feiltrykk): fjerning skjer via «mer»-menyen.
      onClick={() => g.result !== code && onResult(code)}
      style={knockout && code === "½-½" ? { visibility: "hidden" } : undefined}
    >
      {p.results[code]}
    </button>
  );
  return (
    <div
      role="row"
      className="pr-board"
      data-board={g.board}
      data-missing={showResults && missing}
      data-done={showResults && !bye && !!g.result}
      tabIndex={0}
      aria-label={`${p.boardLabel(g.board)}: ${names(g.white)} – ${bye ? p.bye : names(g.black)}${g.result ? `, ${p.results[g.result]}` : ""}`}
      ref={setRef}
      onKeyDown={onKey}
    >
      <div className="pr-no" role="cell">{p.boardLabel(g.board)}</div>
      <div className="pr-players" role="cell">
        {player("white")}
        {player("black")}
      </div>
      <div className="pr-actions" role="cell">
        {!showResults ? null : bye ? (
          <span className="pr-tag" style={{ gridColumn: "1 / -1" }}>{p.byeScore(g.byeType === "half" ? "½" : g.byeType === "zero" ? "0" : "1")}</span>
        ) : (
          <>
            {res("1-0")}
            {res("½-½")}
            {res("0-1")}
            <button type="button" className="pr-more" aria-label={p.moreMenuFor(g.board)} aria-expanded={menuOpen} disabled={!resultsEnabled} onClick={onMenu}>
              <Icon name="ellipsis" size={20} />
            </button>
            {g.result && (g.result === "+-" || g.result === "-+" || g.result === "=") && (
              <span className="pr-tag" style={{ gridColumn: "1 / -1" }}>{p.results[g.result]}</span>
            )}
          </>
        )}
      </div>
      {menuOpen && resultsEnabled && !bye && (
        <div className="pr-menu" role="group" aria-label={p.moreMenuFor(g.board)}>
          <button type="button" className="btn btn-sm" onClick={() => onResult("+-")}>{p.walkoverWhite}</button>
          <button type="button" className="btn btn-sm" onClick={() => onResult("-+")}>{p.walkoverBlack}</button>
          {!knockout && <button type="button" className="btn btn-sm" onClick={() => onResult("=")}>{p.doubleForfeit}</button>}
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => onResult("clear")}>{p.clearResult}</button>
        </div>
      )}
    </div>
  );
}
