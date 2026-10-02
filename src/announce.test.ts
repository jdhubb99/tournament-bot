import { afterEach, beforeEach, describe, expect, it, spyOn, type Mock } from "bun:test";
import { announceChampion, announceLiveMatch, fetchAvatar, seriesResultEmbed } from "./announce.ts";
import { useTournamentChannel } from "./channel.ts";
import { getLiveMatch, getMatch, recordGame, type Match } from "./store.ts";
import { arg, cast, fakeChannel, resetDb, startedTournament } from "./test/helpers.ts";

const match: Match = {
  id: 1,
  tournament_id: 1,
  round: 1,
  play_order: 1,
  label: "Semifinal 1",
  p1_id: "a",
  p2_id: "b",
  best_of: 3,
  winner_id: null,
  next_match_id: 3,
  next_slot: "p1",
  status: "live",
  p1_team: "gooners",
};

let fetchSpy: Mock<typeof fetch>;

beforeEach(() => {
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async () => new Response(new Uint8Array([1, 2, 3]))) as never);
});

afterEach(() => {
  fetchSpy.mockRestore();
});

describe("fetchAvatar", () => {
  it("returns the downloaded bytes", async () => {
    expect(await fetchAvatar("https://cdn.test/a.png")).toEqual(new Uint8Array([1, 2, 3]));
    expect(fetchSpy).toHaveBeenCalledWith("https://cdn.test/a.png");
  });

  it("returns null for an error status", async () => {
    fetchSpy.mockImplementation((async () => new Response("nope", { status: 404 })) as never);
    expect(await fetchAvatar("https://cdn.test/a.png")).toBeNull();
  });

  it("returns null when the request fails", async () => {
    fetchSpy.mockImplementation((async () => {
      throw new Error("offline");
    }) as never);
    expect(await fetchAvatar("https://cdn.test/a.png")).toBeNull();
  });
});

describe("announceLiveMatch", () => {
  let channel: ReturnType<typeof fakeChannel>;
  beforeEach(() => {
    channel = fakeChannel({ members: { a: "Alice" } });
    useTournamentChannel(cast(channel));
  });

  it("posts the match embed with the versus image, pinging only the two players", async () => {
    await announceLiveMatch(match);
    const message = arg(channel.send);
    expect(message.content).toBe("Up next: <@a> vs <@b> (Bo3)");
    expect(message.allowedMentions).toEqual({ users: ["a", "b"] });

    const embed = message.embeds[0].toJSON();
    expect(embed.title).toBe("Semifinal 1 — Live");
    expect(embed.image.url).toBe("attachment://versus.png");
    // Alice is a server member; b falls back to the user profile.
    expect(embed.fields[1].value).toBe("Alice **0 – 0** user-b");
    expect(fetchSpy.mock.calls.map((c) => c[0])).toEqual([
      "https://cdn.test/member/a.png",
      "https://cdn.test/user/b.png",
    ]);

    expect(message.files).toHaveLength(1);
    expect(message.files[0].name).toBe("versus.png");
    expect([...message.files[0].attachment.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("pings nobody in dev mode", async () => {
    process.env.DEV_COMMANDS = "true";
    try {
      await announceLiveMatch(match);
      expect(arg(channel.send).allowedMentions).toEqual({ users: [] });
    } finally {
      delete process.env.DEV_COMMANDS;
    }
  });

  it("refuses a match without teams", async () => {
    await expect(announceLiveMatch({ ...match, p1_team: null })).rejects.toThrow("Match 1 went live without teams");
    expect(channel.send).not.toHaveBeenCalled();
  });

  it("refuses a match without both players", async () => {
    await expect(announceLiveMatch({ ...match, p2_id: null })).rejects.toThrow("Match 1 went live without both players");
    expect(channel.send).not.toHaveBeenCalled();
  });
});

describe("results", () => {
  let channel: ReturnType<typeof fakeChannel>;
  beforeEach(() => {
    resetDb();
    channel = fakeChannel({ members: { a: "Alice" } });
    useTournamentChannel(cast(channel));
  });

  it("builds the green winner embed for a decided series", async () => {
    const id = startedTournament();
    const outcome = recordGame(getLiveMatch(id)!, 1, 3, "r", "goons");
    const embed = (await seriesResultEmbed(outcome.match, outcome.series)).toJSON();
    expect(embed.title).toBe("Semifinal 1 — user-b wins");
    expect(embed.thumbnail?.url).toBe("https://cdn.test/user/b.png");
    expect(embed.fields?.[1]?.value).toBe("Alice **0 – 1** user-b");
  });

  it("crowns the champion with every result, goals for Bo1 and games for longer series", async () => {
    const id = startedTournament({ semis: 1, final: 3 });
    recordGame(getLiveMatch(id)!, 3, 1, "r", "goons"); // A beats B 3–1
    recordGame(getLiveMatch(id)!, 0, 2, "r", "goons"); // D beats C 2–0
    recordGame(getLiveMatch(id)!, 0, 1, "r", "goons"); // final: D 1–0
    recordGame(getLiveMatch(id)!, 4, 2, "r", "goons"); // A 1–1
    const last = recordGame(getLiveMatch(id)!, 5, 0, "r", "goons"); // A wins 2–1
    await announceChampion(id, last.championId!);

    const message = arg(channel.send);
    expect(message.content).toBe("🏆 <@a> wins the tournament!");
    expect(message.allowedMentions).toEqual({ users: ["a"] });
    const embed = message.embeds[0].toJSON();
    expect(embed.title).toBe("🏆 Alice is the champion!");
    expect(embed.fields).toEqual([
      { name: "Runner-up", value: "D" },
      {
        name: "Results",
        value: ["Semifinal 1: **A** def. B (3–1)", "Semifinal 2: **D** def. C (2–0)", "Final: **A** def. D (2–1)"].join("\n"),
      },
    ]);
  });

  it("names the runner-up when the final's p2 wins, without pinging in dev mode", async () => {
    const id = startedTournament({ semis: 1, final: 1 });
    recordGame(getLiveMatch(id)!, 1, 0, "r", "goons");
    recordGame(getLiveMatch(id)!, 1, 0, "r", "goons");
    const last = recordGame(getLiveMatch(id)!, 0, 1, "r", "goons");
    process.env.DEV_COMMANDS = "true";
    try {
      await announceChampion(id, last.championId!);
    } finally {
      delete process.env.DEV_COMMANDS;
    }
    const message = arg(channel.send);
    expect(message.content).toBe("🏆 <@c> wins the tournament!");
    expect(message.allowedMentions).toEqual({ users: [] });
    expect(message.embeds[0].toJSON().fields[0].value).toBe("A");
    expect(getMatch(last.match.id)?.winner_id).toBe("c");
  });

  it("falls back to the id when a player's name is missing", async () => {
    const id = startedTournament({ semis: 1, final: 1 });
    recordGame(getLiveMatch(id)!, 1, 0, "r", "goons");
    recordGame(getLiveMatch(id)!, 1, 0, "r", "goons");
    const last = recordGame(getLiveMatch(id)!, 1, 0, "r", "goons");
    const { db } = await import("./db.ts");
    db.exec("PRAGMA foreign_keys = OFF; DELETE FROM players WHERE discord_id = 'c'; PRAGMA foreign_keys = ON;");
    await announceChampion(id, last.championId!);
    expect(arg(channel.send).embeds[0].toJSON().fields[0].value).toBe("c");
  });
});
