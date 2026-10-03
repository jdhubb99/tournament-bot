import { beforeEach, expect, it } from "bun:test";
import { arg, cast, fakeInteraction, playToTheEnd, resetDb, startedTournament, useFakeChannel } from "../test/helpers.ts";
import { stats } from "./stats.ts";

beforeEach(() => {
  resetDb();
  useFakeChannel();
});

async function run(opts: { player?: string; game?: string; me?: string } = {}) {
  const interaction = fakeInteraction({
    commandName: "stats",
    user: { id: opts.me ?? "a", name: "Me" },
    optionUsers: opts.player ? { player: { id: opts.player, name: opts.player } } : undefined,
    strings: opts.game ? { game: opts.game } : undefined,
  });
  await stats.execute(cast(interaction));
  return interaction;
}

it("ignores interactions outside a cached guild", async () => {
  const interaction = fakeInteraction({ commandName: "stats", cached: false });
  await stats.execute(cast(interaction));
  expect(interaction.reply).not.toHaveBeenCalled();
});

it("says when the player hasn't played the game", async () => {
  expect(arg((await run({ player: "zed" })).reply)).toEqual({
    content: "<@zed> hasn't played any Rocket League matches yet.",
    allowedMentions: { parse: [] },
  });
  playToTheEnd(startedTournament());
  expect(arg((await run({ game: "Mario Kart" })).reply).content).toBe("<@a> hasn't played any Mario Kart matches yet.");
});

it("shows your own stats by default", async () => {
  playToTheEnd(startedTournament());
  const interaction = await run({ me: "a" });
  expect(interaction.deferReply).toHaveBeenCalled();
  const message = arg(interaction.editReply);
  expect(message.embeds[0].toJSON()).toMatchObject({ title: "A — Rocket League", image: { url: "attachment://stats.png" } });
  expect(message.files.map((f: { name: string }) => f.name)).toEqual(["stats.png"]);
});

it("shows another player's stats", async () => {
  playToTheEnd(startedTournament());
  const message = arg((await run({ player: "c", game: "rocket league" })).editReply);
  expect(message.embeds[0].toJSON().title).toBe("C — rocket league");
});
