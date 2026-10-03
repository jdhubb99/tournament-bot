// All SQL lives here. bun:sqlite is synchronous, so each function runs without
// interleaving with other interactions; multi-step writes use transactions.
import { db } from "./db.ts";
import type { PlannedMatch, SeriesLengths } from "./logic/bracket.ts";
import type { Format } from "./logic/format.ts";
import { semifinalPairs, type GroupLabel } from "./logic/groups.ts";
import { allMatchesDone, nextMatchToPlay } from "./logic/queue.ts";
import type { MatchRecord } from "./logic/stats.ts";
import { standings, type StandingRow } from "./logic/roundrobin.ts";
import { seriesState, stageOf, type SeriesState } from "./logic/series.ts";
import type { Team } from "./logic/teams.ts";

export type TournamentStatus = "signup" | "active" | "done" | "cancelled";
export type { Format } from "./logic/format.ts";

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
  (
    tournamentId: number,
    format: Format,
    seeded: string[],
    plan: PlannedMatch[],
    firstP1Team: Team,
    groups: Record<string, GroupLabel> = {},
  ): void => {
    const setSeed = db.query(
      "UPDATE tournament_players SET seed = $seed, group_label = $group WHERE tournament_id = $t AND player_id = $p",
    );
    seeded.forEach((playerId, i) => setSeed.run({ seed: i + 1, group: groups[playerId] ?? null, t: tournamentId, p: playerId }));

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

/**
 * Changes the semis and/or final length of a tournament in signup or in progress, along with
 * every undecided match in that round. Callers check the change first (`checkLengthChange()`).
 */
export const changeSeriesLengths = db.transaction((tournamentId: number, lengths: Partial<SeriesLengths>): void => {
  const matches = listMatches(tournamentId);
  for (const stage of ["semis", "final"] as const) {
    const bestOf = lengths[stage];
    if (bestOf === undefined) continue;
    db.query(`UPDATE tournaments SET ${stage}_best_of = $b WHERE id = $id`).run({ b: bestOf, id: tournamentId });
    for (const m of matches.filter((m) => stageOf(m.label) === stage && m.status !== "done")) {
      db.query("UPDATE matches SET best_of = $b WHERE id = $id").run({ b: bestOf, id: m.id });
    }
  }
});

export interface Game {
  id: number;
  match_id: number;
  game_number: number;
  p1_score: number;
  p2_score: number;
  reported_by: string;
}

export function getPlayer(discordId: string): Player | null {
  return db.query<Player, { id: string }>("SELECT * FROM players WHERE discord_id = $id").get({ id: discordId });
}

/** All matches in play order. */
export function listMatches(tournamentId: number): Match[] {
  return db
    .query<Match, { t: number }>("SELECT * FROM matches WHERE tournament_id = $t ORDER BY play_order")
    .all({ t: tournamentId });
}

export function listGames(matchId: number): Game[] {
  return db
    .query<Game, { m: number }>("SELECT * FROM games WHERE match_id = $m ORDER BY game_number")
    .all({ m: matchId });
}

export interface GameOutcome {
  game: Game;
  /** The reported match, re-read after any update (status/winner). */
  match: Match;
  series: SeriesState;
  /** The match that went live because this game decided the series, if any. */
  next: Match | null;
  /** Set when this game decided the final match of the tournament. */
  championId: string | null;
  /**
   * True when this game finished a round-robin league or a group stage, so the playoffs
   * were just filled from the standings (the final, or both semis).
   */
  stageFinished: boolean;
}

/**
 * Saves one game of the live match. If it decides the series, closes the match,
 * advances the winner (single elim), and then either puts the next playable match
 * live with p1 on `nextP1Team` or, when every match is done, finishes the tournament.
 */
export const recordGame = db.transaction(
  (match: Match, p1Score: number, p2Score: number, reportedBy: string, nextP1Team: Team): GameOutcome => {
    const gameNumber = listGames(match.id).length + 1;
    const gameId = Number(
      db
        .query(
          `INSERT INTO games (match_id, game_number, p1_score, p2_score, reported_by)
           VALUES ($m, $n, $p1, $p2, $by)`,
        )
        .run({ m: match.id, n: gameNumber, p1: p1Score, p2: p2Score, by: reportedBy }).lastInsertRowid,
    );
    const game = db.query<Game, { id: number }>("SELECT * FROM games WHERE id = $id").get({ id: gameId })!;
    const series = seriesState(listGames(match.id), match.best_of);

    let next: Match | null = null;
    let championId: string | null = null;
    let stageFinished = false;
    if (series.winner) {
      const winnerId = series.winner === "p1" ? match.p1_id! : match.p2_id!;
      db.query("UPDATE matches SET status = 'done', winner_id = $w WHERE id = $id").run({ w: winnerId, id: match.id });
      if (match.next_match_id) {
        const column = match.next_slot === "p1" ? "p1_id" : "p2_id";
        db.query(`UPDATE matches SET ${column} = $w WHERE id = $id`).run({ w: winnerId, id: match.next_match_id });
      }

      stageFinished = fillPlayoffsFromStandings(match.tournament_id);
      const matches = listMatches(match.tournament_id);
      const upNext = nextMatchToPlay(matches);
      if (upNext) {
        goLive(upNext.id, nextP1Team);
        next = getMatch(upNext.id);
      } else if (allMatchesDone(matches)) {
        championId = winnerId;
        db.query(
          "UPDATE tournaments SET status = 'done', winner_id = $w, finished_at = datetime('now') WHERE id = $id",
        ).run({ w: winnerId, id: match.tournament_id });
      }
    }

    return { game, match: getMatch(match.id)!, series, next, championId, stageFinished };
  },
);

export function getMatch(id: number): Match | null {
  return db.query<Match, { id: number }>("SELECT * FROM matches WHERE id = $id").get({ id });
}

/**
 * The tournament /undo applies to: the guild's newest tournament, if it's active or
 * finished. Undoing a finished tournament's last game reopens it.
 */
export function getUndoableTournament(guildId: string): Tournament | null {
  const latest = db
    .query<Tournament, { g: string }>("SELECT * FROM tournaments WHERE guild_id = $g ORDER BY id DESC LIMIT 1")
    .get({ g: guildId });
  return latest && (latest.status === "active" || latest.status === "done") ? latest : null;
}

export function getLastGame(tournamentId: number): Game | null {
  return db
    .query<Game, { t: number }>(
      `SELECT g.* FROM games g JOIN matches m ON m.id = g.match_id
       WHERE m.tournament_id = $t ORDER BY g.id DESC LIMIT 1`,
    )
    .get({ t: tournamentId });
}

export interface UndoOutcome {
  game: Game;
  /** The undone game's match, re-read after the undo (always live again). */
  match: Match;
  series: SeriesState;
  /** True if the undone game had decided its series, so the match was reopened. */
  reopened: boolean;
  /** The match that had gone live after it and is now back to waiting, if any. */
  paused: Match | null;
  /** True if the undone game had ended the tournament. */
  tournamentReopened: boolean;
}

/**
 * Removes the tournament's most recent game and reverses everything it caused: reopens
 * the match it closed, takes the winner back out of the next match, puts any match that
 * went live afterwards back to waiting (it has no games, since this game was the latest),
 * and reopens the tournament if this game had ended it. Returns null if there's no game.
 */
export const undoLastGame = db.transaction((tournamentId: number): UndoOutcome | null => {
  const game = getLastGame(tournamentId);
  if (!game) return null;
  const match = getMatch(game.match_id)!;

  let paused: Match | null = null;
  let tournamentReopened = false;
  const reopened = match.status === "done";
  if (reopened) {
    const live = getLiveMatch(tournamentId);
    if (live) {
      db.query("UPDATE matches SET status = 'pending', p1_team = NULL WHERE id = $id").run({ id: live.id });
      paused = getMatch(live.id);
    }
    if (match.next_match_id) {
      const column = match.next_slot === "p1" ? "p1_id" : "p2_id";
      db.query(`UPDATE matches SET ${column} = NULL WHERE id = $id`).run({ id: match.next_match_id });
    }
    // Reopening a league or group match means that stage isn't over, so empty the playoffs
    // it had filled from the standings (the round-robin final, or both semis).
    if (match.round === 1) {
      for (const playoff of standingsFilledMatches(tournamentId)) {
        db.query("UPDATE matches SET p1_id = NULL, p2_id = NULL WHERE id = $id").run({ id: playoff.id });
      }
    }
    db.query("UPDATE matches SET status = 'live', winner_id = NULL WHERE id = $id").run({ id: match.id });

    const tournament = getTournament(tournamentId)!;
    if (tournament.status === "done") {
      db.query("UPDATE tournaments SET status = 'active', winner_id = NULL, finished_at = NULL WHERE id = $id").run({
        id: tournamentId,
      });
      tournamentReopened = true;
    }
  }

  db.query("DELETE FROM games WHERE id = $id").run({ id: game.id });
  const after = getMatch(match.id)!;
  return {
    game,
    match: after,
    series: seriesState(listGames(match.id), match.best_of),
    reopened,
    paused,
    tournamentReopened,
  };
});

/** Finished tournaments for /history, newest first. */
export function listFinishedTournaments(guildId: string, limit = 10): (Tournament & { finished_at: string })[] {
  return db
    .query<Tournament & { finished_at: string }, { g: string; limit: number }>(
      `SELECT * FROM tournaments WHERE guild_id = $g AND status = 'done'
       ORDER BY finished_at DESC, id DESC LIMIT $limit`,
    )
    .all({ g: guildId, limit });
}

/** How many tournaments a player had won in this guild as of (and including) the given one. */
export function titlesUpTo(guildId: string, playerId: string, tournamentId: number): number {
  return db
    .query<{ n: number }, { g: string; p: string; t: number }>(
      "SELECT count(*) AS n FROM tournaments WHERE guild_id = $g AND status = 'done' AND winner_id = $p AND id <= $t",
    )
    .get({ g: guildId, p: playerId, t: tournamentId })!.n;
}

/** The league (round robin) or group (groups) matches: round 1 of those formats. */
function stageMatches(tournamentId: number): Match[] {
  return listMatches(tournamentId).filter((m) => m.round === 1);
}

/** Playoff matches whose players come from the standings: the round-robin final, or the group semis. */
function standingsFilledMatches(tournamentId: number): Match[] {
  const format = getTournament(tournamentId)!.format;
  const matches = listMatches(tournamentId);
  if (format === "round_robin") return matches.slice(-1);
  if (format === "groups") return matches.filter((m) => m.label.startsWith("Semifinal"));
  return [];
}

/** The table for some players, from every decided stage match between them. Players are in seed order. */
function tableFor(tournamentId: number, players: readonly string[]): StandingRow[] {
  const inTable = new Set(players);
  const results = stageMatches(tournamentId)
    .filter((m) => m.status === "done" && inTable.has(m.p1_id!) && inTable.has(m.p2_id!))
    .map((m) => ({ p1: m.p1_id!, p2: m.p2_id!, winner: m.winner_id!, games: listGames(m.id) }));
  return standings(players, results);
}

/** The round-robin league table, from every decided league match. */
export function leagueStandings(tournamentId: number): StandingRow[] {
  return tableFor(tournamentId, listTournamentPlayers(tournamentId).map((p) => p.discord_id));
}

/** Both group tables, from every decided group match. */
export function groupStandings(tournamentId: number): Record<GroupLabel, StandingRow[]> {
  const members = (label: GroupLabel) =>
    db
      .query<{ player_id: string }, { t: number; g: string }>(
        "SELECT player_id FROM tournament_players WHERE tournament_id = $t AND group_label = $g ORDER BY seed",
      )
      .all({ t: tournamentId, g: label })
      .map((r) => r.player_id);
  return { A: tableFor(tournamentId, members("A")), B: tableFor(tournamentId, members("B")) };
}

/**
 * Once every league or group match is done, fills the playoffs from the standings: the
 * round-robin final gets the top 2 (1st as p1); the group semis get A1 vs B2 and B1 vs A2.
 * Returns true if it just did that.
 */
function fillPlayoffsFromStandings(tournamentId: number): boolean {
  const targets = standingsFilledMatches(tournamentId);
  if (targets.length === 0 || targets[0]!.p1_id || stageMatches(tournamentId).some((m) => m.status !== "done")) return false;

  const fill = db.query("UPDATE matches SET p1_id = $p1, p2_id = $p2 WHERE id = $id");
  if (getTournament(tournamentId)!.format === "round_robin") {
    const [first, second] = leagueStandings(tournamentId);
    fill.run({ p1: first!.playerId, p2: second!.playerId, id: targets[0]!.id });
  } else {
    const tables = groupStandings(tournamentId);
    const ids = (rows: StandingRow[]) => rows.map((r) => r.playerId);
    semifinalPairs(ids(tables.A), ids(tables.B)).forEach(([p1, p2], i) => fill.run({ p1, p2, id: targets[i]!.id }));
  }
  return true;
}

export const DEFAULT_GAME = "Rocket League";

/**
 * Every decided match in the guild's finished or in-progress tournaments of a game
 * (case-insensitive), with its games, for /leaderboard and /stats. Cancelled tournaments
 * don't count.
 */
export function decidedMatches(guildId: string, game = DEFAULT_GAME): MatchRecord[] {
  return db
    .query<Match, { g: string; game: string }>(
      `SELECT m.* FROM matches m JOIN tournaments t ON t.id = m.tournament_id
       WHERE t.guild_id = $g AND t.game = $game COLLATE NOCASE AND t.status IN ('active', 'done') AND m.status = 'done'
       ORDER BY m.id`,
    )
    .all({ g: guildId, game })
    .map((m) => ({ p1: m.p1_id!, p2: m.p2_id!, winner: m.winner_id!, games: listGames(m.id) }));
}

/** Titles per player: finished tournaments of a game (case-insensitive) each player won. */
export function titleCounts(guildId: string, game = DEFAULT_GAME): Map<string, number> {
  const rows = db
    .query<{ winner_id: string; n: number }, { g: string; game: string }>(
      `SELECT winner_id, count(*) AS n FROM tournaments
       WHERE guild_id = $g AND game = $game COLLATE NOCASE AND status = 'done'
       GROUP BY winner_id`,
    )
    .all({ g: guildId, game });
  return new Map(rows.map((r) => [r.winner_id, r.n]));
}

/** Remembers the tournament's live bracket message so it can be edited in place. */
export function setBracketMessage(tournamentId: number, messageId: string): void {
  db.query("UPDATE tournaments SET bracket_msg_id = $m WHERE id = $id").run({ m: messageId, id: tournamentId });
}
