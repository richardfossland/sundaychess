import { Chess } from "chess.js";

/** Derive the last move's {from,to,san} from a PGN, for board highlighting on
 * reconnect. Returns null for an empty / unparseable PGN. */
export function lastMoveFromPgn(
  pgn: string,
): { from: string; to: string; san: string } | null {
  if (!pgn || pgn.trim().length === 0) return null;
  try {
    const chess = new Chess();
    chess.loadPgn(pgn);
    const hist = chess.history({ verbose: true });
    const last = hist[hist.length - 1] as
      | { from: string; to: string; san: string }
      | undefined;
    return last ? { from: last.from, to: last.to, san: last.san } : null;
  } catch {
    return null;
  }
}

/** L8: cheap digest of a last-move pair for a `<PlayBoard>` `stylesKey` — the
 * spectate board's squareStyles depend on exactly this pair (see
 * app/host/[tournamentId]/SpectateGame.tsx), so deriving the key from the same
 * `{from,to}` in the same render is what makes them impossible to drift apart
 * — the same discipline GameView follows for its own stylesKey (see the
 * header of lib/client/PlayBoard.tsx). */
export function lastMoveStylesKey(
  lastMove: { from: string; to: string } | null,
): string {
  return `${lastMove?.from ?? ""}|${lastMove?.to ?? ""}`;
}
