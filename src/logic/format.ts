export type Format = "single_elim" | "round_robin" | "groups";

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 8;

/**
 * The format for a player count, keeping every tournament to about 12 matches or fewer:
 * 4 and 8 are knockouts, 5 is a round robin plus a final, 6–7 are two groups then playoffs.
 * Null outside 4–8.
 */
export function formatFor(players: number): Format | null {
  if (players === 4 || players === 8) return "single_elim";
  if (players === 5) return "round_robin";
  if (players === 6 || players === 7) return "groups";
  return null;
}
