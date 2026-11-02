"use client";

import { useEffect, useState } from "react";
import { annotateGame } from "@/lib/chess/analysis";
import { reviewFacts, templatedSummaryNo } from "@/lib/chess/reviewSummary";
import type { ReviewFacts } from "@/lib/chess/reviewSummary";
import { no } from "@/lib/locale/no";
import { Icon } from "@/lib/client/Icon";
import { PgnButtons } from "@/lib/client/PgnButtons";
import { Chess } from "chess.js";
import { finalFen, gamePgn, pgnFileName } from "@/lib/export/pgn";
import type { GameStatus } from "@/lib/types";

// Coached post-game review for a SOLO game. The game is client-only, so all
// engine truth is derived here in the browser (annotateGame replays the PGN);
// the templated Norwegian summary shows immediately, and we then try to upgrade
// it to an AI-narrated paragraph via /api/coach/narrate (keyless → stays
// templated). Same look as the tournament ReviewView.
export function SoloReview({
  pgn,
  playerColor,
  onClose,
}: {
  pgn: string;
  playerColor: "white" | "black";
  onClose: () => void;
}) {
  // Engine truth is computed purely (no network). Defer it OFF the render/paint
  // path (a setTimeout(0) after mount) so the modal opens instantly even after a
  // long game — annotateGame is depth-1 + FEN-memoised, but on a Chromebook a
  // synchronous useMemo could still jank the open. undefined = still computing,
  // null = unreplayable (error), object = ready.
  const [base, setBase] = useState<
    { facts: ReviewFacts; templated: string } | null | undefined
  >(undefined);
  // Bumped by the "Prøv igjen" button to re-run the effect below. annotateGame
  // is a pure replay of `pgn`, so a genuinely malformed PGN will fail the same
  // way again — but a `live` race (a fast close/reopen) can also land here,
  // and for that this button is a real fix, not just a consistent affordance.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    // Back to "loading" on retry (`attempt` bump) — otherwise the old error
    // banner would still be showing while the replay re-runs.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBase(undefined);
    const id = setTimeout(() => {
      const review = annotateGame(pgn, no.solo.you, no.solo.computer);
      if (!live) return;
      if (!review) {
        setBase(null);
        return;
      }
      const side = playerColor === "white" ? review.white : review.black;
      const f = reviewFacts(side, review.result);
      setBase({ facts: f, templated: templatedSummaryNo(f) });
    }, 0);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [pgn, playerColor, attempt]);

  // Optional AI narration upgrade (keyless → stays templated).
  const [narrated, setNarrated] = useState<string | null>(null);
  useEffect(() => {
    if (!base) return;
    let live = true;
    fetch("/api/coach/narrate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ facts: base.facts }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((r: { summary?: string | null } | null) => {
        if (live && r && r.summary) setNarrated(r.summary);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [base]);

  const error = base === null;
  const facts = base?.facts ?? null;
  const aiNarrated = narrated !== null;
  const summary = narrated ?? base?.templated ?? "";

  return (
    <div className="card stack review-card">
      <div className="spread">
        <p className="eyebrow fs-xs">{no.review.title}</p>
        {facts && (
          <span className="muted fs-xs">
            {aiNarrated && <Icon name="sparkle" size={13} />} {aiNarrated ? no.review.aiBadge : no.review.templateBadge}
          </span>
        )}
      </div>

      {error ? (
        <div className="banner banner-error stack gap-2" role="alert">
          <span>{no.review.error}</span>
          <button
            className="btn btn-ghost self-start"
            onClick={() => setAttempt((n) => n + 1)}
          >
            {no.common.retry}
          </button>
        </div>
      ) : !facts ? (
        <div className="row">
          <span className="spin" />
          <span className="muted">{no.review.loading}</span>
        </div>
      ) : (
        <>
          <p className="review-summary">{summary}</p>
          <div className="row review-stats">
            <Stat label={no.review.accuracy} value={`${facts.accuracy}%`} highlight />
            <Stat label={no.review.good} value={facts.goodOrBest} />
            <Stat label={no.review.inaccuracies} value={facts.inaccuracies} />
            <Stat label={no.review.mistakes} value={facts.mistakes} />
            <Stat label={no.review.blunders} value={facts.blunders} />
          </div>
          {facts.worstMove && (
            <p className="muted fs-xs">
              {no.review.worstMove}:{" "}
              <b className="text-gold">
                {facts.worstMove.moveNumber}. {facts.worstMove.san}
              </b>
            </p>
          )}
        </>
      )}

      <PgnButtons
        load={async () => {
          const c = new Chess();
          try {
            c.loadPgn(pgn);
          } catch {}
          const status: GameStatus = c.isCheckmate()
            ? c.turn() === "w"
              ? "black_win"
              : "white_win"
            : c.isDraw()
              ? "draw"
              : "live";
          const you = no.solo.you;
          const cpu = no.solo.computer;
          return {
            filename: pgnFileName(no.appName),
            pgn: gamePgn({
              event: no.appName,
              white: playerColor === "white" ? you : cpu,
              black: playerColor === "black" ? you : cpu,
              status,
              pgn,
            }),
            fen: finalFen(pgn),
          };
        }}
      />

      <button className="btn btn-ghost btn-block" onClick={onClose}>
        <Icon name="back" size={16} /> {no.review.close}
      </button>
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string | number;
  highlight?: boolean;
}) {
  return (
    <div className="stack text-center stat">
      <span className={`stat-value${highlight ? " text-gold" : ""}`}>
        {value}
      </span>
      <span className="muted fs-xs">{label}</span>
    </div>
  );
}
