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
