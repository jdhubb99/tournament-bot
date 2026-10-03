import { describe, expect, it } from "bun:test";
import { groupsPlan, semifinalPairs, splitGroups } from "./groups.ts";

const six = ["a", "b", "c", "d", "e", "f"];
const seven = [...six, "g"];
const backToBacks = (pairs: (string | null)[][]) =>
  pairs.slice(1).filter((p, i) => p.some((id) => id !== null && pairs[i]!.includes(id))).length;

describe("splitGroups", () => {
  it("puts the first 3 of 6 in Group A", () => {
    expect(splitGroups(six)).toEqual({ A: ["a", "b", "c"], B: ["d", "e", "f"] });
  });

  it("puts the first 4 of 7 in Group A", () => {
    expect(splitGroups(seven)).toEqual({ A: ["a", "b", "c", "d"], B: ["e", "f", "g"] });
  });
});

describe("groupsPlan", () => {
  it("has 6 group matches, 2 semis and a final for 6 players", () => {
    const { plan, groups } = groupsPlan(six, { semis: 3, final: 5 });
    expect(plan.map((m) => m.label)).toEqual([
      "Group A - Match 1", "Group B - Match 1", "Group A - Match 2", "Group B - Match 2",
      "Group A - Match 3", "Group B - Match 3", "Semifinal 1", "Semifinal 2", "Final",
    ]);
    expect(plan.map((m) => m.playOrder)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(plan.map((m) => [m.round, m.bestOf])).toEqual([
      [1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [2, 3], [2, 3], [3, 5],
    ]);
    expect(groups).toEqual({ a: "A", b: "A", c: "A", d: "B", e: "B", f: "B" });
  });

  it("keeps every group match inside its group, each pair once", () => {
    const { plan, groups } = groupsPlan(seven, { semis: 1, final: 3 });
    const group = plan.filter((m) => m.round === 1);
    expect(group).toHaveLength(9); // 6 in a group of 4, 3 in a group of 3
    for (const m of group) {
      expect(groups[m.p1!]).toBe(groups[m.p2!]!);
      expect(m.label).toStartWith(`Group ${groups[m.p1!]} - `);
    }
    const pairs = group.map((m) => [m.p1, m.p2].sort().join("-"));
    expect(new Set(pairs).size).toBe(9);
  });

  it("alternates the groups and lets the bigger group finish last", () => {
    const { plan } = groupsPlan(seven, { semis: 1, final: 3 });
    const order = plan.filter((m) => m.round === 1).map((m) => m.label[6]);
    expect(order.join("")).toBe("ABABABAAA");
  });

  it("has no back-to-backs while the groups alternate", () => {
    const { plan } = groupsPlan(six, { semis: 1, final: 3 });
    expect(backToBacks(plan.filter((m) => m.round === 1).map((m) => [m.p1, m.p2]))).toBe(0);
  });

  it("creates empty semis that feed the final", () => {
    const { plan } = groupsPlan(six, { semis: 1, final: 3 });
    const [sf1, sf2, final] = plan.slice(-3);
    expect(sf1).toMatchObject({ p1: null, p2: null, next: { index: 8, slot: "p1" } });
    expect(sf2).toMatchObject({ p1: null, p2: null, next: { index: 8, slot: "p2" } });
    expect(final).toMatchObject({ p1: null, p2: null, next: null });
  });
});

describe("semifinalPairs", () => {
  it("crosses the groups: A1 vs B2 and B1 vs A2", () => {
    expect(semifinalPairs(["a1", "a2", "a3"], ["b1", "b2", "b3"])).toEqual([
      ["a1", "b2"],
      ["b1", "a2"],
    ]);
  });
});
