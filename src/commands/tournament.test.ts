import { beforeEach, describe, expect, it } from "bun:test";
import { useTournamentChannel } from "../channel.ts";
import { db } from "../db.ts";
import { getLiveMatch, getOpenTournament, getTournament, listMatches, listTournamentPlayers } from "../store.ts";
import { arg, cast, fakeChannel, fakeInteraction, resetDb } from "../test/helpers.ts";
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
    expect(arg(channel.send).content).toStartWith("Up next: ");
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
    expect(arg(channel.send).content).toBe(`Up next: <@${seeded[0]}> vs <@${seeded[1]}> (Bo3)`);
    // Avatar downloads fail offline, so the versus image falls back to placeholders.
    expect(arg(channel.send).files[0].name).toBe("versus.png");
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
