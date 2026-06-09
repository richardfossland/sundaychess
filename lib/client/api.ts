"use client";

// Thin typed fetch wrappers around the server API. All mutations go through
// these; the browser never touches the database directly.

import type { BoardState } from "@/lib/dto";

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
};
