"use client";

import { useEffect, useMemo, useState } from "react";
import { annotateGame } from "@/lib/chess/analysis";
import { reviewFacts, templatedSummaryNo } from "@/lib/chess/reviewSummary";
import { no } from "@/lib/locale/no";

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
  // Engine truth is computed purely (no network), so derive it synchronously.
  const base = useMemo(() => {
    const review = annotateGame(pgn, no.solo.you, no.solo.computer);
    if (!review) return null;
    const side = playerColor === "white" ? review.white : review.black;
    const f = reviewFacts(side, review.result);
    return { facts: f, templated: templatedSummaryNo(f) };
  }, [pgn, playerColor]);

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
    <div className="card stack" style={{ padding: 18, width: "100%", maxWidth: 460, gap: 14 }}>
      <div className="spread" style={{ alignItems: "center" }}>
        <p className="eyebrow" style={{ fontSize: 12 }}>{no.review.title}</p>
        {facts && (
          <span className="muted" style={{ fontSize: 11 }}>
            {aiNarrated ? no.review.aiBadge : no.review.templateBadge}
          </span>
        )}
      </div>

      {error ? (
        <div className="banner banner-error">{no.review.error}</div>
      ) : !facts ? (
        <div className="row" style={{ alignItems: "center", gap: 10 }}>
          <span className="spin" />
          <span className="muted">{no.review.loading}</span>
        </div>
      ) : (
        <>
          <p style={{ fontSize: 15, lineHeight: 1.5 }}>{summary}</p>
          <div className="row" style={{ flexWrap: "wrap", gap: 8, justifyContent: "space-between" }}>
            <Stat label={no.review.accuracy} value={`${facts.accuracy}%`} highlight />
            <Stat label={no.review.good} value={facts.goodOrBest} />
            <Stat label={no.review.inaccuracies} value={facts.inaccuracies} />
            <Stat label={no.review.mistakes} value={facts.mistakes} />
            <Stat label={no.review.blunders} value={facts.blunders} />
          </div>
          {facts.worstMove && (
            <p className="muted" style={{ fontSize: 13 }}>
              {no.review.worstMove}:{" "}
              <b style={{ color: "var(--gold)" }}>
                {facts.worstMove.moveNumber}. {facts.worstMove.san}
              </b>
            </p>
          )}
        </>
      )}

      <button className="btn btn-ghost btn-block" onClick={onClose}>
        ← {no.review.close}
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
    <div className="stack text-center" style={{ gap: 2, minWidth: 64 }}>
      <span style={{ fontSize: 20, fontWeight: 700, color: highlight ? "var(--gold)" : undefined }}>
        {value}
      </span>
      <span className="muted" style={{ fontSize: 11 }}>{label}</span>
    </div>
  );
}
