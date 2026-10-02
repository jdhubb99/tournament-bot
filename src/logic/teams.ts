import type { Rng } from "./random.ts";

export type Team = "goons" | "gooners";

export const TEAMS: Record<Team, { name: string; color: string }> = {
  goons: { name: "Goons", color: "#2ecc71" },
  gooners: { name: "Gooners", color: "#9b59b6" },
};

export function otherTeam(team: Team): Team {
  return team === "goons" ? "gooners" : "goons";
}

/** Coin flip for p1's team when a match goes live; p2 gets the other one. */
export function randomTeam(rng: Rng = Math.random): Team {
  return rng() < 0.5 ? "goons" : "gooners";
}
