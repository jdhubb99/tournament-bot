export type Slot = "p1" | "p2";

export interface SeriesLengths {
  semis: number;
  final: number;
}

/** A match to create at tournament start. `next` points at another entry in the same plan by index. */
export interface PlannedMatch {
  round: number;
  playOrder: number;
  label: string;
  p1: string | null;
  p2: string | null;
  bestOf: number;
  next: { index: number; slot: Slot } | null;
}

/**
 * Single elimination for 4 or 8 seeded players (index 0 = seed 1).
 * Round 1 pairs adjacent seeds (1v2, 3v4, ...). Winners of matches 2i and 2i+1
 * meet in match i of the next round. Matches are played in plan order.
 */
export function singleElim(seeded: readonly string[], lengths: SeriesLengths): PlannedMatch[] {
  if (seeded.length !== 4 && seeded.length !== 8) {
    throw new Error(`Single elimination needs 4 or 8 players, got ${seeded.length}`);
  }

  const plan: PlannedMatch[] = [];
  let previousRound: number[] = [];
  let round = 1;

  for (let size = seeded.length / 2; size >= 1; size /= 2, round++) {
    const thisRound: number[] = [];
    for (let i = 0; i < size; i++) {
      const index = plan.length;
      plan.push({
        round,
        playOrder: index + 1,
        label: roundLabel(size, i),
        p1: round === 1 ? seeded[2 * i]! : null,
        p2: round === 1 ? seeded[2 * i + 1]! : null,
        bestOf: size === 1 ? lengths.final : size === 2 ? lengths.semis : 1,
        next: null,
      });
      thisRound.push(index);
    }
    previousRound.forEach((index, i) => {
      plan[index]!.next = { index: thisRound[Math.floor(i / 2)]!, slot: i % 2 === 0 ? "p1" : "p2" };
    });
    previousRound = thisRound;
  }

  return plan;
}

function roundLabel(matchesInRound: number, i: number): string {
  if (matchesInRound === 1) return "Final";
  if (matchesInRound === 2) return `Semifinal ${i + 1}`;
  return `Quarterfinal ${i + 1}`;
}
