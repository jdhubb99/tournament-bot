import type { Format } from "./format.ts";
import { seriesState, type GameScore } from "./series.ts";

export interface ForfeitMatch {
  round: number;
  play_order: number;
  status: "pending" | "live" | "done";
  p1_id: string | null;
  p2_id: string | null;
  winner_id: string | null;
  best_of: number;
}

/** True for a decided match whose games don't decide its series: it was won by forfeit. */
export function wonByForfeit(match: Pick<ForfeitMatch, "status" | "best_of">, games: readonly GameScore[]): boolean {
  return match.status === "done" && seriesState(games, match.best_of).winner === null;
}

/**
 * The earliest pending match a dropped player can't play: both players known and at least
 * one of them dropped. Its winner is the player who didn't drop, or p1 if both did.
 */
export function nextForfeit<T extends ForfeitMatch>(
  matches: readonly T[],
  dropped: ReadonlySet<string>,
): { match: T; winnerId: string } | null {
  const match = matches
    .filter((m) => m.status === "pending" && m.p1_id && m.p2_id && (dropped.has(m.p1_id) || dropped.has(m.p2_id)))
    .sort((a, b) => a.play_order - b.play_order)[0];
  if (!match) return null;
  return { match, winnerId: dropped.has(match.p1_id!) && !dropped.has(match.p2_id!) ? match.p2_id! : match.p1_id! };
}

/**
 * Whether a player is already out of the tournament: they lost a knockout match (any match
 * in single elim, a playoff in the other formats), or the league or group stage is over and
 * they didn't make the playoffs.
 */
export function isOut(playerId: string, matches: readonly ForfeitMatch[], format: Format): boolean {
  const plays = (m: ForfeitMatch) => m.p1_id === playerId || m.p2_id === playerId;
  const knockout = (m: ForfeitMatch) => format === "single_elim" || m.round > 1;
  if (matches.some((m) => knockout(m) && m.status === "done" && plays(m) && m.winner_id !== playerId)) return true;
  if (format === "single_elim") return false;
  const stageOver = matches.filter((m) => m.round === 1).every((m) => m.status === "done");
  return stageOver && !matches.some((m) => m.round > 1 && plays(m));
}

/** A league or group table with the dropped players moved to the bottom, otherwise in the same order. */
export function droppedLast<T extends { playerId: string }>(rows: readonly T[], dropped: ReadonlySet<string>): T[] {
  return [...rows.filter((r) => !dropped.has(r.playerId)), ...rows.filter((r) => dropped.has(r.playerId))];
}
