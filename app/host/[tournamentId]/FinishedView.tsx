"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import type { BoardState, PublicGame } from "@/lib/dto";
import { api } from "@/lib/client/api";
import { identity } from "@/lib/client/identity";
import { Confetti, initials } from "@/lib/client/Confetti";
import { SoundToggle } from "@/lib/client/SoundToggle";
import { FullscreenToggle } from "@/lib/client/FullscreenToggle";
import { sound } from "@/lib/client/sound";
import { computeAwards, type Award } from "@/lib/tournament/awards";
import { computeTeamStandings, teamColor } from "@/lib/tournament/teams";
import { BracketBoard } from "@/lib/client/BracketBoard";
import { no } from "@/lib/locale/no";
import { downloadPgn } from "@/lib/client/pgnActions";
import { exportRound, pgnFileName, tournamentPgn } from "@/lib/export/pgn";
import { Icon, MedalIcon, type IconName } from "@/lib/client/Icon";
import { StandingsTable } from "./StandingsTable";
import { usePresentasjon } from "@/lib/client/storskjerm/usePresentasjon";

/** Tavlevisning: høyeste antall tabellrader før «+N til». */
const TV_RESULT_MAX = 10;

const AWARD_ICON: Record<Award["key"], IconName> = {
  fastest_mate: "quick",
  most_captures: "versus",
  longest_game: "hourglass",
  comeback: "comeback",
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

// Compact per-round result, for the print-only recap below (no.host has no
// entry for this — it's a plain chess score line, not prose).
function printResultLabel(g: PublicGame): string {
  switch (g.status) {
    case "white_win":
      return "1–0";
    case "black_win":
      return "0–1";
    case "draw":
      return "½–½";
    case "bye":
      return no.host.bye;
    case "aborted":
      return no.host.aborted;
    default:
      return no.host.inProgress;
  }
}

export function FinishedView({ state }: { state: BoardState }) {
  const { standings, players, games, rounds, tournament } = state;
  const presentasjon = usePresentasjon();

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

  // The 5s board poll (useBoardState) never carries PGN (R9) — `state.games`
  // has everything else the podium needs, but awards are computed by replaying
  // each decided game's move history. Fetch that ONCE, here, when the finished
  // view first appears, instead of paying for it on every poll. Until it
  // resolves (or if it fails) `pgnGames` stays null and the award grid below
  // simply doesn't render — a quiet loading/empty state, not an error.
  const [pgnGames, setPgnGames] = useState<PublicGame[] | null>(null);
  // Tavlevisningen (presentasjon) viser ingen utmerkelser: hopp over den tunge
  // PGN-hentingen og beregningen helt.
  useEffect(() => {
    if (presentasjon) return;
    let cancelled = false;
    api
      .board(tournament.id, { full: true })
      .then((full) => {
        if (!cancelled) setPgnGames(full.games);
      })
      .catch(() => {
        // Awards are a nice-to-have recap, not core to the podium — leave
        // pgnGames null (empty award grid) rather than erroring this screen.
      });
    return () => {
      cancelled = true;
    };
  }, [tournament.id, presentasjon]);

  // Teacher's private note-to-self (config.notes) — NEVER rides on the public
  // board poll (lib/dto.ts's toBoardTournament strips it), so it's fetched
  // separately through the host-code-gated config route, same as the print
  // header's own host-only paper. Silently absent if the host code isn't on
  // this device (e.g. a colleague projecting from a shared account/PIN).
  const [notes, setNotes] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const hostCode = presentasjon ? null : identity.hostCode(tournament.id);
    if (!hostCode) return;
    api
      .getTournamentConfig(tournament.id, hostCode)
      .then((r) => {
        if (!cancelled) setNotes(r.notes);
      })
      .catch(() => {
        // Print-only nicety — never worth erroring the finished screen for.
      });
    return () => {
      cancelled = true;
    };
  }, [tournament.id, presentasjon]);

  const awards = useMemo(
    () =>
      computeAwards(
        (pgnGames ?? [])
          .filter((g) => g.pgn)
          .map((g) => ({
            id: g.id,
            whitePlayerId: g.whitePlayerId,
            blackPlayerId: g.blackPlayerId,
            status: g.status,
            pgn: g.pgn as string,
          })),
      ),
    [pgnGames],
  );

  const [pgnBusy, setPgnBusy] = useState(false);
  const [pgnFailed, setPgnFailed] = useState(false);
  // Henter ferske partier med PGN ved klikk, så filen alltid er komplett.
  const downloadAllPgn = async () => {
    setPgnBusy(true);
    setPgnFailed(false);
    try {
      const full = await api.board(tournament.id, { full: true });
      const name = new Map(full.players.map((p) => [p.id, p.displayName]));
      const title = tournament.title || no.appName;
      const text = tournamentPgn(
        full.games
          .filter((g) => g.blackPlayerId && g.pgn)
          .map((g) => ({
            event: title,
            // Sluttspillrunder fortsetter etter ligarundene (ellers kolliderer «Round 1»).
            round: exportRound(full.rounds, g.roundId) ?? 0,
            board: (g.slot ?? 0) + 1,
            white: name.get(g.whitePlayerId) ?? "?",
            black: name.get(g.blackPlayerId as string) ?? "?",
            status: g.status,
            resultSource: g.resultSource,
            pgn: g.pgn as string,
          })),
      );
      downloadPgn(pgnFileName(title), text);
    } catch {
      setPgnFailed(true);
    } finally {
      setPgnBusy(false);
    }
  };

  const teamRows = useMemo(
    () => computeTeamStandings(tournament.config.teams ?? [], players),
    [tournament.config.teams, players],
  );
  const teamById = useMemo(() => {
    const m = new Map(players.map((p) => [p.id, p.team]));
    return (id: string) => m.get(id) ?? null;
  }, [players]);

  // Fair-play readout: games decided without play (walkover/absent/override —
  // NOT ordinary byes or time-forced draws, which aren't a fairness concern).
  const nonPlayCount = useMemo(
    () =>
      games.filter(
        (g) =>
          g.resultSource === "walkover" ||
          g.resultSource === "opponent_absent" ||
          g.resultSource === "teacher_override",
      ).length,
    [games],
  );
  // podium order: 2nd, 1st, 3rd  (champion centre, tallest)
  const top = standings.slice(0, 3);
  const order = [top[1], top[0], top[2]].filter(Boolean);
    const medals: Record<number, ReactNode> = { 1: <MedalIcon rank={1} size={30} />, 2: <MedalIcon rank={2} size={30} />, 3: <MedalIcon rank={3} size={30} /> };

  return (
    <main className={`center-screen${presentasjon ? " tv-screen tv-finish" : ""}`}>
      {/* Confetti is a fixed, pointer-events-none canvas with no class of its
          own — wrap it so @media print can hide it (it would otherwise just
          render blank, but it's still dead weight on the page). */}
      <div className="no-print">
        <Confetti />
      </div>

      {/* Printed page only: a plain title + date the projector never shows. */}
      <div className="print-only">
        <h1 className="print-title">{tournament.title || no.appName}</h1>
        <p className="print-small">
          {new Date().toLocaleDateString("no", { day: "2-digit", month: "long", year: "numeric" })}
        </p>
        {/* Teacher's own reminder (class, lesson, …) — never shown to
            students on the projector; this print-only block is host-only
            paper, fetched below like the awards' PGN (never on the 5s poll —
            see lib/dto.ts's toBoardTournament). */}
        {notes && <p className="print-small print-note">{notes}</p>}
      </div>

      <div className="stack text-center finish-wrap">
        {presentasjon && (
          <span className="brandmark reveal" style={{ ["--i" as string]: 0 } as CSSProperties}>
            <span className="knight">♞</span> Sunday<b>Chess</b>
          </span>
        )}
        <p className="eyebrow reveal" style={{ ["--i" as string]: 1 } as CSSProperties}>
          {no.host.podium}
        </p>

        {champion && (
          <div className="stack finish-champion">
            <div className="float champion-cup">
              <Icon name="cup" size={80} strokeWidth={1.3} />
            </div>
            <h1
              className="scale-in gold-text champion-name"
              data-len={champion.displayName.length <= 12 ? "l" : champion.displayName.length <= 20 ? "m" : "s"}
            >{champion.displayName}</h1>
            <p className="muted">{no.host.champion}</p>
          </div>
        )}

        {/* Pall og tabell: side om side på bred skjerm, ellers under hverandre. */}
        <div className="finish-grid">
          <div className="finish-main">
            <div className="podium">
              {order.map((s) => (
                <div className="podium-col" key={s.playerId}>
                  <div className="avatar-lg podium-avatar">{initials(s.displayName)}</div>
                  <b className="podium-name">{s.displayName}</b>
                  {!presentasjon && <span className="badge podium-score">{s.score}</span>}
                  <div
                    className={`podium-bar ${s.rank === 1 ? "p1" : ""}`}
                    data-rank={s.rank}
                    style={{ animationDelay: `${0.2 + s.rank * 0.12}s` }}
                  >
                    <span className="podium-medal">{medals[s.rank]}</span>
                    {presentasjon && <span className="podium-points">{s.score}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Full results — the podium only shows the top 3; ranks 4+ still
              matter to a class projecting this on the wall. */}
          <div
            className="stack gap-3 finish-results"
            style={
              presentasjon
                ? ({ ["--rows"]: Math.min(standings.length, TV_RESULT_MAX) + (standings.length > TV_RESULT_MAX ? 1 : 0) } as CSSProperties)
                : undefined
            }
          >
            <div className="card finish-table-card">
              <p className="eyebrow finish-eyebrow">{no.host.standings}</p>
              <StandingsTable
                standings={standings}
                teamById={teamById}
                limit={presentasjon ? TV_RESULT_MAX : undefined}
              />
            </div>
            {nonPlayCount > 0 && (
              <p className="tiebreak-note">{no.host.resultSourceLegend(nonPlayCount)}</p>
            )}
          </div>
        </div>

        {teamRows.length > 0 && (
          <div className="stack gap-3 finish-block">
            <p className="eyebrow">{no.teams.winner}</p>
            <div className="row team-winners">
              {teamRows.map((r, i) => (
                <span
                  key={r.team}
                  className={`team-chip${i === 0 ? " team-chip-first" : ""}`}
                  style={{
                    borderColor:
                      i === 0
                        ? `color-mix(in srgb, ${teamColor(r.team)} 70%, transparent)`
                        : undefined,
                    boxShadow:
                      i === 0 ? `0 8px 30px -10px ${teamColor(r.team)}` : undefined,
                  }}
                >
                  <span className="team-dot" style={{ background: teamColor(r.team) }} />
                  {i === 0 && <Icon name="cup" size={16} />} 
                  {r.team} · <b>{r.score}</b>
                </span>
              ))}
            </div>
          </div>
        )}

        {!presentasjon && awards.length > 0 && (
          <div className="stack gap-3 finish-block">
            <p className="eyebrow">{no.awards.title}</p>
            <div className="award-grid">
              {awards.map((a, i) => (
                <div
                  key={a.key}
                  className="card award-card reveal"
                  style={{ ["--i" as string]: 3 + i } as CSSProperties}
                >
                  <span className="award-emoji"><Icon name={AWARD_ICON[a.key]} size={26} /></span>
                  <b className="award-title">{no.awards[a.key]}</b>
                  <span className="award-who">
                    {a.playerIds.map(nameById).join(" & ")}
                  </span>
                  <span className="faint fs-xs">
                    {awardDetail(a)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* how the knockout went — the full bracket path (cup / playoff only) */}
        {!presentasjon && rounds.some((r) => r.phase === "playoff") && (
          <div className="stack gap-3 finish-block no-print">
            <p className="eyebrow">{no.host.bracketRecap}</p>
            <BracketBoard games={games} rounds={rounds} players={players} />
          </div>
        )}

        {/* Printed page only: per-round pairings + results (the bracket board
            above is a canvas-y interactive widget, cheap to skip on paper —
            this plain list is the "if cheap" per-round recap instead). */}
        <div className="print-only print-recap">
          <p className="eyebrow">{no.host.games}</p>
          {rounds
            .slice()
            .sort((a, b) => a.number - b.number || (a.phase === "playoff" ? 1 : -1))
            .map((r) => {
              const roundGames = games.filter((g) => g.roundId === r.id);
              if (roundGames.length === 0) return null;
              return (
                <div key={r.id} className="print-round">
                  <b>
                    {no.host.round} {r.number}
                    {r.phase === "playoff" ? ` · ${no.host.bracket}` : ""}
                  </b>
                  <ul className="print-list">
                    {roundGames.map((g) => (
                      <li key={g.id}>
                        {nameById(g.whitePlayerId)}
                        {g.blackPlayerId ? ` – ${nameById(g.blackPlayerId)}` : ""}:{" "}
                        {printResultLabel(g)}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
        </div>

        {/* Tavlevisning: ingen «Ny turnering»/utskrift på projektoren. */}
        {!presentasjon && (
          <div className="row no-print finish-actions">
            <Link href="/arranger" className="btn btn-primary btn-lg">
              {no.host.newTournament} →
            </Link>
            <button
              type="button"
              className="btn btn-ghost btn-lg"
              onClick={() => window.print()}
            >
              <Icon name="print" size={16} /> {no.host.printResults}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-lg"
              disabled={pgnBusy}
              onClick={downloadAllPgn}
            >
              {no.pgn.downloadAll}
            </button>
            {pgnFailed && (
              <span className="muted fs-xs" role="status">
                {no.pgn.failed}
              </span>
            )}
          </div>
        )}
      </div>

      <SoundToggle />
      <FullscreenToggle />
    </main>
  );
}
