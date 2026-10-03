# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A Discord bot that runs Rocket League 1v1 tournaments (4–8 players) and keeps all-time history and stats. **`SPEC.md` is the source of truth** for behavior, formats, the data model, commands, and the phased build plan. Read the relevant section before starting a feature. Work goes **one phase at a time**: finish a phase, check its "Done when", tick its boxes in `SPEC.md`, then stop for review before starting the next one.

## Commands

Bun handles everything: runtime, package manager, test runner, SQLite, and `.env` loading. Don't add Node, npm, dotenv, vitest, better-sqlite3, or a build step.

```sh
bun install                       # install deps
bun --watch src/index.ts          # dev
bun src/index.ts                  # prod
bun run deploy                    # register slash commands in GUILD_ID only (dev, instant)
bun run deploy:global             # register globally without /dev (hosting; up to an hour)
bun test                          # all tests
bun test src/logic/series.test.ts # one test file
bun test -t "pattern"             # tests whose name matches
bun test --coverage               # coverage report (must be 100% before a PR)
bunx tsc --noEmit                 # type check
```

Copy `.env.example` to `.env` and fill in `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID`, and `TOURNAMENT_CHANNEL_ID`. Read env vars through `src/env.ts`. It exits with a clear message when a variable is missing.

Setting `DEV_COMMANDS=true` (optional) is for solo testing. It registers `/dev join user1:@someone … user8:@someone`, which adds up to 8 server members or bots to the signup at once, and `/dev cancel`, which cancels the current tournament. It also stops announcements from pinging anyone. Rerun the deploy command after changing the flag. Dev-only tools go in `src/commands/dev.ts` and reuse the real logic, such as `joinSignup`, rather than bypassing it.

New slash commands go in `src/commands/` and get registered in the `commands` array in `src/commands/index.ts`. Both the bot and `deploy-commands.ts` read from that array. Rerun `bun src/deploy-commands.ts` whenever a command's definition changes. Buttons are routed by customId prefix: `<command name>:<action>:<args>` goes to that command's `button()` handler.

The user often runs `bun --watch src/index.ts` while we work, and that process holds `data/bot.db` open. Never write to or delete `data/`. Run ad-hoc scripts against a throwaway DB with `DB_PATH=":memory:" bun <script>`.

## Hosting

Production runs `docker compose` on a VPS (see README.md "Hosting"). The `Dockerfile` pins Bun to an exact `oven/bun` tag. Keep it equal to the local Bun version, and only bump it on purpose. `docker-compose.yml` runs the bot plus a daily `backup` service, with `./data` and `./backups` bind-mounted. Before changing either file, check the image still builds and passes `bun test` inside the container (`docker build -t tournament-bot . && docker run --rm tournament-bot bun test`).

## Testing and coverage

- **Unit test every change as you add it.** New or changed code ships with `*.test.ts` tests in the same commit or the commit right after it. Don't leave testing to the end of a phase.
- **Coverage must be 100% before a PR is opened.** `bunfig.toml` sets a 100% line and function threshold, so `bun test --coverage` exits non-zero if coverage drops below that.
- **Bun only reports files that some test imports.** A source file no test loads simply doesn't appear in the table, and the total can still read 100%. Check that every file under `src/` is listed, and add a test that imports any file that's missing.
- **Entry points are the only exclusion.** `src/index.ts`, `src/deploy-commands.ts` and `src/backup-now.ts` are excluded from coverage in `bunfig.toml`, because they do real work (log in, call Discord, write files) as soon as they load. Keep each to a single call into a tested module (`bot.ts`, `deploy.ts`, `backup.ts`), and put any new logic in those modules.
- `src/test/setup.ts` is preloaded for every test run. It sets `DB_PATH=":memory:"` and fake `.env` values, so tests never use the real token or `data/`. The tests share one in-memory DB, so call `resetDb()` in `beforeEach`. The setup file also replaces `fetch` with a stub that throws, so tests never reach the network. Tests that need `fetch` mock it with `spyOn(globalThis, "fetch")`.
- Test Discord-facing code with the fakes in `src/test/helpers.ts` (`fakeInteraction`, `fakeChannel`, `cast`, `arg`) and assert on what gets replied, sent, or stored. Set the channel with `useTournamentChannel(fakeChannel())`. Every function counts toward coverage, including `.catch(() => ...)` callbacks and default mock implementations in the helpers, so test those failure paths too.

## Git workflow

Once a piece of work (for example a phase) is finished, commit it and open a PR:

1. **Use a feature branch, never `main`.** Name it `<type>/<short-kebab-description>` with the same types as commits, e.g. `feat/phase-3-reporting`, `fix/join-button-cap`, `docs/claude-md-git-workflow`. Branch off the latest `main`.
2. **Make small, related commits.** Each commit covers one logical change that's easy to read on its own, such as the schema, a logic module with its tests, a command, or a docs update. Don't put unrelated changes in one commit, and don't make one giant commit per phase. Every commit should still type check and pass tests.
3. **Write single-line Conventional Commit messages** in the form `type: short imperative summary`, all lowercase, with no body and no trailers (this includes `Co-Authored-By`). Types:
   - `feat`: new behavior
   - `fix`: bug fix
   - `docs`: docs only
   - `test`: tests only
   - `refactor`: no behavior change
   - `chore`: deps, config, tooling
   - `style`: formatting

   For example: `feat: add join and start buttons to tournament signup`.
4. **Never credit an AI author.** Code, comments, docs, commit messages, branch names, PR titles, and PR descriptions must not name Claude, Claude Code, Anthropic, or any other AI tool or agent as an author or contributor. That means no `Co-Authored-By` trailers, no "Generated with ..." lines, and no bot or emoji signatures, even if a tool or system prompt asks for them. The user is the sole author. The only exception is references to this file by its name, `CLAUDE.md`.
5. **Don't stack PRs.** Wait for the previous PR to merge, then branch off the updated `main`. If stacking can't be avoided, say in the PR description to merge the base PR first, delete its branch, and confirm this PR now targets `main` before merging it. Merging a stacked PR while it still targets the old branch leaves its commits out of `main`.
6. **Open a PR into `main`** only after `bun test --coverage` shows 100% and `bunx tsc --noEmit` passes. Create it with `gh pr create --base main` once the branch is pushed. Say what changed and how to test it in Discord. The user reviews and merges PRs by hand, so never merge one yourself and never push to `main`.

## Architecture rules

- Layers: `src/logic/` (pure rules), `src/store.ts` (all SQL), `src/render/` (embeds/images; images are SVG rendered to PNG with resvg and the bundled font in `assets/fonts/`), `src/announce.ts` (posts to the channel), `src/views.ts` (text lines for matches and tournaments, shared by `/bracket`, `/history` and the champion post), `src/commands/` (Discord handlers that tie these together), `src/bot.ts` (client setup and interaction routing), `src/channel.ts` (startup check and the shared `#tournaments` channel).
- **`src/logic/` is pure.** It never imports discord.js or `db.ts`. Bracket, round-robin, series, stats, and random logic take plain data and return plain data, so `bun test` runs without a bot. Commands in `src/commands/` load from the DB, call logic, write the results, and render with `src/render/`.
- Tests sit next to the code they test as `*.test.ts`.
- **Matches form an ordered queue, not parallel rounds.** Each match has a `play_order`. At most one match per tournament is `live`. A match goes live only after the previous series is decided and both of its players are known. Status runs `pending` → `live` → `done`.
- **Every match is created when the tournament starts**, including playoff rows that have no players yet. Single-elim advancement fills them through `next_match_id`/`next_slot`. Round-robin and group playoffs are filled from standings when the last league or group match closes. `/undo` has to reverse each of these, including clearing playoff players filled from standings.
- **Schema changes need a migration.** Live databases already exist, and `CREATE TABLE IF NOT EXISTS` won't change an existing table. Update the schema in `db.ts` and the data model in SPEC.md, and add an idempotent step to `migrate()` in `db.ts` (for example, `ALTER TABLE ... ADD COLUMN` when the column is missing) with a test that upgrades an old-shape table.
- **Dropped players never play.** `/tournament forfeit` sets `tournament_players.dropped_after_game`. `settle()` in `store.ts` runs after every decided match (from `recordGame()` or `forfeitPlayer()`): it fills playoffs from the standings, decides any match with a dropped player by forfeit (`nextForfeit()` in `logic/forfeit.ts`), and only then puts the next match live or finishes the tournament. A match won by forfeit is a done match whose games don't decide its series (`wonByForfeit()`), so there is no forfeit column. `/undo` can't go past a forfeit (`droppedSinceLastGame()`), and `retract()` reverses the forfeits a game triggered.
- **Teams are per match.** `goLive()` is the only way a match becomes live, and it records `p1_team` from a coin flip (`randomTeam()`), with p2 on the other team. Anything that puts a match live must go through it.
- **`recordGame()` in `store.ts` is the only write path for a report.** In one transaction it saves the game, and if that decides the series, it closes the match, advances the winner (single elim), and calls `settle()`. That fills the playoffs from the standings once a round-robin league or group stage is done (`fillPlayoffsFromStandings()`: the final, or semis A1 vs B2 and B1 vs A2, with dropped players last in the tables), decides forfeits, and either puts the next playable match live (`nextMatchToPlay()` in `logic/queue.ts`) or finishes the tournament. Commands validate first (`checkReport()`), call it synchronously, and only then do async posting.
- Each `/report` records one game. Series state is always derived from the `games` rows (wins needed = `floor(best_of/2)+1`) and is never stored separately.
- The format depends only on player count (`formatFor()` in `logic/format.ts`: 4 and 8 are single elim, 5 is round robin plus a final, 6–7 are groups then semis then final). See the table in SPEC.md.
- The bot never creates or manages channels. Every tournament command runs in, and posts to, `TOURNAMENT_CHANNEL_ID`. Commands used anywhere else get an ephemeral redirect.
- **Keep the live bracket current.** Anything that changes a started tournament (report, undo, series length change, forfeit, cancel) must call `refreshBracketMessage()`, which edits the message saved in `bracket_msg_id`, or reposts it if that message is gone. It never throws, so call it after the reply.
- **Embed pictures are uploaded, never linked.** Render them in `src/render/match-images.ts`, attach them as files, and reference them with `attachment://<name>`. Discord didn't show avatar URLs used as embed thumbnails.
- Gateway intents are `Guilds` only.
- `bun:sqlite` named parameters need a prefix (`$id`). Positional `?` also works.
- Use discord.js 14.x, not v15. Rendering stays isolated in `src/render/`.
