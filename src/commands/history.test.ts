import { beforeEach, expect, it } from "bun:test";
import { db } from "../db.ts";
import { getLiveMatch, recordGame } from "../store.ts";
import { arg, cast, fakeInteraction, resetDb, startedTournament } from "../test/helpers.ts";
import { history } from "./history.ts";

beforeEach(resetDb);

async function run() {
  const interaction = fakeInteraction({ commandName: "history" });
  await history.execute(cast(interaction));
  return arg(interaction.reply).embeds[0].toJSON();
}

function playToTheEnd(id: number) {
  for (let i = 0; i < 4; i++) {
    const live = getLiveMatch(id);
    if (live) recordGame(live, 2, 1, "r", "goons");
  }
}

it("ignores interactions outside a cached guild", async () => {
  const interaction = fakeInteraction({ commandName: "history", cached: false });
  await history.execute(cast(interaction));
  expect(interaction.reply).not.toHaveBeenCalled();
});

it("says when there's no history", async () => {
  expect((await run()).description).toBe("No finished tournaments yet.");
});

it("lists finished tournaments with date, format, winner and runner-up", async () => {
  const id = startedTournament({ semis: 1, final: 1 });
  playToTheEnd(id); // a beats b, c beats d, a beats c
  db.query("UPDATE tournaments SET finished_at = '2026-10-02 21:30:00' WHERE id = $id").run({ id });
  const unix = Date.UTC(2026, 9, 2, 21, 30) / 1000;
  expect((await run()).description).toBe(
    `<t:${unix}:D> · Single elimination, 4 players · 🏆 **A** · runner-up C`,
  );
});
