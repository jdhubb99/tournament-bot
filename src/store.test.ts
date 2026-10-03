import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "./db.ts";
import { singleElim } from "./logic/bracket.ts";
import { isOut, wonByForfeit } from "./logic/forfeit.ts";
import * as store from "./store.ts";
import {
  playLeague,
  playLeagueMatch,
  playToTheEnd,
  resetDb,
  startedEight,
  startedGroups,
  startedRoundRobin,
  startedTournament,
} from "./test/helpers.ts";

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

describe("changeSeriesLengths", () => {
  const lengthsOf = (id: number) => Object.fromEntries(store.listMatches(id).map((m) => [m.label, m.best_of]));

  it("changes a signup tournament's options", () => {
    const id = signup("g", ["a", "b"]);
    store.changeSeriesLengths(id, { semis: 5, final: 1 });
    expect(store.getTournament(id)).toMatchObject({ semis_best_of: 5, final_best_of: 1 });
  });

  it("changes only the given round, in both the options and its matches", () => {
    const id = startedEight({ semis: 1, final: 3 });
    store.changeSeriesLengths(id, { final: 1 });
    expect(store.getTournament(id)).toMatchObject({ semis_best_of: 1, final_best_of: 1 });
    expect(lengthsOf(id)).toMatchObject({ "Quarterfinal 1": 1, "Semifinal 1": 1, "Semifinal 2": 1, Final: 1 });

    store.changeSeriesLengths(id, { semis: 3 });
    expect(lengthsOf(id)).toMatchObject({ "Quarterfinal 4": 1, "Semifinal 1": 3, "Semifinal 2": 3, Final: 1 });
  });

  it("leaves decided matches as they were played", () => {
    const id = startedTournament({ semis: 1, final: 3 });
    store.recordGame(store.getLiveMatch(id)!, 1, 0, "r", "goons"); // Semifinal 1 decided as a Bo1
    store.changeSeriesLengths(id, { semis: 3, final: 5 });
    expect(lengthsOf(id)).toEqual({ "Semifinal 1": 1, "Semifinal 2": 3, Final: 5 });
  });

  it("changes a live match, so later reports use the new length", () => {
    const id = startedRoundRobin(3);
    playLeague(id);
    const final = store.getLiveMatch(id)!;
    store.recordGame(final, 2, 1, "r", "goons");
    store.changeSeriesLengths(id, { final: 5 });
    const outcome = store.recordGame(store.getLiveMatch(id)!, 2, 1, "r", "goons");
    expect(outcome.series).toMatchObject({ p1Wins: 2, winsNeeded: 3, winner: null });
    expect(store.getTournament(id)!.status).toBe("active");
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

describe("round robin", () => {
  const final = (id: number) => store.listMatches(id).at(-1)!;

  it("keeps the final empty until every league match is done", () => {
    const id = startedRoundRobin();
    for (let i = 0; i < 9; i++) expect(playLeagueMatch(id).stageFinished).toBe(false);
    expect(final(id)).toMatchObject({ p1_id: null, p2_id: null, status: "pending" });
  });

  it("fills the final with the top 2 (1st as p1) and puts it live when the league ends", () => {
    const id = startedRoundRobin(3);
    const last = playLeague(id);
    expect(last.stageFinished).toBe(true);
    expect(last.next).toMatchObject({ label: "Final", p1_id: "a", p2_id: "b", status: "live", best_of: 3 });
    expect(store.leagueStandings(id).map((r) => [r.playerId, r.wins])).toEqual([
      ["a", 4],
      ["b", 3],
      ["c", 2],
      ["d", 1],
      ["e", 0],
    ]);
  });

  it("crowns the final's winner, not the top of the table", () => {
    const id = startedRoundRobin(1);
    playLeague(id);
    const outcome = store.recordGame(store.getLiveMatch(id)!, 0, 3, "r", "goons"); // b wins the final
    expect(outcome.championId).toBe("b");
    expect(store.getTournament(id)).toMatchObject({ status: "done", winner_id: "b" });
  });

  it("empties the final again when the last league game is undone", () => {
    const id = startedRoundRobin();
    playLeague(id);
    const outcome = store.undoLastGame(id)!;
    expect(outcome.paused?.label).toBe("Final");
    expect(final(id)).toMatchObject({ p1_id: null, p2_id: null, status: "pending", p1_team: null });
    expect(store.getLiveMatch(id)?.label).toBe("Match 10");
  });

  it("keeps the final's players when a final game is undone", () => {
    const id = startedRoundRobin();
    playLeague(id);
    store.recordGame(store.getLiveMatch(id)!, 3, 0, "r", "goons");
    store.undoLastGame(id);
    expect(final(id)).toMatchObject({ p1_id: "a", p2_id: "b", status: "live" });
  });

  it("only counts decided league matches in the table", () => {
    const id = startedRoundRobin();
    playLeagueMatch(id);
    expect(store.leagueStandings(id).reduce((n, r) => n + r.played, 0)).toBe(2);
  });
});

describe("groups", () => {
  const semis = (id: number) => store.listMatches(id).filter((m) => m.label.startsWith("Semifinal"));
  const playGroupStage = (id: number) => {
    let last!: store.GameOutcome;
    while (store.getLiveMatch(id)!.round === 1) {
      const m = store.getLiveMatch(id)!;
      const p1Wins = m.p1_id! < m.p2_id!;
      last = store.recordGame(m, p1Wins ? 2 : 1, p1Wins ? 1 : 2, "r", "goons");
    }
    return last;
  };

  it("builds each group's table from its own matches", () => {
    const id = startedGroups(7);
    playGroupStage(id);
    const tables = store.groupStandings(id);
    expect(tables.A.map((r) => [r.playerId, r.wins])).toEqual([["a", 3], ["b", 2], ["c", 1], ["d", 0]]);
    expect(tables.B.map((r) => [r.playerId, r.wins])).toEqual([["e", 2], ["f", 1], ["g", 0]]);
  });

  it("fills the semis A1 vs B2 and B1 vs A2 when the last group match closes", () => {
    const id = startedGroups(6);
    expect(semis(id).every((m) => m.p1_id === null && m.p2_id === null)).toBe(true);
    const last = playGroupStage(id);
    expect(last.stageFinished).toBe(true);
    expect(semis(id).map((m) => [m.label, m.p1_id, m.p2_id])).toEqual([
      ["Semifinal 1", "a", "e"],
      ["Semifinal 2", "d", "b"],
    ]);
    expect(last.next).toMatchObject({ label: "Semifinal 1", status: "live" });
  });

  it("empties both semis again when the last group game is undone", () => {
    const id = startedGroups(6);
    playGroupStage(id);
    const undone = store.undoLastGame(id)!;
    expect(undone.paused?.label).toBe("Semifinal 1");
    expect(semis(id).every((m) => m.p1_id === null && m.p2_id === null && m.status === "pending")).toBe(true);
    expect(store.getLiveMatch(id)?.round).toBe(1);
  });

  it("keeps the semis' players when a semifinal game is undone", () => {
    const id = startedGroups(6);
    playGroupStage(id);
    store.recordGame(store.getLiveMatch(id)!, 3, 0, "r", "goons");
    store.undoLastGame(id);
    expect(semis(id).map((m) => [m.p1_id, m.p2_id])).toEqual([
      ["a", "e"],
      ["d", "b"],
    ]);
  });

  it("has no standings-filled playoffs in a knockout", () => {
    const id = startedTournament();
    store.recordGame(store.getLiveMatch(id)!, 1, 0, "r", "goons");
    expect(store.undoLastGame(id)!.reopened).toBe(true);
    expect(store.listMatches(id).at(-1)).toMatchObject({ p1_id: null, p2_id: null });
  });
});

describe("6, 7 and 8 players start to finish", () => {
  it("runs a 6-player groups tournament: 6 group matches, 2 semis, a final", () => {
    const id = startedGroups(6, { semis: 1, final: 1 });
    expect(playToTheEnd(id)).toBe(9);
    expect(store.getTournament(id)).toMatchObject({ status: "done", winner_id: "a" });
  });

  it("runs a 7-player groups tournament: 9 group matches, 2 semis, a final", () => {
    const id = startedGroups(7, { semis: 1, final: 1 });
    expect(playToTheEnd(id)).toBe(12);
    expect(store.getTournament(id)).toMatchObject({ status: "done", winner_id: "a" });
  });

  it("runs an 8-player knockout: quarters, semis and a best-of-3 final", () => {
    const id = startedEight({ semis: 1, final: 3 });
    expect(playToTheEnd(id)).toBe(4 + 2 + 2);
    expect(store.listMatches(id).map((m) => m.winner_id)).toEqual(["a", "c", "e", "g", "a", "e", "a"]);
    expect(store.getTournament(id)).toMatchObject({ status: "done", winner_id: "a" });
  });
});

describe("stats queries", () => {
  it("returns decided matches with their games, from active and finished tournaments only", () => {
    const active = startedTournament();
    store.recordGame(store.getLiveMatch(active)!, 3, 1, "r", "goons"); // a beats b
    const cancelled = startedTournament();
    store.recordGame(store.getLiveMatch(cancelled)!, 1, 0, "r", "goons");
    store.cancelTournament(cancelled);

    expect(store.decidedMatches("guild-1")).toEqual([
      { p1: "a", p2: "b", winner: "a", games: [expect.objectContaining({ p1_score: 3, p2_score: 1 })] },
    ]);
    expect(store.decidedMatches("guild-2")).toEqual([]);
  });

  it("filters by game, ignoring case", () => {
    const id = startedTournament();
    store.recordGame(store.getLiveMatch(id)!, 3, 1, "r", "goons");
    expect(store.decidedMatches("guild-1", "rocket league")).toHaveLength(1);
    expect(store.decidedMatches("guild-1", "Mario Kart")).toEqual([]);
  });

  it("counts titles per player for finished tournaments of the game", () => {
    for (const winner of ["a", "b", "a"]) {
      const id = startedTournament({ semis: 1, final: 1 });
      playToTheEnd(id);
      db.query("UPDATE tournaments SET winner_id = $w WHERE id = $id").run({ w: winner, id });
    }
    db.query("UPDATE tournaments SET game = 'Mario Kart' WHERE id = (SELECT max(id) FROM tournaments)").run();
    expect(store.titleCounts("guild-1")).toEqual(new Map([["a", 1], ["b", 1]]));
    expect(store.titleCounts("guild-1", "mario kart")).toEqual(new Map([["a", 1]]));
  });
});

describe("forfeits", () => {
  const live = (id: number) => store.getLiveMatch(id)!;
  const byLabel = (id: number, label: string) => store.listMatches(id).find((m) => m.label === label)!;
  /** Reports the live match's next game, the alphabetically earlier player winning 2–1. */
  const play = (id: number) => {
    const m = live(id);
    const p1Wins = m.p1_id! < m.p2_id!;
    return store.recordGame(m, p1Wins ? 2 : 1, p1Wins ? 1 : 2, "r", "goons");
  };
  const forfeited = (m: store.Match) => wonByForfeit(m, store.listGames(m.id));

  it("ends the live match in the opponent's favour and puts the next one live", () => {
    const id = startedTournament();
    const outcome = store.forfeitPlayer(id, "a", "gooners");
    expect(outcome.forfeits.map((m) => [m.label, m.winner_id])).toEqual([["Semifinal 1", "b"]]);
    expect(forfeited(byLabel(id, "Semifinal 1"))).toBe(true);
    expect(byLabel(id, "Final").p1_id).toBe("b");
    expect(outcome.next).toMatchObject({ label: "Semifinal 2", status: "live", p1_team: "gooners" });
    expect(outcome).toMatchObject({ championId: null, stageFinished: false });
    expect(store.droppedPlayers(id)).toEqual(new Set(["a"]));
  });

  it("keeps the games already played in a forfeited series", () => {
    const id = startedTournament({ semis: 3, final: 3 });
    store.recordGame(live(id), 2, 1, "r", "goons"); // a leads 1–0
    store.forfeitPlayer(id, "a", "goons");
    const semi = byLabel(id, "Semifinal 1");
    expect(semi).toMatchObject({ status: "done", winner_id: "b" });
    expect(store.listGames(semi.id)).toHaveLength(1);
    expect(forfeited(semi)).toBe(true);
  });

  it("records the newest game at the time of dropping", () => {
    const id = startedTournament();
    store.forfeitPlayer(id, "c", "goons");
    const game = play(id).game;
    store.forfeitPlayer(id, "b", "goons");
    const rows = db.query("SELECT player_id, dropped_after_game FROM tournament_players WHERE dropped_after_game IS NOT NULL ORDER BY player_id").all();
    expect(rows).toEqual([
      { player_id: "b", dropped_after_game: game.id },
      { player_id: "c", dropped_after_game: 0 },
    ]);
  });

  it("decides a waiting match once its other player is known", () => {
    const id = startedTournament();
    play(id); // a wins Semifinal 1 and waits in the final
    const dropped = store.forfeitPlayer(id, "a", "goons");
    expect(dropped).toEqual({ next: null, championId: null, stageFinished: false, forfeits: [] });
    expect(live(id).label).toBe("Semifinal 2");

    const outcome = play(id); // c wins Semifinal 2, then the final is a forfeit
    expect(outcome.forfeits.map((m) => [m.label, m.winner_id])).toEqual([["Final", "c"]]);
    expect(outcome).toMatchObject({ championId: "c", next: null });
    expect(store.getTournament(id)).toMatchObject({ status: "done", winner_id: "c" });
  });

  it("decides a knockout match with both players known right away, leaving the live one alone", () => {
    const id = startedEight();
    const outcome = store.forfeitPlayer(id, "d", "goons");
    expect(outcome.forfeits.map((m) => [m.label, m.winner_id])).toEqual([["Quarterfinal 2", "c"]]);
    expect(outcome.next).toBeNull();
    expect(byLabel(id, "Semifinal 1").p2_id).toBe("c");
    expect(live(id).label).toBe("Quarterfinal 1");
  });

  it("forfeits every league match left and keeps the dropped player out of the final", () => {
    const id = startedRoundRobin();
    const outcome = store.forfeitPlayer(id, "b", "goons");
    expect(outcome.forfeits.map((m) => m.winner_id).sort()).toEqual(["a", "c", "d", "e"]);
    while (live(id).round === 1) play(id);
    // b won nothing but has the fewest games; dropped players go last however they did.
    expect(store.leagueStandings(id).at(-1)!.playerId).toBe("b");
    expect(byLabel(id, "Final")).toMatchObject({ p1_id: "a", p2_id: "c", status: "live" });
  });

  it("puts dropped players at the bottom of the table even if they were winning", () => {
    const id = startedRoundRobin();
    while (store.listMatches(id).filter((m) => m.status === "done").length < 4) play(id);
    const leader = store.leagueStandings(id)[0]!.playerId;
    store.forfeitPlayer(id, leader, "goons");
    expect(store.leagueStandings(id).at(-1)!.playerId).toBe(leader);
  });

  it("gives a dropped player's playoff place to the next in the table, or forfeits it when nobody's left", () => {
    const id = startedGroups(6); // Group A: a, b, c. Group B: d, e, f
    store.forfeitPlayer(id, "b", "goons");
    store.forfeitPlayer(id, "c", "goons");
    let last!: store.GameOutcome;
    while (live(id).round === 1) last = play(id);
    // A2 is a dropped player, so Semifinal 2 (B1 vs A2) is a forfeit as soon as it's filled.
    expect(last.stageFinished).toBe(true);
    expect(last.forfeits.map((m) => [m.label, m.winner_id])).toEqual([["Semifinal 2", "d"]]);
    expect(byLabel(id, "Final").p2_id).toBe("d");
    expect(last.next).toMatchObject({ label: "Semifinal 1", p1_id: "a", p2_id: "e" });
  });

  it("finishes every format with a champion who didn't drop, whoever drops and whenever", () => {
    const starts = { 4: startedTournament, 5: startedRoundRobin, 6: () => startedGroups(6), 7: () => startedGroups(7), 8: startedEight };
    for (const [count, start] of Object.entries(starts)) {
      for (let victim = 0; victim < Number(count); victim++) {
        for (let after = 0; after < 14; after++) {
          resetDb();
          const id = start();
          const player = "abcdefgh"[victim]!;
          for (let i = 0; i < after && store.getTournament(id)!.status === "active"; i++) play(id);
          const t = store.getTournament(id)!;
          if (t.status !== "active" || isOut(player, store.listMatches(id), t.format)) continue;
          store.forfeitPlayer(id, player, "goons");
          playToTheEnd(id);
          const winner = store.getTournament(id)!.winner_id;
          expect(winner === null || winner === player ? `${count} players, ${player} dropped after ${after}` : "ok").toBe("ok");
        }
      }
    }
  });

  it("finishes with the last player standing when everyone else drops", () => {
    for (const start of [startedTournament, startedRoundRobin, () => startedGroups(7), startedEight]) {
      resetDb();
      const id = start();
      const players = store.listTournamentPlayers(id).map((p) => p.discord_id);
      for (const player of players.slice(1)) {
        const t = store.getTournament(id)!;
        if (t.status !== "active") break;
        if (!isOut(player, store.listMatches(id), t.format)) store.forfeitPlayer(id, player, "goons");
        const now = store.getLiveMatch(id);
        if (now) expect([now.p1_id, now.p2_id].some((p) => store.droppedPlayers(id).has(p!))).toBe(false);
        if (store.getTournament(id)!.status === "active") play(id);
      }
      playToTheEnd(id);
      expect(store.droppedPlayers(id).has(store.getTournament(id)!.winner_id!)).toBe(false);
    }
  });

  describe("and undo", () => {
    it("knows when a player dropped after the newest game", () => {
      const id = startedTournament();
      expect(store.droppedSinceLastGame(id)).toBeNull();
      store.forfeitPlayer(id, "d", "goons");
      expect(store.droppedSinceLastGame(id)).toBe("d");
      play(id);
      expect(store.droppedSinceLastGame(id)).toBeNull();
      store.forfeitPlayer(id, "a", "goons");
      expect(store.droppedSinceLastGame(id)).toBe("a");
    });

    it("reopens a final the undone game had decided by forfeit", () => {
      const id = startedTournament();
      play(id); // a wins Semifinal 1
      store.forfeitPlayer(id, "a", "goons");
      play(id); // c wins Semifinal 2, and the final by forfeit
      const outcome = store.undoLastGame(id)!;
      expect(outcome).toMatchObject({ reopened: true, tournamentReopened: true, paused: null });
      expect(outcome.unforfeited.map((m) => [m.label, m.status, m.winner_id, m.p1_id, m.p2_id])).toEqual([
        ["Final", "pending", null, "a", null],
      ]);
      expect(store.getTournament(id)).toMatchObject({ status: "active", winner_id: null });
      expect(live(id).label).toBe("Semifinal 2");
    });

    it("empties playoffs the undone game had filled and decided by forfeit", () => {
      const id = startedGroups(6);
      store.forfeitPlayer(id, "b", "goons");
      store.forfeitPlayer(id, "c", "goons");
      while (live(id).round === 1) play(id);
      const outcome = store.undoLastGame(id)!;
      expect(outcome.paused?.label).toBe("Semifinal 1");
      expect(outcome.unforfeited.map((m) => [m.label, m.status, m.p1_id])).toEqual([["Semifinal 2", "pending", null]]);
      for (const label of ["Semifinal 1", "Semifinal 2"]) {
        expect(byLabel(id, label)).toMatchObject({ p1_id: null, p2_id: null, status: "pending", winner_id: null });
      }
      expect(byLabel(id, "Final").p2_id).toBeNull();
    });

    it("leaves forfeits from before the undone game alone", () => {
      const id = startedRoundRobin();
      store.forfeitPlayer(id, "e", "goons");
      play(id);
      expect(store.undoLastGame(id)!.unforfeited).toEqual([]);
      expect(store.listMatches(id).filter(forfeited)).toHaveLength(4);
    });
  });

  it("leaves forfeit wins out of stats", () => {
    const id = startedTournament({ semis: 3, final: 3 });
    store.recordGame(live(id), 2, 1, "r", "goons"); // a leads b 1–0, then drops
    store.forfeitPlayer(id, "a", "goons");
    play(id);
    play(id); // c beats d 2–0
    expect(store.decidedMatches("guild-1").map((m) => [m.p1, m.p2, m.winner])).toEqual([["c", "d", "c"]]);
    expect(store.getTournament(id)!.status).toBe("active"); // the final, b vs c, is live
  });
});
