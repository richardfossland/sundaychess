"use client";

import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import type { CSSProperties } from "react";
import dynamic from "next/dynamic";
import type { PieceDropHandlerArgs, SquareHandlerArgs } from "react-chessboard";
import { BOARD_BASE_OPTIONS } from "@/lib/client/boardOptions";

/**
 * L5: the player's board, insulated from its parent's re-renders.
 *
 * WHY THIS EXISTS
 * ---------------
 * `react-chessboard` v5 builds its context provider value as a plain object
 * literal (`node_modules/react-chessboard/dist/index.js`, ~5190) — it is a new
 * object on every render of `<Chessboard>`. Its `Square` and `Piece` are
 * `React.memo`'d, but they are context CONSUMERS, so that fresh value defeats
 * the memo: one `<Chessboard>` render = 64 squares + every piece re-rendered.
 * On a Chromebook in a 25-device class, GameView was doing that roughly every
 * 1–2 s while nothing on the board had changed.
 *
 * So the board must not re-render unless something the board DISPLAYS changed.
 * The value props (`id`, `fen`, `orientation`, `allowDragging`, `stylesKey`)
 * are compared by value; the handler props are deliberately IGNORED, because
 * GameView memoizes none of them (`tryMove`'s dependency list is unchanged by
 * this PR) and never will — a memoized move handler is exactly the risk the
 * previous owner refused to take.
 *
 * WHY IGNORING HANDLER IDENTITY IS SAFE
 * -------------------------------------
 * The handlers are routed through refs, updated in an effect after every
 * render (the latest-ref pattern from `lib/client/useChannel.ts`). A ref only
 * refreshes when THIS component renders — i.e. when one of the compared props
 * changed — so the argument that must hold is:
 *
 *   every piece of GameView state the handlers read is a function of the
 *   compared props.
 *
 * Handler by handler, `onDrop` / `onSquareClick` / `tryMove` read exactly:
 *
 *   fen        → the `fen` prop.
 *   status     → `allowDragging` (`!ended`) AND `stylesKey`, which ends in the
 *                full status string, so ANY status change changes a prop.
 *   myColor /
 *   myTurnLetter → the `orientation` prop.
 *   turn       → determined by `fen`: every `setTurn` in GameView is paired
 *                with the `setFen` of the very FEN it was read from (load,
 *                broadcast, optimistic apply, reconcile, rollback), and a
 *                FEN's second field IS the side to move. Same FEN ⇒ same turn.
 *   isMyTurn   → f(status, turn, myTurnLetter) ⇒ f(props).
 *   selected   → in `stylesKey`.
 *   legal      → in `stylesKey` (joined).
 *   preMove    → in `stylesKey` (only WRITTEN by the handlers, never read).
 *   pending    → not a prop, and it does not need to be. The dangerous
 *                direction is a stale `pending: false` letting a second move
 *                through: impossible, because `setPending(true)` is always
 *                preceded in the same batch by `setFen(local.fen)` with a
 *                genuinely different FEN (a legal move always changes it), so
 *                the board re-renders and the ref refreshes. The other
 *                direction (stale `true` after `setPending(false)` released it
 *                on an unchanged position) can only be reached with the turn
 *                already flipped away — `isMyTurn` false in that same stale
 *                closure — where `tryMove` is never called at all.
 *   gameId,
 *   me.playerId,
 *   me.resumeCode → stable for the component's lifetime (`me` is set once, in
 *                app/play/page.tsx). `gameId` can be swapped under a mounted
 *                GameView when the host starts the next round before the
 *                student dismisses the result screen — but only ever while the
 *                old game is FINISHED, and every handler path is inert then
 *                (`allowDragging` false, `isMyTurn` false, `onSquareClick`
 *                returns early on `status !== "live"`). The new game's
 *                `load()` then changes `fen` and refreshes the refs.
 *
 * And `squareStyles` cannot drift from `stylesKey`: GameView derives both from
 * the same tuple in the same render.
 *
 * Note what this does NOT touch: the pre-move effect and the promotion picker
 * call `tryMove` directly from GameView, never through a ref, so they always
 * run the freshest closure — exactly as today.
 */

// DnD board: render client-only to avoid SSR/window issues.
const Chessboard = dynamic(
  () => import("react-chessboard").then((m) => m.Chessboard),
  { ssr: false },
);

export interface PlayBoardProps {
  /** react-chessboard instance id (also the DOM id root). */
  id: string;
  fen: string;
  orientation: "white" | "black";
  allowDragging: boolean;
  /** Highlight styles for this render. Its identity is ignored — `stylesKey`
   * is the thing compared — so it must be derived from exactly the same tuple
   * `stylesKey` is. */
  squareStyles: Record<string, CSSProperties>;
  /** Cheap digest of everything `squareStyles` is built from, so the memo
   * comparison is six string/boolean compares instead of a deep object walk. */
  stylesKey: string;
  onDrop: (args: PieceDropHandlerArgs) => boolean;
  onSquareClick: (args: SquareHandlerArgs) => void;
}

/** Props comparison for the `memo` below. Compares only what the board
 * DISPLAYS; `onDrop`/`onSquareClick` identity is ignored on purpose (see the
 * correctness argument in the file header). Exported for `test/playBoard.test.ts`. */
export function arePropsEqual(
  prev: Readonly<PlayBoardProps>,
  next: Readonly<PlayBoardProps>,
): boolean {
  return (
    prev.id === next.id &&
    prev.fen === next.fen &&
    prev.orientation === next.orientation &&
    prev.allowDragging === next.allowDragging &&
    prev.stylesKey === next.stylesKey
  );
}

export const PlayBoard = memo(function PlayBoard({
  id,
  fen,
  orientation,
  allowDragging,
  squareStyles,
  onDrop,
  onSquareClick,
}: PlayBoardProps) {
  // Latest-ref pattern (see lib/client/useChannel.ts): the trampolines below
  // are stable for the life of the component, so a new handler closure never
  // busts the `options` memo — but they always CALL the newest closure this
  // component has committed with.
  const dropRef = useRef(onDrop);
  const clickRef = useRef(onSquareClick);
  useEffect(() => {
    dropRef.current = onDrop;
    clickRef.current = onSquareClick;
  });

  const handleDrop = useCallback(
    (args: PieceDropHandlerArgs) => dropRef.current(args),
    [],
  );
  const handleSquareClick = useCallback(
    (args: SquareHandlerArgs) => clickRef.current(args),
    [],
  );

  // One options object per real change. Without this, `<Chessboard>` would get
  // a fresh literal on every render of THIS component too, and the parent's
  // memo would only have moved the churn one level down.
  const options = useMemo(
    () => ({
      ...BOARD_BASE_OPTIONS,
      position: fen || undefined,
      boardOrientation: orientation,
      allowDragging,
      onPieceDrop: handleDrop,
      onSquareClick: handleSquareClick,
      squareStyles,
      id,
    }),
    [fen, orientation, allowDragging, squareStyles, id, handleDrop, handleSquareClick],
  );

  return <Chessboard options={options} />;
}, arePropsEqual);
