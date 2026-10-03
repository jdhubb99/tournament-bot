import { standings, type LeagueResult, type StandingRow } from "./roundrobin.ts";

/** A decided match: both players, the series winner, and every game's score. */
export type MatchRecord = LeagueResult;

export interface PlayerStats extends StandingRow {
  titles: number;
}

const gameDiff = (r: StandingRow) => r.gameWins - r.gameLosses;
const goalDiff = (r: StandingRow) => r.goalsFor - r.goalsAgainst;

/** Everyone who has played at least one decided match. */
function playersIn(matches: readonly MatchRecord[]): string[] {
  return [...new Set(matches.flatMap((m) => [m.p1, m.p2]))];
}

/**
 * The leaderboard: every player who has played, ranked by titles, then series wins, then
 * game difference, then goal difference, then fewest series losses, then player id so the
 * order never shuffles.
 */
export function leaderboard(matches: readonly MatchRecord[], titles: ReadonlyMap<string, number>): PlayerStats[] {
  return standings(playersIn(matches), matches)
    .map((row) => ({ ...row, titles: titles.get(row.playerId) ?? 0 }))
    .sort(
      (a, b) =>
        b.titles - a.titles ||
        b.wins - a.wins ||
        gameDiff(b) - gameDiff(a) ||
        goalDiff(b) - goalDiff(a) ||
        a.losses - b.losses ||
        a.playerId.localeCompare(b.playerId),
    );
}

export interface HeadToHead extends StandingRow {
  /** The opponent; the counts are from the player's side (wins = the player's series wins). */
  opponentId: string;
}

/** The player's record against each opponent they've met, most-played matchup first. */
export function headToHead(matches: readonly MatchRecord[], playerId: string): HeadToHead[] {
  const theirs = matches.filter((m) => m.p1 === playerId || m.p2 === playerId);
  const opponents = [...new Set(theirs.map((m) => (m.p1 === playerId ? m.p2 : m.p1)))];
  return opponents
    .map((opponentId) => {
      const between = theirs.filter((m) => m.p1 === opponentId || m.p2 === opponentId);
      const row = standings([playerId, opponentId], between).find((r) => r.playerId === playerId)!;
      return { ...row, opponentId };
    })
    .sort((a, b) => b.played - a.played || a.opponentId.localeCompare(b.opponentId));
}
