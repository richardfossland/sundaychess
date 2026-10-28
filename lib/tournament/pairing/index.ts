import { monrad } from "./monrad";
import { pairRoundRobin, type RoundRobinOptions } from "./roundRobin";
import { swiss } from "./swiss";
import type { PairingInput, PairingOutput } from "./types";

export * from "./types";
export * from "./colors";
export * from "./byes";
export { monrad, monradWithContext, contextFromHistory, rankPlayers, pairKey } from "./monrad";
export { swiss, seedOrder } from "./swiss";
export {
  bergerTable,
  pairRoundRobin,
  roundRobinRounds,
  roundRobinSchedule,
  tableOrder,
  type RoundRobinOptions,
  type RoundRobinSchedule,
  type ScheduledGame,
} from "./roundRobin";

export type PairingSystem = "monrad" | "swiss" | "roundRobin";

/** Single entry point: pair `input.round` with the chosen system. */
export function pairRound(system: PairingSystem, input: PairingInput, rr: RoundRobinOptions = {}): PairingOutput {
  switch (system) {
    case "monrad":
      return monrad(input);
    case "swiss":
      return swiss(input);
    case "roundRobin":
      return pairRoundRobin(input, rr);
  }
}
