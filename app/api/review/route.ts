import { getGame, getPlayer } from "@/lib/server/store";
import { authPlayer } from "@/lib/server/auth";
import { clientIp, fail, ok, rateLimit, readJson } from "@/lib/server/http";
import { annotateGame } from "@/lib/chess/analysis";
import { reviewFacts, templatedSummaryNo } from "@/lib/chess/reviewSummary";
import { narrateReview } from "@/lib/server/llm";

// POST /api/review — coached post-game review for ONE finished game, from the
// requesting player's side. ALL chess truth is engine-derived here on the
// server (annotateGame replays the stored PGN); the LLM, if a key is present,
// only narrates the resulting facts into a warm Norwegian paragraph. With no
// key (or any LLM failure) we fall back to a templated Norwegian summary, so
// the feature degrades gracefully and never blocks.
export async function POST(req: Request) {
  const body = await readJson<{
    playerId?: string;
    resumeCode?: string;
    gameId?: string;
  }>(req);
  if (!body) return fail(400, "bad_request");

  // Per-player key (classroom shares one NAT IP). Tight cap — narration is the
  // only cost and it must not be spammable.
  if (!rateLimit(`review:${clientIp(req)}:${body.playerId ?? "anon"}`, 20, 60_000)) {
    return fail(429, "rate_limited");
  }

  const player = await authPlayer(body.playerId, body.resumeCode);
  if (!player) return fail(401, "unauthorized");
  if (!body.gameId) return fail(400, "bad_request");

  const game = await getGame(body.gameId);
  if (!game) return fail(404, "no_game");
  if (game.tournament_id !== player.tournament_id) return fail(403, "forbidden");

  // Only the two players in the game may review it, and only once it's decided.
  const isWhite = game.white_player_id === player.id;
  const isBlack = game.black_player_id === player.id;
  if (!isWhite && !isBlack) return fail(403, "not_your_game");
  if (game.status !== "white_win" && game.status !== "black_win" && game.status !== "draw") {
    return fail(409, "not_finished");
  }

  const [white, black] = await Promise.all([
    getPlayer(game.white_player_id),
    game.black_player_id ? getPlayer(game.black_player_id) : Promise.resolve(null),
  ]);

  // Engine truth: replay the PGN and tag every move. No PGN / unreplayable
  // (e.g. teacher-overridden with no moves) → nothing to coach.
  const review = annotateGame(
    game.pgn,
    white?.display_name ?? "Hvit",
    black?.display_name ?? "Svart",
  );
  if (!review) return fail(409, "no_moves");

  const side = isWhite ? review.white : review.black;
  const facts = reviewFacts(side, review.result);

  // Templated Norwegian summary is the deterministic baseline + keyless fallback.
  const fallback = templatedSummaryNo(facts);
  // LLM only narrates; null (no key / failure / refusal) → use the fallback.
  const narrated = await narrateReview(facts);

  return ok({
    summary: narrated ?? fallback,
    aiNarrated: narrated != null,
    facts,
    moves: side.moves,
  });
}
