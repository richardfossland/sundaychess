// Off-thread chess engine. The main thread posts a position here and gets back
// the bot's move, the coach's advice for every legal move, or the position's
// evaluation — so no search of any kind ever runs on the UI thread (which would
// freeze a low-power Chromebook tab at the exact moment a piece is dropped).
//
// Deliberately a shim: the whole protocol lives in lib/chess/engineProtocol.ts
// so it is unit-testable in node. This file imports only pure compute modules
// (chess.js), never the DOM or React.

import { handleEngineRequest, type EngineRequest } from "@/lib/chess/engineProtocol";

const ctx = self as unknown as {
  postMessage: (m: unknown) => void;
  addEventListener: (t: "message", cb: (e: MessageEvent) => void) => void;
};

ctx.addEventListener("message", async (e: MessageEvent) => {
  ctx.postMessage(await handleEngineRequest(e.data as EngineRequest));
});
