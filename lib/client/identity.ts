"use client";

// Local persistence of bearer identities for crash-recovery (spec §2). Only the
// resume/host code lives here — never authoritative game state, which is always
// refetched from the server on mount.

import { INITIAL_RATING, clampSkill, type RatingState } from "@/lib/chess/skill";
import { safeGet, safeRemove, safeSet } from "@/lib/client/storage";

const HOST_KEY = (id: string) => `sjakk:host:${id}`;
const PLAYER_KEY = "sjakk:player"; // single active student session per browser
const SOLO_RATING_KEY = "sjakk:solo-rating"; // adaptive single-player rating

export interface StoredPlayer {
  tournamentId: string;
  playerId: string;
  resumeCode: string;
  displayName: string;
}

export const identity = {
  saveHostCode(tournamentId: string, hostCode: string) {
    // Persistence lost (private mode / quota / blocked storage) → crash-recovery
    // won't work for this device. Surface it instead of failing silently.
    if (!safeSet(HOST_KEY(tournamentId), hostCode)) {
      console.warn("[identity] localStorage write failed");
    }
  },
  hostCode(tournamentId: string): string | null {
    return safeGet(HOST_KEY(tournamentId));
  },
  savePlayer(p: StoredPlayer) {
    // Persistence lost (private mode / quota / blocked storage) → crash-recovery
    // won't work for this device. Surface it instead of failing silently.
    if (!safeSet(PLAYER_KEY, JSON.stringify(p))) {
      console.warn("[identity] localStorage write failed");
    }
  },
  player(): StoredPlayer | null {
    const raw = safeGet(PLAYER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredPlayer;
    } catch {
      return null;
    }
  },
  clearPlayer() {
    // Persistence lost (private mode / quota / blocked storage) → crash-recovery
    // won't work for this device. Surface it instead of failing silently.
    if (!safeRemove(PLAYER_KEY)) {
      console.warn("[identity] localStorage write failed");
    }
  },

  /** The device's adaptive single-player rating (Elo-like). Client-only; never
   *  authoritative and never sent to the server. Falls back to the initial
   *  rating if absent or corrupt. */
  soloRating(): RatingState {
    const raw = safeGet(SOLO_RATING_KEY);
    if (!raw) return { ...INITIAL_RATING };
    try {
      const parsed = JSON.parse(raw) as Partial<RatingState>;
      const rating = clampSkill(Number(parsed.rating));
      const games = Number.isFinite(parsed.games) ? Math.max(0, Math.floor(parsed.games as number)) : 0;
      return { rating, games };
    } catch {
      return { ...INITIAL_RATING };
    }
  },
  saveSoloRating(state: RatingState) {
    // Persistence lost (private mode / quota / blocked storage) → crash-recovery
    // won't work for this device. Surface it instead of failing silently.
    if (!safeSet(SOLO_RATING_KEY, JSON.stringify(state))) {
      console.warn("[identity] localStorage write failed");
    }
  },
};
