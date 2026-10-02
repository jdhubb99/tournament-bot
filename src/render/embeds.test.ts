import { describe, expect, it } from "bun:test";
import { championEmbed, liveMatchEmbed, matchResultEmbed, resultLine, signupEmbed } from "./embeds.ts";

describe("signupEmbed", () => {
  const base = { semisBestOf: 1, finalBestOf: 3, maxPlayers: 8 };

  it("shows an empty open signup", () => {
    const embed = signupEmbed({ ...base, players: [], closed: false }).toJSON();
    expect(embed.title).toBe("Rocket League 1v1 — Signup open");
    expect(embed.fields).toEqual([
      { name: "Players (0/8)", value: "_No one yet_" },
      { name: "Series", value: "Semis Bo1 · Final Bo3" },
    ]);
  });

  it("lists players and marks signup closed", () => {
    const embed = signupEmbed({ ...base, players: [{ discord_id: "a" }, { discord_id: "b" }], closed: true }).toJSON();
    expect(embed.title).toBe("Rocket League 1v1 — Signup closed");
    expect(embed.fields?.[0]).toEqual({ name: "Players (2/8)", value: "1. <@a>\n2. <@b>" });
  });
});

const players = {
  p1: { id: "a", name: "Alice", avatarUrl: "https://cdn.test/a.png" },
  p2: { id: "b", name: "Bob", avatarUrl: "https://cdn.test/b.png" },
};

describe("liveMatchEmbed", () => {
  it("is red with the versus image and the format", () => {
    const embed = liveMatchEmbed({ ...players, label: "Semifinal 1", bestOf: 3 }).toJSON();
    expect(embed.color).toBe(0xed4245);
    expect(embed.title).toBe("Semifinal 1 — Live");
    expect(embed.description).toBe("<@a> vs <@b>");
    expect(embed.image?.url).toBe("attachment://versus.png");
    expect(embed.thumbnail).toBeUndefined();
    expect(embed.fields).toEqual([{ name: "Format", value: "Best of 3 (first to 2)" }]);
  });

  it("just says best of 1 for single games", () => {
    expect(liveMatchEmbed({ ...players, label: "Semifinal 1", bestOf: 1 }).toJSON().fields).toEqual([
      { name: "Format", value: "Best of 1" },
    ]);
  });
});

describe("matchResultEmbed", () => {
  it("shows the goals as the final score for a best of 1", () => {
    const embed = matchResultEmbed({
      ...players,
      label: "Semifinal 1",
      bestOf: 1,
      games: [{ p1_score: 6, p2_score: 5 }],
      winnerId: "a",
    }).toJSON();
    expect(embed.color).toBe(0x2ecc71);
    expect(embed.title).toBe("Semifinal 1 — Alice wins");
    expect(embed.thumbnail?.url).toBe("attachment://winner.png");
    expect(embed.image).toBeUndefined();
    expect(embed.fields).toEqual([{ name: "Final score", value: "**Alice** 6 – 5 Bob" }]);
  });

  it("shows games won and each game's goals for a longer series", () => {
    const embed = matchResultEmbed({
      ...players,
      label: "Final",
      bestOf: 3,
      games: [
        { p1_score: 6, p2_score: 5 },
        { p1_score: 2, p2_score: 3 },
        { p1_score: 0, p2_score: 4 },
      ],
      winnerId: "b",
    }).toJSON();
    expect(embed.title).toBe("Final — Bob wins");
    expect(embed.thumbnail?.url).toBe("attachment://winner.png");
    expect(embed.fields).toEqual([
      { name: "Series (best of 3)", value: "Alice 1 – 2 **Bob**" },
      { name: "Games", value: "Game 1: Alice 6–5\nGame 2: Bob 3–2\nGame 3: Bob 4–0" },
    ]);
  });
});

describe("resultLine", () => {
  const base = { winnerName: "Jake", loserName: "Benny" };

  it("shows goals for a best of 1", () => {
    expect(resultLine({ ...base, label: "Semifinal 1", winnerScore: 6, loserScore: 5, series: false })).toBe(
      "Semifinal 1: **Jake** def. Benny (6–5)",
    );
  });

  it("labels games won for a longer series", () => {
    expect(resultLine({ ...base, label: "Final", winnerScore: 2, loserScore: 1, series: true })).toBe(
      "Final: **Jake** def. Benny (series 2–1)",
    );
  });
});

describe("championEmbed", () => {
  it("is gold with the champion's avatar, runner-up and results", () => {
    const embed = championEmbed({
      champion: { id: "j", name: "Jake", avatarUrl: "https://cdn.test/j.png" },
      runnerUpName: "Benny",
      results: ["Semifinal 1: **Jake** def. A (3–1)", "Final: **Jake** def. Benny (2–1)"],
    }).toJSON();
    expect(embed.color).toBe(0xd4af37);
    expect(embed.title).toBe("🏆 Jake is the champion!");
    expect(embed.thumbnail?.url).toBe("attachment://winner.png");
    expect(embed.fields).toEqual([
      { name: "Runner-up", value: "Benny" },
      { name: "Results", value: "Semifinal 1: **Jake** def. A (3–1)\nFinal: **Jake** def. Benny (2–1)" },
    ]);
  });
});
