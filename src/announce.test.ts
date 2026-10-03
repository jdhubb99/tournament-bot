import { afterEach, beforeEach, describe, expect, it, spyOn, type Mock } from "bun:test";
import {
  announceChampion,
  announceForfeits,
  announceStageFinished,
  announceLiveMatch,
  bracketImage,
  bracketPost,
  currentMatchPost,
  fetchAvatar,
  matchResult,
  refreshBracketMessage,
  seriesUpdate,
} from "./announce.ts";
import { useTournamentChannel } from "./channel.ts";
import {
  cancelTournament,
  forfeitPlayer,
  getLiveMatch,
  getMatch,
  getTournament,
  listMatches,
  recordGame,
  setBracketMessage,
  type Match,
} from "./store.ts";
import {
  arg,
  cast,
  fakeChannel,
  playLeague,
  playToTheEnd,
  resetDb,
  startedEight,
  startedGroups,
  startedRoundRobin,
  startedTournament,
} from "./test/helpers.ts";

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
    expect(embed.fields).toEqual([{ name: "Format", value: "Best of 3 (first to 2)" }]);
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

  it("builds the green result embed with the winner image attached", async () => {
    const id = startedTournament(); // a is p1 on Goons, so b is on Gooners
    const outcome = recordGame(getLiveMatch(id)!, 1, 3, "r", "goons");
    const { embed, file } = await matchResult(outcome.match);
    const json = embed.toJSON();
    // Alice is a server member; b falls back to the user profile.
    expect(json.title).toBe("Semifinal 1 — user-b wins");
    expect(json.thumbnail?.url).toBe("attachment://winner.png");
    expect(json.fields).toEqual([{ name: "Final score", value: "Alice 1 – 3 **user-b**" }]);
    expect(file.name).toBe("winner.png");
    expect([...(file.attachment as Buffer).subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(fetchSpy.mock.calls.map((c) => c[0])).toEqual(["https://cdn.test/user/b.png"]);
  });

  it("builds the red series update with the scoreboard attached", async () => {
    const id = startedTournament({ semis: 3, final: 3 });
    const outcome = recordGame(getLiveMatch(id)!, 1, 3, "r", "goons");
    const { embed, file } = await seriesUpdate(outcome.match, outcome.series, "Semifinal 1 — Game 1");
    expect(embed.toJSON()).toMatchObject({
      title: "Semifinal 1 — Game 1",
      description: "user-b leads the series 1–0",
      image: { url: "attachment://scoreboard.png" },
    });
    expect(file.name).toBe("scoreboard.png");
    expect(fetchSpy.mock.calls.map((c) => c[0])).toEqual(["https://cdn.test/member/a.png", "https://cdn.test/user/b.png"]);
  });

  it("refuses to draw a winner for a match without teams", async () => {
    const id = startedTournament();
    const outcome = recordGame(getLiveMatch(id)!, 3, 1, "r", "goons");
    await expect(matchResult({ ...outcome.match, p1_team: null })).rejects.toThrow(`Match ${outcome.match.id} has no teams`);
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
    expect(message.files.map((f: { name: string }) => f.name)).toEqual(["winner.png"]);
    const embed = message.embeds[0].toJSON();
    expect(embed.title).toBe("🏆 Alice is the champion!");
    expect(embed.fields).toEqual([
      { name: "Runner-up", value: "D" },
      {
        name: "Results",
        value: ["Semifinal 1: **A** def. B (3–1)", "Semifinal 2: **D** def. C (2–0)", "Final: **A** def. D (series 2–1)"].join("\n"),
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

  it("pictures a champion who won the final by forfeit in their team from the last match they played", async () => {
    const id = startedTournament({ semis: 1, final: 3 });
    recordGame(getLiveMatch(id)!, 3, 1, "r", "goons"); // A beats B
    recordGame(getLiveMatch(id)!, 0, 2, "r", "goons"); // D beats C, and the final goes live
    expect(forfeitPlayer(id, "a", "goons").championId).toBe("d");
    await announceChampion(id, "d");
    expect(arg(channel.send).embeds[0].toJSON().fields).toEqual([
      { name: "Runner-up", value: "A" },
      { name: "Results", value: "Semifinal 1: **A** def. B (3–1)\nSemifinal 2: **D** def. C (2–0)\nFinal: **D** def. A (forfeit)" },
    ]);
  });

  it("pictures a champion with no team on record on Goons", async () => {
    const id = startedTournament({ semis: 1, final: 1 });
    for (let i = 0; i < 3; i++) recordGame(getLiveMatch(id)!, 2, 1, "r", "goons");
    const { db } = await import("./db.ts");
    db.query("UPDATE matches SET p1_team = NULL WHERE tournament_id = $t").run({ t: id });
    await announceChampion(id, "a");
    expect(arg(channel.send).files.map((f: { name: string }) => f.name)).toEqual(["winner.png"]);
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

describe("announceForfeits", () => {
  let channel: ReturnType<typeof fakeChannel>;
  beforeEach(() => {
    resetDb();
    channel = fakeChannel();
    useTournamentChannel(cast(channel));
  });

  it("posts a line per match won by forfeit, pinging nobody", async () => {
    const id = startedEight();
    forfeitPlayer(id, "a", "goons");
    forfeitPlayer(id, "d", "goons");
    await announceForfeits(listMatches(id).filter((m) => m.status === "done"));
    expect(arg(channel.send)).toEqual({
      content: "🏳️ Quarterfinal 1: **B** def. A (forfeit)\n🏳️ Quarterfinal 2: **C** def. D (forfeit)",
      allowedMentions: { parse: [] },
    });
  });

  it("posts nothing when there are none", async () => {
    await announceForfeits([]);
    expect(channel.send).not.toHaveBeenCalled();
  });
});

describe("bracketImage", () => {
  beforeEach(() => {
    resetDb();
    useTournamentChannel(cast(fakeChannel({ members: { a: "Alice" } })));
  });

  it("renders the bracket with every known player's avatar", async () => {
    const id = startedTournament({ semis: 3, final: 3 });
    recordGame(getLiveMatch(id)!, 3, 1, "r", "goons"); // SF1 live at 1–0
    const file = await bracketImage(id);
    expect(file.name).toBe("bracket.png");
    expect([...(file.attachment as Buffer).subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(fetchSpy.mock.calls.map((c) => c[0]).sort()).toEqual([
      "https://cdn.test/member/a.png",
      "https://cdn.test/user/b.png",
      "https://cdn.test/user/c.png",
      "https://cdn.test/user/d.png",
    ]);
  });

  it("draws FF for a player who forfeited, and dims dropped players in the tables", async () => {
    const id = startedGroups(6);
    const before = Buffer.from((await bracketImage(id)).attachment as Buffer);
    forfeitPlayer(id, "b", "goons");
    const after = Buffer.from((await bracketImage(id)).attachment as Buffer);
    expect(before.equals(after)).toBe(false);

    const knockout = startedTournament();
    forfeitPlayer(knockout, "a", "goons");
    expect((await bracketImage(knockout)).name).toBe("bracket.png");
  });

  it("changes as results come in and draws the champion at the end", async () => {
    const id = startedTournament({ semis: 1, final: 1 });
    const before = Buffer.from((await bracketImage(id)).attachment as Buffer);
    for (let i = 0; i < 3; i++) recordGame(getLiveMatch(id)!, 2, 1, "r", "goons");
    const after = Buffer.from((await bracketImage(id)).attachment as Buffer);
    expect(before.equals(after)).toBe(false);
  });
});

describe("currentMatchPost", () => {
  beforeEach(() => {
    resetDb();
    useTournamentChannel(cast(fakeChannel()));
  });

  it("is the versus post when no games have been played", async () => {
    const id = startedTournament();
    const { embed, file } = await currentMatchPost(getLiveMatch(id)!);
    expect(embed.toJSON()).toMatchObject({ title: "Semifinal 1 — Live", image: { url: "attachment://versus.png" } });
    expect(file.name).toBe("versus.png");
  });

  it("is the scoreboard with the standing once games have been played", async () => {
    const id = startedTournament({ semis: 3, final: 3 });
    recordGame(getLiveMatch(id)!, 3, 1, "r", "goons");
    const { embed, file } = await currentMatchPost(getLiveMatch(id)!);
    expect(embed.toJSON()).toMatchObject({
      title: "Semifinal 1 — Live",
      description: "user-a leads the series 1–0",
      image: { url: "attachment://scoreboard.png" },
    });
    expect(file.name).toBe("scoreboard.png");
  });
});

describe("round robin posts", () => {
  let channel: ReturnType<typeof fakeChannel>;
  beforeEach(() => {
    resetDb();
    channel = fakeChannel();
    useTournamentChannel(cast(channel));
  });

  it("renders the league table for /bracket, before and after the league", async () => {
    const id = startedRoundRobin();
    const before = Buffer.from((await bracketImage(id)).attachment as Buffer);
    playLeague(id);
    const file = await bracketImage(id);
    expect(file.name).toBe("bracket.png");
    expect(before.equals(file.attachment as Buffer)).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(10); // five avatars, twice
  });

  it("lists the league matches still to play while the league runs", async () => {
    const { playLeagueMatch } = await import("./test/helpers.ts");
    const id = startedRoundRobin();
    const height = async () => new DataView(((await bracketImage(id)).attachment as Buffer).buffer).getUint32(20);
    const withList = await height(); // 10 left: 4 listed plus "+6 more"
    for (let i = 0; i < 7; i++) playLeagueMatch(id);
    const shorter = await height(); // 3 left, all listed
    for (let i = 0; i < 3; i++) playLeagueMatch(id);
    const none = await height(); // league done; the final is on the right instead
    expect(withList).toBeGreaterThan(shorter);
    expect(shorter).toBeGreaterThan(none);
  });

  it("announces the end of the league with the table", async () => {
    const id = startedRoundRobin();
    playLeague(id);
    await announceStageFinished(id);
    const message = arg(channel.send);
    expect(message.content).toBe("📊 The league is done! **A** and **B** go to the final.");
    expect(message.embeds[0].toJSON().title).toBe("Final league table");
    expect(message.files.map((f: { name: string }) => f.name)).toEqual(["bracket.png"]);
    expect(message.allowedMentions).toEqual({ parse: [] });
  });
});

describe("groups and 8-player posts", () => {
  let channel: ReturnType<typeof fakeChannel>;
  beforeEach(() => {
    resetDb();
    channel = fakeChannel();
    useTournamentChannel(cast(channel));
  });

  const finishGroupStage = (id: number) => {
    while (getLiveMatch(id)!.round === 1) {
      const m = getLiveMatch(id)!;
      recordGame(m, m.p1_id! < m.p2_id! ? 2 : 1, m.p1_id! < m.p2_id! ? 1 : 2, "r", "goons");
    }
  };

  it("draws the groups image through the group stage, playoffs and champion", async () => {
    const id = startedGroups(7);
    const images = [Buffer.from((await bracketImage(id)).attachment as Buffer)];
    finishGroupStage(id);
    images.push(Buffer.from((await bracketImage(id)).attachment as Buffer));
    playToTheEnd(id);
    images.push(Buffer.from((await bracketImage(id)).attachment as Buffer));
    expect(images[0]!.equals(images[1]!) || images[1]!.equals(images[2]!)).toBe(false);
  });

  it("announces the end of the group stage with the semifinal pairings", async () => {
    const id = startedGroups(6);
    finishGroupStage(id);
    await announceStageFinished(id);
    const message = arg(channel.send);
    expect(message.content).toBe(
      "📊 The group stage is done! Semifinal 1: **A** vs **E** · Semifinal 2: **D** vs **B**",
    );
    expect(message.embeds[0].toJSON().title).toBe("Final group tables");
  });

  it("draws an 8-player bracket", async () => {
    const id = startedEight();
    const file = await bracketImage(id);
    const view = new DataView((file.attachment as Buffer).buffer, (file.attachment as Buffer).byteOffset);
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([1424, 708]); // quarters, semis, final, plus the key
  });
});

describe("live bracket message", () => {
  let channel: ReturnType<typeof fakeChannel>;
  beforeEach(() => {
    resetDb();
    channel = fakeChannel();
    useTournamentChannel(cast(channel));
  });

  it("titles the bracket by format and status", async () => {
    const id = startedTournament();
    expect((await bracketPost(id)).embed.toJSON().title).toBe("Rocket League 1v1 — Knockout, 4 players");
    cancelTournament(id);
    expect((await bracketPost(id)).embed.toJSON().title).toBe("Rocket League 1v1 — Knockout, 4 players (cancelled)");
    const done = startedTournament({ semis: 1, final: 1 });
    playToTheEnd(done);
    expect((await bracketPost(done)).embed.toJSON().title).toBe("Rocket League 1v1 — Knockout, 4 players (finished)");
  });

  it("posts the bracket the first time and remembers the message", async () => {
    const id = startedTournament();
    await refreshBracketMessage(id);
    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(arg(channel.send).files[0].name).toBe("bracket.png");
    expect(getTournament(id)?.bracket_msg_id).toBe("msg-1");
  });

  it("edits the same message after that, replacing the old image", async () => {
    const id = startedTournament();
    await refreshBracketMessage(id);
    recordGame(getLiveMatch(id)!, 3, 1, "r", "goons");
    await refreshBracketMessage(id);
    expect(channel.send).toHaveBeenCalledTimes(1);
    const edit = arg(channel.sent.get("msg-1")!.edit);
    expect(edit.attachments).toEqual([]);
    expect(edit.files[0].name).toBe("bracket.png");
    expect(edit.embeds[0].toJSON().description).toBe("🔴 Live: **Semifinal 2** (Bo1): C vs D");
  });

  it("posts a new message if the old one was deleted", async () => {
    const id = startedTournament();
    setBracketMessage(id, "deleted-message");
    await refreshBracketMessage(id);
    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(getTournament(id)?.bracket_msg_id).toBe("msg-1");
  });

  it("logs instead of throwing when the update fails", async () => {
    const id = startedTournament();
    channel.send.mockImplementation(async () => {
      throw new Error("Missing Permissions");
    });
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(refreshBracketMessage(id)).resolves.toBeUndefined();
      expect(error.mock.calls[0]?.[0]).toBe(`Couldn't update the bracket message for tournament ${id}:`);
    } finally {
      error.mockRestore();
    }
  });
});
