import { describe, expect, it } from "bun:test";
import { escapeXml, intoRounds, renderBracketImage, type BracketMatch, type BracketSlot } from "./bracket-image.ts";

const size = (png: Uint8Array) => {
  const view = new DataView(png.buffer, png.byteOffset);
  return { width: view.getUint32(16), height: view.getUint32(20) };
};
const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

const slot = (name: string | null, extra: Partial<BracketSlot> = {}): BracketSlot => ({
  name,
  placeholder: "Winner of Semifinal 1",
  avatar: null,
  team: null,
  seed: null,
  score: null,
  won: false,
  ...extra,
});
const match = (status: BracketMatch["status"], p1: BracketSlot, p2: BracketSlot): BracketMatch => ({
  label: "Match",
  bestOf: 1,
  status,
  p1,
  p2,
});

const fourPlayer = (): BracketMatch[] => [
  match("done", slot("A", { seed: 1, team: "goons", score: 3, won: true }), slot("B", { seed: 2, team: "gooners", score: 1 })),
  match("live", slot("C", { seed: 3, team: "gooners" }), slot("D", { seed: 4, team: "goons" })),
  match("pending", slot("A"), slot(null)),
];

describe("escapeXml", () => {
  it("escapes characters that would break SVG", () => {
    expect(escapeXml(`Sam & <Co> "Q" 'x'`)).toBe("Sam &amp; &lt;Co&gt; &quot;Q&quot; &apos;x&apos;");
  });
});

describe("intoRounds", () => {
  it("splits plan order into halving rounds", () => {
    expect(intoRounds([1, 2, 3])).toEqual([[1, 2], [3]]);
    expect(intoRounds([1, 2, 3, 4, 5, 6, 7])).toEqual([[1, 2, 3, 4], [5, 6], [7]]);
  });
});

describe("renderBracketImage", () => {
  it("sizes a 4-player bracket to two rounds plus the champion column", () => {
    expect(size(renderBracketImage(fourPlayer(), null))).toEqual({ width: 1054, height: 356 });
  });

  it("is taller and wider for 8 players", () => {
    const eight = [...Array(4)].map(() => fourPlayer()[0]!).concat(fourPlayer());
    expect(size(renderBracketImage(eight, null))).toEqual({ width: 1424, height: 668 });
  });

  it("draws the champion once there is one", () => {
    const matches = fourPlayer();
    const withChampion = renderBracketImage(matches, { name: "A", avatar: null });
    expect(same(withChampion, renderBracketImage(matches, null))).toBe(false);
  });

  it("reflects scores, long names and avatars", () => {
    const plain = renderBracketImage(fourPlayer(), null);
    const changed = fourPlayer();
    changed[1]!.p1 = slot("A really very long player name", { seed: 3, score: 2, avatar: new Uint8Array([1, 2, 3]) });
    expect(same(plain, renderBracketImage(changed, null))).toBe(false);
  });
});
