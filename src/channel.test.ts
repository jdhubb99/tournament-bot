import { afterEach, beforeEach, describe, expect, it, spyOn, type Mock } from "bun:test";
import { ChannelType, PermissionFlagsBits } from "discord.js";
import { checkTournamentChannel, tournamentChannel, useTournamentChannel } from "./channel.ts";
import { cast, fakeChannel } from "./test/helpers.ts";

function clientWith(fetch: () => Promise<unknown>) {
  return cast<Parameters<typeof checkTournamentChannel>[0]>({ user: { id: "bot" }, channels: { fetch } });
}

describe("tournamentChannel", () => {
  it("throws before the startup check has run", () => {
    useTournamentChannel(null);
    expect(() => tournamentChannel()).toThrow("Tournament channel used before startup check");
  });
});

describe("checkTournamentChannel", () => {
  let exit: Mock<typeof process.exit>;
  let error: Mock<typeof console.error>;
  let log: Mock<typeof console.log>;

  beforeEach(() => {
    useTournamentChannel(null);
    exit = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);
    error = spyOn(console, "error").mockImplementation(() => {});
    log = spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    exit.mockRestore();
    error.mockRestore();
    log.mockRestore();
  });

  const reason = () => String(error.mock.calls[0]?.[0]);

  it("stores a valid channel", async () => {
    const channel = fakeChannel();
    await checkTournamentChannel(clientWith(async () => channel));
    expect(tournamentChannel()).toBe(cast(channel));
    expect(log).toHaveBeenCalledWith("Tournament channel: #tournaments");
    expect(exit).not.toHaveBeenCalled();
  });

  it("exits when the channel can't be fetched", async () => {
    await expect(checkTournamentChannel(clientWith(async () => { throw new Error("Unknown Channel"); }))).rejects.toThrow("exit");
    expect(reason()).toContain("channel channel-1 not found or not visible to the bot");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("exits when the channel isn't a text channel", async () => {
    const voice = { ...fakeChannel(), type: ChannelType.GuildVoice };
    await expect(checkTournamentChannel(clientWith(async () => voice))).rejects.toThrow("exit");
    expect(reason()).toContain("is not a text channel");
  });

  it("exits when the channel is in another guild", async () => {
    const elsewhere = { ...fakeChannel(), guildId: "guild-2" };
    await expect(checkTournamentChannel(clientWith(async () => elsewhere))).rejects.toThrow("exit");
    expect(reason()).toContain("is not in guild guild-1");
  });

  it("exits listing missing permissions", async () => {
    const channel = fakeChannel({ permissions: [String(PermissionFlagsBits.ViewChannel), String(PermissionFlagsBits.SendMessages)] });
    await expect(checkTournamentChannel(clientWith(async () => channel))).rejects.toThrow("exit");
    expect(reason()).toContain("missing permissions in #tournaments: EmbedLinks, AttachFiles, ReadMessageHistory");
  });

  it("treats unknown permissions as all missing", async () => {
    const channel = fakeChannel({ permissions: null });
    await expect(checkTournamentChannel(clientWith(async () => channel))).rejects.toThrow("exit");
    expect(reason()).toContain("ViewChannel, SendMessages");
  });
});
