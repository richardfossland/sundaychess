import { describe, expect, it } from "vitest";
import {
  DEFAULT_SKILL,
  INITIAL_RATING,
  MAX_SKILL,
  MIN_SKILL,
  botSkillForPlayer,
  clampSkill,
  expectedScore,
  kFactor,
  outcomeToScore,
  skillToParams,
  updateRating,
  type RatingState,
} from "@/lib/chess/skill";

describe("clampSkill", () => {
  it("clamps below and above the range", () => {
    expect(clampSkill(0)).toBe(MIN_SKILL);
    expect(clampSkill(9999)).toBe(MAX_SKILL);
  });
  it("leaves in-range values untouched", () => {
    expect(clampSkill(1000)).toBe(1000);
  });
  it("falls back to default on NaN/Infinity", () => {
    expect(clampSkill(NaN)).toBe(DEFAULT_SKILL);
    expect(clampSkill(Infinity)).toBe(DEFAULT_SKILL);
  });
});

describe("skillToParams", () => {
  it("is monotonic: noise and blunder-prob fall as skill rises", () => {
    const lo = skillToParams(MIN_SKILL);
    const mid = skillToParams(1000);
    const hi = skillToParams(MAX_SKILL);
    expect(lo.noise).toBeGreaterThan(mid.noise);
    expect(mid.noise).toBeGreaterThan(hi.noise);
    expect(lo.randomMoveProb).toBeGreaterThan(mid.randomMoveProb);
    expect(hi.randomMoveProb).toBe(0);
  });

  it("depth increases (weakly) with skill, always >= 1", () => {
    const depths = [400, 700, 1100, 1600, 2000].map((s) => skillToParams(s).depth);
    for (let i = 1; i < depths.length; i++) {
      expect(depths[i]).toBeGreaterThanOrEqual(depths[i - 1]);
    }
    expect(Math.min(...depths)).toBeGreaterThanOrEqual(1);
  });

  it("clamps out-of-range skill before mapping", () => {
    expect(skillToParams(-500)).toEqual(skillToParams(MIN_SKILL));
    expect(skillToParams(99999)).toEqual(skillToParams(MAX_SKILL));
  });

  it("beginner has real noise and a meaningful blunder rate", () => {
    const p = skillToParams(MIN_SKILL);
    expect(p.depth).toBe(1);
    expect(p.noise).toBeGreaterThan(50);
    expect(p.randomMoveProb).toBeGreaterThan(0.2);
  });

  it("top skill is near-deterministic (tiny noise, no blunders)", () => {
    const p = skillToParams(MAX_SKILL);
    expect(p.randomMoveProb).toBe(0);
    expect(p.noise).toBeLessThan(15);
    expect(p.depth).toBeGreaterThanOrEqual(3);
  });
});

describe("expectedScore", () => {
  it("is 0.5 for equal ratings", () => {
    expect(expectedScore(1200, 1200)).toBeCloseTo(0.5, 6);
  });
  it("favors the higher-rated player", () => {
    expect(expectedScore(1600, 1200)).toBeGreaterThan(0.5);
    expect(expectedScore(1200, 1600)).toBeLessThan(0.5);
  });
  it("is symmetric (probabilities sum to 1)", () => {
    expect(expectedScore(1500, 1300) + expectedScore(1300, 1500)).toBeCloseTo(1, 6);
  });
  it("400-point gap is the classic ~10:1 odds", () => {
    expect(expectedScore(1600, 1200)).toBeCloseTo(10 / 11, 4);
  });
});

describe("kFactor", () => {
  it("decreases as games accumulate", () => {
    expect(kFactor(0)).toBeGreaterThan(kFactor(10));
    expect(kFactor(10)).toBeGreaterThan(kFactor(50));
  });
});

describe("outcomeToScore", () => {
  it("maps outcomes to Elo scores", () => {
    expect(outcomeToScore("win")).toBe(1);
    expect(outcomeToScore("draw")).toBe(0.5);
    expect(outcomeToScore("loss")).toBe(0);
  });
});

describe("updateRating", () => {
  const even: RatingState = { rating: 1000, games: 20 }; // bot mirrors player

  it("a win against an equal opponent raises the rating", () => {
    const next = updateRating(even, 1000, 1);
    expect(next.rating).toBeGreaterThan(even.rating);
    expect(next.games).toBe(21);
  });

  it("a loss against an equal opponent lowers the rating", () => {
    const next = updateRating(even, 1000, 0);
    expect(next.rating).toBeLessThan(even.rating);
  });

  it("a draw against an equal opponent is roughly neutral", () => {
    expect(updateRating(even, 1000, 0.5).rating).toBe(1000);
  });

  it("a win/loss against an equal opponent is symmetric in magnitude", () => {
    const up = updateRating(even, 1000, 1).rating - even.rating;
    const down = even.rating - updateRating(even, 1000, 0).rating;
    expect(up).toBe(down);
  });

  it("never exceeds the skill range", () => {
    let s: RatingState = { rating: MAX_SKILL, games: 100 };
    for (let i = 0; i < 50; i++) s = updateRating(s, MAX_SKILL, 1);
    expect(s.rating).toBeLessThanOrEqual(MAX_SKILL);

    let lo: RatingState = { rating: MIN_SKILL, games: 100 };
    for (let i = 0; i < 50; i++) lo = updateRating(lo, MIN_SKILL, 0);
    expect(lo.rating).toBeGreaterThanOrEqual(MIN_SKILL);
  });

  it("calibrates faster early (bigger K) than later", () => {
    const early = updateRating({ rating: 1000, games: 0 }, 1000, 1).rating - 1000;
    const late = updateRating({ rating: 1000, games: 30 }, 1000, 1).rating - 1000;
    expect(early).toBeGreaterThan(late);
  });

  it("converges toward an even matchup: a player who wins half their games drifts back to the bot rating", () => {
    // Bot always mirrors the player's rating before each game; player scores
    // exactly 50% (alternating W/L). Rating should hover near the start.
    let s: RatingState = { ...INITIAL_RATING };
    for (let i = 0; i < 40; i++) {
      const bot = botSkillForPlayer(s);
      s = updateRating(s, bot, i % 2 === 0 ? 1 : 0);
    }
    // Equal score against an ever-matching opponent ⇒ stays close to default.
    expect(Math.abs(s.rating - DEFAULT_SKILL)).toBeLessThan(60);
  });

  it("a consistently winning player climbs, then the matching bot reins it in", () => {
    let s: RatingState = { ...INITIAL_RATING };
    for (let i = 0; i < 10; i++) s = updateRating(s, botSkillForPlayer(s), 1);
    // Climbed above default but capped by the range.
    expect(s.rating).toBeGreaterThan(DEFAULT_SKILL);
    expect(s.rating).toBeLessThanOrEqual(MAX_SKILL);
  });
});

describe("botSkillForPlayer", () => {
  it("mirrors the player so the expected score is ~50%", () => {
    const state: RatingState = { rating: 1234, games: 10 };
    const bot = botSkillForPlayer(state);
    expect(expectedScore(state.rating, bot)).toBeCloseTo(0.5, 6);
  });
});
