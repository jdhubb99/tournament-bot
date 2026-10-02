// Text lines describing matches and tournaments, shared by /bracket, /history and the champion post.
import { describeSeries, seriesState } from "./logic/series.ts";
import { resultLine } from "./render/embeds.ts";
import { getPlayer, listGames, type Format, type Match } from "./store.ts";

export const FORMAT_NAMES: Record<Format, string> = {
  single_elim: "Single elimination",
  round_robin: "Round robin + final",
  groups: "Groups + playoffs",
};

/** A player's stored display name, or their id if they somehow aren't stored. */
export function playerName(id: string): string {
  return getPlayer(id)?.display_name ?? id;
}

/** "Semifinal 1: **A** def. B (6–5)" for a best of 1, "(series 2–1)" for longer series. */
export function resultLineFor(match: Match): string {
  const games = listGames(match.id);
  const series = seriesState(games, match.best_of);
  const winnerIsP1 = match.p1_id === match.winner_id;
  const [p1, p2] = match.best_of === 1 ? [games[0]!.p1_score, games[0]!.p2_score] : [series.p1Wins, series.p2Wins];
  return resultLine({
    label: match.label,
    winnerName: playerName(match.winner_id!),
    loserName: playerName(winnerIsP1 ? match.p2_id! : match.p1_id!),
    winnerScore: winnerIsP1 ? p1 : p2,
    loserScore: winnerIsP1 ? p2 : p1,
    series: match.best_of > 1,
  });
}

/** "**Final** (Bo3): A vs D · A leads the series 1–0". A best of 1 has no series to describe. */
export function liveLineFor(match: Match): string {
  const [p1, p2] = [playerName(match.p1_id!), playerName(match.p2_id!)];
  const line = `**${match.label}** (Bo${match.best_of}): ${p1} vs ${p2}`;
  if (match.best_of === 1) return line;
  return `${line} · ${describeSeries(seriesState(listGames(match.id), match.best_of), p1, p2)}`;
}

/** "Final (Bo3): A vs Winner of Semifinal 2", naming the feeder match for a slot not filled yet. */
export function queueLineFor(match: Match, all: readonly Match[]): string {
  const slot = (playerId: string | null, side: "p1" | "p2") => {
    if (playerId) return playerName(playerId);
    const feeder = all.find((m) => m.next_match_id === match.id && m.next_slot === side);
    return feeder ? `Winner of ${feeder.label}` : "TBD";
  };
  return `${match.label} (Bo${match.best_of}): ${slot(match.p1_id, "p1")} vs ${slot(match.p2_id, "p2")}`;
}

/** The loser of the last match (the final) of a finished tournament. */
export function runnerUpOf(matches: readonly Match[]): string {
  const final = matches.at(-1)!;
  return playerName(final.winner_id === final.p1_id ? final.p2_id! : final.p1_id!);
}
