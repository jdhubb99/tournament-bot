import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "./db.ts";
import { getLiveMatch, listMatches, recordGame } from "./store.ts";
import { resetDb, startedTournament } from "./test/helpers.ts";
import {
  FORMAT_NAMES,
  liveLineFor,
  matchScore,
  ordinal,
  playerName,
  resultLineFor,
  runnerUpOf,
  slotPlaceholder,
} from "./views.ts";

beforeEach(resetDb);

const live = (id: number) => getLiveMatch(id)!;

describe("views", () => {
  it("names every format", () => {
    expect(FORMAT_NAMES).toEqual({
      single_elim: "Knockout",
      round_robin: "Round robin + final",
      groups: "Groups + playoffs",
    });
  });

  it("uses stored names, falling back to the id", () => {
    startedTournament();
    expect(playerName("a")).toBe("A");
    expect(playerName("ghost")).toBe("ghost");
  });

  it("describes results with goals for Bo1 and games for longer series", () => {
    const id = startedTournament({ semis: 1, final: 3 });
    recordGame(live(id), 1, 4, "r", "goons"); // B beats A 4–1
    recordGame(live(id), 2, 0, "r", "goons"); // C beats D
    recordGame(live(id), 3, 0, "r", "goons");
    recordGame(live(id), 3, 0, "r", "goons"); // B (p1 of the final) wins 2–0
    const [sf1, , final] = listMatches(id);
    expect(resultLineFor(sf1!)).toBe("Semifinal 1: **B** def. A (4–1)");
    expect(resultLineFor(final!)).toBe("Final: **B** def. C (series 2–0)");
    expect(runnerUpOf(listMatches(id))).toBe("C");
  });

  it("scores a decided match from the winner's side", () => {
    const id = startedTournament({ semis: 1, final: 3 });
    recordGame(live(id), 1, 4, "r", "goons");
    expect(matchScore(listMatches(id)[0]!)).toEqual({ winnerId: "b", loserId: "a", winnerScore: 4, loserScore: 1 });
  });

  it("writes ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal)).toEqual([
      "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st", "111th",
    ]);
  });

  it("names the runner-up when the final's p2 wins", () => {
    const id = startedTournament({ semis: 1, final: 1 });
    recordGame(live(id), 1, 0, "r", "goons");
    recordGame(live(id), 1, 0, "r", "goons");
    recordGame(live(id), 0, 1, "r", "goons");
    expect(runnerUpOf(listMatches(id))).toBe("A");
  });

  it("describes the live match, with the series only when it's longer than one game", () => {
    const id = startedTournament({ semis: 3, final: 3 });
    expect(liveLineFor(live(id))).toBe("**Semifinal 1** (Bo3): A vs B · Series tied 0–0");
    recordGame(live(id), 3, 1, "r", "goons");
    expect(liveLineFor(live(id))).toBe("**Semifinal 1** (Bo3): A vs B · A leads the series 1–0");

    const bo1 = startedTournament();
    expect(liveLineFor(live(bo1))).toBe("**Semifinal 1** (Bo1): A vs B");
  });

  it("names the feeder match for an empty slot", () => {
    const id = startedTournament();
    const matches = listMatches(id);
    expect(slotPlaceholder(matches[2]!, matches, "p1")).toBe("Winner of Semifinal 1");
    expect(slotPlaceholder(matches[2]!, matches, "p2")).toBe("Winner of Semifinal 2");

    db.query("UPDATE matches SET next_match_id = NULL").run();
    const unlinked = listMatches(id);
    expect(slotPlaceholder(unlinked[2]!, unlinked, "p2")).toBe("TBD");
  });
});
