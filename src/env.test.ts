import { describe, expect, it, spyOn } from "bun:test";
import { env } from "./env.ts";

describe("env", () => {
  it("reads each variable", () => {
    expect(env.token).toBe("test-token");
    expect(env.clientId).toBe("test-client");
    expect(env.guildId).toBe("guild-1");
    expect(env.tournamentChannelId).toBe("channel-1");
  });

  it("treats DEV_COMMANDS as off unless it is exactly \"true\"", () => {
    expect(env.devCommands).toBe(false);
    process.env.DEV_COMMANDS = "yes";
    expect(env.devCommands).toBe(false);
    process.env.DEV_COMMANDS = "true";
    expect(env.devCommands).toBe(true);
    delete process.env.DEV_COMMANDS;
  });

  it("exits with a clear message when a variable is missing", () => {
    const saved = process.env.GUILD_ID;
    delete process.env.GUILD_ID;
    const exit = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => env.guildId).toThrow("exit");
      expect(exit).toHaveBeenCalledWith(1);
      expect(error).toHaveBeenCalledWith("Missing GUILD_ID in .env (see .env.example)");
    } finally {
      process.env.GUILD_ID = saved;
      exit.mockRestore();
      error.mockRestore();
    }
  });
});
