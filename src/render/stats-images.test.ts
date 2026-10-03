import { describe, expect, it } from "bun:test";
import { renderLeaderboardImage, renderPlayerStatsImage, type LeaderboardRow } from "./stats-images.ts";

const size = (png: Uint8Array) => {
  const view = new DataView(png.buffer, png.byteOffset);
  return { width: view.getUint32(16), height: view.getUint32(20) };
};
const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

const row = (name: string, titles: number, wins: number, losses: number): LeaderboardRow => ({
  name,
  avatar: null,
  titles,
  wins,
  losses,
  gameWins: wins,
  gameLosses: losses,
  goalsFor: wins * 2,
  goalsAgainst: losses * 2,
});

describe("renderLeaderboardImage", () => {
  it("is one table, a row per player", () => {
    expect(size(renderLeaderboardImage("Rocket League", [row("A", 2, 5, 1), row("B", 0, 1, 5)]))).toEqual({
      width: 700,
      height: 40 + 40 + 2 * 52 + 40,
    });
  });

  it("changes with the records", () => {
    const base = renderLeaderboardImage("Rocket League", [row("A", 2, 5, 1)]);
    expect(same(base, renderLeaderboardImage("Rocket League", [row("A", 3, 5, 1)]))).toBe(false);
  });
});

describe("renderPlayerStatsImage", () => {
  it("has a profile card above a head-to-head row per opponent", () => {
    const png = renderPlayerStatsImage(row("A", 1, 3, 1), [row("B", 0, 2, 0), row("C", 0, 1, 1)]);
    expect(size(png)).toEqual({ width: 700, height: 40 + 128 + 24 + 40 + 2 * 52 + 40 });
  });

  it("rings title winners in gold and says 1 title or N titles", () => {
    const opponents = [row("B", 0, 1, 0)];
    const none = renderPlayerStatsImage(row("A", 0, 1, 0), opponents);
    const one = renderPlayerStatsImage(row("A", 1, 1, 0), opponents);
    const two = renderPlayerStatsImage(row("A", 2, 1, 0), opponents);
    expect(same(none, one) || same(one, two)).toBe(false);
  });
});
