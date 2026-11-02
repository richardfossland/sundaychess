"use client";

import { useEffect, useRef } from "react";
import { no } from "@/lib/locale/no";
import { boardKeysId, focusBoardKeys } from "@/lib/client/BoardKeys";

/**
 * E3: «Bekreft / Angre» for et foreløpig trekk. Fokus flytter til Bekreft når
 * linja dukker opp (kun hvis fokus lå i brettets tastaturrutenett), og tilbake til brettet etter valget, slik at en
 * tastaturspiller aldri mister plassen sin. Fokus flyttes bare hvis det faktisk
 * lå i linja, så en mus- eller touchspiller får ingen overraskelser.
 */
export function MoveConfirmBar({
  boardId,
  text,
  onConfirm,
  onCancel,
}: {
  /** `id` på brettet (BoardKeys), som får fokus tilbake. */
  boardId: string;
  /** Trekket på norsk («Hvit springer til f3»). */
  text: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const root = useRef<HTMLDivElement | null>(null);
  const confirmBtn = useRef<HTMLButtonElement | null>(null);

  // Bare en tastaturspiller (fokus lå i brettets rutenett da trekket ble lagt
  // inn) får fokus flyttet til Bekreft. Mus/touch-spillere og alle andre får
  // ikke fokus stjålet fra det de holder på med.
  useEffect(() => {
    const grid = document.getElementById(boardKeysId(boardId));
    if (grid && grid.contains(document.activeElement)) {
      confirmBtn.current?.focus({ preventScroll: true });
    }
  }, [boardId]);

  const settle = (act: () => void) => {
    const hadFocus = !!root.current && root.current.contains(document.activeElement);
    act();
    if (hadFocus) requestAnimationFrame(() => focusBoardKeys(boardId));
  };

  return (
    <div
      ref={root}
      className="move-confirm"
      role="group"
      aria-label={no.a11y.pendingLabel}
      data-testid="move-confirm"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          settle(onCancel);
        }
      }}
    >
      <span className="move-confirm-text">{no.a11y.pendingMove(text)}</span>
      <div className="move-confirm-btns">
        <button
          ref={confirmBtn}
          type="button"
          className="btn btn-primary"
          onClick={() => settle(onConfirm)}
        >
          {no.a11y.confirm}
        </button>
        <button type="button" className="btn" onClick={() => settle(onCancel)}>
          {no.a11y.undo}
        </button>
      </div>
    </div>
  );
}
