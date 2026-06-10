"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import type { CSSProperties } from "react";
import type { BoardState, PublicGame } from "@/lib/dto";
import { Confetti, initials } from "@/lib/client/Confetti";
import { SoundToggle } from "@/lib/client/SoundToggle";
import { sound } from "@/lib/client/sound";
import { computeAwards, type Award } from "@/lib/tournament/awards";
import { no } from "@/lib/locale/no";

const AWARD_EMOJI: Record<Award["key"], string> = {
  fastest_mate: "⚡",
  most_captures: "⚔️",
  longest_game: "⏳",
  comeback: "💪",
};

function awardDetail(a: Award): string {
  switch (a.key) {
    case "fastest_mate":
      return `Sjakkmatt på ${Math.ceil(a.value / 2)} ${no.awards.movesUnit}`;
    case "most_captures":
      return `${a.value} ${no.awards.capturesUnit}`;
    case "longest_game":
      return `${Math.ceil(a.value / 2)} ${no.awards.movesUnit}`;
    case "comeback":
      return no.awards.comebackDetail;
  }
}

function gameWinner(g: PublicGame): string | null {
  if (g.status === "white_win") return g.whitePlayerId;
  if (g.status === "black_win") return g.blackPlayerId;
  return null;
}

export function FinishedView({ state }: { state: BoardState }) {
  const { standings, players, games, rounds } = state;

  // victory fanfare, once, when the podium appears
  useEffect(() => {
    sound.play("win");
  }, []);

  const championId = useMemo(() => {
    const playoffRounds = rounds
      .filter((r) => r.phase === "playoff")
      .sort((a, b) => b.number - a.number);
    if (playoffRounds.length > 0) {
      const finalGame = games.find((g) => g.roundId === playoffRounds[0].id);
      const w = finalGame ? gameWinner(finalGame) : null;
      if (w) return w;
    }
    return standings[0]?.playerId ?? null;
  }, [rounds, games, standings]);

  const champion = players.find((p) => p.id === championId);
  const nameById = useMemo(() => {
    const m = new Map(players.map((p) => [p.id, p.displayName]));
    return (id: string) => m.get(id) ?? "?";
  }, [players]);

  const awards = useMemo(
    () =>
      computeAwards(
        games
          .filter((g) => g.pgn)
          .map((g) => ({
            id: g.id,
            whitePlayerId: g.whitePlayerId,
            blackPlayerId: g.blackPlayerId,
            status: g.status,
            pgn: g.pgn as string,
          })),
      ),
    [games],
  );
  // podium order: 2nd, 1st, 3rd  (champion centre, tallest)
  const top = standings.slice(0, 3);
  const order = [top[1], top[0], top[2]].filter(Boolean);
  const heights: Record<number, number> = { 1: 150, 2: 112, 3: 84 };
  const medals: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

  return (
    <main className="center-screen">
      <Confetti />
      <div className="stack text-center" style={{ alignItems: "center", maxWidth: 680, gap: 18 }}>
        <span className="brandmark reveal" style={{ ["--i" as string]: 0 } as CSSProperties}>
          <span className="knight">♞</span> Sunday<b>Chess</b>
        </span>
        <p className="eyebrow reveal" style={{ ["--i" as string]: 1 } as CSSProperties}>
          {no.host.podium}
        </p>

        {champion && (
          <div className="stack" style={{ alignItems: "center", gap: 6 }}>
            <div className="float" style={{ fontSize: 80, lineHeight: 1, filter: "drop-shadow(0 12px 30px rgba(235,184,75,.45))" }}>
              🏆
            </div>
            <h1
              className="scale-in"
              style={{ fontSize: "clamp(40px,9vw,80px)", background: "var(--gold-grad)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}
            >
              {champion.displayName}
            </h1>
            <p className="muted">{no.host.champion}</p>
          </div>
        )}

        {/* podium */}
        <div className="podium" style={{ marginTop: 14 }}>
          {order.map((s) => (
            <div className="podium-col" key={s.playerId}>
              <div className="avatar-lg" style={{ width: 48, height: 48, fontSize: 16 }}>
                {initials(s.displayName)}
              </div>
              <b style={{ fontSize: 15 }}>{s.displayName}</b>
              <span className="badge">{s.score}</span>
              <div
                className={`podium-bar ${s.rank === 1 ? "p1" : ""}`}
                style={{ height: heights[s.rank], animationDelay: `${0.2 + s.rank * 0.12}s`, fontSize: 26 }}
              >
                <span style={{ marginTop: 4 }}>{medals[s.rank]}</span>
              </div>
            </div>
          ))}
        </div>

        {awards.length > 0 && (
          <div className="stack" style={{ alignItems: "center", gap: 12, marginTop: 18, width: "100%" }}>
            <p className="eyebrow">{no.awards.title}</p>
            <div className="award-grid">
              {awards.map((a, i) => (
                <div
                  key={a.key}
                  className="card award-card reveal"
                  style={{ ["--i" as string]: 3 + i } as CSSProperties}
                >
                  <span className="award-emoji">{AWARD_EMOJI[a.key]}</span>
                  <b style={{ fontSize: 15 }}>{no.awards[a.key]}</b>
                  <span style={{ fontSize: 14, color: "var(--gold)" }}>
                    {a.playerIds.map(nameById).join(" & ")}
                  </span>
                  <span className="faint" style={{ fontSize: 12 }}>
                    {awardDetail(a)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <Link href="/host" className="btn btn-primary btn-lg" style={{ marginTop: 28 }}>
          {no.host.newTournament} →
        </Link>
      </div>

      <SoundToggle />
    </main>
  );
}
