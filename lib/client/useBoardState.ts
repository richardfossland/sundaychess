"use client";

import { useCallback, useEffect, useState } from "react";
import type { BoardState } from "@/lib/dto";
import { api } from "@/lib/client/api";
import { channels } from "@/lib/realtime";
import { useChannel } from "@/lib/client/useChannel";

/** Fetch authoritative board state on mount, keep it fresh by refetching on any
 * lobby-channel event, and expose a manual refresh. Used by both the host board
 * and the student client (reads are public — no secrets in board state). */
export function useBoardState(tournamentId: string | null) {
  const [state, setState] = useState<BoardState | null>(null);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    if (!tournamentId) return;
    try {
      const next = await api.board(tournamentId);
      setState(next);
      setError(false);
    } catch {
      setError(true);
    }
  }, [tournamentId]);

  useEffect(() => {
    // Fetch-on-mount: setState happens asynchronously after the await, in the
    // fetch callback — the intended use of an effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  useChannel(tournamentId ? channels.lobby(tournamentId) : null, () => {
    refresh();
  });

  return { state, error, refresh };
}
