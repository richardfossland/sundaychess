import { narrateReview } from "@/lib/server/llm";
import { clientIp, fail, ok, rateLimit, readJson } from "@/lib/server/http";
import type { ReviewFacts } from "@/lib/chess/reviewSummary";

// POST /api/coach/narrate — AI narration for a SOLO coached-game review. Solo
// games live only in the browser, so the client computes the engine facts
// (annotateGame is pure) and posts them here purely to be turned into a warm
// Norwegian paragraph. Keyless → returns summary:null and the client falls back
// to its templated summary. Tightly rate-limited (narration is the only cost).
export async function POST(req: Request) {
  try {
    return await handlePost(req);
  } catch (err) {
    console.error("[coach/narrate]", err);
    return fail(503, "server_error");
  }
}

async function handlePost(req: Request): Promise<Response> {
  if (!rateLimit(`coach:${clientIp(req)}`, 30, 60_000)) {
    return fail(429, "rate_limited");
  }
  const facts = (await readJson<{ facts?: ReviewFacts }>(req))?.facts;
  if (!facts || typeof facts !== "object" || typeof facts.accuracy !== "number") {
    return fail(400, "bad_request");
  }
  // Clamp the only free-text fields so a client can't bloat the LLM prompt.
  const safe: ReviewFacts = {
    ...facts,
    name: String(facts.name ?? "").slice(0, 40),
    colorNo: String(facts.colorNo ?? "").slice(0, 12),
    worstMove: facts.worstMove
      ? { ...facts.worstMove, san: String(facts.worstMove.san ?? "").slice(0, 12) }
      : facts.worstMove,
  };
  const narrated = await narrateReview(safe);
  return ok({ summary: narrated, aiNarrated: narrated != null });
}
