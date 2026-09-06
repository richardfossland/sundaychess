import { describe, expect, it } from "vitest";
import type { Game, ResultSource, Tournament } from "@/lib/types";
import { resultSourceLabel, toBoardTournament, toPublicGame } from "@/lib/dto";

// R9: PGN is heavy (a full move-by-move history per decided game) and must
// never ride along on the 5s board poll — only a one-off `?full=1` fetch
// (awards/replay recap) opts in via `{ withPgn: true }`.

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function makeGame(over: Partial<Game> = {}): Game {
  return {
    id: "g1",
    tournament_id: "t",
    round_id: "r",
    white_player_id: "white",
    black_player_id: "black",
    fen: START,
    pgn: "1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7#",
    status: "white_win",
    result_source: null,
    turn: "w",
    draw_offered_by: null,
    updated_at: "",
    ...over,
  };
}

describe("toPublicGame — pgn stays off the hot board poll (R9)", () => {
  it("omits pgn by default for a decided game", () => {
    const pub = toPublicGame(makeGame());
    expect(pub.pgn).toBeUndefined();
    expect("pgn" in pub).toBe(false);
  });

  it("omits pgn when withPgn is explicitly false", () => {
    const pub = toPublicGame(makeGame(), { withPgn: false });
    expect(pub.pgn).toBeUndefined();
  });

  it("includes pgn for a decided game only when withPgn is true", () => {
    const pub = toPublicGame(makeGame({ status: "white_win" }), { withPgn: true });
    expect(pub.pgn).toBe("1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7#");
  });

  it("includes pgn for a draw when withPgn is true", () => {
    const pub = toPublicGame(makeGame({ status: "draw" }), { withPgn: true });
    expect(pub.pgn).toBe("1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7#");
  });

  it("NEVER includes pgn for a live game, even with withPgn: true", () => {
    const pub = toPublicGame(makeGame({ status: "live" }), { withPgn: true });
    expect(pub.pgn).toBeUndefined();
  });

  it("omits pgn when the row has no pgn yet, even if decided + withPgn: true", () => {
    const pub = toPublicGame(makeGame({ status: "draw", pgn: "" }), { withPgn: true });
    expect(pub.pgn).toBeUndefined();
  });

  it("still returns the rest of the shape unchanged regardless of withPgn", () => {
    const pub = toPublicGame(makeGame(), { withPgn: true });
    expect(pub).toMatchObject({
      id: "g1",
      roundId: "r",
      whitePlayerId: "white",
      blackPlayerId: "black",
      fen: START,
      status: "white_win",
      turn: "w",
      slot: 0,
    });
  });
});

describe("toPublicGame — fair-play readout (result_source)", () => {
  it("includes resultSource for a decided game, regardless of withPgn", () => {
    const pub = toPublicGame(makeGame({ status: "white_win", result_source: "walkover" }));
    expect(pub.resultSource).toBe("walkover");
  });

  it("includes resultSource for a draw decided by teacher_override", () => {
    const pub = toPublicGame(
      makeGame({ status: "draw", result_source: "teacher_override" }),
      { withPgn: true },
    );
    expect(pub.resultSource).toBe("teacher_override");
  });

  it("omits resultSource for a live game, even if the row somehow has one", () => {
    const pub = toPublicGame(makeGame({ status: "live", result_source: "walkover" }));
    expect(pub.resultSource).toBeUndefined();
    expect("resultSource" in pub).toBe(false);
  });

  it("omits resultSource when the decided game's row has none", () => {
    const pub = toPublicGame(makeGame({ status: "white_win", result_source: null }));
    expect(pub.resultSource).toBeUndefined();
  });

  it("omits resultSource for an aborted game (not in the `decided` set)", () => {
    const pub = toPublicGame(makeGame({ status: "aborted", result_source: "teacher_override" }));
    expect(pub.resultSource).toBeUndefined();
  });
});

describe("toBoardTournament — the teacher's private notes never leak to students", () => {
  function makeTournament(over: Partial<Tournament> = {}): Tournament {
    return {
      id: "t1",
      join_pin: "123456",
      host_code: "HOST",
      host_user_id: null,
      title: "7A",
      status: "league",
      config: {
        leagueRounds: 5,
        playoff: false,
        playoffSize: 0,
        roundTimerSec: null,
        notes: "Klasse 7A, time 3 — pass på Kari og Ola",
      },
      current_round: 1,
      created_at: "",
      ...over,
    };
  }

  // GET /api/tournament/[id] is UNAUTHENTICATED and polled every 5s by every
  // connected student device (see app/api/tournament/[id]/route.ts) — the
  // teacher's private reminder must never ride along in its `config`.
  it("strips config.notes from the public board DTO", () => {
    const pub = toBoardTournament(makeTournament());
    expect(pub.config).not.toHaveProperty("notes");
    expect("notes" in pub.config).toBe(false);
  });

  it("leaves every other config field untouched", () => {
    const pub = toBoardTournament(makeTournament());
    expect(pub.config).toMatchObject({
      leagueRounds: 5,
      playoff: false,
      playoffSize: 0,
      roundTimerSec: null,
    });
  });

  it("is safe when there are no notes to begin with", () => {
    const t = makeTournament();
    delete t.config.notes;
    const pub = toBoardTournament(t);
    expect(pub.config).not.toHaveProperty("notes");
  });
});

describe("resultSourceLabel — pure marker text for a fair-play readout", () => {
  it("is empty for ordinary play", () => {
    expect(resultSourceLabel("play")).toBe("");
  });

  it("is empty for null/undefined (a live game)", () => {
    expect(resultSourceLabel(null)).toBe("");
    expect(resultSourceLabel(undefined)).toBe("");
  });

  const cases: [ResultSource, string][] = [
    ["walkover", "W.O."],
    ["opponent_absent", "Fraværende"],
    ["teacher_override", "Overstyrt"],
    ["timeout_draw", "Tid ute"],
    ["bye", "Frirunde"],
  ];
  it.each(cases)("maps %s to %s", (source, label) => {
    expect(resultSourceLabel(source)).toBe(label);
  });
});
