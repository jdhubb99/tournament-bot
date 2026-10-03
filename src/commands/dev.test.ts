import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "../db.ts";
import { createTournament, getOpenTournament, getTournament, listTournamentPlayers } from "../store.ts";
import { arg, cast, fakeInteraction, resetDb, startedTournament, useFakeChannel } from "../test/helpers.ts";
import { refreshBracketMessage } from "../announce.ts";
import { dev } from "./dev.ts";
import { joinSignup } from "./tournament.ts";

let channel: ReturnType<typeof useFakeChannel>;

beforeEach(() => {
  resetDb();
  channel = useFakeChannel();
});

type OptionUser = { id: string; name: string; memberName?: string };

/** Runs /dev join with the given users in slots user1, user2, ... */
async function devJoin(...users: OptionUser[]) {
  const optionUsers = Object.fromEntries(users.map((u, i) => [`user${i + 1}`, u]));
  const interaction = fakeInteraction({ commandName: "dev", subcommand: "join", optionUsers });
  await dev.execute(cast(interaction));
  return arg(interaction.reply);
}

const players = (n: number, from = 1) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i + from}`, name: `P${i + from}` }));

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

  it("adds several players in one go, privately", async () => {
    const id = createTournament("guild-1", { semis: 1, final: 3 });
    const message = await devJoin(...players(3));
    expect(message.content).toBe(
      "Added <@p1>, <@p2>, <@p3> (3/8).\nThe signup message's list refreshes on the next Join or Start click.",
    );
    expect(message.flags).toBeDefined();
    expect(listTournamentPlayers(id).map((p) => p.discord_id)).toEqual(["p1", "p2", "p3"]);
  });

  it("uses server names, falling back to the user's name", async () => {
    const id = createTournament("guild-1", { semis: 1, final: 3 });
    await devJoin({ id: "friend", name: "global", memberName: "Server Nick" }, { id: "botuser", name: "Some Bot" });
    expect(listTournamentPlayers(id).map((p) => p.display_name)).toEqual(["Server Nick", "Some Bot"]);
  });

  it("skips empty slots and the same user picked twice", async () => {
    const id = createTournament("guild-1", { semis: 1, final: 3 });
    const interaction = fakeInteraction({
      commandName: "dev",
      subcommand: "join",
      optionUsers: { user1: { id: "p1", name: "P1" }, user3: { id: "p2", name: "P2" }, user4: { id: "p1", name: "P1" } },
    });
    await dev.execute(cast(interaction));
    expect(arg(interaction.reply).content).toStartWith("Added <@p1>, <@p2> (2/8).");
    expect(listTournamentPlayers(id)).toHaveLength(2);
  });

  it("reports who was already in and who didn't fit", async () => {
    const id = createTournament("guild-1", { semis: 1, final: 3 });
    for (const p of players(6)) joinSignup(id, p.id, p.name);
    const message = await devJoin({ id: "p1", name: "P1" }, ...players(3, 7));
    expect(message.content).toBe(
      [
        "Added <@p7>, <@p8> (8/8).",
        "Already joined: <@p1>.",
        "Not added, the tournament is full: <@p9>.",
        "The signup message's list refreshes on the next Join or Start click.",
      ].join("\n"),
    );
  });

  it("says when nobody new was added", async () => {
    const id = createTournament("guild-1", { semis: 1, final: 3 });
    joinSignup(id, "p1", "P1");
    expect((await devJoin({ id: "p1", name: "P1" })).content).toBe("Nobody new was added (1/8).\nAlready joined: <@p1>.");
  });

  it("offers eight user slots, only the first required", () => {
    const join = dev.data.toJSON().options!.find((o) => o.name === "join") as { options: { name: string; required?: boolean }[] };
    expect(join.options.map((o) => o.name)).toEqual(["user1", "user2", "user3", "user4", "user5", "user6", "user7", "user8"]);
    expect(join.options.map((o) => o.required ?? false)).toEqual([true, false, false, false, false, false, false, false]);
  });
});

describe("/dev cancel", () => {
  async function devCancel() {
    const interaction = fakeInteraction({ commandName: "dev", subcommand: "cancel" });
    await dev.execute(cast(interaction));
    return arg(interaction.reply);
  }

  it("says when nothing is running", async () => {
    expect((await devCancel()).content).toBe("No tournament is running.");
  });

  it("cancels a tournament in signup", async () => {
    const id = createTournament("guild-1", { semis: 1, final: 3 });
    const message = await devCancel();
    expect(message.content).toBe(`Cancelled tournament #${id}. You can run \`/tournament start\` again.`);
    expect(message.flags).toBeDefined();
    expect(getTournament(id)?.status).toBe("cancelled");
  });

  it("marks an active tournament's bracket message cancelled", async () => {
    const id = startedTournament();
    await refreshBracketMessage(id);
    await devCancel();
    expect(arg(channel.sent.get("msg-1")!.edit).embeds[0].toJSON().title).toEndWith("(cancelled)");
  });

  it("cancels an active tournament so a new one can start", async () => {
    startedTournament();
    await devCancel();
    expect(getOpenTournament("guild-1")).toBeNull();
  });
});

it("does nothing for an unknown /dev subcommand", async () => {
  const interaction = fakeInteraction({ commandName: "dev", subcommand: "nope" });
  await dev.execute(cast(interaction));
  expect(interaction.reply).not.toHaveBeenCalled();
});
