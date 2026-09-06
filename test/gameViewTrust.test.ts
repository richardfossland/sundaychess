import { describe, expect, it } from "vitest";
import { channels } from "@/lib/realtime";
import {
  createReactionGate,
  isClockWire,
  isFenString,
  isGameStatus,
  isValidDrawEvent,
  isValidPositionPayload,
  isValidResultPayload,
  isValidSpectatePosition,
  isValidSpectateResult,
  nextStamp,
  resolveAuthoritative,
} from "@/lib/realtimeTrust";
import { plyOf } from "@/lib/chess/ply";

// The pure half of the Realtime trust model (lib/realtimeTrust.ts). What these
// lock down is the rule the broadcast handlers are built on: a payload is a
// hint, an authoritative fetch is the truth, and the ply guard only ever
// arbitrates between two authoritative sources.

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";

describe("topic namespace", () => {
  it("prefixes every topic with the app, so the shared Supabase project can't cross apps", () => {
    // lib/realtime.ts used to be byte-identical in SundayTicTacToe, and Realtime
    // topics are one flat namespace per project — both apps were listening on
    // the same `game:<id>`.
    expect(channels.game("g1")).toBe("chess:game:g1");
    expect(channels.lobby("t1")).toBe("chess:lobby:t1");
    expect(channels.spectate("t1")).toBe("chess:spectate:t1");
    expect(channels.presence("t1")).toBe("chess:presence:t1");
  });
});

describe("isFenString", () => {
  it("accepts the positions this app actually plays", () => {
    expect(isFenString(START)).toBe(true);
    expect(isFenString(AFTER_E4)).toBe(true);
    // the shipped variants (lib/chess/variants.ts)
    expect(isFenString("rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNB1KBNR w KQkq - 0 1")).toBe(true);
    expect(isFenString("4k3/pppppppp/8/8/8/8/PPPPPPPP/4K3 w - - 0 1")).toBe(true);
  });

  it("rejects anything that isn't a real FEN", () => {
    expect(isFenString(undefined)).toBe(false);
    expect(isFenString(42)).toBe(false);
    expect(isFenString({ fen: START })).toBe(false);
    expect(isFenString("")).toBe(false);
    // five fields, not six
    expect(isFenString("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0")).toBe(false);
    // seven ranks
    expect(isFenString("rnbqkbnr/pppppppp/8/8/8/8/RNBQKBNR w KQkq - 0 1")).toBe(false);
    // a rank that doesn't add up to eight files
    expect(isFenString("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNRR w KQkq - 0 1")).toBe(false);
    // a piece letter chess has never heard of
    expect(isFenString("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNX w KQkq - 0 1")).toBe(false);
    // side to move
    expect(isFenString("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR x KQkq - 0 1")).toBe(false);
    // castling / en-passant fields
    expect(isFenString("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w ZZ - 0 1")).toBe(false);
    expect(isFenString("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq e9 0 1")).toBe(false);
    // clock fields
    expect(isFenString("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - x 1")).toBe(false);
    expect(isFenString("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 0")).toBe(false);
    // an absent (empty) castling field is not "no castling rights"
    expect(isFenString("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w  - 0 1")).toBe(false);
  });
});

describe("isGameStatus / isClockWire", () => {
  it("knows the six statuses and nothing else", () => {
    for (const s of ["live", "white_win", "black_win", "draw", "bye", "aborted"]) {
      expect(isGameStatus(s)).toBe(true);
    }
    expect(isGameStatus("won")).toBe(false);
    expect(isGameStatus(1)).toBe(false);
    expect(isGameStatus(null)).toBe(false);
  });

  it("requires a whole clock snapshot, with finite non-negative times", () => {
    expect(isClockWire({ whiteMs: 1000, blackMs: 900, turn: "w", running: true })).toBe(true);
    expect(isClockWire({ whiteMs: 1000, blackMs: 900, turn: "w" })).toBe(false);
    expect(isClockWire({ whiteMs: -1, blackMs: 900, turn: "w", running: true })).toBe(false);
    expect(isClockWire({ whiteMs: NaN, blackMs: 900, turn: "w", running: true })).toBe(false);
    expect(isClockWire({ whiteMs: "1000", blackMs: 900, turn: "w", running: true })).toBe(false);
    expect(isClockWire(null)).toBe(false);
  });
});

describe("isValidPositionPayload", () => {
  const good = {
    fen: AFTER_E4,
    turn: "b",
    status: "live",
    lastMove: { from: "e2", to: "e4", san: "e4" },
    clock: { whiteMs: 1000, blackMs: 1000, turn: "b", running: true },
  };

  it("accepts what the server sends", () => {
    expect(isValidPositionPayload(good)).toBe(true);
    expect(isValidPositionPayload({ fen: AFTER_E4, turn: "b", status: "live" })).toBe(true);
    expect(
      isValidPositionPayload({ fen: AFTER_E4, turn: "b", status: "live", lastMove: null, clock: null }),
    ).toBe(true);
    expect(
      isValidPositionPayload({ fen: AFTER_E4, turn: "b", status: "live", lastMove: { from: "e2", to: "e4" } }),
    ).toBe(true);
  });

  it("drops a payload whose `turn` contradicts the FEN's own side to move", () => {
    expect(isValidPositionPayload({ ...good, turn: "w" })).toBe(false);
  });

  it("drops malformed pieces rather than letting them reach the board", () => {
    expect(isValidPositionPayload(null)).toBe(false);
    expect(isValidPositionPayload("position")).toBe(false);
    expect(isValidPositionPayload({ ...good, fen: "not a fen" })).toBe(false);
    expect(isValidPositionPayload({ ...good, status: "hacked" })).toBe(false);
    expect(isValidPositionPayload({ ...good, lastMove: { from: "z9", to: "e4" } })).toBe(false);
    expect(isValidPositionPayload({ ...good, lastMove: { from: "e2", to: "e4", san: "x".repeat(40) } })).toBe(false);
    expect(isValidPositionPayload({ ...good, clock: { whiteMs: 1 } })).toBe(false);
  });
});

describe("isValidResultPayload / spectate payloads / draw events", () => {
  it("validates a result's status", () => {
    expect(isValidResultPayload({ status: "black_win" })).toBe(true);
    expect(isValidResultPayload({ status: "nope" })).toBe(false);
    expect(isValidResultPayload({})).toBe(false);
    expect(isValidResultPayload(undefined)).toBe(false);
  });

  it("validates the tournament-wide spectate feed", () => {
    expect(isValidSpectatePosition({ gameId: "g1", fen: AFTER_E4 })).toBe(true);
    expect(isValidSpectatePosition({ gameId: "g1", fen: AFTER_E4, clock: null })).toBe(true);
    expect(isValidSpectatePosition({ gameId: "", fen: AFTER_E4 })).toBe(false);
    expect(isValidSpectatePosition({ fen: AFTER_E4 })).toBe(false);
    expect(isValidSpectatePosition({ gameId: "g1", fen: "junk" })).toBe(false);

    expect(isValidSpectateResult({ gameId: "g1", status: "draw" })).toBe(true);
    expect(isValidSpectateResult({ gameId: "g1", status: "draw?" })).toBe(false);
    expect(isValidSpectateResult({ status: "draw" })).toBe(false);
  });

  it("only lets a player in THIS game raise a draw banner", () => {
    const players = new Set(["white", "black"]);
    expect(isValidDrawEvent({ by: "white" }, players)).toBe(true);
    expect(isValidDrawEvent({ by: "someone-else" }, players)).toBe(false);
    expect(isValidDrawEvent({ by: 7 }, players)).toBe(false);
    expect(isValidDrawEvent({}, players)).toBe(false);
    // Before the first load() the roster is empty — drop, don't trust.
    expect(isValidDrawEvent({ by: "white" }, new Set())).toBe(false);
  });
});

describe("resolveAuthoritative", () => {
  it("between two AUTHORITATIVE sources, the monotonic ply guard still rules", () => {
    // A slow in-flight GET resolving after a fresher move must not roll back.
    expect(
      resolveAuthoritative({ ply: 10 }, { ply: 9, issuedStamp: nextStamp() }, null),
    ).toBe(false);
    expect(
      resolveAuthoritative({ ply: 10 }, { ply: 10, issuedStamp: nextStamp() }, null),
    ).toBe(true);
    expect(
      resolveAuthoritative({ ply: 10 }, { ply: 11, issuedStamp: nextStamp() }, null),
    ).toBe(true);
  });

  it("a fetch issued AFTER a provisional wins outright — this is what heals a forged position", () => {
    // The attack: a `position` broadcast claiming ply 400. The old guard
    // accepted it (higher ply) and then blocked every real load for good.
    const provisional = { stamp: nextStamp() };
    const issuedStamp = nextStamp(); // the refetch the broadcast scheduled
    expect(
      resolveAuthoritative({ ply: 400 }, { ply: 12, issuedStamp }, provisional),
    ).toBe(true);
  });

  it("a fetch already in flight when the broadcast landed proves nothing, so the guard holds", () => {
    // Otherwise a legitimate move would be rolled back off the board by a GET
    // that was sent before the server even had it.
    const issuedStamp = nextStamp();
    const provisional = { stamp: nextStamp() };
    expect(
      resolveAuthoritative({ ply: 12 }, { ply: 11, issuedStamp }, provisional),
    ).toBe(false);
    // …but it is still adopted when it is not a rollback.
    expect(
      resolveAuthoritative({ ply: 12 }, { ply: 12, issuedStamp }, provisional),
    ).toBe(true);
  });

  it("stamps are strictly increasing, so the comparison is an order and not a guess", () => {
    const a = nextStamp();
    const b = nextStamp();
    expect(b).toBeGreaterThan(a);
  });

  it("models the whole forged-position episode end to end", () => {
    // Real state: ply 12. Forged broadcast: ply 400 — accepted for display.
    let shownPly = plyOf(AFTER_E4);
    const forgedPly = 400;
    const provisional = { stamp: nextStamp() };
    shownPly = forgedPly;
    // The refetch the handler scheduled comes back with the truth.
    const issuedStamp = nextStamp();
    const adopt = resolveAuthoritative(
      { ply: shownPly },
      { ply: 12, issuedStamp },
      provisional,
    );
    expect(adopt).toBe(true);
    // …and once adopted, nothing provisional is left to override the guard.
    expect(resolveAuthoritative({ ply: 12 }, { ply: 11, issuedStamp: nextStamp() }, null)).toBe(false);
  });
});

describe("createReactionGate", () => {
  const ALLOWED = ["👍", "👏", "😄"] as const;
  const senders = new Set(["p1", "p2"]);

  it("passes an allowlisted emoji from a player in the game", () => {
    const gate = createReactionGate(ALLOWED);
    expect(gate({ emoji: "👍", by: "p1" }, senders)).toBe("👍");
  });

  it("drops anything outside the allowlist — including arbitrary strings", () => {
    const gate = createReactionGate(ALLOWED);
    expect(gate({ emoji: "🔥", by: "p1" }, senders)).toBeNull();
    expect(gate({ emoji: "look behind you", by: "p1" }, senders)).toBeNull();
    expect(gate({ emoji: 3, by: "p1" }, senders)).toBeNull();
    expect(gate({ by: "p1" }, senders)).toBeNull();
    expect(gate(null, senders)).toBeNull();
    expect(gate("👍", senders)).toBeNull();
  });

  it("drops a sender who is not one of this game's players", () => {
    const gate = createReactionGate(ALLOWED);
    expect(gate({ emoji: "👍", by: "stranger" }, senders)).toBeNull();
    expect(gate({ emoji: "👍" }, senders)).toBeNull();
    expect(gate({ emoji: "👍", by: "p1" }, new Set())).toBeNull();
  });

  it("caps the overlay at 5 a second and lets it refill", () => {
    let t = 1_000_000;
    const gate = createReactionGate(ALLOWED, 5, () => t);
    for (let i = 0; i < 5; i++) {
      expect(gate({ emoji: "👍", by: "p1" }, senders)).toBe("👍");
    }
    // Sixth inside the same second: dropped, however it is dressed up.
    expect(gate({ emoji: "👏", by: "p2" }, senders)).toBeNull();
    t += 999;
    expect(gate({ emoji: "👏", by: "p2" }, senders)).toBeNull();
    // The window is a full second wide, not a bucket that resets on the hour.
    t += 1;
    expect(gate({ emoji: "👏", by: "p2" }, senders)).toBe("👏");
  });

  it("counts the OVERLAY, not the sender — five spoofed ids fill it just as fast", () => {
    const t = 0;
    const gate = createReactionGate(ALLOWED, 2, () => t);
    expect(gate({ emoji: "👍", by: "p1" }, senders)).toBe("👍");
    expect(gate({ emoji: "👍", by: "p2" }, senders)).toBe("👍");
    expect(gate({ emoji: "👍", by: "p1" }, senders)).toBeNull();
  });
});
