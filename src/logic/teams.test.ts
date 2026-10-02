import { describe, expect, it } from "bun:test";
import { otherTeam, randomTeam, TEAMS } from "./teams.ts";

describe("teams", () => {
  it("has Goons in green and Gooners in purple", () => {
    expect(TEAMS.goons).toEqual({ name: "Goons", color: "#2ecc71" });
    expect(TEAMS.gooners).toEqual({ name: "Gooners", color: "#9b59b6" });
  });

  it("pairs each team with the other", () => {
    expect(otherTeam("goons")).toBe("gooners");
    expect(otherTeam("gooners")).toBe("goons");
  });

  it("flips a coin for p1's team", () => {
    expect(randomTeam(() => 0.2)).toBe("goons");
    expect(randomTeam(() => 0.7)).toBe("gooners");
    expect(["goons", "gooners"]).toContain(randomTeam());
  });
});
