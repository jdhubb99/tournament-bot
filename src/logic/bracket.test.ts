import { describe, expect, it } from "bun:test";
import { singleElim } from "./bracket.ts";

const lengths = { semis: 1, final: 3 };

describe("singleElim", () => {
  it("builds two semis feeding a final for 4 players", () => {
    const plan = singleElim(["s1", "s2", "s3", "s4"], lengths);
    expect(plan.map((m) => [m.label, m.p1, m.p2, m.bestOf, m.playOrder])).toEqual([
      ["Semifinal 1", "s1", "s2", 1, 1],
      ["Semifinal 2", "s3", "s4", 1, 2],
      ["Final", null, null, 3, 3],
    ]);
    expect(plan[0]!.next).toEqual({ index: 2, slot: "p1" });
    expect(plan[1]!.next).toEqual({ index: 2, slot: "p2" });
    expect(plan[2]!.next).toBeNull();
  });

  it("builds quarters, semis and final for 8 players", () => {
    const plan = singleElim(["1", "2", "3", "4", "5", "6", "7", "8"], { semis: 3, final: 5 });
    expect(plan.map((m) => m.label)).toEqual([
      "Quarterfinal 1", "Quarterfinal 2", "Quarterfinal 3", "Quarterfinal 4",
      "Semifinal 1", "Semifinal 2", "Final",
    ]);
    expect(plan.map((m) => m.bestOf)).toEqual([1, 1, 1, 1, 3, 3, 5]);
    expect(plan.slice(0, 4).map((m) => [m.p1, m.p2])).toEqual([["1", "2"], ["3", "4"], ["5", "6"], ["7", "8"]]);
    expect(plan.map((m) => m.next)).toEqual([
      { index: 4, slot: "p1" }, { index: 4, slot: "p2" },
      { index: 5, slot: "p1" }, { index: 5, slot: "p2" },
      { index: 6, slot: "p1" }, { index: 6, slot: "p2" },
      null,
    ]);
  });

  it("rejects other player counts", () => {
    expect(() => singleElim(["a", "b", "c"], lengths)).toThrow();
  });
});
