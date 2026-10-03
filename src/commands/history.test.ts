import { beforeEach, expect, it } from "bun:test";
import { db } from "../db.ts";
import { forfeitPlayer, getLiveMatch, recordGame } from "../store.ts";
import { arg, cast, fakeInteraction, resetDb, startedTournament } from "../test/helpers.ts";
import { history } from "./history.ts";

beforeEach(resetDb);

async function run() {
  const interaction = fakeInteraction({ commandName: "history" });
  await history.execute(cast(interaction));
  return arg(interaction.reply).embeds[0].toJSON();
}

/** Plays a started tournament to the end, reporting each game as the given scores (p1–p2). */
function play(id: number, games: [number, number][]) {
  for (const [p1, p2] of games) recordGame(getLiveMatch(id)!, p1, p2, "r", "goons");
}

function finishAt(id: number, when: string) {
  db.query("UPDATE tournaments SET finished_at = $when WHERE id = $id").run({ id, when });
  return Date.parse(`${when.replace(" ", "T")}Z`) / 1000;
}

it("ignores interactions outside a cached guild", async () => {
  const interaction = fakeInteraction({ commandName: "history", cached: false });
  await history.execute(cast(interaction));
  expect(interaction.reply).not.toHaveBeenCalled();
});

it("says when there's no history", async () => {
  expect((await run()).description).toBe("No finished tournaments yet.");
});

it("shows two lines per tournament: what and when, then how the final went", async () => {
  const id = startedTournament({ semis: 1, final: 3 });
  play(id, [[2, 1], [0, 3], [1, 2], [4, 0], [3, 1]]); // A and D reach the final; A wins it 2–1
  const unix = finishAt(id, "2026-10-02 22:30:00");
  expect((await run()).description).toBe(
    `<t:${unix}:f> · Knockout, 4 players, semis Bo1\n` +
      "> 🏆 **A** (1st title) beat D 2–1 in the final (Bo3)",
  );
});

it("shows goals for a best-of-1 final and counts titles over time, newest first", async () => {
  const first = startedTournament({ semis: 1, final: 1 });
  play(first, [[2, 1], [2, 1], [5, 4]]); // A beats C 5–4
  const firstUnix = finishAt(first, "2026-10-01 18:00:00");

  const second = startedTournament({ semis: 3, final: 1 });
  play(second, [[1, 0], [1, 0], [1, 0], [1, 0], [6, 2]]); // A beats C 6–2 again
  const secondUnix = finishAt(second, "2026-10-02 18:00:00");

  expect((await run()).description).toBe(
    [
      `<t:${secondUnix}:f> · Knockout, 4 players, semis Bo3\n> 🏆 **A** (2nd title) beat C 6–2 in the final (Bo1)`,
      `<t:${firstUnix}:f> · Knockout, 4 players, semis Bo1\n> 🏆 **A** (1st title) beat C 5–4 in the final (Bo1)`,
    ].join("\n\n"),
  );
});

it("says when the final was won by forfeit", async () => {
  const id = startedTournament({ semis: 1, final: 3 });
  play(id, [[2, 1], [0, 3]]); // A and D reach the final
  forfeitPlayer(id, "a", "goons");
  const unix = finishAt(id, "2026-10-02 22:30:00");
  expect((await run()).description).toBe(
    `<t:${unix}:f> · Knockout, 4 players, semis Bo1\n> 🏆 **D** (1st title) beat A by forfeit in the final (Bo3)`,
  );
});

it("leaves out semis for round robin, which has none", async () => {
  const id = startedTournament({ semis: 1, final: 1 });
  play(id, [[1, 0], [1, 0], [0, 1]]); // C wins the final
  db.query("UPDATE tournaments SET format = 'round_robin' WHERE id = $id").run({ id });
  const unix = finishAt(id, "2026-10-02 22:30:00");
  expect((await run()).description).toBe(
    `<t:${unix}:f> · Round robin + final, 4 players\n> 🏆 **C** (1st title) beat A 1–0 in the final (Bo1)`,
  );
});
