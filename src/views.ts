// Text lines describing matches and tournaments, shared by /bracket, /history and the champion post.
import { wonByForfeit } from "./logic/forfeit.ts";
import { describeSeries, seriesState } from "./logic/series.ts";
import { resultLine } from "./render/embeds.ts";
import { getPlayer, listGames, type Format, type Match } from "./store.ts";

export const FORMAT_NAMES: Record<Format, string> = {
  single_elim: "Knockout",
  round_robin: "Round robin + final",
  groups: "Groups + playoffs",
};

/** A player's stored display name, or their id if they somehow aren't stored. */
export function playerName(id: string): string {
  return getPlayer(id)?.display_name ?? id;
}

/**
 * How a decided match ended: goals for a best of 1, games won for longer series. A match won
 * by forfeit has `forfeit` set, and its scores are the games each side won before it.
 */
export function matchScore(match: Match): {
  winnerId: string;
  loserId: string;
  winnerScore: number;
  loserScore: number;
  forfeit: boolean;
} {
  const games = listGames(match.id);
  const series = seriesState(games, match.best_of);
  const forfeit = wonByForfeit(match, games);
  const winnerIsP1 = match.p1_id === match.winner_id;
  const [p1, p2] = match.best_of === 1 && !forfeit ? [games[0]!.p1_score, games[0]!.p2_score] : [series.p1Wins, series.p2Wins];
  return {
    winnerId: match.winner_id!,
    loserId: winnerIsP1 ? match.p2_id! : match.p1_id!,
    winnerScore: winnerIsP1 ? p1 : p2,
    loserScore: winnerIsP1 ? p2 : p1,
    forfeit,
  };
}

/** "Semifinal 1: **A** def. B (6–5)" for a best of 1, "(series 2–1)" for longer series, "(forfeit)" for a forfeit. */
export function resultLineFor(match: Match): string {
  const score = matchScore(match);
  return resultLine({
    label: match.label,
    winnerName: playerName(score.winnerId),
    loserName: playerName(score.loserId),
    winnerScore: score.winnerScore,
    loserScore: score.loserScore,
    series: match.best_of > 1,
    forfeit: score.forfeit,
  });
}

/** 1 → "1st", 2 → "2nd", 11 → "11th", 22 → "22nd". */
export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}

/** "**Final** (Bo3): A vs D · A leads the series 1–0". A best of 1 has no series to describe. */
export function liveLineFor(match: Match): string {
  const [p1, p2] = [playerName(match.p1_id!), playerName(match.p2_id!)];
  const line = `**${match.label}** (Bo${match.best_of}): ${p1} vs ${p2}`;
  if (match.best_of === 1) return line;
  return `${line} · ${describeSeries(seriesState(listGames(match.id), match.best_of), p1, p2)}`;
}

/** What an empty slot is waiting for: "Winner of Semifinal 2", or "TBD" if nothing feeds it. */
export function slotPlaceholder(match: Match, all: readonly Match[], side: "p1" | "p2"): string {
  const feeder = all.find((m) => m.next_match_id === match.id && m.next_slot === side);
  return feeder ? `Winner of ${feeder.label}` : "TBD";
}

/** The loser of the last match (the final) of a finished tournament. */
export function runnerUpOf(matches: readonly Match[]): string {
  return playerName(matchScore(matches.at(-1)!).loserId);
}
