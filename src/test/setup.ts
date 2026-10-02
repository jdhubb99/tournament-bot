// Preloaded by bunfig.toml before every test file. Overrides values Bun loaded
// from .env so tests never use the real token or touch data/bot.db.
process.env.DB_PATH = ":memory:";
process.env.DISCORD_TOKEN = "test-token";
process.env.CLIENT_ID = "test-client";
process.env.GUILD_ID = "guild-1";
process.env.TOURNAMENT_CHANNEL_ID = "channel-1";
delete process.env.DEV_COMMANDS;

// No network in tests. Tests that need fetch replace it with spyOn(globalThis, "fetch").
globalThis.fetch = (async (input: string | URL | Request) => {
  throw new Error(`Network disabled in tests: ${String(input)}`);
}) as unknown as typeof fetch;
