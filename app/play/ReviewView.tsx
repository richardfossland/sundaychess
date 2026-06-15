"use client";

import { useEffect, useState } from "react";
import type { ReviewResult } from "@/lib/dto";
import { api } from "@/lib/client/api";
import type { StoredPlayer } from "@/lib/client/identity";
import { no } from "@/lib/locale/no";

// Per-player coached review screen. Fetches the engine-derived review for one
// finished game (POST /api/review) and shows the coaching paragraph (AI-narrated
// when a key is configured, templated Norwegian otherwise — same shape either
// way) plus a small engine stat readout. All numbers come from the server's
// engine analysis; this component only renders them.

export function ReviewView({
  me,
  gameId,
  onClose,
}: {
  me: StoredPlayer;
  gameId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<ReviewResult | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .review(gameId, me.playerId, me.resumeCode)
      .then((r) => live && setData(r))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [gameId, me.playerId, me.resumeCode]);

  return (
    <div className="card stack" style={{ padding: 18, width: "100%", maxWidth: 460, gap: 14 }}>
      <div className="spread" style={{ alignItems: "center" }}>
        <p className="eyebrow" style={{ fontSize: 12 }}>{no.review.title}</p>
        {data && (
          <span className="muted" style={{ fontSize: 11 }}>
            {data.aiNarrated ? no.review.aiBadge : no.review.templateBadge}
          </span>
        )}
      </div>

      {!data && !error && (
        <div className="row" style={{ alignItems: "center", gap: 10 }}>
          <span className="spin" />
          <span className="muted">{no.review.loading}</span>
        </div>
      )}

      {error && <div className="banner banner-error">{no.review.error}</div>}

      {data && (
        <>
          <p style={{ fontSize: 15, lineHeight: 1.5 }}>{data.summary}</p>

          <div
            className="row"
            style={{ flexWrap: "wrap", gap: 8, justifyContent: "space-between" }}
          >
            <Stat label={no.review.accuracy} value={`${data.facts.accuracy}%`} highlight />
            <Stat label={no.review.good} value={data.facts.goodOrBest} />
            <Stat label={no.review.inaccuracies} value={data.facts.inaccuracies} />
            <Stat label={no.review.mistakes} value={data.facts.mistakes} />
            <Stat label={no.review.blunders} value={data.facts.blunders} />
          </div>

          {data.facts.worstMove && (
            <p className="muted" style={{ fontSize: 13 }}>
              {no.review.worstMove}:{" "}
              <b style={{ color: "var(--gold)" }}>
                {data.facts.worstMove.moveNumber}. {data.facts.worstMove.san}
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
      <span
        style={{
          fontSize: 20,
          fontWeight: 700,
          color: highlight ? "var(--gold)" : undefined,
        }}
      >
        {value}
      </span>
      <span className="muted" style={{ fontSize: 11 }}>
        {label}
      </span>
    </div>
  );
}
