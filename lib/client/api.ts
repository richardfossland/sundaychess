"use client";

// Thin typed fetch wrappers around the server API. All mutations go through
// these; the browser never touches the database directly.

import type { BoardState, GameDetail, ReviewResult } from "@/lib/dto";
import type { GameStatus, Turn } from "@/lib/types";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public payload: unknown,
  ) {
    super(code);
  }
}

const DEFAULT_TIMEOUT = 8000;

/** fetch with a hard timeout — a hung request must never freeze the UI. On
 * timeout/abort or a network failure it throws ApiError(0, "timeout"|"network")
 * so callers always settle (releases optimistic locks, falls back gracefully). */
async function timedFetch(url: string, init: RequestInit, timeoutMs = DEFAULT_TIMEOUT): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === "AbortError";
    throw new ApiError(0, aborted ? "timeout" : "network", null);
  } finally {
    clearTimeout(t);
  }
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await timedFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data?.error ?? "error", data);
  return data as T;
}

async function getJson<T>(url: string, code: string): Promise<T> {
  const res = await timedFetch(url, { cache: "no-store" });
  if (!res.ok) throw new ApiError(res.status, code, null);
  return (await res.json()) as T;
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

  createDuel: (body: {
    name: string;
    bestOf: number;
    clockSec: number | null;
    variant: string;
  }) =>
    post<{
      tournamentId: string;
      joinPin: string;
      playerId: string;
      resumeCode: string;
      displayName: string;
    }>("/api/duel", body),

  joinDuel: (pin: string, name: string) =>
    post<JoinResult>("/api/duel/join", { pin, name }),

  resume: (resumeCode: string, ref: { pin?: string; tournamentId?: string }) =>
    post<ResumeResult>("/api/resume", { resumeCode, ...ref }),

  board: (id: string) => getJson<BoardState>(`/api/tournament/${id}`, "board_failed"),

  game: (id: string) => getJson<GameDetail>(`/api/game/${id}`, "game_failed"),

  review: (gameId: string, playerId: string, resumeCode: string) =>
    post<ReviewResult>("/api/review", { gameId, playerId, resumeCode }),

  move: (args: {
    gameId: string;
    from: string;
    to: string;
    promotion?: string;
    playerId: string;
    resumeCode: string;
  }) =>
    post<{
      fen: string;
      turn: Turn;
      status: GameStatus;
      san: string;
      clock: { whiteMs: number; blackMs: number; turn: Turn; running: boolean } | null;
    }>("/api/move", args),

  claimTime: (gameId: string, playerId: string, resumeCode: string) =>
    post<{ status: GameStatus }>("/api/game/claim", {
      gameId,
      playerId,
      resumeCode,
    }),

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

  predict: (
    playerId: string,
    resumeCode: string,
    gameId: string,
    predicted: "white" | "black" | "draw",
  ) =>
    post<{ predicted: string }>("/api/predict", {
      playerId,
      resumeCode,
      gameId,
      predicted,
      action: "tip",
    }),

  myPredictions: (playerId: string, resumeCode: string) =>
    post<{ predictions: Record<string, "white" | "black" | "draw"> }>(
      "/api/predict",
      { playerId, resumeCode, action: "list" },
    ),

  // ---- teacher actions (authenticated by host code) ----
  startRound: (tournamentId: string, hostCode: string) =>
    post<{ status: string }>("/api/round/start", { tournamentId, hostCode }),

  advanceRound: (tournamentId: string, hostCode: string) =>
    post<{ status: string }>("/api/round/advance", { tournamentId, hostCode }),

  forceResolve: (tournamentId: string, hostCode: string) =>
    post<{ ok: boolean }>("/api/round/force", { tournamentId, hostCode }),

  extendRound: (tournamentId: string, hostCode: string) =>
    post<{ extendedMs: number | null }>("/api/round/extend", { tournamentId, hostCode }),

  override: (gameId: string, hostCode: string, result: GameStatus) =>
    post<{ status: GameStatus }>("/api/game/override", {
      gameId,
      hostCode,
      result,
    }),

  absent: (
    gameId: string,
    hostCode: string,
    absentPlayerId: string,
    scope: "round" | "tournament",
  ) =>
    post<{ status: GameStatus }>("/api/game/absent", {
      gameId,
      hostCode,
      absentPlayerId,
      scope,
    }),

  codes: (tournamentId: string, hostCode: string) =>
    post<{ players: { playerId: string; name: string; resumeCode: string }[] }>(
      `/api/tournament/${tournamentId}/codes`,
      { hostCode },
    ),
};
