import { describe, expect, it } from "bun:test";
import { allMatchesDone, nextMatchToPlay, type QueuedMatch } from "./queue.ts";

const m = (play_order: number, status: QueuedMatch["status"], p1: string | null, p2: string | null) => ({
  play_order,
  status,
  p1_id: p1,
  p2_id: p2,
});

describe("nextMatchToPlay", () => {
  it("picks the earliest pending match by play_order", () => {
    const matches = [m(3, "pending", "x", "y"), m(1, "done", "a", "b"), m(2, "pending", "c", "d")];
    expect(nextMatchToPlay(matches)?.play_order).toBe(2);
  });

  it("waits when the next match is missing a player", () => {
    const matches = [m(1, "done", "a", "b"), m(2, "pending", "a", null), m(3, "pending", "c", "d")];
    expect(nextMatchToPlay(matches)).toBeNull();
  });

  it("returns null when nothing is pending", () => {
    expect(nextMatchToPlay([m(1, "done", "a", "b")])).toBeNull();
    expect(nextMatchToPlay([])).toBeNull();
  });
});

describe("allMatchesDone", () => {
  it("is true only when every match is done", () => {
    expect(allMatchesDone([m(1, "done", "a", "b"), m(2, "done", "a", "c")])).toBe(true);
    expect(allMatchesDone([m(1, "done", "a", "b"), m(2, "live", "a", "c")])).toBe(false);
  });
});
