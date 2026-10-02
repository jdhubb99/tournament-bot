import { afterEach, beforeEach, describe, expect, it, mock, spyOn, type Mock } from "bun:test";
import { Events, GatewayIntentBits } from "discord.js";
import { createClient, handleInteraction, onReady, startBot } from "./bot.ts";
import { tournamentChannel, useTournamentChannel } from "./channel.ts";
import { commandsByName } from "./commands/index.ts";
import { arg, cast, fakeChannel, fakeInteraction, resetDb } from "./test/helpers.ts";

let error: Mock<typeof console.error>;
let log: Mock<typeof console.log>;

beforeEach(() => {
  resetDb();
  useTournamentChannel(cast(fakeChannel()));
  error = spyOn(console, "error").mockImplementation(() => {});
  log = spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  error.mockRestore();
  log.mockRestore();
});

/** Temporarily replaces a command handler with one that throws. */
function failing<K extends "execute" | "button">(name: string, key: K) {
  const command = commandsByName.get(name)!;
  const original = command[key];
  command[key] = (async () => {
    throw new Error("boom");
  }) as never;
  return () => {
    command[key] = original;
  };
}

describe("createClient", () => {
  it("uses only the Guilds intent", () => {
    expect(createClient().options.intents.bitfield).toBe(GatewayIntentBits.Guilds);
  });
});

describe("onReady", () => {
  it("checks the tournament channel and logs in", async () => {
    const channel = fakeChannel();
    await onReady(cast({ user: { id: "bot", tag: "Bot#0001" }, channels: { fetch: async () => channel } }));
    expect(tournamentChannel()).toBe(cast(channel));
    expect(log).toHaveBeenCalledWith("Logged in as Bot#0001");
  });
});

describe("startBot", () => {
  it("wires up events and logs in with the token", async () => {
    const client = { once: mock(() => {}), on: mock(() => {}), login: mock(async () => "test-token") };
    expect(await startBot(cast(client))).toBe(cast(client));
    expect(client.once).toHaveBeenCalledWith(Events.ClientReady, onReady);
    expect(client.on).toHaveBeenCalledWith(Events.InteractionCreate, handleInteraction);
    expect(client.login).toHaveBeenCalledWith("test-token");
  });
});

describe("handleInteraction: slash commands", () => {
  it("runs the matching command", async () => {
    const interaction = fakeInteraction({ commandName: "ping" });
    await handleInteraction(cast(interaction));
    expect(arg(interaction.reply).content).toBe("Pong! (42ms)");
  });

  it("ignores unknown commands", async () => {
    const interaction = fakeInteraction({ commandName: "nope" });
    await handleInteraction(cast(interaction));
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it("redirects tournament commands used outside #tournaments", async () => {
    const interaction = fakeInteraction({ commandName: "tournament", channelId: "general" });
    await handleInteraction(cast(interaction));
    expect(arg(interaction.reply).content).toBe("Tournament commands only work in <#channel-1>.");
  });

  it("allows non-tournament commands anywhere", async () => {
    const interaction = fakeInteraction({ commandName: "ping", channelId: "general" });
    await handleInteraction(cast(interaction));
    expect(arg(interaction.reply).content).toBe("Pong! (42ms)");
  });

  it("replies privately when a command throws", async () => {
    const restore = failing("ping", "execute");
    try {
      const interaction = fakeInteraction({ commandName: "ping" });
      await handleInteraction(cast(interaction));
      expect(arg(interaction.reply).content).toBe("Something went wrong.");
      expect(error.mock.calls[0]?.[0]).toBe("Error in /ping:");
    } finally {
      restore();
    }
  });

  it("follows up when the command already replied", async () => {
    const restore = failing("ping", "execute");
    try {
      const interaction = fakeInteraction({ commandName: "ping", replied: true });
      await handleInteraction(cast(interaction));
      expect(arg(interaction.followUp).content).toBe("Something went wrong.");
      expect(interaction.reply).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("survives the follow-up failing", async () => {
    const restore = failing("ping", "execute");
    try {
      const interaction = fakeInteraction({ commandName: "ping", replied: true });
      interaction.followUp.mockImplementation(async () => {
        throw new Error("gone");
      });
      await handleInteraction(cast(interaction));
      expect(interaction.followUp).toHaveBeenCalled();
      expect(interaction.reply).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("survives the error reply failing", async () => {
    const restore = failing("ping", "execute");
    try {
      const interaction = fakeInteraction({ commandName: "ping" });
      interaction.reply.mockImplementation(async () => {
        throw new Error("gone");
      });
      await expect(handleInteraction(cast(interaction))).resolves.toBeUndefined();
    } finally {
      restore();
    }
  });
});

describe("handleInteraction: buttons", () => {
  it("routes by customId prefix with the remaining parts as args", async () => {
    const interaction = fakeInteraction({ kind: "button", customId: "tournament:join:999" });
    await handleInteraction(cast(interaction));
    expect(arg(interaction.reply).content).toBe("Signup for this tournament is closed.");
  });

  it("ignores buttons for commands without a button handler", async () => {
    for (const customId of ["ping:x", "unknown:x"]) {
      const interaction = fakeInteraction({ kind: "button", customId });
      await handleInteraction(cast(interaction));
      expect(interaction.reply).not.toHaveBeenCalled();
    }
  });

  it("replies privately when a button handler throws", async () => {
    const restore = failing("tournament", "button");
    try {
      const interaction = fakeInteraction({ kind: "button", customId: "tournament:join:1" });
      await handleInteraction(cast(interaction));
      expect(arg(interaction.reply).content).toBe("Something went wrong.");
      expect(error.mock.calls[0]?.[0]).toBe("Error in button tournament:join:1:");
    } finally {
      restore();
    }
  });
});

it("ignores other interaction types", async () => {
  const interaction = fakeInteraction({ kind: "other" });
  await handleInteraction(cast(interaction));
  expect(interaction.reply).not.toHaveBeenCalled();
});
