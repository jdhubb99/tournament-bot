export type Side = "p1" | "p2";

export interface GameScore {
  p1_score: number;
  p2_score: number;
}

export interface SeriesState {
  p1Wins: number;
  p2Wins: number;
  winsNeeded: number;
  winner: Side | null;
}

export function winsNeeded(bestOf: number): number {
  return Math.floor(bestOf / 2) + 1;
}

/** Counts game wins in a series. Games are never tied (validated at report time). */
export function seriesState(games: readonly GameScore[], bestOf: number): SeriesState {
  const needed = winsNeeded(bestOf);
  const p1Wins = games.filter((g) => g.p1_score > g.p2_score).length;
  const p2Wins = games.length - p1Wins;
  const winner = p1Wins >= needed ? "p1" : p2Wins >= needed ? "p2" : null;
  return { p1Wins, p2Wins, winsNeeded: needed, winner };
}

export type ReportCheck =
  | { ok: true; p1Score: number; p2Score: number }
  | { ok: false; reason: "not_in_match" | "not_higher" | "negative" };

/**
 * Validates a `/report` against the live match's players and converts the
 * winner/loser scores into p1/p2 scores.
 */
export function checkReport(
  players: { p1: string; p2: string },
  winnerId: string,
  winnerScore: number,
  loserScore: number,
): ReportCheck {
  if (winnerId !== players.p1 && winnerId !== players.p2) return { ok: false, reason: "not_in_match" };
  if (!Number.isInteger(winnerScore) || !Number.isInteger(loserScore) || winnerScore < 0 || loserScore < 0) {
    return { ok: false, reason: "negative" };
  }
  if (winnerScore <= loserScore) return { ok: false, reason: "not_higher" };
  return winnerId === players.p1
    ? { ok: true, p1Score: winnerScore, p2Score: loserScore }
    : { ok: true, p1Score: loserScore, p2Score: winnerScore };
}

/** The two rounds whose series length is an option. Everything else is always best of 1. */
export type Stage = "semis" | "final";

/** Which length option a match follows, from its label, or null for a match that's always best of 1. */
export function stageOf(label: string): Stage | null {
  if (label === "Final") return "final";
  if (label.startsWith("Semifinal")) return "semis";
  return null;
}

export interface StageMatch {
  label: string;
  status: "pending" | "live" | "done";
  games: readonly GameScore[];
}

export type LengthCheck =
  | { ok: true }
  | { ok: false; reason: "decided"; label: string }
  | { ok: false; reason: "too_short"; label: string; series: SeriesState };

/**
 * Whether a stage's matches can switch to a new length. Not once any of them is decided,
 * so both semis always share a length, and not to a length the games already played in
 * the live one would decide.
 */
export function checkLengthChange(matches: readonly StageMatch[], bestOf: number): LengthCheck {
  const decided = matches.find((m) => m.status === "done");
  if (decided) return { ok: false, reason: "decided", label: decided.label };
  for (const m of matches) {
    const series = seriesState(m.games, bestOf);
    if (series.winner) return { ok: false, reason: "too_short", label: m.label, series };
  }
  return { ok: true };
}

/** "Jake leads the series 2–1", "Series tied 1–1", or "Jake wins the series 2–1". Leader's wins come first. */
export function describeSeries(state: SeriesState, p1Name: string, p2Name: string): string {
  const { p1Wins, p2Wins } = state;
  const [leader, high, low] = p1Wins >= p2Wins ? [p1Name, p1Wins, p2Wins] : [p2Name, p2Wins, p1Wins];
  if (state.winner) return `${leader} wins the series ${high}–${low}`;
  if (p1Wins === p2Wins) return `Series tied ${p1Wins}–${p2Wins}`;
  return `${leader} leads the series ${high}–${low}`;
}
