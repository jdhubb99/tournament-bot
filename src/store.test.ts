import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "./db.ts";
import { singleElim } from "./logic/bracket.ts";
import * as store from "./store.ts";
import { resetDb } from "./test/helpers.ts";

const lengths = { semis: 3, final: 5 };

function signup(guild: string, players: string[]): number {
  const id = store.createTournament(guild, lengths);
  for (const p of players) {
    store.upsertPlayer(p, p.toUpperCase());
    store.addTournamentPlayer(id, p);
  }
  return id;
}

beforeEach(resetDb);

describe("players", () => {
  it("upserts display names", () => {
    store.upsertPlayer("a", "Old");
    store.upsertPlayer("a", "New");
    expect(db.query("SELECT display_name FROM players WHERE discord_id = 'a'").get()).toEqual({ display_name: "New" });
  });
});

describe("tournaments", () => {
  it("creates a signup tournament with series lengths", () => {
    const id = store.createTournament("g", lengths);
    expect(store.getTournament(id)).toMatchObject({
      guild_id: "g",
      status: "signup",
      semis_best_of: 3,
      final_best_of: 5,
      game: "Rocket League",
    });
  });

  it("returns null for an unknown tournament", () => {
    expect(store.getTournament(999)).toBeNull();
  });

  it("finds only signup or active tournaments for the guild", () => {
    expect(store.getOpenTournament("g")).toBeNull();
    const id = store.createTournament("g", lengths);
    expect(store.getOpenTournament("other")).toBeNull();
    expect(store.getOpenTournament("g")?.id).toBe(id);
    db.query("UPDATE tournaments SET status = 'done' WHERE id = $id").run({ id });
    expect(store.getOpenTournament("g")).toBeNull();
  });

  it("cancels a tournament so it no longer counts as open", () => {
    const id = store.createTournament("g", lengths);
    store.cancelTournament(id);
    expect(store.getTournament(id)?.status).toBe("cancelled");
    expect(db.query("SELECT finished_at IS NOT NULL AS done FROM tournaments WHERE id = $id").get({ id })).toEqual({ done: 1 });
    expect(store.getOpenTournament("g")).toBeNull();
  });

  it("adds each player once and lists them in join order", () => {
    const id = signup("g", ["c", "a", "b"]);
    expect(store.addTournamentPlayer(id, "a")).toBe(false);
    expect(store.listTournamentPlayers(id)).toEqual([
      { discord_id: "c", display_name: "C" },
      { discord_id: "a", display_name: "A" },
      { discord_id: "b", display_name: "B" },
    ]);
  });
});

describe("startTournament", () => {
  it("stores seeds, creates linked matches, and makes the first one live", () => {
    const id = signup("g", ["a", "b", "c", "d"]);
    const seeded = ["d", "b", "a", "c"];
    store.startTournament(id, "single_elim", seeded, singleElim(seeded, lengths));

    expect(store.getTournament(id)).toMatchObject({ status: "active", format: "single_elim" });
    expect(store.listTournamentPlayers(id).map((p) => p.discord_id)).toEqual(seeded);

    const matches = db
      .query<store.Match, []>("SELECT * FROM matches ORDER BY play_order")
      .all()
      .map((m) => [m.label, m.p1_id, m.p2_id, m.best_of, m.status, m.next_match_id, m.next_slot]);
    expect(matches).toEqual([
      ["Semifinal 1", "d", "b", 3, "live", 3, "p1"],
      ["Semifinal 2", "a", "c", 3, "pending", 3, "p2"],
      ["Final", null, null, 5, "pending", null, null],
    ]);
    expect(store.getLiveMatch(id)?.label).toBe("Semifinal 1");
  });

  it("rolls back everything if any step fails", () => {
    const id = signup("g", ["a", "b", "c", "d"]);
    const plan = singleElim(["a", "b", "c", "d"], lengths);
    plan[2]!.p1 = "not-a-player"; // violates the players foreign key
    expect(() => store.startTournament(id, "single_elim", ["a", "b", "c", "d"], plan)).toThrow();
    expect(store.getTournament(id)?.status).toBe("signup");
    expect(db.query("SELECT count(*) AS n FROM matches").get()).toEqual({ n: 0 });
  });

  it("has no live match before start", () => {
    expect(store.getLiveMatch(signup("g", ["a"]))).toBeNull();
  });
});
