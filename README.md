# tournament-bot

A Discord bot that runs Rocket League 1v1 tournaments for 4–8 players: signup, random seeding, knockouts, round robins and groups, best-of-1/3/5 series, a live bracket image, and all-time history, leaderboard and head-to-head stats. `SPEC.md` describes exactly how it behaves.

## Setup

1. In the [Discord developer portal](https://discord.com/developers/applications), create an application.
   - Invite it with the scopes `bot` and `applications.commands`, set to **Guild Install**.
   - Give it these permissions: View Channels, Send Messages, Embed Links, Attach Files, Read Message History.
2. Create a `#tournaments` channel in your server.
3. Copy `.env.example` to `.env` and fill it in:
   - `DISCORD_TOKEN`: Bot → Reset Token.
   - `CLIENT_ID`: General Information → Application ID.
   - `GUILD_ID`: with Developer Mode on, right-click the server → Copy Server ID.
   - `TOURNAMENT_CHANNEL_ID`: right-click `#tournaments` → Copy Channel ID.

## Development

Needs [Bun](https://bun.sh) 1.3.9, the same version the Docker image pins.

```sh
bun install
bun run deploy          # register commands in your server only (instant)
bun run dev             # run with auto-restart on file changes
bun test --coverage     # tests; coverage must stay at 100%
bunx tsc --noEmit       # type check
```

Set `DEV_COMMANDS=true` in `.env` to test on your own:
- `/dev join` adds up to 8 server members or bots to a signup.
- `/dev cancel` ends a tournament.
- Announcements stop pinging anyone.

Run `bun run deploy` again after changing it.

## Hosting

The bot runs in Docker with `docker compose`. The database (`data/bot.db`) and its daily backups (`backups/`) live on the host, so they survive rebuilds. These steps are for a small Linux VPS, such as Hetzner or DigitalOcean with 1 GB of RAM. A Raspberry Pi running a 64-bit OS works the same way.

### First time

1. Install Docker: `curl -fsSL https://get.docker.com | sh`.
2. Clone the repo and add your `.env`:
   ```sh
   git clone https://github.com/jdhubb99/tournament-bot.git && cd tournament-bot
   cp .env.example .env && nano .env    # DEV_COMMANDS=false in production
   ```
3. Create the data folders. The container runs as an unprivileged user with uid 1000, which needs to own them:
   ```sh
   mkdir -p data backups && sudo chown 1000:1000 data backups
   ```
4. Start the bot and the backup job:
   ```sh
   docker compose up -d --build
   docker compose logs -f bot    # expect "Tournament channel: #tournaments" and "Logged in as ..."
   ```
5. Register the commands globally. This happens once, then again whenever a command changes. It also removes the server-only copies from development, so nothing shows up twice. Global changes can take up to an hour to appear.
   ```sh
   docker compose run --rm bot bun src/deploy-commands.ts --global
   ```

Stop running the bot on your own computer at this point, or both copies will answer commands.

### Updating

```sh
git pull
docker compose up -d --build
```

If any slash command was added or changed, run step 5 again.

### Upgrading Bun

Bun is pinned in the `Dockerfile` (`FROM oven/bun:1.3.9-slim`) so upgrades happen on purpose:
1. Update Bun locally (`bun upgrade`).
2. Change the tag to the same version.
3. Check it with `bun test` and `docker build -t tournament-bot . && docker run --rm tournament-bot bun test`.
4. Deploy as above.

### Backups

The `backup` service snapshots the database once a day into `backups/bot-<date>_<time>.db` and keeps the newest 14. Set `BACKUP_KEEP` in `.env` to change that. Snapshots are safe to take while the bot is running.

- **Take one now:** `docker compose run --rm backup bun src/backup-now.ts`
- **Restore:**
  ```sh
  docker compose stop bot
  cp backups/bot-2026-10-02_213000.db data/bot.db && rm -f data/bot.db-wal data/bot.db-shm
  docker compose start bot
  ```

These backups are on the same machine, so they protect against bad data, not against losing the server. Copy `backups/` somewhere else now and then if that matters.
