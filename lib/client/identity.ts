"use client";

// Local persistence of bearer identities for crash-recovery (spec §2). Only the
// resume/host code lives here — never authoritative game state, which is always
// refetched from the server on mount.

import { INITIAL_RATING, clampSkill, type RatingState } from "@/lib/chess/skill";

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
    try {
      localStorage.setItem(HOST_KEY(tournamentId), hostCode);
    } catch (e) {
      // Persistence lost (private mode / quota) → crash-recovery won't work for
      // this device. Surface it instead of failing silently.
      console.warn("[identity] localStorage write failed", e);
    }
  },
  hostCode(tournamentId: string): string | null {
    try {
      return localStorage.getItem(HOST_KEY(tournamentId));
    } catch {
      return null;
    }
  },
  savePlayer(p: StoredPlayer) {
    try {
      localStorage.setItem(PLAYER_KEY, JSON.stringify(p));
    } catch (e) {
      // Persistence lost (private mode / quota) → crash-recovery won't work for
      // this device. Surface it instead of failing silently.
      console.warn("[identity] localStorage write failed", e);
    }
  },
  player(): StoredPlayer | null {
    try {
      const raw = localStorage.getItem(PLAYER_KEY);
      return raw ? (JSON.parse(raw) as StoredPlayer) : null;
    } catch {
      return null;
    }
  },
  clearPlayer() {
    try {
      localStorage.removeItem(PLAYER_KEY);
    } catch (e) {
      // Persistence lost (private mode / quota) → crash-recovery won't work for
      // this device. Surface it instead of failing silently.
      console.warn("[identity] localStorage write failed", e);
    }
  },

  /** The device's adaptive single-player rating (Elo-like). Client-only; never
   *  authoritative and never sent to the server. Falls back to the initial
   *  rating if absent or corrupt. */
  soloRating(): RatingState {
    try {
      const raw = localStorage.getItem(SOLO_RATING_KEY);
      if (!raw) return { ...INITIAL_RATING };
      const parsed = JSON.parse(raw) as Partial<RatingState>;
      const rating = clampSkill(Number(parsed.rating));
      const games = Number.isFinite(parsed.games) ? Math.max(0, Math.floor(parsed.games as number)) : 0;
      return { rating, games };
    } catch {
      return { ...INITIAL_RATING };
    }
  },
  saveSoloRating(state: RatingState) {
    try {
      localStorage.setItem(SOLO_RATING_KEY, JSON.stringify(state));
    } catch (e) {
      // Persistence lost (private mode / quota) → crash-recovery won't work for
      // this device. Surface it instead of failing silently.
      console.warn("[identity] localStorage write failed", e);
    }
  },
};
