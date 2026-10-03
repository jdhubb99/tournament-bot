import { beforeEach, expect, it } from "bun:test";
import { singleElim } from "../logic/bracket.ts";
import { addTournamentPlayer, createTournament, startTournament, upsertPlayer } from "../store.ts";
import { arg, cast, fakeInteraction, playToTheEnd, resetDb, startedTournament, useFakeChannel } from "../test/helpers.ts";
import { leaderboard } from "./leaderboard.ts";

beforeEach(() => {
  resetDb();
  useFakeChannel();
});

async function run(strings?: Record<string, string>) {
  const interaction = fakeInteraction({ commandName: "leaderboard", strings });
  await leaderboard.execute(cast(interaction));
  return interaction;
}

it("ignores interactions outside a cached guild", async () => {
  const interaction = fakeInteraction({ commandName: "leaderboard", cached: false });
  await leaderboard.execute(cast(interaction));
  expect(interaction.reply).not.toHaveBeenCalled();
});

it("says when nothing has been played for the game", async () => {
  expect(arg((await run()).reply)).toBe("No Rocket League matches have been played yet.");
  startedTournament();
  expect(arg((await run({ game: "  Mario Kart " })).reply)).toBe("No Mario Kart matches have been played yet.");
});

it("shows the leaderboard image for the default game", async () => {
  playToTheEnd(startedTournament());
  const interaction = await run();
  expect(interaction.deferReply).toHaveBeenCalled();
  const message = arg(interaction.editReply);
  expect(message.embeds[0].toJSON()).toMatchObject({ title: "Leaderboard — Rocket League", image: { url: "attachment://leaderboard.png" } });
  expect(message.embeds[0].toJSON().description).toBeUndefined();
  expect(message.files.map((f: { name: string }) => f.name)).toEqual(["leaderboard.png"]);
});

it("shows the top 15 and says how many there are", async () => {
  // Two finished 8-player knockouts with different players: 16 people have played.
  for (const prefix of ["x", "y"]) {
    const id = createTournament("guild-1", { semis: 1, final: 1 });
    const seeded = [...Array(8)].map((_, i) => `${prefix}${i}`);
    for (const p of seeded) {
      upsertPlayer(p, p.toUpperCase());
      addTournamentPlayer(id, p);
    }
    startTournament(id, "single_elim", seeded, singleElim(seeded, { semis: 1, final: 1 }), "goons");
    playToTheEnd(id);
  }
  const embed = arg((await run()).editReply).embeds[0].toJSON();
  expect(embed.description).toBe("Showing the top 15 of 16 players.");
});
