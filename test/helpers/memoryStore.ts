// In-memory implementation of the parts of lib/server/store.ts that the league
// engine, the physical continuation and the claim flow use. Mirrors the SQL
// semantics that matter: recompute_scores (win 1 / draw ½ / bye 1; black=null
// draw ½, aborted 0), claim_player atomicity, unique (tournament, phase, number).
import { generateResumeCode, generateUnique } from "@/lib/codes";
import type { Game, Player, Round, Tournament, TournamentConfig } from "@/lib/types";

let seq = 0;
const uid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
const db = {
  tournaments: [] as Tournament[],
  players: [] as Player[],
  rounds: [] as Round[],
  games: [] as Game[],
};
export const __mem = db;
export function __resetMem() {
  db.tournaments = [];
  db.players = [];
  db.rounds = [];
  db.games = [];
  seq = 0;
}

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
export const START_FEN = START;
export const isUniqueViolation = (e: unknown) => (e as { code?: string } | null)?.code === "23505";

export async function createTournament(title: string | null, config: TournamentConfig, host: string | null = null): Promise<Tournament> {
  const t: Tournament = {
    id: uid(),
    join_pin: String(100000 + db.tournaments.length),
    host_code: "HOST-" + String(db.tournaments.length).padStart(2, "0"),
    host_user_id: host,
    title,
    status: "lobby",
    config,
    current_round: 0,
    created_at: new Date().toISOString(),
  };
  db.tournaments.push(t);
  return t;
}
export async function getTournament(id: string) {
  return db.tournaments.find((t) => t.id === id) ?? null;
}
export async function getTournamentByPin(pin: string) {
  return db.tournaments.find((t) => t.join_pin === pin) ?? null;
}
export async function updateTournament(id: string, patch: Partial<Tournament>) {
  const t = db.tournaments.find((x) => x.id === id)!;
  Object.assign(t, patch);
  return t;
}
export async function deleteTournament(id: string) {
  db.tournaments = db.tournaments.filter((t) => t.id !== id);
  db.players = db.players.filter((p) => p.tournament_id !== id);
}
export async function listPlayers(tid: string) {
  return db.players.filter((p) => p.tournament_id === tid);
}
export async function getPlayer(id: string) {
  return db.players.find((p) => p.id === id) ?? null;
}
export async function insertPreRegisteredPlayers(tid: string, rows: Record<string, unknown>[]) {
  const out = rows.map(
    (r) =>
      ({ id: uid(), tournament_id: tid, score: 0, tiebreak: 0, seed: null, joined_at: new Date().toISOString(), pre_registered: true, claimed_at: null, ...r }) as unknown as Player,
  );
  db.players.push(...out);
  return out;
}
export async function claimPlayer(tid: string, pid: string) {
  const p = db.players.find((x) => x.id === pid && x.tournament_id === tid);
  if (!p || !p.pre_registered || p.claimed_at || p.status !== "active") return null;
  p.claimed_at = new Date().toISOString();
  return p;
}
export async function resetClaim(tid: string, pid: string) {
  const p = db.players.find((x) => x.id === pid && x.tournament_id === tid && x.pre_registered);
  if (!p) return null;
  p.claimed_at = null;
  p.resume_code = generateUnique(generateResumeCode, new Set(db.players.map((x) => x.resume_code)));
  return p;
}
export async function listRounds(tid: string) {
  return db.rounds.filter((r) => r.tournament_id === tid).sort((a, b) => a.number - b.number);
}
export async function createRound(tid: string, number: number, phase: Round["phase"], status: Round["status"] = "live") {
  if (db.rounds.some((r) => r.tournament_id === tid && r.phase === phase && r.number === number)) throw { code: "23505" };
  const r: Round = { id: uid(), tournament_id: tid, number, phase, status, started_at: new Date().toISOString() };
  db.rounds.push(r);
  return r;
}
export async function setRoundStatus(id: string, status: Round["status"]) {
  db.rounds.find((r) => r.id === id)!.status = status;
}
export async function listGames(tid: string) {
  return db.games.filter((g) => g.tournament_id === tid);
}
export async function listGamesForRound(rid: string) {
  return db.games.filter((g) => g.round_id === rid);
}
export async function createGame(g: {
  tournamentId: string; roundId: string; whitePlayerId: string; blackPlayerId: string | null;
  status?: Game["status"]; resultSource?: Game["result_source"]; startFen?: string; slot?: number;
}) {
  const bye = g.blackPlayerId === null;
  const row: Game = {
    id: uid(), tournament_id: g.tournamentId, round_id: g.roundId, white_player_id: g.whitePlayerId,
    black_player_id: g.blackPlayerId, fen: g.startFen ?? START, pgn: "", status: g.status ?? (bye ? "bye" : "live"),
    result_source: g.resultSource ?? (bye ? "bye" : null), turn: "w", draw_offered_by: null, slot: g.slot ?? 0,
    updated_at: new Date().toISOString(),
  };
  db.games.push(row);
  return row;
}
export async function insertFinishedGames(tid: string, games: { roundId: string; whitePlayerId: string; blackPlayerId: string | null; status: Game["status"]; resultSource: Game["result_source"]; slot: number }[], fen = START) {
  for (const g of games) await createGame({ tournamentId: tid, ...g, startFen: fen });
}
export async function resolveGameRpc(id: string, status: Game["status"], source: Game["result_source"]) {
  const g = db.games.find((x) => x.id === id)!;
  g.status = status;
  g.result_source = source;
  return { ok: true };
}
/** Same arithmetic as public.recompute_scores (0002). */
export async function recomputeScores(tid: string) {
  for (const p of db.players.filter((x) => x.tournament_id === tid)) {
    let s = 0;
    for (const g of db.games.filter((x) => x.tournament_id === tid)) {
      if (g.white_player_id === p.id) s += g.status === "white_win" ? 1 : g.status === "draw" ? 0.5 : g.status === "bye" ? 1 : 0;
      if (g.black_player_id === p.id) s += g.status === "black_win" ? 1 : g.status === "draw" ? 0.5 : 0;
    }
    p.score = s;
  }
}
