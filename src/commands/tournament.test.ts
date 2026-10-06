import { beforeEach, describe, expect, it } from "bun:test";
import { useTournamentChannel } from "../channel.ts";
import { db } from "../db.ts";
import {
  getLiveMatch,
  getOpenTournament,
  getTournament,
  droppedPlayers,
  forfeitPlayer,
  listGames,
  listMatches,
  listTournamentPlayers,
  recordGame,
} from "../store.ts";
import {
  arg,
  cast,
  fakeChannel,
  fakeInteraction,
  resetDb,
  sentStartingWith,
  playToTheEnd,
  startedEight,
  startedGroups,
  startedRoundRobin,
  startedTournament,
} from "../test/helpers.ts";
import { tournament } from "./tournament.ts";

let channel: ReturnType<typeof fakeChannel>;

beforeEach(() => {
  resetDb();
  channel = fakeChannel();
  useTournamentChannel(cast(channel));
});

async function startSignup(integers?: Record<string, number>): Promise<number> {
  await tournament.execute(cast(fakeInteraction({ subcommand: "start", integers })));
  return getOpenTournament("guild-1")!.id;
}

async function press(action: string, id: number, user = { id: "u1", name: "Player One" }) {
  const interaction = fakeInteraction({ kind: "button", customId: `tournament:${action}:${id}`, user });
  await tournament.button!(cast(interaction), [action, String(id)]);
  return interaction;
}

async function joinPlayers(id: number, count: number) {
  for (let i = 1; i <= count; i++) await press("join", id, { id: `p${i}`, name: `Player ${i}` });
}

describe("/tournament start", () => {
  it("ignores interactions outside a cached guild", async () => {
    const interaction = fakeInteraction({ cached: false });
    await tournament.execute(cast(interaction));
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(getOpenTournament("guild-1")).toBeNull();
  });

  it("opens signup with Join and Start buttons and default series lengths", async () => {
    const interaction = fakeInteraction({ subcommand: "start" });
    await tournament.execute(cast(interaction));

    const t = getOpenTournament("guild-1")!;
    expect(t).toMatchObject({ status: "signup", semis_best_of: 1, final_best_of: 3 });
    const message = arg(interaction.reply);
    expect(message.embeds[0].toJSON().title).toBe("Rocket League 1v1 — Signup open");
    expect(message.components[0].toJSON().components.map((b: { custom_id: string }) => b.custom_id)).toEqual([
      `tournament:join:${t.id}`,
      `tournament:start:${t.id}`,
    ]);
  });

  it("uses the semis and final options", async () => {
    const id = await startSignup({ semis: 3, final: 5 });
    expect(getTournament(id)).toMatchObject({ semis_best_of: 3, final_best_of: 5 });
  });

  it("refuses while another tournament is open", async () => {
    await startSignup();
    const interaction = fakeInteraction({ subcommand: "start" });
    await tournament.execute(cast(interaction));
    expect(arg(interaction.reply).content).toBe("A tournament is already running. Finish or cancel it first.");
    expect(db.query("SELECT count(*) AS n FROM tournaments").get()).toEqual({ n: 1 });
  });

  it("does nothing for an unknown subcommand", async () => {
    const interaction = fakeInteraction({ subcommand: "nope" });
    await tournament.execute(cast(interaction));
    expect(interaction.reply).not.toHaveBeenCalled();
  });
});

describe("signup buttons", () => {
  it("ignores interactions outside a cached guild", async () => {
    const interaction = fakeInteraction({ kind: "button", cached: false });
    await tournament.button!(cast(interaction), ["join", "1"]);
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it("says signup is closed for an unknown or started tournament", async () => {
    expect(arg((await press("join", 999)).reply).content).toBe("Signup for this tournament is closed.");
    const id = await startSignup();
    db.query("UPDATE tournaments SET status = 'active' WHERE id = $id").run({ id });
    expect(arg((await press("join", id)).reply).content).toBe("Signup for this tournament is closed.");
  });

  it("does nothing for an unknown action", async () => {
    const interaction = await press("dance", await startSignup());
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.update).not.toHaveBeenCalled();
  });

  it("adds a player and updates the list", async () => {
    const id = await startSignup();
    const interaction = await press("join", id, { id: "p1", name: "Jake" });
    expect(listTournamentPlayers(id)).toEqual([{ discord_id: "p1", display_name: "Jake" }]);
    expect(arg(interaction.update).embeds[0].toJSON().fields[0]).toEqual({ name: "Players (1/8)", value: "1. <@p1>" });
  });

  it("silently ignores a second Join from the same player", async () => {
    const id = await startSignup();
    await press("join", id);
    const again = await press("join", id);
    expect(again.deferUpdate).toHaveBeenCalled();
    expect(again.update).not.toHaveBeenCalled();
    expect(listTournamentPlayers(id)).toHaveLength(1);
  });

  it("turns away a 9th player", async () => {
    const id = await startSignup();
    await joinPlayers(id, 8);
    const ninth = await press("join", id, { id: "p9", name: "Late" });
    expect(arg(ninth.reply).content).toBe("The bot supports up to 8 players, and this tournament is full.");
    expect(listTournamentPlayers(id)).toHaveLength(8);
  });

  it("keeps signup open when fewer than 4 have joined", async () => {
    const id = await startSignup();
    await joinPlayers(id, 3);
    const interaction = await press("start", id);
    expect(arg(interaction.reply).content).toBe("At least 4 players are needed to start (3 joined).");
    expect(getTournament(id)?.status).toBe("signup");
  });

  it("starts 6 and 7 players as two groups with empty playoffs", async () => {
    for (const count of [6, 7]) {
      resetDb();
      const id = await startSignup();
      await joinPlayers(id, count);
      await press("start", id);
      expect(getTournament(id)).toMatchObject({ status: "active", format: "groups" });
      const matches = listMatches(id);
      expect(matches).toHaveLength(count === 6 ? 9 : 12);
      expect(matches.slice(-3).map((m) => [m.label, m.p1_id, m.p2_id])).toEqual([
        ["Semifinal 1", null, null],
        ["Semifinal 2", null, null],
        ["Final", null, null],
      ]);
      expect(getLiveMatch(id)?.label).toBe("Group A - Match 1");
      const labels = db
        .query<{ group_label: string }, { t: number }>("SELECT group_label FROM tournament_players WHERE tournament_id = $t")
        .all({ t: id })
        .map((r) => r.group_label)
        .sort()
        .join("");
      expect(labels).toBe(count === 6 ? "AAABBB" : "AAAABBB");
    }
  });

  it("starts 8 players as a knockout with quarterfinals", async () => {
    const id = await startSignup();
    await joinPlayers(id, 8);
    await press("start", id);
    expect(getTournament(id)).toMatchObject({ status: "active", format: "single_elim" });
    expect(listMatches(id)).toHaveLength(7);
    expect(getLiveMatch(id)?.label).toBe("Quarterfinal 1");
  });

  it("starts 5 players as a round robin with an empty final and announces Match 1", async () => {
    const id = await startSignup({ final: 5 });
    await joinPlayers(id, 5);
    await press("start", id);

    expect(getTournament(id)).toMatchObject({ status: "active", format: "round_robin" });
    const matches = listMatches(id);
    expect(matches).toHaveLength(11);
    expect(matches[10]).toMatchObject({ label: "Final", p1_id: null, p2_id: null, best_of: 5, play_order: 11 });
    expect(getLiveMatch(id)).toMatchObject({ label: "Match 1", best_of: 1 });
    expect(sentStartingWith(channel, "Up next: ")).toHaveLength(1);
  });

  it("starts a 4-player bracket and announces Semifinal 1", async () => {
    const id = await startSignup({ semis: 3 });
    await joinPlayers(id, 4);
    const interaction = await press("start", id);

    expect(getTournament(id)).toMatchObject({ status: "active", format: "single_elim" });
    const seeded = listTournamentPlayers(id).map((p) => p.discord_id);
    expect([...seeded].sort()).toEqual(["p1", "p2", "p3", "p4"]);

    const live = getLiveMatch(id)!;
    expect(live).toMatchObject({ label: "Semifinal 1", p1_id: seeded[0], p2_id: seeded[1], best_of: 3 });
    expect(["goons", "gooners"]).toContain(live.p1_team!);

    const closed = arg(interaction.update);
    expect(closed.embeds[0].toJSON().title).toBe("Rocket League 1v1 — Signup closed");
    expect(closed.components).toEqual([]);
    // The live bracket is posted first and remembered, then the "Up next" ping.
    expect(arg(channel.send).files[0].name).toBe("bracket.png");
    expect(getTournament(id)?.bracket_msg_id).toBe("msg-1");
    const [upNext] = sentStartingWith(channel, "Up next: ");
    expect(upNext.content).toBe(`Up next: <@${seeded[0]}> vs <@${seeded[1]}> (Bo3)`);
    // Avatar downloads fail offline, so the versus image falls back to placeholders.
    expect(upNext.files[0].name).toBe("versus.png");
  });
});

describe("/tournament cancel", () => {
  async function ask() {
    const interaction = fakeInteraction({ subcommand: "cancel" });
    await tournament.execute(cast(interaction));
    return arg(interaction.reply);
  }

  it("says when nothing is running", async () => {
    expect((await ask()).content).toBe("No tournament is running.");
  });

  it("asks privately for confirmation with cancel and keep buttons", async () => {
    const id = await startSignup();
    const message = await ask();
    expect(message.content).toBe("Cancel the current tournament (in signup)? This can't be undone.");
    expect(message.flags).toBeDefined();
    expect(message.components[0].toJSON().components.map((b: { custom_id: string }) => b.custom_id)).toEqual([
      `tournament:cancel:${id}`,
      `tournament:keep:${id}`,
    ]);

    db.query("UPDATE tournaments SET status = 'active' WHERE id = $id").run({ id });
    expect((await ask()).content).toBe("Cancel the current tournament (in progress)? This can't be undone.");
  });

  it("keeps the tournament when asked to", async () => {
    const id = await startSignup();
    const interaction = await press("keep", id);
    expect(arg(interaction.update)).toEqual({ content: "Okay, the tournament continues.", components: [] });
    expect(getTournament(id)?.status).toBe("signup");
  });

  it("marks an in-progress tournament's bracket message cancelled", async () => {
    const id = await startSignup();
    await joinPlayers(id, 4);
    await press("start", id); // posts the live bracket as msg-1
    await press("cancel", id);
    const edit = arg(channel.sent.get("msg-1")!.edit);
    expect(edit.embeds[0].toJSON().title).toEndWith("(cancelled)");
  });

  it("cancels on confirmation and tells the channel", async () => {
    const id = await startSignup();
    const interaction = await press("cancel", id, { id: "boss", name: "Boss" });
    expect(arg(interaction.update)).toEqual({ content: "Cancelled.", components: [] });
    expect(getTournament(id)?.status).toBe("cancelled");
    expect(arg(channel.send)).toEqual({
      content: "🛑 The tournament was cancelled by <@boss>. Run `/tournament start` to begin a new one.",
      allowedMentions: { parse: [] },
    });
  });

  it("does nothing if the tournament already ended", async () => {
    const id = await startSignup();
    db.query("UPDATE tournaments SET status = 'done' WHERE id = $id").run({ id });
    const interaction = await press("cancel", id);
    expect(arg(interaction.update).content).toBe("That tournament has already ended.");
    expect(getTournament(id)?.status).toBe("done");
    expect(arg((await press("cancel", 999)).update).content).toBe("That tournament has already ended.");
  });
});

describe("/tournament series", () => {
  async function change(integers: Record<string, number>, user = { id: "u1", name: "Player One" }) {
    const interaction = fakeInteraction({ subcommand: "series", integers, user });
    await tournament.execute(cast(interaction));
    return arg(interaction.reply);
  }
  const lengthsOf = (id: number) => Object.fromEntries(listMatches(id).map((m) => [m.label, m.best_of]));

  it("says when nothing is running", async () => {
    expect(await change({ final: 1 })).toMatchObject({ content: "No tournament is running.", flags: expect.any(Number) });
  });

  it("changes a signup tournament's lengths before anyone starts", async () => {
    const id = await startSignup();
    const reply = await change({ semis: 3, final: 5 }, { id: "boss", name: "Boss" });
    expect(reply).toEqual({
      content: "🔧 <@boss> changed the series length.\nSemifinals: Bo1 → **Bo3 (first to 2)**\nFinal: Bo3 → **Bo5 (first to 3)**",
      allowedMentions: { parse: [] },
    });
    expect(getTournament(id)).toMatchObject({ semis_best_of: 3, final_best_of: 5 });
    expect(channel.send).not.toHaveBeenCalled();

    await joinPlayers(id, 4);
    await press("start", id);
    expect(lengthsOf(id)).toEqual({ "Semifinal 1": 3, "Semifinal 2": 3, Final: 5 });
  });

  it("changes a running tournament's upcoming matches and refreshes the bracket", async () => {
    const id = startedEight({ semis: 1, final: 3 });
    const reply = await change({ final: 1 });
    expect(reply.content).toBe("🔧 <@u1> changed the series length.\nFinal: Bo3 → **Bo1**");
    expect(lengthsOf(id)).toMatchObject({ "Quarterfinal 1": 1, "Semifinal 1": 1, Final: 1 });
    expect(arg(channel.send).files[0].name).toBe("bracket.png");
    expect(getTournament(id)?.bracket_msg_id).toBe("msg-1");
  });

  it("lengthens the live match mid-series", async () => {
    const id = startedTournament({ semis: 3, final: 3 });
    recordGame(getLiveMatch(id)!, 2, 1, "r", "goons");
    await change({ semis: 5 });
    expect(getLiveMatch(id)).toMatchObject({ label: "Semifinal 1", best_of: 5 });
  });

  it("only mentions the rounds that actually change", async () => {
    startedTournament({ semis: 1, final: 3 });
    expect((await change({ semis: 1, final: 5 })).content).toBe(
      "🔧 <@u1> changed the series length.\nFinal: Bo3 → **Bo5 (first to 3)**",
    );
  });

  it("says when there's nothing to change", async () => {
    const id = startedTournament({ semis: 1, final: 3 });
    expect((await change({})).content).toBe("Nothing to change. The semis are Bo1 and the final is Bo3.");
    expect((await change({ semis: 1, final: 3 })).content).toBe(
      "Nothing to change. The semis are Bo1 and the final is Bo3.",
    );
    expect(getTournament(id)).toMatchObject({ semis_best_of: 1, final_best_of: 3 });
  });

  it("only offers the final in a round robin", async () => {
    const id = startedRoundRobin(3);
    expect((await change({ semis: 3 })).content).toBe("This round robin has no semifinals, just the final.");
    expect((await change({ final: 3 })).content).toBe("Nothing to change. The final is Bo3.");
    await change({ final: 5 });
    expect(lengthsOf(id).Final).toBe(5);
  });

  it("locks a round once one of its matches is decided", async () => {
    const id = startedTournament({ semis: 1, final: 3 });
    recordGame(getLiveMatch(id)!, 1, 0, "r", "goons"); // Semifinal 1 decided
    const reply = await change({ semis: 3, final: 5 });
    expect(reply.content).toBe("Semifinal 1 has already been decided, so the semis length is locked.");
    expect(lengthsOf(id)).toEqual({ "Semifinal 1": 1, "Semifinal 2": 1, Final: 3 });
    expect(getTournament(id)).toMatchObject({ semis_best_of: 1, final_best_of: 3 });
  });

  it("won't shorten a live series so far that its games would end it", async () => {
    const id = startedTournament({ semis: 3, final: 3 });
    recordGame(getLiveMatch(id)!, 0, 2, "r", "goons");
    const reply = await change({ semis: 1 });
    expect(reply.content).toBe(
      "Semifinal 1 already stands at 1–0, so a best of 1 would end it. Use `/undo` first to shorten it.",
    );
    expect(getLiveMatch(id)).toMatchObject({ label: "Semifinal 1", best_of: 3 });
    expect(listGames(getLiveMatch(id)!.id)).toHaveLength(1);
  });
});

describe("/tournament forfeit", () => {
  async function ask(player: string) {
    const interaction = fakeInteraction({ subcommand: "forfeit", optionUsers: { player: { id: player, name: player } } });
    await tournament.execute(cast(interaction));
    return arg(interaction.reply);
  }
  async function answer(action: "forfeit" | "stay", id: number, player: string) {
    const interaction = fakeInteraction({ kind: "button", customId: `tournament:${action}:${id}:${player}`, user: { id: "boss", name: "Boss" } });
    await tournament.button!(cast(interaction), [action, String(id), player]);
    return arg(interaction.update);
  }

  it("refuses when there's nothing to forfeit", async () => {
    expect((await ask("a")).content).toBe("No tournament is running.");
    await startSignup();
    expect((await ask("a")).content).toBe("The tournament hasn't started yet, so there's nothing to forfeit.");
  });

  it("refuses a player who isn't in it, has dropped, or is already out", async () => {
    const id = startedTournament();
    expect((await ask("zed")).content).toBe("<@zed> isn't in this tournament.");
    recordGame(getLiveMatch(id)!, 3, 1, "r", "goons"); // B is out
    expect((await ask("b")).content).toBe("<@b> is already out of the tournament.");
    forfeitPlayer(id, "a", "goons");
    const refused = await ask("a");
    expect(refused).toMatchObject({ content: "<@a> has already dropped out.", flags: expect.any(Number) });
  });

  it("asks privately first, saying who wins the live match", async () => {
    const id = startedTournament();
    const message = await ask("b");
    expect(message.content).toBe(
      "Drop <@b> from the tournament? They forfeit every match they have left. They're in the live match (Semifinal 1), so <@a> wins it now. This can't be undone.",
    );
    expect(message.flags).toBeDefined();
    expect(message.components[0].toJSON().components.map((b: { custom_id: string }) => b.custom_id)).toEqual([
      `tournament:forfeit:${id}:b`,
      `tournament:stay:${id}:b`,
    ]);
    expect((await ask("a")).content).toContain("so <@b> wins it now.");
    expect((await ask("c")).content).toBe(
      "Drop <@c> from the tournament? They forfeit every match they have left. This can't be undone.",
    );
    expect(droppedPlayers(id).size).toBe(0);
  });

  it("keeps the player in when asked to", async () => {
    const id = startedTournament();
    expect(await answer("stay", id, "b")).toEqual({ content: "Okay, <@b> stays in.", components: [] });
    expect(droppedPlayers(id).size).toBe(0);
  });

  it("drops the player, posts the forfeit, refreshes the bracket and announces the next match", async () => {
    const id = startedTournament();
    expect(await answer("forfeit", id, "a")).toEqual({ content: "Dropped.", components: [] });
    expect(droppedPlayers(id)).toEqual(new Set(["a"]));
    expect(sentStartingWith(channel, "🏳️")[0]).toEqual({
      content: "🏳️ <@a> dropped out of the tournament (by <@boss>).\nSemifinal 1: **B** def. A (forfeit)",
      allowedMentions: { parse: [] },
    });
    expect(getTournament(id)?.bracket_msg_id).toBe("msg-2");
    expect(sentStartingWith(channel, "Up next: ")[0].content).toBe("Up next: <@c> vs <@d> (Bo1)");
  });

  it("just posts the drop when nothing is decided yet", async () => {
    const id = startedTournament();
    recordGame(getLiveMatch(id)!, 3, 1, "r", "goons"); // A waits in the final
    await answer("forfeit", id, "a");
    expect(sentStartingWith(channel, "🏳️")[0].content).toBe("🏳️ <@a> dropped out of the tournament (by <@boss>).");
    expect(sentStartingWith(channel, "Up next: ")).toHaveLength(0);
  });

  it("announces the end of a group stage the forfeit finished", async () => {
    const id = startedGroups(6); // Group A: a, b, c. Group B: d, e, f
    while (getLiveMatch(id)!.label !== "Group B - Match 3") {
      const m = getLiveMatch(id)!;
      recordGame(m, m.p1_id! < m.p2_id! ? 2 : 1, m.p1_id! < m.p2_id! ? 1 : 2, "r", "goons");
    }
    const last = getLiveMatch(id)!;
    await answer("forfeit", id, last.p2_id!);
    expect(sentStartingWith(channel, "📊 The group stage is done!")).toHaveLength(1);
    expect(sentStartingWith(channel, "Up next: ")[0].content).toStartWith("Up next: ");
  });

  it("crowns the champion when the forfeit ends the tournament", async () => {
    const id = startedTournament();
    recordGame(getLiveMatch(id)!, 3, 1, "r", "goons");
    recordGame(getLiveMatch(id)!, 3, 1, "r", "goons"); // final: A vs C is live
    await answer("forfeit", id, "c");
    expect(sentStartingWith(channel, "🏆")[0].content).toBe("🏆 <@a> wins the tournament!");
    expect(getTournament(id)).toMatchObject({ status: "done", winner_id: "a" });
  });

  it("checks again when confirmed, in case the tournament moved on", async () => {
    const id = startedTournament();
    playToTheEnd(id);
    expect(await answer("forfeit", id, "a")).toEqual({ content: "No tournament is running.", components: [] });
    const other = startedEight();
    forfeitPlayer(other, "a", "goons");
    expect(await answer("forfeit", other, "a")).toEqual({ content: "<@a> has already dropped out.", components: [] });
    expect(await answer("forfeit", 999, "a")).toEqual({ content: "No tournament is running.", components: [] });
  });
});
