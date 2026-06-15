// Templated Norwegian (Bokmål) coaching summary — the KEYLESS fallback.
//
// Pure functions, no network, no key. Given an engine-derived PlayerReview,
// produce a warm, church/community-appropriate paragraph in Norwegian. When no
// Anthropic key is configured, this is what the review screen shows; when a key
// IS configured, the same facts are handed to Claude to narrate (see
// lib/server/llm.ts) and this stays the safety net.
//
// All numbers here come from the engine (lib/chess/analysis.ts); nothing is
// invented. The tone is encouraging and never harsh — this is for a Sunday
// chess afternoon, not a grandmaster post-mortem.

import type { MoveTag, PlayerReview } from "@/lib/chess/analysis";

/** Norwegian labels for each move tag (single move, lower-case mid-sentence). */
export const TAG_LABEL_NO: Record<MoveTag, string> = {
  best: "beste trekk",
  good: "godt trekk",
  inaccuracy: "unøyaktighet",
  mistake: "feil",
  blunder: "tabbe",
  missed_mate: "oversett matt",
  found_mate: "sjakkmatt",
};

/** Compact, structured facts the coach narrates around. Both the templated
 * summary and the LLM prompt are built from THIS — single source of truth. */
export interface ReviewFacts {
  name: string;
  /** "Hvit" | "Svart" */
  colorNo: string;
  totalMoves: number;
  blunders: number;
  mistakes: number;
  inaccuracies: number;
  goodOrBest: number;
  missedMates: number;
  deliveredMate: boolean;
  /** 0–100 rough accuracy proxy (higher = better). */
  accuracy: number;
  /** The single worst move, if any, for a concrete teaching moment. */
  worstMove: {
    moveNumber: number;
    san: string;
    tag: MoveTag;
  } | null;
  /** "white_win" | "black_win" | "draw" | "unknown" plus whether the player won. */
  outcome: "won" | "lost" | "draw" | "unknown";
}

const COLOR_NO: Record<"w" | "b", string> = { w: "Hvit", b: "Svart" };

/** Map average centipawn loss to a friendly 0–100 accuracy proxy. ~0 cpl ≈ 99,
 * ~100 cpl ≈ ~55. Purely cosmetic; clamped. */
function accuracyFromCpLoss(avgCpLoss: number): number {
  const a = 100 - avgCpLoss / 2.2;
  return Math.max(20, Math.min(99, Math.round(a)));
}

/** Build the structured facts for one player from the engine review. */
export function reviewFacts(
  review: PlayerReview,
  result: "white_win" | "black_win" | "draw" | "unknown",
): ReviewFacts {
  const c = review.counts;
  const worst =
    review.worstMoveIndex >= 0 ? review.moves[review.worstMoveIndex] : null;

  let outcome: ReviewFacts["outcome"] = "unknown";
  if (result === "draw") outcome = "draw";
  else if (result === "white_win") outcome = review.side === "w" ? "won" : "lost";
  else if (result === "black_win") outcome = review.side === "b" ? "won" : "lost";

  return {
    name: review.name,
    colorNo: COLOR_NO[review.side],
    totalMoves: review.moves.length,
    blunders: c.blunder,
    mistakes: c.mistake,
    inaccuracies: c.inaccuracy,
    goodOrBest: c.good + c.best,
    missedMates: c.missed_mate,
    deliveredMate: c.found_mate > 0,
    accuracy: accuracyFromCpLoss(review.averageCpLoss),
    worstMove: worst
      ? { moveNumber: worst.moveNumber, san: worst.san, tag: worst.tag }
      : null,
    outcome,
  };
}

/** Norwegian count phrase: "1 tabbe" / "3 tabber" (handles singular/plural). */
function nb(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Build the warm templated Norwegian paragraph from the facts. Deterministic
 * and pure — this is the keyless fallback AND the gate-tested baseline.
 */
export function templatedSummaryNo(f: ReviewFacts): string {
  const parts: string[] = [];

  // Opening line: outcome-aware, always kind.
  if (f.deliveredMate) {
    parts.push(
      `Godt jobba, ${f.name}! Du satte mattangrepet i hus og avgjorde partiet.`,
    );
  } else if (f.outcome === "won") {
    parts.push(`Fint spilt, ${f.name} — du vant partiet med ${f.colorNo.toLowerCase()}.`);
  } else if (f.outcome === "draw") {
    parts.push(`Jevnt og fint, ${f.name} — partiet endte remis.`);
  } else if (f.outcome === "lost") {
    parts.push(`Bra innsats, ${f.name}. Det ble tap denne gangen, men det er mye å ta med seg.`);
  } else {
    parts.push(`Her er en gjennomgang av partiet ditt, ${f.name}.`);
  }

  // Accuracy + good moves.
  parts.push(
    `Du spilte ${nb(f.totalMoves, "trekk", "trekk")} med en nøyaktighet på rundt ${f.accuracy} %, og ${nb(f.goodOrBest, "av dem var solid", "av dem var solide")}.`,
  );

  // Coaching on errors — gentle, concrete.
  if (f.blunders === 0 && f.mistakes === 0 && f.missedMates === 0) {
    parts.push("Du holdt hodet kaldt og unngikk de store feilene. Det er imponerende stabilt!");
  } else {
    const errBits: string[] = [];
    if (f.blunders > 0) errBits.push(nb(f.blunders, "tabbe", "tabber"));
    if (f.mistakes > 0) errBits.push(nb(f.mistakes, "feil", "feil"));
    if (f.inaccuracies > 0) errBits.push(nb(f.inaccuracies, "unøyaktighet", "unøyaktigheter"));
    if (errBits.length > 0) {
      parts.push(`Underveis snek det seg inn ${errBits.join(", ")} — helt vanlig, og akkurat her ligger det mest å lære.`);
    }
    if (f.missedMates > 0) {
      parts.push(`Du hadde matt på brettet ${nb(f.missedMates, "gang", "ganger")} uten å sette den — øv på å se de avgjørende trekkene til slutt.`);
    }
  }

  // Concrete teaching moment.
  if (f.worstMove && (f.worstMove.tag === "blunder" || f.worstMove.tag === "mistake" || f.worstMove.tag === "missed_mate")) {
    parts.push(`Se spesielt på trekk ${f.worstMove.moveNumber} (${f.worstMove.san}) — gå gjennom det i reprisen og se om du finner et bedre alternativ.`);
  }

  // Encouraging close.
  parts.push("Stå på videre — hvert parti gjør deg litt skarpere. Lykke til i neste runde!");

  return parts.join(" ");
}
