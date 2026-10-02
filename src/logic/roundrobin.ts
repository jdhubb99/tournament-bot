import type { PlannedMatch } from "./bracket.ts";
import type { GameScore } from "./series.ts";

export type Pair = readonly [string, string];

/**
 * Circle method: player 0 stays put and everyone else rotates one place each round.
 * An odd count gets a bye (the player paired with it sits that round out).
 */
export function circleRounds(players: readonly string[]): Pair[][] {
  const slots: (string | null)[] = players.length % 2 ? [...players, null] : [...players];
  const n = slots.length;
  const rounds: Pair[][] = [];
  for (let r = 0; r < n - 1; r++) {
    const round: Pair[] = [];
    for (let i = 0; i < n / 2; i++) {
      const [a, b] = [slots[i], slots[n - 1 - i]];
      if (a && b) round.push([a, b]);
    }
    rounds.push(round);
    slots.splice(1, 0, slots.pop()!);
  }
  return rounds;
}

const sharesPlayer = (a: Pair, b: Pair) => a.includes(b[0]) || a.includes(b[1]);

/**
 * Orders matches so as few as possible share a player with the match before. With 5
 * players nobody ever plays twice in a row. Depth-first search, allowing 0, then 1, ...
 * back-to-backs until an order is found; fine for the handful of matches in a league.
 */
export function orderWithoutBackToBack(pairs: readonly Pair[]): Pair[] {
  const search = (path: number[], remaining: number[], budget: number): number[] | null => {
    if (remaining.length === 0) return path;
    for (const i of remaining) {
      const cost = path.length > 0 && sharesPlayer(pairs[path.at(-1)!]!, pairs[i]!) ? 1 : 0;
      if (cost > budget) continue;
      const found = search([...path, i], remaining.filter((j) => j !== i), budget - cost);
      if (found) return found;
    }
    return null;
  };
  for (let allowed = 0; ; allowed++) {
    const order = search([], pairs.map((_, i) => i), allowed);
    if (order) return order.map((i) => pairs[i]!);
  }
}

/**
 * Round robin + final: every pair plays once (best of 1) in an order that avoids
 * back-to-backs, then an empty final that the top 2 fill when the league ends.
 */
export function roundRobinPlan(seeded: readonly string[], finalBestOf: number): PlannedMatch[] {
  const league = orderWithoutBackToBack(circleRounds(seeded).flat());
  const plan: PlannedMatch[] = league.map(([p1, p2], i) => ({
    round: 1,
    playOrder: i + 1,
    label: `Match ${i + 1}`,
    p1,
    p2,
    bestOf: 1,
    next: null,
  }));
  plan.push({ round: 2, playOrder: league.length + 1, label: "Final", p1: null, p2: null, bestOf: finalBestOf, next: null });
  return plan;
}

export interface LeagueResult {
  p1: string;
  p2: string;
  winner: string;
  games: readonly GameScore[];
}

export interface StandingRow {
  playerId: string;
  played: number;
  wins: number;
  losses: number;
  gameWins: number;
  gameLosses: number;
  goalsFor: number;
  goalsAgainst: number;
}

/**
 * The league table. Order: series wins, game wins, goal difference, then head-to-head
 * wins among the players still tied, then `players` order. Callers pass players in
 * seed order, and seeds are random, so that last step is the spec's random tiebreak
 * while staying the same every time the table is shown.
 */
export function standings(players: readonly string[], results: readonly LeagueResult[]): StandingRow[] {
  const rows = new Map<string, StandingRow>(
    players.map((id) => [id, { playerId: id, played: 0, wins: 0, losses: 0, gameWins: 0, gameLosses: 0, goalsFor: 0, goalsAgainst: 0 }]),
  );
  for (const result of results) {
    for (const [side, id] of [["p1", result.p1], ["p2", result.p2]] as const) {
      const row = rows.get(id)!;
      row.played++;
      if (result.winner === id) row.wins++;
      else row.losses++;
      for (const g of result.games) {
        const [mine, theirs] = side === "p1" ? [g.p1_score, g.p2_score] : [g.p2_score, g.p1_score];
        row.goalsFor += mine;
        row.goalsAgainst += theirs;
        if (mine > theirs) row.gameWins++;
        else row.gameLosses++;
      }
    }
  }

  const key = (r: StandingRow) => [r.wins, r.gameWins, r.goalsFor - r.goalsAgainst];
  const compare = (a: StandingRow, b: StandingRow) => {
    const [ka, kb] = [key(a), key(b)];
    return kb[0]! - ka[0]! || kb[1]! - ka[1]! || kb[2]! - ka[2]!;
  };
  const sorted = [...rows.values()].sort(compare); // stable, so ties keep seed order

  // Break remaining ties by head-to-head wins among just the tied players.
  const table: StandingRow[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i + 1;
    while (j < sorted.length && compare(sorted[i]!, sorted[j]!) === 0) j++;
    const tied = sorted.slice(i, j);
    const ids = new Set(tied.map((r) => r.playerId));
    const h2h = (id: string) => results.filter((r) => r.winner === id && ids.has(r.p1) && ids.has(r.p2)).length;
    table.push(...tied.sort((a, b) => h2h(b.playerId) - h2h(a.playerId)));
    i = j;
  }
  return table;
}
