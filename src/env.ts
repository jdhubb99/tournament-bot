// Bun loads .env automatically.
function required(name: string): string {
  const value = Bun.env[name];
  if (!value) {
    console.error(`Missing ${name} in .env (see .env.example)`);
    process.exit(1);
  }
  return value;
}

export const env = {
  get token() { return required("DISCORD_TOKEN"); },
  get clientId() { return required("CLIENT_ID"); },
  get guildId() { return required("GUILD_ID"); },
  get tournamentChannelId() { return required("TOURNAMENT_CHANNEL_ID"); },
  /** Optional. Registers /dev and stops announcements from pinging, for solo testing. */
  get devCommands() { return Bun.env.DEV_COMMANDS === "true"; },
};
