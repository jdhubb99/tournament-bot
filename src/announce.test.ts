import { afterEach, beforeEach, describe, expect, it, spyOn, type Mock } from "bun:test";
import { announceLiveMatch, fetchAvatar } from "./announce.ts";
import { useTournamentChannel } from "./channel.ts";
import type { Match } from "./store.ts";
import { arg, cast, fakeChannel } from "./test/helpers.ts";

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

  it("refuses a match without both players", async () => {
    await expect(announceLiveMatch({ ...match, p2_id: null })).rejects.toThrow("Match 1 went live without both players");
    expect(channel.send).not.toHaveBeenCalled();
  });
});
