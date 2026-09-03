// PURE presentation logic for the spectator eval bar and its hype callout.
//
// Deliberately separate from the React components: the components only own the
// async plumbing (lib/client/useEval.ts) and the markup, while every decision
// — how full the bar is, what the pill says, whether a move deserves a callout
// — lives here where it is unit-testable in plain node.

import { Chess } from "chess.js";
import { plyOf } from "@/lib/chess/ply";

/** What the engine reports for one position: centipawns from WHITE's
 * perspective (+ = White better) plus a forced-mate flag. */
export interface Evaluation {
  cp: number;
  mate: 1 | -1 | null;
}

/** An Evaluation tagged with the position it belongs to. The eval now arrives
 * asynchronously from the worker, so the fen has to travel with it. */
export interface FenEval extends Evaluation {
  fen: string;
}

export interface BarView {
  /** Height of the White fill, in percent, clamped to a visible 2–98. */
  whitePct: number;
  /** The value pill: "+1.4", "−0.7", "#", "−#", or "–" when nothing is known. */
  label: string;
  whiteAhead: boolean;
  /** False before the first evaluation resolves — the bar sits neutral. */
  known: boolean;
}

/**
 * Turn an evaluation into the bar's geometry and label. `null` (no evaluation
 * yet, or the engine worker is unavailable) renders a neutral, unlabelled bar
 * — a still 50/50 bar is a far better projector than a 300 ms freeze.
 */
export function barFromEval(ev: Evaluation | null): BarView {
  if (!ev) return { whitePct: 50, label: "–", whiteAhead: true, known: false };
  const { cp, mate } = ev;
  const p = mate != null ? (mate > 0 ? 1 : 0) : 1 / (1 + Math.pow(10, -cp / 400));
  return {
    whitePct: Math.max(2, Math.min(98, p * 100)),
    label:
      mate != null
        ? mate > 0
          ? "#"
          : "−#"
        : `${cp >= 0 ? "+" : "−"}${Math.abs(cp / 100).toFixed(1)}`,
    whiteAhead: p >= 0.5,
    known: true,
  };
}

export type CalloutKind = "mate" | "swing" | "blunder" | "brilliant";
export type CalloutTone = "good" | "bad" | "swing" | "mate";

export const CALLOUT_TONE: Record<CalloutKind, CalloutTone> = {
  mate: "mate",
  swing: "swing",
  blunder: "bad",
  brilliant: "good",
};

/** Clamp mate scores so a single Δ threshold works near mate too. */
export function clampCp(cp: number): number {
  return Math.max(-1200, Math.min(1200, cp));
}

const SWING_CP = 260;
const LEAD_CP = 120;

/**
 * Decide whether the move that led from `before` to `after` deserves a callout.
 *
 * `before`/`after` are two RESOLVED evaluations, so the pair may have gaps if a
 * position's evaluation never came back. Callouts are therefore only made for
 * two positions exactly one ply apart — otherwise "who moved" is a guess and a
 * two-ply swing would be blamed on the wrong player.
 *
 * Returns null when nothing is worth shouting about.
 */
export function calloutFor(before: FenEval | null, after: FenEval): CalloutKind | null {
  if (!before) return null; // first position seen — nothing to compare against
  if (before.fen === after.fen) return null;
  if (plyOf(after.fen) - plyOf(before.fen) !== 1) return null;

  let chess: Chess;
  try {
    chess = new Chess(after.fen);
  } catch {
    return null;
  }
  if (after.mate != null && chess.isCheckmate()) return "mate";

  const beforeCp = clampCp(before.cp);
  const afterCp = clampCp(after.cp);
  if (
    (beforeCp > LEAD_CP && afterCp < -LEAD_CP) ||
    (beforeCp < -LEAD_CP && afterCp > LEAD_CP)
  ) {
    return "swing";
  }

  // Δ from the mover's perspective: positive = the move improved their game.
  const moverIsWhite = before.fen.split(" ")[1] === "w";
  const delta = (afterCp - beforeCp) * (moverIsWhite ? 1 : -1);
  if (delta <= -SWING_CP) return "blunder";
  if (delta >= SWING_CP) return "brilliant";
  return null;
}
