import { beforeEach, expect, it } from "bun:test";
import { db } from "../db.ts";
import { addTournamentPlayer, createTournament, getLiveMatch, recordGame, upsertPlayer } from "../store.ts";
import { arg, cast, fakeInteraction, resetDb, startedTournament, useFakeChannel } from "../test/helpers.ts";
import { bracket } from "./bracket.ts";

beforeEach(() => {
  resetDb();
  useFakeChannel();
});

async function run() {
  const interaction = fakeInteraction({ commandName: "bracket" });
  await bracket.execute(cast(interaction));
  return interaction;
}

it("ignores interactions outside a cached guild", async () => {
  const interaction = fakeInteraction({ commandName: "bracket", cached: false });
  await bracket.execute(cast(interaction));
  expect(interaction.reply).not.toHaveBeenCalled();
});

it("says when no tournament has been played", async () => {
  expect(arg((await run()).reply)).toBe("No tournament has been played yet. Run `/tournament start` to begin one.");
});

it("says signup is still open", async () => {
  const id = createTournament("guild-1", { semis: 1, final: 3 });
  upsertPlayer("a", "A");
  addTournamentPlayer(id, "a");
  expect(arg((await run()).reply)).toBe("Signup is open with 1 player(s). The bracket is drawn when someone presses Start.");
});

it("shows the bracket image with the live match", async () => {
  const id = startedTournament();
  recordGame(getLiveMatch(id)!, 3, 1, "r", "goons");
  const interaction = await run();
  expect(interaction.deferReply).toHaveBeenCalled();
  const message = arg(interaction.editReply);
  expect(message.embeds[0].toJSON()).toMatchObject({
    title: "Rocket League 1v1 — Knockout, 4 players",
    description: "🔴 Live: **Semifinal 2** (Bo1): C vs D",
    image: { url: "attachment://bracket.png" },
  });
  expect(message.files.map((f: { name: string }) => f.name)).toEqual(["bracket.png"]);
});

it("shows the last finished tournament when nothing is running", async () => {
  const id = startedTournament({ semis: 1, final: 1 });
  for (let i = 0; i < 3; i++) recordGame(getLiveMatch(id)!, 2, 1, "r", "goons");
  const embed = arg((await run()).editReply).embeds[0].toJSON();
  expect(embed.title).toBe("Rocket League 1v1 — Knockout, 4 players (finished)");
  expect(embed.description).toBeUndefined();
});

it("leaves out the live line while nothing is live", async () => {
  const id = startedTournament();
  db.query("UPDATE matches SET status = 'pending' WHERE tournament_id = $id").run({ id });
  expect(arg((await run()).editReply).embeds[0].toJSON().description).toBeUndefined();
});
