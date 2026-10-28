// Fysisk turneringsmodus – skjema v1. Ren data (JSON-serialiserbar), ingen logikk.
// Se docs/FYSISK-MODUS.md.

import type { TiebreakKey } from "@/lib/tournament/tiebreaks";
import type { ByeType } from "@/lib/tournament/pairing/types";

export const SCHEMA_VERSION = 1 as const;

export type PhysicalSystem = "monrad" | "swiss" | "roundRobin" | "knockout";
export const PHYSICAL_SYSTEMS: readonly PhysicalSystem[] = ["monrad", "swiss", "roundRobin", "knockout"];

/** '+-' / '-+' = walkover (hvit/svart vinner uten parti), '=' = begge uteble (0–0). */
export type ResultCode = "1-0" | "0-1" | "½-½" | "+-" | "-+" | "=";
export const RESULT_CODES: readonly ResultCode[] = ["1-0", "0-1", "½-½", "+-", "-+", "="];

export interface PhysicalSettings {
  system: PhysicalSystem;
  /** Antall runder. For roundRobin/knockout utledes det av spillerantallet (se totalRounds). */
  rounds: number;
  doubleRoundRobin?: boolean;
  tiebreaks: TiebreakKey[];
  /** Poeng for automatisk frirunde (oddetall spillere): 1 eller 0.5. */
  byePoints: 1 | 0.5;
  allowLateEntry: boolean;
  /** Visningsnavn for «club»-feltet, f.eks. «Klubb» eller «Klasse». */
  groupLabel?: string;
}

export interface PhysicalPlayer {
  id: string;
  /** 1-basert startnummer, tildelt i påmeldingsrekkefølge. Aldri gjenbrukt. */
  startNo: number;
  name: string;
  rating?: number;
  /** Klubb eller klasse (se settings.groupLabel). */
  club?: string;
  status: "active" | "withdrawn";
  /** Første runde en senpåmeldt spiller kunne parres i. */
  lateEntryRound?: number;
  /** Senpåmeldt: ½ poeng for hver runde som ble gått glipp av (frirunde). Utelatt = 0 (standard). */
  missedRoundPoints?: 0.5;
}

export interface PhysicalPairing {
  /** 1-basert. Utslag: brett = plass i brakett (slot + 1). Ellers: frirunder sist. */
  board: number;
  white: string;
  /** null = frirunde for `white`. */
  black: string | null;
  byeType?: ByeType;
  result?: ResultCode | null;
  resultSource?: ResultSource;
  /** Omkamp som ikke kunne unngås. */
  rematch?: boolean;
  /** Parringen er endret manuelt av arrangør. */
  manual?: boolean;
}

/** Hvem førte resultatet: arrangøren selv, eller en spillerrapport (QR) som arrangøren godkjente. */
export type ResultSource = "arbiter" | "player_report";

export type RoundStatus = "draft" | "published" | "completed";

export interface PhysicalRound {
  number: number;
  status: RoundStatus;
  pairings: PhysicalPairing[];
}

/** Ønsket frirunde (½ eller 0 poeng) for en framtidig runde. */
export interface ByeRequest {
  playerId: string;
  round: number;
  byeType: "half" | "zero";
}

export type TournamentStatus = "running" | "finished";

export interface PhysicalTournament {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  title: string;
  createdAt: string;
  status: TournamentStatus;
  settings: PhysicalSettings;
  players: PhysicalPlayer[];
  rounds: PhysicalRound[];
  byeRequests: ByeRequest[];
  /** Sannhetskilden. Alt annet er replay(events). */
  events: PhysicalEvent[];
}

// ---- Hendelser ----

export interface EventBase {
  id: string;
  /** ISO 8601. */
  at: string;
}

export type PhysicalEventBody =
  | { type: "createTournament"; tournamentId: string; title: string; settings: PhysicalSettings }
  | {
      type: "addPlayer";
      playerId: string;
      name: string;
      rating?: number;
      club?: string;
      /** Bare for senpåmeldte: gi ½ poeng for tapte runder. Utelatt/0 = ingen poeng. */
      missedRoundPoints?: 0 | 0.5;
    }
  | {
      type: "editPlayer";
      playerId: string;
      patch: { name?: string; rating?: number | null; club?: string | null };
    }
  /** `forfeit`: spillerens uferdige partier i den publiserte runden får walkover til motstanderen. */
  | { type: "withdrawPlayer"; playerId: string; forfeit?: boolean }
  | { type: "reinstatePlayer"; playerId: string }
  | { type: "requestBye"; playerId: string; round: number; byeType: "half" | "zero" }
  | { type: "cancelByeRequest"; playerId: string; round: number }
  /** Lagrer de beregnede parringene – replay kaller aldri parringsmotoren. */
  | { type: "pairRound"; round: number; pairings: PhysicalPairing[] }
  /** Arrangør overstyrer alle parringene i en utkast-runde. */
  | { type: "manualPairing"; round: number; pairings: PhysicalPairing[]; afterPublish?: boolean }
  /** Bytter to spillere (eller farger når samme brett) i en utkast-runde. */
  | {
      type: "swapPairing";
      round: number;
      a: { board: number; side: "white" | "black" };
      b: { board: number; side: "white" | "black" };
      /** Eksplisitt endring av en allerede publisert runde (resultater på berørte brett nullstilles). */
      afterPublish?: boolean;
    }
  /** `autoForfeit`: brett med trukne spillere får walkover straks runden publiseres. */
  | { type: "publishRound"; round: number; autoForfeit?: boolean }
  | { type: "setResult"; round: number; board: number; result: ResultCode; source?: ResultSource }
  | { type: "clearResult"; round: number; board: number }
  | { type: "completeRound"; round: number }
  | { type: "finishTournament" };

export type PhysicalEvent = EventBase & PhysicalEventBody;
export type PhysicalEventType = PhysicalEventBody["type"];

/** Lagret form (IndexedDB/localStorage/fil): bare loggen + litt metadata til listevisning. */
export interface StoredTournament {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  playerCount: number;
  roundsPlayed: number;
  events: PhysicalEvent[];
}
