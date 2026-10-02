import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "./db.ts";
import { singleElim } from "./logic/bracket.ts";
import * as store from "./store.ts";
import { resetDb, startedTournament } from "./test/helpers.ts";

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
    store.startTournament(id, "single_elim", seeded, singleElim(seeded, lengths), "gooners");

    expect(store.getTournament(id)).toMatchObject({ status: "active", format: "single_elim" });
    expect(store.listTournamentPlayers(id).map((p) => p.discord_id)).toEqual(seeded);

    const matches = db
      .query<store.Match, []>("SELECT * FROM matches ORDER BY play_order")
      .all()
      .map((m) => [m.label, m.p1_id, m.p2_id, m.best_of, m.status, m.next_match_id, m.next_slot, m.p1_team]);
    expect(matches).toEqual([
      ["Semifinal 1", "d", "b", 3, "live", 3, "p1", "gooners"],
      ["Semifinal 2", "a", "c", 3, "pending", 3, "p2", null],
      ["Final", null, null, 5, "pending", null, null, null],
    ]);
    expect(store.getLiveMatch(id)?.label).toBe("Semifinal 1");
  });

  it("rolls back everything if any step fails", () => {
    const id = signup("g", ["a", "b", "c", "d"]);
    const plan = singleElim(["a", "b", "c", "d"], lengths);
    plan[2]!.p1 = "not-a-player"; // violates the players foreign key
    expect(() => store.startTournament(id, "single_elim", ["a", "b", "c", "d"], plan, "goons")).toThrow();
    expect(store.getTournament(id)?.status).toBe("signup");
    expect(db.query("SELECT count(*) AS n FROM matches").get()).toEqual({ n: 0 });
  });

  it("records the teams when a match goes live", () => {
    const id = signup("g", ["a", "b", "c", "d"]);
    store.startTournament(id, "single_elim", ["a", "b", "c", "d"], singleElim(["a", "b", "c", "d"], lengths), "goons");
    const semi2 = db.query<{ id: number }, []>("SELECT id FROM matches WHERE label = 'Semifinal 2'").get()!;
    db.query("UPDATE matches SET status = 'done' WHERE status = 'live'").run();
    store.goLive(semi2.id, "gooners");
    expect(store.getLiveMatch(id)).toMatchObject({ label: "Semifinal 2", p1_team: "gooners" });
  });

  it("has no live match before start", () => {
    expect(store.getLiveMatch(signup("g", ["a"]))).toBeNull();
  });
});

describe("recordGame", () => {
  const live = (id: number) => store.getLiveMatch(id)!;

  it("saves a game and keeps an undecided series live", () => {
    const id = startedTournament({ semis: 3, final: 3 });
    const outcome = store.recordGame(live(id), 3, 1, "reporter", "gooners");
    expect(outcome.game).toMatchObject({ game_number: 1, p1_score: 3, p2_score: 1, reported_by: "reporter" });
    expect(outcome.series).toMatchObject({ p1Wins: 1, p2Wins: 0, winner: null });
    expect(outcome.match.status).toBe("live");
    expect(outcome.next).toBeNull();
    expect(outcome.championId).toBeNull();
    expect(store.listGames(outcome.match.id)).toHaveLength(1);
  });

  it("closes a decided series, advances the winner, and puts the next match live", () => {
    const id = startedTournament();
    const outcome = store.recordGame(live(id), 0, 2, "reporter", "gooners");
    expect(outcome.match).toMatchObject({ status: "done", winner_id: "b" });
    expect(outcome.next).toMatchObject({ label: "Semifinal 2", status: "live", p1_team: "gooners" });

    const final = store.listMatches(id).find((m) => m.label === "Final")!;
    expect(final).toMatchObject({ p1_id: "b", p2_id: null, status: "pending" });
  });

  it("fills the final's p2 from Semifinal 2 and crowns the champion after the final", () => {
    const id = startedTournament();
    store.recordGame(live(id), 1, 0, "r", "goons"); // a wins SF1
    const sf2 = store.recordGame(live(id), 0, 4, "r", "goons"); // d wins SF2
    expect(sf2.next).toMatchObject({ label: "Final", p1_id: "a", p2_id: "d" });

    store.recordGame(live(id), 0, 1, "r", "goons");
    store.recordGame(live(id), 2, 1, "r", "goons");
    const last = store.recordGame(live(id), 1, 3, "r", "goons");
    expect(last.series).toMatchObject({ p1Wins: 1, p2Wins: 2, winner: "p2" });
    expect(last.championId).toBe("d");
    expect(last.next).toBeNull();
    expect(store.getTournament(id)).toMatchObject({ status: "done", winner_id: "d" });
    expect(store.getOpenTournament("guild-1")).toBeNull();
  });

  it("waits instead of finishing when the next match is missing a player", () => {
    const id = startedTournament();
    db.query("UPDATE matches SET p1_id = NULL, p2_id = NULL WHERE label = 'Semifinal 2'").run();
    const outcome = store.recordGame(live(id), 1, 0, "r", "goons");
    expect(outcome.next).toBeNull();
    expect(outcome.championId).toBeNull();
    expect(store.getTournament(id)?.status).toBe("active");
  });

  it("looks up players and matches", () => {
    startedTournament();
    expect(store.getPlayer("a")).toEqual({ discord_id: "a", display_name: "A" });
    expect(store.getPlayer("nobody")).toBeNull();
    expect(store.getMatch(999)).toBeNull();
  });
});

describe("undoLastGame", () => {
  const live = (id: number) => store.getLiveMatch(id)!;
  const byLabel = (id: number, label: string) => store.listMatches(id).find((m) => m.label === label)!;

  it("returns null when nothing has been reported", () => {
    expect(store.undoLastGame(startedTournament())).toBeNull();
  });

  it("removes a game from a series that's still live", () => {
    const id = startedTournament({ semis: 3, final: 3 });
    store.recordGame(live(id), 3, 1, "r", "goons");
    store.recordGame(live(id), 0, 2, "r", "goons");
    const outcome = store.undoLastGame(id)!;
    expect(outcome.game).toMatchObject({ game_number: 2, p1_score: 0, p2_score: 2 });
    expect(outcome).toMatchObject({ reopened: false, paused: null, tournamentReopened: false });
    expect(outcome.series).toMatchObject({ p1Wins: 1, p2Wins: 0 });
    expect(store.listGames(outcome.match.id)).toHaveLength(1);
  });

  it("reopens a decided match, takes the winner out of the final, and pauses the next match", () => {
    const id = startedTournament();
    store.recordGame(live(id), 3, 1, "r", "gooners"); // a wins SF1, SF2 goes live on gooners
    const outcome = store.undoLastGame(id)!;

    expect(outcome.reopened).toBe(true);
    expect(outcome.match).toMatchObject({ label: "Semifinal 1", status: "live", winner_id: null, p1_team: "goons" });
    expect(outcome.paused).toMatchObject({ label: "Semifinal 2", status: "pending", p1_team: null });
    expect(byLabel(id, "Final")).toMatchObject({ p1_id: null, p2_id: null });
    expect(live(id).label).toBe("Semifinal 1");
  });

  it("clears the p2 slot when the reopened match fed it", () => {
    const id = startedTournament();
    store.recordGame(live(id), 3, 1, "r", "goons"); // SF1: a
    store.recordGame(live(id), 0, 2, "r", "goons"); // SF2: d, final goes live
    const outcome = store.undoLastGame(id)!;
    expect(outcome.paused?.label).toBe("Final");
    expect(byLabel(id, "Final")).toMatchObject({ p1_id: "a", p2_id: null });
  });

  it("reopens a finished tournament when its deciding game is undone", () => {
    const id = startedTournament({ semis: 1, final: 1 });
    store.recordGame(live(id), 1, 0, "r", "goons");
    store.recordGame(live(id), 1, 0, "r", "goons");
    store.recordGame(live(id), 0, 1, "r", "goons"); // c wins the final
    const outcome = store.undoLastGame(id)!;

    expect(outcome).toMatchObject({ reopened: true, paused: null, tournamentReopened: true });
    expect(store.getTournament(id)).toMatchObject({ status: "active", winner_id: null });
    expect(db.query("SELECT finished_at FROM tournaments WHERE id = $id").get({ id })).toEqual({ finished_at: null });
    expect(live(id).label).toBe("Final");
  });

  it("picks the newest game across matches", () => {
    const id = startedTournament();
    store.recordGame(live(id), 1, 0, "r", "goons");
    store.recordGame(live(id), 2, 0, "r", "goons");
    expect(store.getLastGame(id)).toMatchObject({ p1_score: 2 });
  });
});

describe("getUndoableTournament", () => {
  it("is the newest tournament when it's active or done", () => {
    expect(store.getUndoableTournament("guild-1")).toBeNull();
    const id = startedTournament();
    expect(store.getUndoableTournament("guild-1")?.id).toBe(id);
    db.query("UPDATE tournaments SET status = 'done' WHERE id = $id").run({ id });
    expect(store.getUndoableTournament("guild-1")?.id).toBe(id);
  });

  it("is nothing once a newer tournament is in signup or cancelled", () => {
    const old = startedTournament();
    db.query("UPDATE tournaments SET status = 'done' WHERE id = $id").run({ id: old });
    const fresh = store.createTournament("guild-1", lengths);
    expect(store.getUndoableTournament("guild-1")).toBeNull();
    store.cancelTournament(fresh);
    expect(store.getUndoableTournament("guild-1")).toBeNull();
  });
});

describe("listFinishedTournaments", () => {
  it("lists done tournaments in this guild, newest first", () => {
    const first = store.createTournament("guild-1", lengths);
    const second = store.createTournament("guild-1", lengths);
    const other = store.createTournament("guild-2", lengths);
    store.createTournament("guild-1", lengths); // still in signup
    const finish = (id: number, at: string) =>
      db.query("UPDATE tournaments SET status = 'done', finished_at = $at WHERE id = $id").run({ id, at });
    finish(first, "2026-10-01 10:00:00");
    finish(second, "2026-10-02 10:00:00");
    finish(other, "2026-10-03 10:00:00");
    expect(store.listFinishedTournaments("guild-1").map((t) => t.id)).toEqual([second, first]);
    expect(store.listFinishedTournaments("guild-1", 1).map((t) => t.id)).toEqual([second]);
  });
});

describe("titlesUpTo", () => {
  it("counts a player's titles up to and including a tournament", () => {
    const win = (winner: string) => {
      const id = store.createTournament("guild-1", lengths);
      db.query("UPDATE tournaments SET status = 'done', winner_id = $w WHERE id = $id").run({ w: winner, id });
      return id;
    };
    store.upsertPlayer("a", "A");
    store.upsertPlayer("b", "B");
    const first = win("a");
    win("b");
    const third = win("a");
    expect(store.titlesUpTo("guild-1", "a", first)).toBe(1);
    expect(store.titlesUpTo("guild-1", "a", third)).toBe(2);
    expect(store.titlesUpTo("guild-1", "b", third)).toBe(1);
    expect(store.titlesUpTo("guild-2", "a", third)).toBe(0);
  });
});
