export interface QueuedMatch {
  play_order: number;
  status: "pending" | "live" | "done";
  p1_id: string | null;
  p2_id: string | null;
}

/**
 * The match that should go live next: the earliest pending match by play_order,
 * but only once both its players are known. Returns null if it's still waiting
 * (e.g. a final whose semifinal hasn't finished) or nothing is pending.
 */
export function nextMatchToPlay<T extends QueuedMatch>(matches: readonly T[]): T | null {
  const next = matches
    .filter((m) => m.status === "pending")
    .sort((a, b) => a.play_order - b.play_order)[0];
  return next?.p1_id && next.p2_id ? next : null;
}

/** True once every match has been played. */
export function allMatchesDone(matches: readonly QueuedMatch[]): boolean {
  return matches.every((m) => m.status === "done");
}
