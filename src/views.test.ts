import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "./db.ts";
import { getLiveMatch, listMatches, recordGame } from "./store.ts";
import { resetDb, startedTournament } from "./test/helpers.ts";
import { FORMAT_NAMES, liveLineFor, playerName, queueLineFor, resultLineFor, runnerUpOf } from "./views.ts";

beforeEach(resetDb);

const live = (id: number) => getLiveMatch(id)!;

describe("views", () => {
  it("names every format", () => {
    expect(FORMAT_NAMES).toEqual({
      single_elim: "Single elimination",
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

  it("names the feeder match for empty slots in the queue", () => {
    const id = startedTournament();
    recordGame(live(id), 3, 1, "r", "goons"); // A into the final's p1
    const matches = listMatches(id);
    expect(queueLineFor(matches[2]!, matches)).toBe("Final (Bo3): A vs Winner of Semifinal 2");
    expect(queueLineFor(matches[1]!, matches)).toBe("Semifinal 2 (Bo1): C vs D");

    db.query("UPDATE matches SET next_match_id = NULL").run();
    const unlinked = listMatches(id);
    expect(queueLineFor(unlinked[2]!, unlinked)).toBe("Final (Bo3): A vs TBD");
  });
});
