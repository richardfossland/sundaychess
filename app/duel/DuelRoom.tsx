"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { PublicGame, PublicPlayer } from "@/lib/dto";
import { useBoardState } from "@/lib/client/useBoardState";
import { QRCode } from "@/lib/client/QRCode";
import { initials } from "@/lib/client/Confetti";
import { variantStartFen } from "@/lib/chess/variants";
import {
  duelStateOrdered,
  normalizeBestOf,
  whiteForGame,
  type DuelGameOutcome,
} from "@/lib/duel/match";
import type { StoredPlayer } from "@/lib/client/identity";
import { no } from "@/lib/locale/no";
import { GameView } from "../play/GameView";

/** Outcome dots from the player's own perspective (W / · / L). */
function ResultDots({
  results,
  iAmP1,
}: {
  results: DuelGameOutcome[];
  iAmP1: boolean;
}) {
  const mine = (o: DuelGameOutcome): "win" | "loss" | "draw" =>
    o === "draw" ? "draw" : (o === "p1") === iAmP1 ? "win" : "loss";
  return (
    <div className="row" style={{ gap: 6, justifyContent: "center" }}>
      {results.map((o, i) => {
        const r = mine(o);
        return (
          <span
            key={i}
            className="duel-dot"
            data-result={r}
            title={`${no.duel.gameNo} ${i + 1}`}
          >
            {r === "win" ? "♛" : r === "loss" ? "♟" : "½"}
          </span>
        );
      })}
    </div>
  );
}

function ScoreBar({
  meName,
  oppName,
  myScore,
  oppScore,
  target,
}: {
  meName: string;
  oppName: string;
  myScore: number;
  oppScore: number;
  target: number;
}) {
  return (
    <div className="duel-hud">
      <span className="duel-hud-name">{meName}</span>
      <b className="duel-hud-score">{myScore}</b>
      <span className="duel-hud-sep">–</span>
      <b className="duel-hud-score">{oppScore}</b>
      <span className="duel-hud-name">{oppName}</span>
      <span className="duel-hud-target">
        {no.duel.raceTo} {target}
      </span>
    </div>
  );
}

export function DuelRoom({
  me,
  onExit,
}: {
  me: StoredPlayer;
  onExit: () => void;
}) {
  const { state, refresh } = useBoardState(me.tournamentId);
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Read the origin after mount (window is undefined during SSR) — one-time.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(window.location.origin);
  }, []);

  if (!state) {
    return (
      <main className="center-screen">
        <span className="spin" />
      </main>
    );
  }

  const players: PublicPlayer[] = state.players;
  const config = state.tournament.config;
  const bestOf = normalizeBestOf(config.bestOf);
  const joinPin = state.tournament.joinPin;

  // players[0] is the creator (joined first), players[1] the challenger.
  const p1 = players[0];
  const p2 = players[1];
  const opponent = players.find((p) => p.id !== me.playerId) ?? null;
  const iAmP1 = p1?.id === me.playerId;

  // ---- 1. Host waiting room: opponent hasn't joined yet ----
  if (!opponent || players.length < 2) {
    const joinUrl = origin ? `${origin}/duel?j=${joinPin}` : "";
    return (
      <main className="center-screen">
        <div className="card card-narrow stack text-center scale-in" style={{ alignItems: "center", gap: 14 }}>
          <div className="brandmark" style={{ justifyContent: "center" }}>
            <span className="knight">♞</span> Sunday<b>Chess</b>
          </div>
          <p className="eyebrow">⚔️ {no.duel.waitTitle}</p>
          {joinUrl && (
            <div style={{ padding: 6, background: "var(--paper)", borderRadius: 16 }}>
              <QRCode value={joinUrl} size={216} />
            </div>
          )}
          <p className="faint" style={{ fontSize: 13 }}>
            {no.duel.waitScan} <b>{origin.replace(/^https?:\/\//, "")}/duel</b> {no.duel.waitPin}
          </p>
          <div className="big-code" style={{ letterSpacing: "0.18em" }}>{joinPin}</div>
          <button
            className="btn btn-block"
            onClick={() => {
              if (!joinUrl) return;
              navigator.clipboard?.writeText(joinUrl).then(
                () => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                },
                () => {},
              );
            }}
          >
            {copied ? no.duel.shareCopied : no.duel.shareLink}
          </button>
          <div className="banner banner-wait" style={{ width: "100%" }}>
            <span className="spin" style={{ display: "inline-block", verticalAlign: "middle", marginRight: 10 }} />
            {no.duel.waitFor}
          </div>
          <button className="btn btn-ghost" onClick={onExit}>
            {no.common.cancel}
          </button>
        </div>
      </main>
    );
  }

  // ---- both players present: compute match state ----
  const dstate = duelStateOrdered(state.games, p1.id, p2.id, bestOf);
  const myScore = iAmP1 ? dstate.p1Score : dstate.p2Score;
  const oppScore = iAmP1 ? dstate.p2Score : dstate.p1Score;
  const myLiveGame: PublicGame | undefined = state.games.find(
    (g) =>
      g.status === "live" &&
      (g.whitePlayerId === me.playerId || g.blackPlayerId === me.playerId),
  );

  // ---- 2. A live game → play it (with a duel score HUD on top) ----
  if (myLiveGame) {
    return (
      <>
        <ScoreBar
          meName={no.duel.you}
          oppName={opponent.displayName}
          myScore={myScore}
          oppScore={oppScore}
          target={dstate.target}
        />
        <GameView
          me={me}
          gameId={myLiveGame.id}
          timer={null}
          reactionsEnabled={config.reactions === true}
          variantFen={variantStartFen(config.variant)}
          onFinished={() => refresh()}
        />
      </>
    );
  }

  // ---- 3. Match decided → result screen ----
  const matchOver = dstate.decided || state.tournament.status === "finished";
  if (matchOver) {
    const iWon = dstate.winnerId === me.playerId;
    const title = dstate.winnerId
      ? iWon
        ? no.duel.youWonMatch
        : no.duel.youLostMatch
      : no.duel.tied;
    return (
      <main className="center-screen">
        <div className="card stack text-center scale-in" style={{ alignItems: "center", gap: 14, maxWidth: 440 }}>
          <div className="result-emoji">{!dstate.winnerId ? "🤝" : iWon ? "🏆" : "😔"}</div>
          <h1 style={{ fontSize: "clamp(30px,7vw,48px)" }}>{title}</h1>
          <p className="eyebrow" style={{ fontSize: 11 }}>{no.duel.finalScore}</p>
          <div className="duel-final-score">
            <span className="duel-final-side">
              <span className="avatar-lg" style={{ width: 44, height: 44 }}>{initials(me.displayName)}</span>
              <b>{myScore}</b>
            </span>
            <span className="duel-hud-sep" style={{ fontSize: 28 }}>–</span>
            <span className="duel-final-side">
              <b>{oppScore}</b>
              <span className="avatar-lg" style={{ width: 44, height: 44, background: "linear-gradient(180deg, var(--ink-soft), #1c212b)", color: "var(--txt)", border: "1px solid var(--ink-line-strong)" }}>
                {initials(opponent.displayName)}
              </span>
            </span>
          </div>
          <ResultDots results={dstate.results} iAmP1={iAmP1} />
          <button className="btn btn-primary btn-block btn-lg" style={{ marginTop: 6 }} onClick={onExit}>
            ⚔️ {no.duel.rematch}
          </button>
          <Link href="/" className="btn btn-ghost btn-block">
            {no.duel.backHome}
          </Link>
        </div>
      </main>
    );
  }

  // ---- 4. Interlude: between games, server is creating the next one ----
  const nextIndex = dstate.gamesPlayed; // next game's 0-based index
  const iAmWhiteNext = whiteForGame(nextIndex, p1.id, p2.id) === me.playerId;
  const started = dstate.gamesPlayed > 0;
  return (
    <main className="center-screen">
      <div className="card card-narrow stack text-center scale-in" style={{ alignItems: "center", gap: 14 }}>
        <div className="brandmark" style={{ justifyContent: "center" }}>
          <span className="knight">♞</span> Sunday<b>Chess</b>
        </div>
        <p className="eyebrow">⚔️ {no.duel.matchScore}</p>
        <div className="duel-final-score">
          <span className="duel-final-side"><b style={{ fontSize: 34 }}>{myScore}</b><span className="faint">{no.duel.you}</span></span>
          <span className="duel-hud-sep" style={{ fontSize: 24 }}>–</span>
          <span className="duel-final-side"><b style={{ fontSize: 34 }}>{oppScore}</b><span className="faint">{opponent.displayName}</span></span>
        </div>
        {started && <ResultDots results={dstate.results} iAmP1={iAmP1} />}
        <div className="banner banner-wait" style={{ width: "100%" }}>
          <span className="spin" style={{ display: "inline-block", verticalAlign: "middle", marginRight: 10 }} />
          {no.duel.nextGame}
        </div>
        <p className="muted" style={{ fontSize: 13 }}>
          {iAmWhiteNext ? no.duel.youWhiteNext : no.duel.youBlackNext}
        </p>
        <button className="btn btn-ghost" onClick={onExit}>
          {no.common.cancel}
        </button>
      </div>
    </main>
  );
}
