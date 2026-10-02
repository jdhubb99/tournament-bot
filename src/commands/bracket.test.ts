import { beforeEach, expect, it } from "bun:test";
import { addTournamentPlayer, createTournament, getLiveMatch, recordGame, upsertPlayer } from "../store.ts";
import { arg, cast, fakeInteraction, resetDb, startedTournament } from "../test/helpers.ts";
import { bracket } from "./bracket.ts";

beforeEach(resetDb);

async function run() {
  const interaction = fakeInteraction({ commandName: "bracket" });
  await bracket.execute(cast(interaction));
  return arg(interaction.reply);
}

it("ignores interactions outside a cached guild", async () => {
  const interaction = fakeInteraction({ commandName: "bracket", cached: false });
  await bracket.execute(cast(interaction));
  expect(interaction.reply).not.toHaveBeenCalled();
});

it("points to /history when nothing is running", async () => {
  expect(await run()).toBe("No tournament is running. Use `/history` for past tournaments.");
});

it("says signup is still open", async () => {
  const id = createTournament("guild-1", { semis: 1, final: 3 });
  upsertPlayer("a", "A");
  addTournamentPlayer(id, "a");
  expect(await run()).toBe("Signup is open with 1 player(s). The bracket is drawn when someone presses Start.");
});

it("shows the live match, the queue, and results", async () => {
  const id = startedTournament();
  recordGame(getLiveMatch(id)!, 3, 1, "r", "goons");
  const embed = (await run()).embeds[0].toJSON();
  expect(embed.title).toBe("Rocket League 1v1 — Single elimination, 4 players");
  expect(embed.fields).toEqual([
    { name: "🔴 Live", value: "**Semifinal 2** (Bo1): C vs D" },
    { name: "Up next", value: "Final (Bo3): A vs Winner of Semifinal 2" },
    { name: "Results", value: "Semifinal 1: **A** def. B (3–1)" },
  ]);
});

it("leaves out the live section while nothing is live", async () => {
  const id = startedTournament();
  const { db } = await import("../db.ts");
  db.query("UPDATE matches SET status = 'pending' WHERE tournament_id = $id").run({ id });
  const fields = (await run()).embeds[0].toJSON().fields.map((f: { name: string }) => f.name);
  expect(fields).toEqual(["Up next"]);
});
