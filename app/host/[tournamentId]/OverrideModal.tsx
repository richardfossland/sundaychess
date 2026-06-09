"use client";

import { useState } from "react";
import { api } from "@/lib/client/api";
import { no } from "@/lib/locale/no";
import type { GameStatus } from "@/lib/types";

/** Teacher result-override dialog, shared by the league grid and the bracket. */
export function OverrideModal({
  gameId,
  hostCode,
  title,
  onClose,
  onDone,
  allowAbort = true,
}: {
  gameId: string;
  hostCode: string;
  title: string;
  onClose: () => void;
  onDone: () => void;
  allowAbort?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function set(result: GameStatus) {
    setBusy(true);
    setError(null);
    try {
      await api.override(gameId, hostCode, result);
      onDone();
    } catch {
      setError(no.common.error);
      setBusy(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "grid",
        placeItems: "center",
        padding: 20,
        zIndex: 50,
      }}
    >
      <div className="card card-narrow stack" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ fontSize: 20 }}>{no.host.overrideTitle}</h3>
        <p className="muted">{title}</p>
        <button className="btn btn-block" disabled={busy} onClick={() => set("white_win")}>
          {no.host.whiteWin}
        </button>
        <button className="btn btn-block" disabled={busy} onClick={() => set("black_win")}>
          {no.host.blackWin}
        </button>
        <button className="btn btn-block" disabled={busy} onClick={() => set("draw")}>
          {no.host.draw}
        </button>
        {allowAbort && (
          <button className="btn btn-danger btn-block" disabled={busy} onClick={() => set("aborted")}>
            {no.host.abort}
          </button>
        )}
        {error && <div className="banner banner-error">{error}</div>}
        <button className="btn btn-ghost btn-block" onClick={onClose}>
          {no.common.cancel}
        </button>
      </div>
    </div>
  );
}
