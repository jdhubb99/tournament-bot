import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "../db.ts";
import { createTournament, listTournamentPlayers } from "../store.ts";
import { arg, cast, fakeInteraction, resetDb } from "../test/helpers.ts";
import { dev } from "./dev.ts";
import { joinSignup } from "./tournament.ts";

beforeEach(resetDb);

async function devJoin(optionUser: { id: string; name: string; memberName?: string }) {
  const interaction = fakeInteraction({ commandName: "dev", subcommand: "join", optionUser });
  await dev.execute(cast(interaction));
  return arg(interaction.reply);
}

describe("/dev join", () => {
  it("ignores interactions outside a cached guild", async () => {
    const interaction = fakeInteraction({ commandName: "dev", cached: false });
    await dev.execute(cast(interaction));
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it("needs a tournament in signup", async () => {
    const message = await devJoin({ id: "x", name: "X" });
    expect(message.content).toBe("No tournament is in signup. Run `/tournament start` first.");

    const id = createTournament("guild-1", { semis: 1, final: 3 });
    db.query("UPDATE tournaments SET status = 'active' WHERE id = $id").run({ id });
    expect((await devJoin({ id: "x", name: "X" })).content).toBe("No tournament is in signup. Run `/tournament start` first.");
  });

  it("adds a server member under their server name, privately", async () => {
    const id = createTournament("guild-1", { semis: 1, final: 3 });
    const message = await devJoin({ id: "friend", name: "global", memberName: "Server Nick" });
    expect(message.content).toBe("Added <@friend> (1/8). The signup message's list refreshes on the next Join or Start click.");
    expect(message.flags).toBeDefined();
    expect(listTournamentPlayers(id)).toEqual([{ discord_id: "friend", display_name: "Server Nick" }]);
  });

  it("falls back to the user's name when they aren't a resolved member", async () => {
    const id = createTournament("guild-1", { semis: 1, final: 3 });
    await devJoin({ id: "botuser", name: "Some Bot" });
    expect(listTournamentPlayers(id)[0]?.display_name).toBe("Some Bot");
  });

  it("reports duplicates and a full signup", async () => {
    const id = createTournament("guild-1", { semis: 1, final: 3 });
    await devJoin({ id: "p1", name: "P1" });
    expect((await devJoin({ id: "p1", name: "P1" })).content).toBe("<@p1> has already joined.");

    for (let i = 2; i <= 8; i++) joinSignup(id, `p${i}`, `P${i}`);
    expect((await devJoin({ id: "p9", name: "P9" })).content).toBe(
      "The bot supports up to 8 players, and this tournament is full.",
    );
  });
});
