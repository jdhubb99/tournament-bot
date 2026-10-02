import { describe, expect, it } from "bun:test";
import { matchEmbed, signupEmbed } from "./embeds.ts";

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

describe("matchEmbed", () => {
  const players = {
    p1: { id: "a", name: "Alice", avatarUrl: "https://cdn.test/a.png" },
    p2: { id: "b", name: "Bob", avatarUrl: "https://cdn.test/b.png" },
  };

  it("is red with the versus image while live", () => {
    const embed = matchEmbed({ ...players, label: "Semifinal 1", bestOf: 3, p1Wins: 1, p2Wins: 0 }).toJSON();
    expect(embed.color).toBe(0xed4245);
    expect(embed.title).toBe("Semifinal 1 — Live");
    expect(embed.image?.url).toBe("attachment://versus.png");
    expect(embed.thumbnail).toBeUndefined();
    expect(embed.author).toBeUndefined();
    expect(embed.description).toBe("<@a> vs <@b>");
    expect(embed.fields).toEqual([
      { name: "Series", value: "Best of 3", inline: true },
      { name: "Score", value: "Alice **1 – 0** Bob", inline: true },
    ]);
  });

  it("is green with only the winner's avatar once decided", () => {
    const embed = matchEmbed({ ...players, label: "Final", bestOf: 3, p1Wins: 1, p2Wins: 2, winnerId: "b" }).toJSON();
    expect(embed.color).toBe(0x2ecc71);
    expect(embed.title).toBe("Final — Bob wins");
    expect(embed.thumbnail?.url).toBe("https://cdn.test/b.png");
    expect(embed.image).toBeUndefined();
  });
});
