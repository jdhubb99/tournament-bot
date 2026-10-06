import { describe, expect, it } from "bun:test";
import type { BracketMatch, BracketSlot } from "./bracket-image.ts";
import { layoutTable, renderGroupsImage, renderStandingsImage, type StandingsImageRow } from "./standings-image.ts";

const size = (png: Uint8Array) => {
  const view = new DataView(png.buffer, png.byteOffset);
  return { width: view.getUint32(16), height: view.getUint32(20) };
};
const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

const row = (name: string, wins: number, losses: number, goalsFor: number, goalsAgainst: number): StandingsImageRow => ({
  name,
  avatar: null,
  played: wins + losses,
  wins,
  losses,
  goalsFor,
  goalsAgainst,
  dropped: false,
});
const rows = [row("A", 4, 0, 8, 2), row("B", 3, 1, 6, 4), row("C", 2, 2, 5, 5), row("D", 1, 3, 3, 6), row("E", 0, 4, 2, 7)];
const slot = (name: string | null, extra: Partial<BracketSlot> = {}): BracketSlot => ({
  name,
  placeholder: "League 1st place",
  avatar: null,
  team: null,
  seed: null,
  score: null,
  won: false,
  forfeited: false,
  ...extra,
});
const emptyFinal: BracketMatch = { label: "Final", bestOf: 3, status: "pending", p1: slot(null), p2: slot(null) };

describe("renderStandingsImage", () => {
  it("fits five rows, the final and the champion", () => {
    expect(size(renderStandingsImage(rows, emptyFinal, null))).toEqual({ width: 1340, height: 420 });
  });

  it("changes with the table, the final and the champion", () => {
    const base = renderStandingsImage(rows, emptyFinal, null);
    const reordered = renderStandingsImage([rows[1]!, rows[0]!, ...rows.slice(2)], emptyFinal, null);
    const filled: BracketMatch = { ...emptyFinal, status: "live", p1: slot("A", { team: "goons" }), p2: slot("B", { team: "gooners" }) };
    expect(same(base, reordered)).toBe(false);
    expect(same(base, renderStandingsImage(rows, filled, null))).toBe(false);
    expect(same(base, renderStandingsImage(rows, emptyFinal, { name: "A", avatar: null }))).toBe(false);
  });

  it("shows positive, zero and negative goal differences", () => {
    const even = renderStandingsImage([row("A", 1, 0, 3, 3)], emptyFinal, null);
    const ahead = renderStandingsImage([row("A", 1, 0, 4, 3)], emptyFinal, null);
    const behind = renderStandingsImage([row("A", 1, 0, 2, 3)], emptyFinal, null);
    expect(same(even, ahead) || same(even, behind) || same(ahead, behind)).toBe(false);
  });
});

describe("up next list", () => {
  const upcoming = (n: number) =>
    [...Array(n)].map((_, i) => ({ label: `Match ${i + 5}`, p1: "A", p2: "B", live: i === 0 }));

  it("adds a card under the table with a line per match, plus one for '+N more'", () => {
    // 420 without the list; the list adds a 44px header, 34px per line and 20px of padding.
    expect(size(renderStandingsImage(rows, emptyFinal, null, { matches: upcoming(2), more: 0 })).height).toBe(420 + 44 + 2 * 34 + 20);
    expect(size(renderStandingsImage(rows, emptyFinal, null, { matches: upcoming(4), more: 3 })).height).toBe(420 + 44 + 5 * 34 + 20);
  });

  it("leaves the list out when nothing is left to play", () => {
    expect(size(renderStandingsImage(rows, emptyFinal, null, { matches: [], more: 0 })).height).toBe(420);
  });

  it("marks the live match differently from the rest", () => {
    const live = renderStandingsImage(rows, emptyFinal, null, { matches: upcoming(1), more: 0 });
    const waiting = renderStandingsImage(rows, emptyFinal, null, { matches: [{ ...upcoming(1)[0]!, live: false }], more: 0 });
    expect(same(live, waiting)).toBe(false);
  });
});

describe("renderGroupsImage", () => {
  const playoffs: BracketMatch[] = [
    { label: "Semifinal 1", bestOf: 1, status: "pending", p1: slot(null, { seed: "A1" }), p2: slot(null, { seed: "B2" }) },
    { label: "Semifinal 2", bestOf: 1, status: "pending", p1: slot(null, { seed: "B1" }), p2: slot(null, { seed: "A2" }) },
    { label: "Final", bestOf: 3, status: "pending", p1: slot(null), p2: slot(null) },
  ];
  const groups = { A: rows.slice(0, 4), B: rows.slice(4).concat(row("F", 0, 1, 0, 1), row("G", 0, 1, 0, 1)) };

  it("stacks both group tables beside the playoff bracket", () => {
    // Group A has 4 rows and Group B 3: both tables, the gap and the key on the left; the bracket on the right.
    expect(size(renderGroupsImage(groups, playoffs, null))).toEqual({ width: 1710, height: 588 });
  });

  it("grows to fit the up next list and changes with the champion", () => {
    const upNext = { matches: [{ label: "Group A - Match 5", p1: "A", p2: "B", live: true }], more: 0 };
    expect(size(renderGroupsImage(groups, playoffs, null, upNext)).height).toBe(588 + 44 + 34 + 20);
    expect(same(renderGroupsImage(groups, playoffs, null), renderGroupsImage(groups, playoffs, { name: "A", avatar: null }))).toBe(false);
  });
});

describe("layoutTable highlights", () => {
  const columns = [{ label: "W", x: 300, value: (r: StandingsImageRow) => String(r.wins) }];

  it("colors each highlighted row and draws the cutoff line in the last color", () => {
    const { svg } = layoutTable(0, 0, "T", rows, "t", columns, { colors: ["#111111", "#222222"], cutoff: true });
    expect(svg.match(/#111111/g)?.length).toBe(3); // bar, rank, ring
    expect(svg.match(/#222222/g)?.length).toBe(4); // bar, rank, ring, cutoff line
  });

  it("leaves out the cutoff line when asked", () => {
    const { svg } = layoutTable(0, 0, "T", rows, "t", columns, { colors: ["#aaaaaa", "#bbbbbb", "#cccccc"], cutoff: false });
    expect([/#aaaaaa/g, /#bbbbbb/g, /#cccccc/g].map((re) => svg.match(re)?.length)).toEqual([3, 3, 3]);
  });

  it("dims the names of players who dropped", () => {
    const dropped = rows.map((r, i) => ({ ...r, dropped: i === 4 }));
    const plain = layoutTable(0, 0, "T", rows, "t", columns, { colors: [], cutoff: false }).svg;
    expect(layoutTable(0, 0, "T", dropped, "t", columns, { colors: [], cutoff: false }).svg).not.toBe(plain);
  });

  it("can hide the rank numbers", () => {
    const ranked = layoutTable(0, 0, "T", rows, "t", columns, { colors: [], cutoff: false }).svg;
    const unranked = layoutTable(0, 0, "T", rows, "t", columns, { colors: [], cutoff: false }, false).svg;
    expect(ranked.includes(">5</text>")).toBe(true);
    expect(unranked.length).toBeLessThan(ranked.length);
  });
});
