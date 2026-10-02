import { beforeEach, describe, expect, it } from "bun:test";
import { announceLiveMatch } from "./announce.ts";
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
};

describe("announceLiveMatch", () => {
  let channel: ReturnType<typeof fakeChannel>;
  beforeEach(() => {
    channel = fakeChannel({ members: { a: "Alice" } });
    useTournamentChannel(cast(channel));
  });

  it("posts the match embed and pings only the two players", async () => {
    await announceLiveMatch(match);
    const message = arg(channel.send);
    expect(message.content).toBe("Up next: <@a> vs <@b> (Bo3)");
    expect(message.allowedMentions).toEqual({ users: ["a", "b"] });

    const embed = message.embeds[0].toJSON();
    expect(embed.title).toBe("Semifinal 1 — Live");
    // Alice is a server member; b falls back to the user profile.
    expect(embed.author).toEqual({ name: "Alice", icon_url: "https://cdn.test/member/a.png" });
    expect(embed.thumbnail.url).toBe("https://cdn.test/user/b.png");
    expect(embed.fields[1].value).toBe("Alice **0 – 0** user-b");
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
