import "server-only";

// Anthropic seam for the coached post-game review. The LLM ONLY narrates;
// every chess fact is engine-derived (lib/chess/analysis.ts) and passed in as
// structured ReviewFacts. The model turns those numbers into a warm Norwegian
// coaching paragraph — it never sees the board, never decides legality, and its
// output is sanitized to a single plain-text string before it reaches the app.
//
// KEYLESS by design: getLlmClient(env) returns null when ANTHROPIC_API_KEY is
// absent, and the route falls back to the templated Norwegian summary
// (lib/chess/reviewSummary.ts). The request-builder and response-parser below
// are PURE (no network, no env) so they can be unit-tested with canned
// fixtures and no key.
//
// This is the repo's FIRST LLM integration; there is no SDK dependency and the
// app runs on Cloudflare Workers (OpenNext), so we call the Messages API over
// plain fetch rather than pull in @anthropic-ai/sdk. The key is read from the
// server env only (process.env on a Worker → wrangler secret), never shipped to
// the browser.

import type { ReviewFacts } from "@/lib/chess/reviewSummary";

// Match the current Opus. The repo has no existing Anthropic constant, so this
// is the canonical id from the claude-api guidance.
export const REVIEW_MODEL = "claude-opus-4-8";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_TOKENS = 600;
// Hard cap on the narration call so a hung Anthropic request can never stall the
// review response on a Worker — on timeout we just fall back to the template.
const NARRATE_TIMEOUT_MS = 12_000;
// Hard ceiling on the narrated paragraph after sanitizing — defence in depth so
// a misbehaving model can never flood the UI.
const MAX_SUMMARY_CHARS = 1200;

export interface LlmClient {
  apiKey: string;
}

/**
 * Return an LLM client iff an API key is configured, else null. Mirrors the
 * "getLlmClient(env) → null without key" pattern: callers MUST handle null and
 * fall back to the templated summary. Pure given its env argument.
 */
export function getLlmClient(
  env: { ANTHROPIC_API_KEY?: string } = process.env as { ANTHROPIC_API_KEY?: string },
): LlmClient | null {
  const key = env.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;
  return { apiKey: key };
}

/** Shape of an Anthropic Messages API request body (the subset we send). */
export interface MessagesRequest {
  model: string;
  max_tokens: number;
  system: string;
  messages: { role: "user"; content: string }[];
}

/** Build the system prompt — Norwegian, church/community tone, narrate-only. */
export function buildSystemPrompt(): string {
  return [
    "Du er en varm, oppmuntrende sjakktrener for en menighets sjakkettermiddag.",
    "Du får FERDIG ANALYSERTE fakta om et parti (alle tall kommer fra en sjakkmotor).",
    "Oppgaven din er KUN å formulere en kort, vennlig oppsummering på norsk (bokmål)",
    "basert på disse fakta — du skal IKKE finne på nye trekk, vurderinger eller tall,",
    "og ALDRI motsi tallene du får. Hold tonen snill og folkelig, aldri hard.",
    "Skriv 2–4 setninger i ett avsnitt. Ingen overskrifter, ingen punktlister,",
    "ingen emoji-spam (maks én emoji). Henvend deg direkte til spilleren.",
    "Avslutt med litt oppmuntring til neste parti.",
  ].join(" ");
}

/** Render the engine facts into a compact, model-friendly fact sheet. */
function factSheet(f: ReviewFacts): string {
  const outcome =
    f.outcome === "won"
      ? "vant"
      : f.outcome === "lost"
        ? "tapte"
        : f.outcome === "draw"
          ? "remis"
          : "ukjent resultat";
  const lines = [
    `Spiller: ${f.name} (spilte ${f.colorNo})`,
    `Resultat: ${outcome}`,
    `Antall trekk: ${f.totalMoves}`,
    `Gode/beste trekk: ${f.goodOrBest}`,
    `Unøyaktigheter: ${f.inaccuracies}`,
    `Feil: ${f.mistakes}`,
    `Tabber: ${f.blunders}`,
    `Oversette matt-sjanser: ${f.missedMates}`,
    `Satte matt selv: ${f.deliveredMate ? "ja" : "nei"}`,
    `Nøyaktighet (0-100): ${f.accuracy}`,
  ];
  if (f.worstMove) {
    lines.push(`Verste trekk: nr ${f.worstMove.moveNumber} (${f.worstMove.san})`);
  }
  return lines.join("\n");
}

/**
 * Build the full Messages API request from engine facts. PURE — no network,
 * no key. This is the primary unit-tested surface.
 */
export function buildReviewRequest(facts: ReviewFacts): MessagesRequest {
  return {
    model: REVIEW_MODEL,
    max_tokens: MAX_TOKENS,
    system: buildSystemPrompt(),
    messages: [
      {
        role: "user",
        content:
          "Her er motoranalysen av partiet. Skriv den vennlige oppsummeringen på norsk:\n\n" +
          factSheet(facts),
      },
    ],
  };
}

/**
 * Parse + sanitize an Anthropic Messages API response into a single plain-text
 * Norwegian paragraph, or null if the response is unusable (refusal, empty,
 * wrong shape). PURE — give it the already-parsed JSON. Callers fall back to
 * the templated summary on null.
 *
 * Sanitizing: concatenate text blocks, strip control chars, collapse
 * whitespace, and clamp length. The result NEVER touches game state — it is
 * display-only narration.
 */
export function parseReviewResponse(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const obj = json as {
    stop_reason?: string;
    content?: { type?: string; text?: string }[];
  };
  // A safety refusal yields no usable narration — fall back.
  if (obj.stop_reason === "refusal") return null;
  if (!Array.isArray(obj.content)) return null;

  const text = obj.content
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("")
    // strip control chars except tab/newline/carriage-return
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .trim();

  if (!text) return null;
  return text.length > MAX_SUMMARY_CHARS
    ? text.slice(0, MAX_SUMMARY_CHARS).trimEnd() + "…"
    : text;
}

/**
 * Call the Anthropic Messages API to narrate the engine facts. Returns the
 * sanitized paragraph, or null on ANY failure (no key, network error, non-OK
 * status, bad shape, refusal) so the caller can fall back cleanly. Never
 * throws.
 */
export async function narrateReview(
  facts: ReviewFacts,
  env: { ANTHROPIC_API_KEY?: string } = process.env as { ANTHROPIC_API_KEY?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const client = getLlmClient(env);
  if (!client) return null;

  const body = buildReviewRequest(facts);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), NARRATE_TIMEOUT_MS);
  try {
    const res = await fetchImpl(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": client.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    return parseReviewResponse(json);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
