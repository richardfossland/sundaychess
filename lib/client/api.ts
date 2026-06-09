"use client";

// Thin typed fetch wrappers around the server API. All mutations go through
// these; the browser never touches the database directly.

import type { BoardState, GameDetail } from "@/lib/dto";
import type { GameStatus, Turn } from "@/lib/types";

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data?.error ?? "error", data);
  return data as T;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public payload: unknown,
  ) {
    super(code);
  }
}

export interface CreatedTournament {
  id: string;
  joinPin: string;
  hostCode: string;
}

export interface JoinResult {
  tournamentId: string;
  playerId: string;
  resumeCode: string;
  displayName: string;
}

export interface ResumeResult {
  tournamentId: string;
  playerId: string;
  displayName: string;
  tournamentStatus: string;
}

export const api = {
  createTournament: (body: { title?: string; config?: unknown }) =>
    post<CreatedTournament>("/api/tournament", body),

  openHost: (hostCode: string) =>
    post<{ id: string }>("/api/tournament/open", { hostCode }),

  join: (pin: string, displayName: string) =>
    post<JoinResult>("/api/join", { pin, displayName }),

  resume: (resumeCode: string, ref: { pin?: string; tournamentId?: string }) =>
    post<ResumeResult>("/api/resume", { resumeCode, ...ref }),

  board: async (id: string): Promise<BoardState> => {
    const res = await fetch(`/api/tournament/${id}`, { cache: "no-store" });
    if (!res.ok) throw new ApiError(res.status, "board_failed", null);
    return (await res.json()) as BoardState;
  },

  game: async (id: string): Promise<GameDetail> => {
    const res = await fetch(`/api/game/${id}`, { cache: "no-store" });
    if (!res.ok) throw new ApiError(res.status, "game_failed", null);
    return (await res.json()) as GameDetail;
  },

  move: (args: {
    gameId: string;
    from: string;
    to: string;
    promotion?: string;
    playerId: string;
    resumeCode: string;
  }) =>
    post<{ fen: string; turn: Turn; status: GameStatus; san: string }>(
      "/api/move",
      args,
    ),

  resign: (gameId: string, playerId: string, resumeCode: string) =>
    post<{ status: GameStatus }>("/api/game/resign", {
      gameId,
      playerId,
      resumeCode,
    }),

  draw: (
    gameId: string,
    playerId: string,
    resumeCode: string,
    action: "offer" | "accept" | "decline",
  ) => post<unknown>("/api/game/draw", { gameId, playerId, resumeCode, action }),

  // ---- teacher actions (authenticated by host code) ----
  startRound: (tournamentId: string, hostCode: string) =>
    post<{ status: string }>("/api/round/start", { tournamentId, hostCode }),

  advanceRound: (tournamentId: string, hostCode: string) =>
    post<{ status: string }>("/api/round/advance", { tournamentId, hostCode }),

  forceResolve: (tournamentId: string, hostCode: string) =>
    post<{ ok: boolean }>("/api/round/force", { tournamentId, hostCode }),

  override: (gameId: string, hostCode: string, result: GameStatus) =>
    post<{ status: GameStatus }>("/api/game/override", {
      gameId,
      hostCode,
      result,
    }),
};
