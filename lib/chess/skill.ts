// Adaptive single-player difficulty. Two PURE, unit-tested concerns live here:
//
//   1. skill → (search depth, eval noise, random-move probability)
//      A single continuous `skill` value (≈ an Elo rating) drives how strong
//      the bot plays. Higher skill ⇒ deeper search, less noise, fewer random
//      blunders. The bot in lib/chess/bot.ts is already RNG-injectable, so we
//      only need to choose the knobs.
//
//   2. an Elo-style rating update so the bot auto-tunes toward ~50% win rate.
//      After each solo game the student's rating moves toward/away from the
//      bot's rating; the next game's bot skill is set to the (new) student
//      rating. Over a few games that converges on an even matchup.
//
// Everything here is deterministic given its inputs — no DOM, no storage, no
// RNG — so it is straightforward to test.

/** Inclusive bounds for a skill / rating value (Elo-like). */
export const MIN_SKILL = 400;
export const MAX_SKILL = 2000;
/** Where a brand-new player starts before any games are recorded. */
export const DEFAULT_SKILL = 800;

/** Tunable knobs the bot search consumes for one move. */
export interface BotParams {
  /** Negamax search depth in plies (≥ 1). */
  depth: number;
  /** Centipawns of uniform random noise added to each candidate's score.
   *  Large noise ⇒ the bot often prefers an objectively worse move. */
  noise: number;
  /** Probability in [0,1] of ignoring the search entirely and playing a
   *  uniformly random legal move (an outright blunder). */
  randomMoveProb: number;
}

/** Clamp any number into the skill range. */
export function clampSkill(skill: number): number {
  if (!Number.isFinite(skill)) return DEFAULT_SKILL;
  return Math.min(MAX_SKILL, Math.max(MIN_SKILL, skill));
}

/**
 * Map a continuous skill value to concrete search knobs.
 *
 * The mapping is monotonic: noise and blunder-probability fall as skill rises,
 * depth rises in steps. It is deliberately smooth so that small rating changes
 * after each game nudge strength gradually.
 */
export function skillToParams(skill: number): BotParams {
  const s = clampSkill(skill);
  // 0 at MIN_SKILL → 1 at MAX_SKILL.
  const t = (s - MIN_SKILL) / (MAX_SKILL - MIN_SKILL);

  // Depth: 1 ply at the bottom up to 3 plies at the top, in integer steps.
  // Thresholds picked so beginners face a 1-ply bot and only strong players
  // face the deeper search. Capped at 3: a 4-ply negamax at the opening can
  // take >5s on a low-power Chromebook tab (it ran the CI runner over its 5s
  // budget), which would freeze the student's browser — exactly the failure
  // mode we are hardening against. Strength above ~1300 is shaped by lower
  // noise/blunder-rate, not extra depth.
  let depth: number;
  if (s < 800) depth = 1;
  else if (s < 1300) depth = 2;
  else depth = 3;

  // Noise: ~120 cp of slop for a rank beginner fading toward ~6 cp (just
  // enough to vary play) for the strongest setting.
  const noise = Math.round(120 - 114 * t);

  // Random blunder probability: ~45% at the floor fading to 0 by mid-strength.
  const randomMoveProb = Math.max(0, 0.45 * (1 - t / 0.55));

  return { depth, noise, randomMoveProb };
}

// ---------------------------------------------------------------------------
// Elo rating update
// ---------------------------------------------------------------------------

/** A game result from the *player's* perspective. */
export type GameScore = 0 | 0.5 | 1; // loss / draw / win

/** Map an outcome string to an Elo score. */
export function outcomeToScore(outcome: "win" | "loss" | "draw"): GameScore {
  return outcome === "win" ? 1 : outcome === "draw" ? 0.5 : 0;
}

/**
 * Expected score for `playerRating` against `opponentRating` under the
 * standard logistic Elo curve. Returns a value in (0,1).
 */
export function expectedScore(playerRating: number, opponentRating: number): number {
  return 1 / (1 + 10 ** ((opponentRating - playerRating) / 400));
}

/**
 * K-factor: larger while a player has few games (fast calibration), settling
 * to a stable value once they have a track record. This is what makes the bot
 * converge quickly toward an even ~50% matchup for a new student.
 */
export function kFactor(gamesPlayed: number): number {
  if (gamesPlayed < 5) return 80;
  if (gamesPlayed < 15) return 48;
  return 32;
}

/** A persisted, evolving rating for one device identity. */
export interface RatingState {
  rating: number;
  games: number;
}

export const INITIAL_RATING: RatingState = { rating: DEFAULT_SKILL, games: 0 };

/**
 * Update a player's rating after one game against a bot of `opponentRating`.
 * Pure: returns a new RatingState, clamped to the skill range.
 */
export function updateRating(
  state: RatingState,
  opponentRating: number,
  score: GameScore,
): RatingState {
  const k = kFactor(state.games);
  const expected = expectedScore(state.rating, opponentRating);
  const next = state.rating + k * (score - expected);
  return { rating: Math.round(clampSkill(next)), games: state.games + 1 };
}

/**
 * The bot's skill for the next game given the player's current rating. The bot
 * mirrors the player (so the expected score is ~0.5), which is the auto-tune
 * toward a 50% win rate.
 */
export function botSkillForPlayer(state: RatingState): number {
  return clampSkill(state.rating);
}
