# Tournament Bot — SPEC

A Discord bot for our server that runs Rocket League 1v1 tournaments, tracks scores and series, and keeps a permanent history and leaderboard.

## Goals

- Run a 1v1 tournament start to finish inside Discord with minimal typing.
- Randomly decide who plays and who faces whom.
- Support best-of-1/3/5 series for semis and finals, with per-game scores.
- Keep all-time history, leaderboard, and head-to-head stats.
- Make it easy to add other games later.

## Non-goals (v1)

- 2v2 or team tournaments
- Seeding weighted by past results (seeding is fully random)
- More than one tournament at a time per server
- More than 8 players in one tournament
- Creating, renaming, or deleting channels (the bot never manages channels)
- A web dashboard (possible later, data is already in SQLite)

## Stack

Runtime is **Bun**, used for everything it covers (runtime, package manager, test runner, SQLite, env loading). Versions checked October 2026. Always install the latest patch.

| Piece | Version | Notes |
|---|---|---|
| Bun | latest 1.x | Runtime, package manager (`bun install`), test runner, SQLite driver. Bun has no LTS lines, so stay on the latest 1.x and pin it where you deploy |
| TypeScript | 7.x | Bun runs `.ts` directly with no build step. `typescript` is only used for type checking (`tsc --noEmit`). typescript-eslint can't use TS 7 until 7.1, so use TS 6.x if you add linting before then |
| @types/bun | latest | Types for Bun APIs (`bun:sqlite`, `bun:test`) |
| discord.js | 14.x (latest) | Works on Bun out of the box. v15 is still pre-release, so don't use it until it's stable |
| bun:sqlite | built in | Replaces better-sqlite3 (similar synchronous API, faster). Single file at `data/bot.db` |
| bun test | built in | Replaces vitest. Jest-style API (`describe`, `it`, `expect`) |
| @resvg/resvg-js | latest | Renders the match versus image (from phase 2) and bracket images (phase 8). Native module, confirmed to load under Bun |

- Config: Bun loads `.env` automatically (`DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID`, `TOURNAMENT_CHANNEL_ID`), no dotenv or flags needed
- Scripts: `bun --watch src/index.ts` (dev), `bun src/index.ts` (prod), `bun test`, `bunx tsc --noEmit` (type check)
- `bun:sqlite` named parameters need a `$`, `:`, or `@` prefix by default (e.g. `$id`); positional `?` works as usual
- Gateway intents: `Guilds` only (slash commands and buttons need nothing else)

## Project structure

```
src/
  index.ts            // client setup, command + interaction loading
  deploy-commands.ts  // registers slash commands
  db.ts               // connection + schema creation
  commands/           // one file per slash command
  logic/
    bracket.ts        // single elim generation + advancement
    roundrobin.ts     // circle-method schedule + standings
    series.ts         // series win checking
    stats.ts          // leaderboard + head-to-head queries
    random.ts         // Fisher-Yates shuffle, random pick
  render/
    embeds.ts         // embed builders for match / bracket / standings
    bracket-image.ts  // (visuals phase) PNG generation
data/                 // sqlite file (gitignored)
```

Rule: everything in `logic/` is pure (no Discord or database imports) so it can be unit tested with `bun test` without a bot running. Tests live next to the code as `*.test.ts`.

## Core behavior

### Formats

| Players | Format | Matches |
|---|---|---|
| fewer than 4 | Can't start: bot says it needs at least 4 | n/a |
| 4 | Single elimination | 3 (Semi 1, Semi 2, Final) |
| 5 | Round robin + top-2 final | 11 (10 league + final) |
| 6 | Two groups of 3 → semis → final | 9 (6 group + 2 semis + final) |
| 7 | Groups of 4 and 3 → semis → final | 12 (9 group + 2 semis + final) |
| 8 | Single elimination | 7 (4 quarters, 2 semis, final) |
| 9+ | Not supported: Join is capped at 8 | n/a |

Single elimination is shown to players as "Knockout".

Everyone who joins plays. The goal is to keep every tournament at roughly 12 matches or fewer, since matches are played one at a time.

### Series length

- `semis` and `final` options, each 1, 3, or 5. Defaults: semis = 1, final = 3. `semis` applies to single elim semis and group-stage semis.
- Quarterfinals (8 players) and group matches are always best-of-1.
- Round robin: every league match is best-of-1. The top-2 final uses the `final` option (default Bo3, Bo5 allowed).
- Games to win a series = `floor(best_of / 2) + 1`.

### One match at a time (important)

Players not in the current match are the audience. Matches are an **ordered queue**, not parallel rounds.

- Every match has a `play_order`.
- Only one match can be `live` at a time.
- The next match goes live only when the current series is decided AND both of its players are known (e.g., the final waits for semi 2, or for the last round robin match).
- When a match finishes, the bot posts the result and "Up next: @A vs @B (Bo3)", pinging only those two.

Match status: `pending` → `live` → `done`.

### Seeding

- Fully random (Fisher-Yates shuffle) at tournament start.
- 4 players: seed 1 vs 2 in Semi 1, seed 3 vs 4 in Semi 2.
- 8 players: quarters are 1v2, 3v4, 5v6, 7v8. QF1/QF2 winners meet in Semi 1, QF3/QF4 winners in Semi 2.
- 6–7 players: after the shuffle, the first 3 (6 players) or first 4 (7 players) go to Group A, the rest to Group B.
- Keep the `seed` column so weighted seeding can be added later without a migration.

### Round robin schedule and standings

- Generate pairings with the circle method, then order them so nobody plays back-to-back where possible.
- Standings order: series wins, then game wins, then goal differential, then head-to-head, then random.
- After all 10 league matches, the **top 2 in the standings play a final**. The tournament winner is the winner of that final, not the top of the table.
- The 1st-place finisher is `p1` in the final (just for display order; there's no advantage).
- The final row is created at tournament start with `play_order = 11`, `status = 'pending'`, and empty players. It gets filled in when the last league match closes, then goes live like any other match.
- League standings are still saved and shown (embed and later image) so you can see who finished where.

### Group stage (6–7 players)

- Each group plays a mini round robin (group of 3 = 3 matches, group of 4 = 6 matches).
- Group matches alternate between A and B in `play_order` so nobody plays back-to-back where possible. With 7 players, Group A's extra matches finish after Group B is done.
- Group standings use the same tiebreakers as round robin.
- Top 2 from each group advance. Semi 1 = A1 vs B2, Semi 2 = B1 vs A2. Winners play the final.
- Semi and final rows are created at start with empty players. Semis fill in once the last group match closes.

### Teams

- There are two teams: **Goons** (green, `#2ecc71`) and **Gooners** (purple, `#9b59b6`).
- Every match puts each side on one of the teams. When a match goes live, a coin flip picks p1's team and p2 gets the other.
- A side keeps its team for every game of that series. In the next match the coin is flipped again, so a player's team can change between matches.
- In 1v1 each side is one player. Future team formats (e.g. 2v2) use the same two teams, with every player on a side sharing that side's team.
- Teams are shown in the versus image: each avatar is ringed and labelled in its team's color.

### Reporting scores

`/report winner:@user winner_score:N loser_score:N`

- Anyone in the server can report.
- Applies to the single `live` match. The bot validates:
  - the winner is one of the two live players
  - both scores are non-negative integers and `winner_score > loser_score` (no ties)
- Each report is one **game**. After saving it, the bot counts series wins:
  - Series not decided (only possible in a best of 3 or 5): post a red scoreboard embed with the standing ("Jake leads the series 2–1" or "Series tied 1–1"). Always say "series" so it isn't confused with a game's goals.
  - Series decided: close the match, advance the winner (single elim), post the series result, announce the next match.
  - Final match decided: crown the champion and post a summary.
- Every game stores `reported_by`, and every report is posted publicly in the channel so bad entries get spotted. The post doesn't mention the reporter, because Discord already shows who used `/report` above the reply.

### Undo

`/undo` removes the most recent game in the active tournament.

- If that game had closed a match, the match reopens and any advancement is reverted.
- If it had ended the tournament, the tournament returns to active.
- If it was the last league or group match, the playoff players filled from standings are cleared again (the final or semis go back to waiting).
- Works on the guild's newest tournament while it's active, or after it has finished as long as no newer tournament has been started, so a wrong final report can still be fixed.
- Everything the game caused is reversed: a match that went live after it goes back to waiting (its team coin flip is cleared), and the undo is posted publicly with the reopened match as it now stands: the versus image if it has no games left, otherwise the scoreboard with the corrected standing.

### Tournament channel

- **The bot never creates, renames, or deletes channels, and there's no channel command.** You create a `#tournaments` channel manually in Discord.
- The channel's ID goes in `.env` as `TOURNAMENT_CHANNEL_ID` (in Discord: enable Developer Mode, right-click the channel, Copy Channel ID).
- On startup, the bot checks that the channel exists and that it can view, post, embed, and attach files there. If not, it logs a clear error and exits.
- All tournament commands are run from `#tournaments`, and all tournament posts (signup, matches, brackets, champion announcements) go there.
- Tournament commands used in any other channel get a short private reply pointing to `#tournaments`.
- Optional, no code needed: in Server Settings → Integrations → the bot, limit its commands to `#tournaments` so they don't show up elsewhere.

### Random picker

- `/tournament start` posts a message with a **Join** button; the player list updates as people click.
- Join is capped at 8. A 9th click gets a private reply: the bot supports up to 8 players.
- A **Start** button locks signup and runs the format rules above. With fewer than 4 joined, Start replies that at least 4 are needed and keeps signup open.
- `/pick count:N options:...` is a standalone random picker for quick decisions.

## Data model

```sql
CREATE TABLE players (
  discord_id   TEXT PRIMARY KEY,
  display_name TEXT NOT NULL
);

CREATE TABLE tournaments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id        TEXT NOT NULL,
  game            TEXT NOT NULL DEFAULT 'Rocket League',
  format          TEXT NOT NULL CHECK (format IN ('single_elim','round_robin','groups')),
  status          TEXT NOT NULL CHECK (status IN ('signup','active','done','cancelled')),
  semis_best_of   INTEGER NOT NULL DEFAULT 1,
  final_best_of   INTEGER NOT NULL DEFAULT 3,
  winner_id       TEXT REFERENCES players(discord_id),
  bracket_msg_id  TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at     TEXT
);

CREATE TABLE tournament_players (
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id),
  player_id     TEXT NOT NULL REFERENCES players(discord_id),
  seed          INTEGER,
  group_label   TEXT CHECK (group_label IN ('A','B')),  -- groups format only
  PRIMARY KEY (tournament_id, player_id)
);

CREATE TABLE matches (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id),
  round         INTEGER NOT NULL,
  play_order    INTEGER NOT NULL,
  label         TEXT NOT NULL,              -- 'Quarterfinal 2', 'Semifinal 1', 'Final', 'Match 4', 'Group A - Match 2'
  p1_id         TEXT REFERENCES players(discord_id),
  p2_id         TEXT REFERENCES players(discord_id),
  best_of       INTEGER NOT NULL DEFAULT 1,
  winner_id     TEXT REFERENCES players(discord_id),
  next_match_id INTEGER REFERENCES matches(id),
  next_slot     TEXT CHECK (next_slot IN ('p1','p2')),
  status        TEXT NOT NULL CHECK (status IN ('pending','live','done')),
  p1_team       TEXT CHECK (p1_team IN ('goons','gooners'))  -- set when the match goes live; p2 is on the other team
);

CREATE TABLE games (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id    INTEGER NOT NULL REFERENCES matches(id),
  game_number INTEGER NOT NULL,
  p1_score    INTEGER NOT NULL,
  p2_score    INTEGER NOT NULL,
  reported_by TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Constraints enforced in code: one active tournament per guild, one live match per tournament.

Round robin and group matches have no `next_match_id`. Playoff rows (quarters' successors, semis, finals) are created at start with empty players and filled in either by bracket advancement (single elim) or from standings when the league or group stage finishes.

## Commands (v1)

| Command | What it does |
|---|---|
| `/tournament start [semis] [final]` | Open signup with Join/Start buttons |
| `/tournament cancel` | Cancel the active tournament (asks the person for private confirmation first, then announces it in the channel) |
| `/report winner winner_score loser_score` | Record a game in the live match |
| `/undo` | Remove the last reported game |
| `/bracket` | Bracket image (live match, queue, results, champion) plus the live match as text. Shows the last finished tournament when none is running (round robin and groups: a standings image instead) |
| `/history` | Past tournaments, newest first, two lines each: "date and time · Knockout, 4 players, semis Bo1" (no tournament number, since cancelled tournaments would leave gaps) then "🏆 **Jegson** (2nd title) beat Jako 2–1 in the final (Bo3)". A best-of-1 final shows goals, longer finals show games won |
| `/leaderboard` | Titles, series record, game record, goal differential |
| `/stats @player` | Personal stats and head-to-head records |
| `/pick count options` | Random picker |

## Stats

- Titles won (a title = winning the tournament final, in either format), series record, game record, goals for/against, goal differential
- Head-to-head between any two players (series and games)
- All queries accept an optional `game` filter; default is Rocket League

## Visuals

**Embeds (built in from phase 2):**
- Live match embed: red side stripe ("on air"), the format ("Best of 3 (first to 2)"), and a "versus" image showing both players' avatars side by side, each ringed and labelled in its team's color, with "VS" split between the two team colors (SVG to PNG with `@resvg/resvg-js`, using the bundled Bebas Neue font in `assets/fonts/`; an avatar that fails to download becomes a grey circle)
- Series update embed (after a game that doesn't decide the series): red, titled "Final — Game 2", with the standing and an uploaded scoreboard image. It uses the versus layout with the games won ("1–0") in place of "VS", each number in its team's color
- Match result embed (when a series is decided): green, with an uploaded winner image (the winner's avatar ringed in the team they won with, "WINNER" underneath) as the thumbnail. A best of 1 shows a "Final score" field with the goals. Longer series show "Series (best of N)" with games won, plus a "Games" list of each game's goals. Never label games won as "Score"
- Standings embed for round robin
- Champion embed (gold, with the same uploaded winner image, the runner-up, and every result)

**Bracket image (phase 8):**
- Render the bracket as SVG, convert to PNG with `@resvg/resvg-js`
- Fetch player avatars and embed them as data URIs
- Load the bundled font file explicitly (resvg won't pick up system fonts reliably). `assets/fonts/BebasNeue-Regular.ttf` is already used by the versus image
- Round robin gets a standings table image, with the top-2 final matchup shown once the league is done
- Groups format gets two small standings tables plus the semis/final bracket
- 8-player bracket layout (quarters → semis → final)
- After each match, **edit** the existing bracket message (`bracket_msg_id`) instead of posting a new one
- Keep rendering isolated in `render/` so it can be swapped without touching logic

## Phases

### Phase 1 — Bot online
- [x] Create the app in the Discord developer portal and invite it with scopes `bot` + `applications.commands` and permissions: View Channels, Send Messages, Embed Links, Attach Files, Read Message History. No Manage Channels permission needed
- [x] Project scaffold with `bun init`, then `bun add discord.js` and `bun add -d typescript @types/bun`. Add `tsconfig.json`, `.env`, `.gitignore` (token + `data/`), and the scripts listed in Stack
- [x] `deploy-commands.ts` registering guild commands (instant updates in dev)
- [x] `/ping` test command responds

**Done when:** `/ping` works in the server.

### Phase 2 — Signup and seeding
- [x] `db.ts` creates the schema
- [x] Create `#tournaments` manually in Discord and add its ID to `.env` as `TOURNAMENT_CHANNEL_ID`
- [x] Startup check for the channel and bot permissions; commands outside `#tournaments` get a private redirect
- [x] `/tournament start` with Join and Start buttons, live player list
- [x] Random shuffle seeding, single-elim generation for 4 players with `play_order` and `next_match_id`
- [x] First live match announced with embed

**Done when:** four people can join, start, and see Semi 1 go live.

### Phase 3 — Reporting and series
- [x] `/report` with validation and `reported_by`
- [x] Series logic (Bo1/3/5), match close, bracket advancement
- [x] "Up next" announcements, champion crowned after final
- [x] Unit tests (`bun test`) for `bracket.ts`, `series.ts` and `queue.ts`

**Done when:** a full 4-player tournament can be played end to end.

### Phase 4 — Views and corrections
- [x] `/bracket`, `/history`
- [x] `/undo` with reopen and revert logic
- [x] `/tournament cancel`

### Phase 5 — Round robin
- [ ] Circle-method schedule with back-to-back avoidance
- [ ] Standings and tiebreakers
- [ ] Create the empty final match at start; fill in the top 2 when the last league match closes
- [ ] Tournament winner = final winner; `winner_id` set only after the final
- [ ] 5 players = round robin + final
- [ ] Unit tests for schedule, standings, and final setup
- [ ] Standings image for `/bracket`: the league table plus the top-2 final once the league is done (same style as the bracket image)

**Done when:** a 5-player tournament runs 10 league matches, then a top-2 final, then crowns a champion.

### Phase 6 — 6 to 8 players
- [ ] Join cap at 8, minimum 4 on Start
- [ ] 8-player single elim (quarters → semis → final)
- [ ] Groups format for 6–7: random split, alternating group schedule, group standings
- [ ] Semis filled from group standings (A1 vs B2, B1 vs A2), then final
- [ ] Unit tests for format selection by player count, group split, and semis seeding

**Done when:** tournaments with 6, 7, and 8 players each run start to finish.

### Phase 7 — Stats
- [ ] `/leaderboard`, `/stats @player` with head-to-head
- [ ] `game` filter plumbed through queries

### Phase 8 — Visuals
- [x] SVG bracket layout for single elim (4 and 8 players, in `render/bracket-image.ts`): match cards with avatars ringed in team colors, seeds, scores (goals as numbers for a best of 1; games won as dots for a best of 3 or 5, with a key under the bracket when it mixes both), the live match outlined in red, the winning row marked in its team color, and the champion in gold
- [x] PNG conversion, avatars, bundled font
- [ ] Standings image for round robin (built in phase 5 along with the format)
- [ ] Edit-in-place bracket message after each match

### Phase 9 — Hosting
- [ ] Register commands globally
- [ ] Always-on host (VPS, Raspberry Pi, or Fly.io/Railway). On a Pi, use a 64-bit OS, since Bun ships arm64 Linux builds
- [ ] Pin the Bun version on the host (e.g. a specific `oven/bun` Docker image tag) and upgrade deliberately
- [ ] Persistent storage for the SQLite file
- [ ] Keep it running with a systemd service or a Docker restart policy
- [ ] Simple periodic backup of `bot.db`

## Edge cases to handle

- Join clicked twice by the same person: ignore
- Someone leaves mid-tournament: `/tournament cancel` is the v1 answer
- Report with a non-live player as winner: reject with a clear message
- `/report` when no tournament or no live match: friendly error
- Bot restarts mid-tournament: all state is in SQLite, so it resumes
- `#tournaments` deleted or bot loses access: startup check fails with a clear error; create the channel again and update `TOURNAMENT_CHANNEL_ID`
- Tie at an advancement cutoff (2nd place in round robin or in a group) after all tiebreakers: v1 picks randomly between the tied players; revisit with a sudden-death match
- 9th person clicks Join: private reply that the max is 8
- Start with fewer than 4: private reply, signup stays open
- Top 2 finishers tied with each other: no issue, both make the final and the random tiebreak only decides display order

## Future ideas

- More games (Mario Kart, Smash, etc.) using the `game` field
- 2v2 with rotating partners
- Seeding weighted by past wins
- Web page for history and charts
- Best-of options per round robin match
