// All SQL lives here. bun:sqlite is synchronous, so each function runs without
// interleaving with other interactions; multi-step writes use transactions.
import { db } from "./db.ts";
import type { PlannedMatch, SeriesLengths } from "./logic/bracket.ts";
import type { Team } from "./logic/teams.ts";

export type TournamentStatus = "signup" | "active" | "done" | "cancelled";
export type Format = "single_elim" | "round_robin" | "groups";

export interface Tournament {
  id: number;
  guild_id: string;
  game: string;
  format: Format;
  status: TournamentStatus;
  semis_best_of: number;
  final_best_of: number;
  winner_id: string | null;
  bracket_msg_id: string | null;
}

export interface Player {
  discord_id: string;
  display_name: string;
}

export interface Match {
  id: number;
  tournament_id: number;
  round: number;
  play_order: number;
  label: string;
  p1_id: string | null;
  p2_id: string | null;
  best_of: number;
  winner_id: string | null;
  next_match_id: number | null;
  next_slot: "p1" | "p2" | null;
  status: "pending" | "live" | "done";
  /** p1's team, set when the match goes live; p2 is on the other team. */
  p1_team: Team | null;
}

export function upsertPlayer(discordId: string, displayName: string): void {
  db.query(
    `INSERT INTO players (discord_id, display_name) VALUES ($id, $name)
     ON CONFLICT (discord_id) DO UPDATE SET display_name = excluded.display_name`,
  ).run({ id: discordId, name: displayName });
}

/** The guild's tournament that is in signup or active, if any (at most one by rule). */
export function getOpenTournament(guildId: string): Tournament | null {
  return db
    .query<Tournament, { guild: string }>(
      `SELECT * FROM tournaments WHERE guild_id = $guild AND status IN ('signup','active')
       ORDER BY id DESC LIMIT 1`,
    )
    .get({ guild: guildId });
}

export function getTournament(id: number): Tournament | null {
  return db.query<Tournament, { id: number }>("SELECT * FROM tournaments WHERE id = $id").get({ id });
}

/** Format is decided at Start from the player count; 'single_elim' is a placeholder until then. */
export function createTournament(guildId: string, lengths: SeriesLengths): number {
  const result = db
    .query(
      `INSERT INTO tournaments (guild_id, format, status, semis_best_of, final_best_of)
       VALUES ($guild, 'single_elim', 'signup', $semis, $final)`,
    )
    .run({ guild: guildId, semis: lengths.semis, final: lengths.final });
  return Number(result.lastInsertRowid);
}

/** Returns false if the player had already joined. */
export function addTournamentPlayer(tournamentId: number, playerId: string): boolean {
  const result = db
    .query("INSERT OR IGNORE INTO tournament_players (tournament_id, player_id) VALUES ($t, $p)")
    .run({ t: tournamentId, p: playerId });
  return result.changes > 0;
}

/** Players in join order (before Start) or seed order (after). */
export function listTournamentPlayers(tournamentId: number): Player[] {
  return db
    .query<Player, { t: number }>(
      `SELECT p.discord_id, p.display_name FROM tournament_players tp
       JOIN players p ON p.discord_id = tp.player_id
       WHERE tp.tournament_id = $t
       ORDER BY tp.seed IS NULL, tp.seed, tp.rowid`,
    )
    .all({ t: tournamentId });
}

/**
 * Locks signup: stores seeds, creates every match in the plan (playoff rows with empty
 * players included), links advancement, and makes the first match live with p1 on `firstP1Team`.
 */
export const startTournament = db.transaction(
  (tournamentId: number, format: Format, seeded: string[], plan: PlannedMatch[], firstP1Team: Team): void => {
    const setSeed = db.query("UPDATE tournament_players SET seed = $seed WHERE tournament_id = $t AND player_id = $p");
    seeded.forEach((playerId, i) => setSeed.run({ seed: i + 1, t: tournamentId, p: playerId }));

    const insert = db.query(
      `INSERT INTO matches (tournament_id, round, play_order, label, p1_id, p2_id, best_of, status)
       VALUES ($t, $round, $order, $label, $p1, $p2, $bestOf, 'pending')`,
    );
    const ids = plan.map((m, i) =>
      Number(
        insert.run({
          t: tournamentId,
          round: m.round,
          order: m.playOrder,
          label: m.label,
          p1: m.p1,
          p2: m.p2,
          bestOf: m.bestOf,
        }).lastInsertRowid,
      ),
    );

    const link = db.query("UPDATE matches SET next_match_id = $next, next_slot = $slot WHERE id = $id");
    plan.forEach((m, i) => {
      if (m.next) link.run({ next: ids[m.next.index]!, slot: m.next.slot, id: ids[i]! });
    });

    goLive(ids[0]!, firstP1Team);

    db.query("UPDATE tournaments SET status = 'active', format = $format WHERE id = $id").run({
      format,
      id: tournamentId,
    });
  },
);

/** Makes a match the live one and records the teams for its whole series. */
export function goLive(matchId: number, p1Team: Team): void {
  db.query("UPDATE matches SET status = 'live', p1_team = $team WHERE id = $id").run({ team: p1Team, id: matchId });
}

export function getLiveMatch(tournamentId: number): Match | null {
  return db
    .query<Match, { t: number }>("SELECT * FROM matches WHERE tournament_id = $t AND status = 'live'")
    .get({ t: tournamentId });
}

/** Ends a signup or active tournament without a winner. Its matches and games are kept as they were. */
export function cancelTournament(tournamentId: number): void {
  db.query("UPDATE tournaments SET status = 'cancelled', finished_at = datetime('now') WHERE id = $id").run({
    id: tournamentId,
  });
}
