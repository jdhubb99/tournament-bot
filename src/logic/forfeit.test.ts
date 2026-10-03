import { describe, expect, it } from "bun:test";
import { droppedLast, isOut, nextForfeit, wonByForfeit, type ForfeitMatch } from "./forfeit.ts";

const win = { p1_score: 3, p2_score: 1 };

function match(overrides: Partial<ForfeitMatch>): ForfeitMatch {
  return { round: 1, play_order: 1, status: "pending", p1_id: null, p2_id: null, winner_id: null, best_of: 1, ...overrides };
}

describe("wonByForfeit", () => {
  it("is a decided match whose games don't decide it", () => {
    expect(wonByForfeit(match({ status: "done" }), [])).toBe(true);
    expect(wonByForfeit(match({ status: "done", best_of: 3 }), [win])).toBe(true);
  });

  it("isn't a match decided by its games, or one still undecided", () => {
    expect(wonByForfeit(match({ status: "done" }), [win])).toBe(false);
    expect(wonByForfeit(match({ status: "done", best_of: 3 }), [win, win])).toBe(false);
    expect(wonByForfeit(match({ status: "live" }), [])).toBe(false);
    expect(wonByForfeit(match({ status: "pending" }), [])).toBe(false);
  });
});

describe("nextForfeit", () => {
  const dropped = new Set(["x", "y"]);

  it("finds the earliest pending match with a dropped player, won by the other player", () => {
    const later = match({ play_order: 3, p1_id: "a", p2_id: "x" });
    const earlier = match({ play_order: 2, p1_id: "y", p2_id: "b" });
    expect(nextForfeit([later, earlier], dropped)).toEqual({ match: earlier, winnerId: "b" });
    expect(nextForfeit([later], dropped)).toEqual({ match: later, winnerId: "a" });
  });

  it("advances p1 when both players dropped", () => {
    const both = match({ p1_id: "x", p2_id: "y" });
    expect(nextForfeit([both], dropped)).toEqual({ match: both, winnerId: "x" });
  });

  it("waits for both players and skips live, decided and unaffected matches", () => {
    expect(
      nextForfeit(
        [
          match({ p1_id: "x", p2_id: null }),
          match({ status: "live", p1_id: "x", p2_id: "a" }),
          match({ status: "done", p1_id: "x", p2_id: "a", winner_id: "a" }),
          match({ p1_id: "a", p2_id: "b" }),
        ],
        dropped,
      ),
    ).toBeNull();
  });
});

describe("isOut", () => {
  it("in single elim, is anyone who lost a match", () => {
    const matches = [
      match({ status: "done", p1_id: "a", p2_id: "b", winner_id: "a" }),
      match({ round: 2, play_order: 3, p1_id: "a" }),
    ];
    expect(isOut("b", matches, "single_elim")).toBe(true);
    expect(isOut("a", matches, "single_elim")).toBe(false);
    expect(isOut("c", matches, "single_elim")).toBe(false);
  });

  it("during a league or group stage, is nobody, even after losing stage matches", () => {
    const matches = [
      match({ status: "done", p1_id: "a", p2_id: "b", winner_id: "a" }),
      match({ status: "live", play_order: 2, p1_id: "b", p2_id: "c" }),
      match({ round: 2, play_order: 3 }),
    ];
    for (const format of ["round_robin", "groups"] as const) expect(isOut("b", matches, format)).toBe(false);
  });

  it("after the stage, is anyone who missed the playoffs or lost one", () => {
    const matches = [
      match({ status: "done", p1_id: "a", p2_id: "b", winner_id: "a" }),
      match({ status: "done", play_order: 2, p1_id: "b", p2_id: "c", winner_id: "c" }),
      match({ round: 2, play_order: 3, status: "done", p1_id: "a", p2_id: "c", winner_id: "c" }),
      match({ round: 3, play_order: 4, p1_id: "c" }),
    ];
    expect(isOut("b", matches, "groups")).toBe(true);
    expect(isOut("a", matches, "groups")).toBe(true);
    expect(isOut("c", matches, "groups")).toBe(false);
  });
});

describe("droppedLast", () => {
  it("moves dropped players to the bottom, keeping everyone else's order", () => {
    const rows = ["a", "x", "b", "y", "c"].map((playerId) => ({ playerId }));
    expect(droppedLast(rows, new Set(["x", "y"])).map((r) => r.playerId)).toEqual(["a", "b", "c", "x", "y"]);
    expect(droppedLast(rows, new Set()).map((r) => r.playerId)).toEqual(["a", "x", "b", "y", "c"]);
  });
});
