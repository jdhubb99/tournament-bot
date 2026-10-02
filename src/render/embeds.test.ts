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

  it("is yellow with both avatars while live", () => {
    const embed = matchEmbed({ ...players, label: "Semifinal 1", bestOf: 3, p1Wins: 1, p2Wins: 0, finished: false }).toJSON();
    expect(embed.color).toBe(0xf1c40f);
    expect(embed.title).toBe("Semifinal 1 — Live");
    expect(embed.author).toEqual({ name: "Alice", icon_url: "https://cdn.test/a.png" });
    expect(embed.thumbnail?.url).toBe("https://cdn.test/b.png");
    expect(embed.description).toBe("<@a> vs <@b>");
    expect(embed.fields).toEqual([
      { name: "Series", value: "Best of 3", inline: true },
      { name: "Score", value: "Alice **1 – 0** Bob", inline: true },
    ]);
  });

  it("is green when finished", () => {
    const embed = matchEmbed({ ...players, label: "Final", bestOf: 1, p1Wins: 0, p2Wins: 1, finished: true }).toJSON();
    expect(embed.color).toBe(0x2ecc71);
    expect(embed.title).toBe("Final — Finished");
  });
});
