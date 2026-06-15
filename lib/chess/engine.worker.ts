// Off-thread chess engine. Solo play posts a position here and gets back the
// bot's move, so even the strongest ("umulig") search never blocks the UI
// thread (which would freeze a low-power Chromebook tab). Pure compute — it
// imports only the bot/search modules (chess.js), never the DOM or React.

import {
  bestMove,
  bestMoveBySkill,
  bestMoveStrong,
  type BotLevel,
} from "@/lib/chess/bot";
import type { MoveIntent } from "@/lib/chess/validateMove";

type EngineRequest = { id: number; fen: string } & (
  | { mode: "skill"; skill: number }
  | { mode: "level"; level: BotLevel }
);

const ctx = self as unknown as {
  postMessage: (m: unknown) => void;
  addEventListener: (t: "message", cb: (e: MessageEvent) => void) => void;
};

ctx.addEventListener("message", async (e: MessageEvent) => {
  const req = e.data as EngineRequest;
  let move: MoveIntent | null = null;
  try {
    if (req.mode === "skill") {
      move = bestMoveBySkill(req.fen, req.skill);
    } else if (req.level === "impossible") {
      move = await bestMoveStrong(req.fen);
    } else {
      move = bestMove(req.fen, req.level);
    }
  } catch {
    move = null;
  }
  ctx.postMessage({ id: req.id, move });
});
