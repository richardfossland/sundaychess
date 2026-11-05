import "server-only";

import { startRoundRpc } from "@/lib/server/store";

type Args = Parameters<typeof startRoundRpc>[0];

/** Oppretter en runde atomisk (start_round, 0018). "created" = vi laget den;
 * "exists" = en annen forespørsel (dobbeltklikk) laget en HEL runde først.
 * En halvbygd runde (arv fra før 0018) er IKKE en vellykket dobbeltklikk:
 * da kastes "round_incomplete" så læreren får en ærlig feil, ikke stille 200. */
export async function commitRound(args: Args): Promise<"created" | "exists"> {
  const r = await startRoundRpc(args);
  if (r.ok) return "created";
  if (r.conflict === "exists") {
    if (r.complete) return "exists";
    throw new Error("round_incomplete");
  }
  throw new Error(r.conflict === "no_games" ? "no_games" : "start_round_failed");
}
