"use client";

import { useEffect, useState } from "react";
import type { ReviewResult } from "@/lib/dto";
import { api } from "@/lib/client/api";
import type { StoredPlayer } from "@/lib/client/identity";
import { no } from "@/lib/locale/no";
import { Icon } from "@/lib/client/Icon";
import { PgnButtons } from "@/lib/client/PgnButtons";
import { exportRound, finalFen, gamePgn, pgnFileName } from "@/lib/export/pgn";

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
  // Bumped by the "Prøv igjen" button to re-run the effect below without
  // duplicating the fetch call at the call site.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    // Clears a previous failure on retry (`attempt` bump) — otherwise the old
    // error banner would still be showing when the new request lands.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(false);
    api
      .review(gameId, me.playerId, me.resumeCode)
      .then((r) => live && setData(r))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [gameId, me.playerId, me.resumeCode, attempt]);

  return (
    <div className="card stack review-card">
      <div className="spread">
        <p className="eyebrow fs-xs">{no.review.title}</p>
        {data && (
          <span className="muted fs-xs">
            {data.aiNarrated && <Icon name="sparkle" size={13} />} {data.aiNarrated ? no.review.aiBadge : no.review.templateBadge}
          </span>
        )}
      </div>

      {!data && !error && (
        <div className="row">
          <span className="spin" />
          <span className="muted">{no.review.loading}</span>
        </div>
      )}

      {error && (
        <div className="banner banner-error stack gap-2" role="alert">
          <span>{no.review.error}</span>
          <button
            className="btn btn-ghost self-start"
            onClick={() => setAttempt((n) => n + 1)}
          >
            {no.common.retry}
          </button>
        </div>
      )}

      {data && (
        <>
          <p className="review-summary">{data.summary}</p>

          <div className="row review-stats">
            <Stat label={no.review.accuracy} value={`${data.facts.accuracy}%`} highlight />
            <Stat label={no.review.good} value={data.facts.goodOrBest} />
            <Stat label={no.review.inaccuracies} value={data.facts.inaccuracies} />
            <Stat label={no.review.mistakes} value={data.facts.mistakes} />
            <Stat label={no.review.blunders} value={data.facts.blunders} />
          </div>

          {data.facts.worstMove && (
            <p className="muted fs-xs">
              {no.review.worstMove}:{" "}
              <b className="text-gold">
                {data.facts.worstMove.moveNumber}. {data.facts.worstMove.san}
              </b>
            </p>
          )}
        </>
      )}

      <PgnButtons
        load={async () => {
          const g = await api.game(gameId);
          // Samme visningsnavn som tavla; tittel/runde fra offentlig tavle-tilstand.
          const b = await api.board(g.tournamentId).catch(() => null);
          const title = b?.tournament.title || no.appName;
          const round = b ? exportRound(b.rounds, g.roundId) : null;
          const pub = b?.games.find((x) => x.id === g.id);
          const slot = pub?.slot;
          const board = slot === undefined ? null : slot + 1;
          return {
            filename: pgnFileName(title, round, board),
            pgn: gamePgn({
              event: title,
              round,
              board,
              white: g.white.name,
              black: g.black?.name ?? "?",
              status: g.status,
              resultSource: pub?.resultSource,
              pgn: g.pgn,
            }),
            fen: finalFen(g.pgn),
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
      <span className="muted fs-xs">
        {label}
      </span>
    </div>
  );
}
