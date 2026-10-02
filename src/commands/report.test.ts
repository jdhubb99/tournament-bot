import { beforeEach, describe, expect, it } from "bun:test";
import { useTournamentChannel } from "../channel.ts";
import { db } from "../db.ts";
import { createTournament, getLiveMatch, getTournament, listGames } from "../store.ts";
import { arg, cast, fakeChannel, fakeInteraction, resetDb, startedTournament } from "../test/helpers.ts";
import { report } from "./report.ts";

let channel: ReturnType<typeof fakeChannel>;

beforeEach(() => {
  resetDb();
  channel = fakeChannel();
  useTournamentChannel(cast(channel));
});

async function send(winner: string, winnerScore: number, loserScore: number, reporter = "ref") {
  const interaction = fakeInteraction({
    commandName: "report",
    user: { id: reporter, name: "Ref" },
    optionUser: { id: winner, name: winner },
    integers: { winner_score: winnerScore, loser_score: loserScore },
  });
  await report.execute(cast(interaction));
  return interaction;
}

const errorOf = (interaction: ReturnType<typeof fakeInteraction>) => arg(interaction.reply).content;

describe("/report validation", () => {
  it("ignores interactions outside a cached guild", async () => {
    const interaction = fakeInteraction({ commandName: "report", cached: false });
    await report.execute(cast(interaction));
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it("needs a live match", async () => {
    expect(errorOf(await send("a", 1, 0))).toBe("There's no live match to report right now.");
    createTournament("guild-1", { semis: 1, final: 3 }); // still in signup
    expect(errorOf(await send("a", 1, 0))).toBe("There's no live match to report right now.");
  });

  it("rejects a winner who isn't playing", async () => {
    startedTournament();
    expect(errorOf(await send("c", 3, 1))).toBe("<@c> isn't in the live match (Semifinal 1: <@a> vs <@b>).");
  });

  it("rejects ties and negative scores", async () => {
    startedTournament();
    expect(errorOf(await send("a", 2, 2))).toBe("The winner's score must be higher than the loser's (no ties).");
    expect(errorOf(await send("a", 2, -1))).toBe("Scores must be whole numbers, 0 or more.");
  });

  it("replies privately and saves nothing when invalid", async () => {
    const id = startedTournament();
    const interaction = await send("a", 1, 1);
    expect(arg(interaction.reply).flags).toBeDefined();
    expect(listGames(getLiveMatch(id)!.id)).toHaveLength(0);
  });
});

describe("/report results", () => {
  it("posts an undecided game publicly with the scoreboard", async () => {
    const id = startedTournament({ semis: 3, final: 3 });
    const interaction = await send("b", 4, 2, "ref");

    expect(interaction.deferReply).toHaveBeenCalled();
    const message = arg(interaction.editReply);
    expect(message.content).toBe("Game 1 · Semifinal 1: A 2 – 4 **B**");
    expect(message.embeds[0].toJSON()).toMatchObject({
      title: "Semifinal 1 — Game 1",
      description: "user-b leads the series 1–0",
      image: { url: "attachment://scoreboard.png" },
    });
    expect(message.files.map((f: { name: string }) => f.name)).toEqual(["scoreboard.png"]);
    expect(message.allowedMentions).toEqual({ parse: [] });
    expect(listGames(getLiveMatch(id)!.id)[0]).toMatchObject({ p1_score: 2, p2_score: 4, reported_by: "ref" });
    expect(channel.send).not.toHaveBeenCalled();
  });

  it("closes a best of 1 with the result embed, no series line, and announces the next match", async () => {
    startedTournament();
    const interaction = await send("a", 3, 0);

    const message = arg(interaction.editReply);
    expect(message.content).toBe("Game 1 · Semifinal 1: **A** 3 – 0 B");
    const embed = message.embeds[0].toJSON();
    expect(embed.title).toBe("Semifinal 1 — user-a wins");
    expect(embed.fields).toEqual([{ name: "Final score", value: "**user-a** 3 – 0 user-b" }]);
    expect(embed.thumbnail.url).toBe("attachment://winner.png");
    expect(message.files.map((f: { name: string }) => f.name)).toEqual(["winner.png"]);
    expect(arg(channel.send).content).toBe("Up next: <@c> vs <@d> (Bo1)");
  });

  it("plays a full 4-player tournament end to end", async () => {
    const id = startedTournament({ semis: 1, final: 3 });
    await send("a", 2, 1); // SF1: a
    await send("d", 3, 2); // SF2: d
    expect(getLiveMatch(id)).toMatchObject({ label: "Final", p1_id: "a", p2_id: "d", best_of: 3 });

    await send("d", 1, 0);
    await send("a", 2, 0);
    const last = await send("d", 4, 3);

    expect(arg(last.editReply).content).toBe("Game 3 · Final: A 3 – 4 **D**");
    const posts = channel.send.mock.calls.map((c) => (c[0] as { content: string }).content);
    expect(posts).toEqual([
      "Up next: <@c> vs <@d> (Bo1)",
      "Up next: <@a> vs <@d> (Bo3)",
      "🏆 <@d> wins the tournament!",
    ]);
    expect(getTournament(id)).toMatchObject({ status: "done", winner_id: "d" });
    expect(errorOf(await send("d", 1, 0))).toBe("There's no live match to report right now.");
  });

  it("says there's no live match while an active tournament has none", async () => {
    const id = startedTournament();
    db.query("UPDATE matches SET status = 'done' WHERE tournament_id = $id").run({ id });
    expect(errorOf(await send("a", 1, 0))).toBe("There's no live match to report right now.");
  });
});
