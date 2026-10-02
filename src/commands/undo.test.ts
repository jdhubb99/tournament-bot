import { beforeEach, describe, expect, it } from "bun:test";
import { getLiveMatch, getTournament, recordGame } from "../store.ts";
import { arg, cast, fakeInteraction, resetDb, startedTournament } from "../test/helpers.ts";
import { undo } from "./undo.ts";

beforeEach(resetDb);

const live = (id: number) => getLiveMatch(id)!;

async function run() {
  const interaction = fakeInteraction({ commandName: "undo" });
  await undo.execute(cast(interaction));
  return arg(interaction.reply);
}

describe("/undo", () => {
  it("ignores interactions outside a cached guild", async () => {
    const interaction = fakeInteraction({ commandName: "undo", cached: false });
    await undo.execute(cast(interaction));
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it("says when there's nothing to undo", async () => {
    expect(await run()).toBe("There's no reported game to undo.");
    startedTournament();
    expect(await run()).toBe("There's no reported game to undo.");
  });

  it("removes a game mid-series and shows the new standing", async () => {
    const id = startedTournament({ semis: 3, final: 3 });
    recordGame(live(id), 3, 1, "r", "goons");
    recordGame(live(id), 0, 2, "r", "goons");
    const message = await run();
    expect(message.content).toBe("↩️ Removed game 2 of Semifinal 1 (A 0 – 2 B).\nA leads the series 1–0");
    expect(message.allowedMentions).toEqual({ parse: [] });
  });

  it("reopens a decided match and pauses the one that went live after it", async () => {
    const id = startedTournament();
    recordGame(live(id), 3, 1, "r", "goons");
    expect((await run()).content).toBe(
      "↩️ Removed game 1 of Semifinal 1 (A 3 – 1 B).\nSemifinal 1 is live again. Semifinal 2 is back to waiting.",
    );
    expect(live(id).label).toBe("Semifinal 1");
  });

  it("reopens a finished tournament", async () => {
    const id = startedTournament({ semis: 1, final: 1 });
    recordGame(live(id), 1, 0, "r", "goons");
    recordGame(live(id), 1, 0, "r", "goons");
    recordGame(live(id), 0, 1, "r", "goons");
    expect((await run()).content).toBe(
      [
        "↩️ Removed game 1 of Final (A 0 – 1 C).",
        "The tournament is back in progress and the champion has been cleared.",
        "Final is live again.",
      ].join("\n"),
    );
    expect(getTournament(id)?.status).toBe("active");
  });
});
