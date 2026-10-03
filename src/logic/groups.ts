import type { PlannedMatch, SeriesLengths } from "./bracket.ts";
import { circleRounds, orderWithoutBackToBack, type Pair } from "./roundrobin.ts";

export type GroupLabel = "A" | "B";

/** After the shuffle, the first 3 (6 players) or 4 (7 players) go to Group A, the rest to B. */
export function splitGroups(seeded: readonly string[]): Record<GroupLabel, string[]> {
  const sizeA = Math.ceil(seeded.length / 2);
  return { A: seeded.slice(0, sizeA), B: seeded.slice(sizeA) };
}

/** Alternates A, B, A, B, ... and lets the longer list finish on its own. */
function interleave<T>(a: readonly T[], b: readonly T[]): T[] {
  return Array.from({ length: Math.max(a.length, b.length) }, (_, i) => [a[i], b[i]])
    .flat()
    .filter((m): m is T => m !== undefined);
}

/**
 * Two groups then playoffs: each group plays a mini round robin (best of 1), with the
 * groups alternating so nobody plays back-to-back where possible. Then two empty
 * semifinals (A1 vs B2, B1 vs A2), filled when the group stage ends, feeding the final.
 */
export function groupsPlan(seeded: readonly string[], lengths: SeriesLengths): {
  plan: PlannedMatch[];
  groups: Record<string, GroupLabel>;
} {
  const split = splitGroups(seeded);
  const schedule = (label: GroupLabel) =>
    orderWithoutBackToBack(circleRounds(split[label]).flat()).map((pair) => ({ label, pair }));
  const groupMatches = interleave(schedule("A"), schedule("B"));

  const counts: Record<GroupLabel, number> = { A: 0, B: 0 };
  const plan: PlannedMatch[] = groupMatches.map(({ label, pair: [p1, p2] }: { label: GroupLabel; pair: Pair }, i) => ({
    round: 1,
    playOrder: i + 1,
    label: `Group ${label} - Match ${++counts[label]}`,
    p1,
    p2,
    bestOf: 1,
    next: null,
  }));

  const sf1 = plan.length;
  const playoff = (label: string, round: number, bestOf: number, next: PlannedMatch["next"]): PlannedMatch => ({
    round,
    playOrder: plan.length + 1,
    label,
    p1: null,
    p2: null,
    bestOf,
    next,
  });
  plan.push(playoff("Semifinal 1", 2, lengths.semis, { index: sf1 + 2, slot: "p1" }));
  plan.push(playoff("Semifinal 2", 2, lengths.semis, { index: sf1 + 2, slot: "p2" }));
  plan.push(playoff("Final", 3, lengths.final, null));

  const groups: Record<string, GroupLabel> = {};
  for (const id of split.A) groups[id] = "A";
  for (const id of split.B) groups[id] = "B";
  return { plan, groups };
}

/** Semifinal pairings from the final group tables (ids in finishing order): A1 vs B2, B1 vs A2. */
export function semifinalPairs(tableA: readonly string[], tableB: readonly string[]): [Pair, Pair] {
  return [
    [tableA[0]!, tableB[1]!],
    [tableB[0]!, tableA[1]!],
  ];
}
