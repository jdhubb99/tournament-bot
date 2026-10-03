import { avatarCircle, CARD, DIM, GOLD, MUTED, PAD, text, TEXT, truncate } from "./bracket-image.ts";
import { toPng } from "./match-images.ts";
import { layoutTable, signed, svgDoc, TABLE_W, type Column } from "./standings-image.ts";

/** A player's record, as /leaderboard and /stats show it. */
export interface RecordRow {
  name: string;
  avatar: Uint8Array | null;
  wins: number;
  losses: number;
  gameWins: number;
  gameLosses: number;
  goalsFor: number;
  goalsAgainst: number;
}

export const LEADERBOARD_FILE = "leaderboard.png";
export const STATS_FILE = "stats.png";

export interface LeaderboardRow extends RecordRow {
  titles: number;
}

const record = (w: number, l: number) => `${w}-${l}`;

const LEADERBOARD_COLUMNS: Column<LeaderboardRow>[] = [
  { label: "Titles", x: 320, value: (r) => String(r.titles) },
  { label: "Series", x: 410, value: (r) => record(r.wins, r.losses) },
  { label: "Games", x: 500, value: (r) => record(r.gameWins, r.gameLosses) },
  { label: "GD", x: 585, value: (r) => signed(r.goalsFor - r.goalsAgainst) },
];

const HEAD_TO_HEAD_COLUMNS: Column<RecordRow>[] = [
  { label: "Series", x: 330, value: (r) => record(r.wins, r.losses) },
  { label: "Games", x: 415, value: (r) => record(r.gameWins, r.gameLosses) },
  { label: "Goals", x: 500, value: (r) => record(r.goalsFor, r.goalsAgainst) },
  { label: "GD", x: 585, value: (r) => signed(r.goalsFor - r.goalsAgainst) },
];

const PROFILE_H = 128;
const SECTION_GAP = 24;

/** /leaderboard: every ranked player's titles, series and game records, and goal difference. */
export function renderLeaderboardImage(game: string, rows: readonly LeaderboardRow[]): Uint8Array {
  const table = layoutTable(PAD, PAD, game, rows, "l", LEADERBOARD_COLUMNS, 0);
  const width = PAD + TABLE_W + PAD;
  return toPng(svgDoc(width, PAD + table.height + PAD, table.svg));
}

/**
 * /stats: a profile card (avatar, name, titles and totals) above the player's
 * head-to-head record against each opponent. Everything sits on dark cards so the
 * text reads in light and dark themes.
 */
export function renderPlayerStatsImage(player: LeaderboardRow, opponents: readonly RecordRow[]): Uint8Array {
  const x = PAD;
  const cy = PAD + PROFILE_H / 2;
  const titles = player.titles === 1 ? "1 title" : `${player.titles} titles`;
  const totals =
    `Series ${record(player.wins, player.losses)} · Games ${record(player.gameWins, player.gameLosses)} · ` +
    `Goals ${record(player.goalsFor, player.goalsAgainst)} (${signed(player.goalsFor - player.goalsAgainst)})`;
  const profile =
    `<rect x="${x}" y="${PAD}" width="${TABLE_W}" height="${PROFILE_H}" rx="8" fill="${CARD}"/>` +
    avatarCircle("me", x + 64, cy, 44, player.avatar, player.titles > 0 ? GOLD : DIM, 5) +
    text(x + 128, cy - 8, truncate(player.name, 22), { size: 44, fill: TEXT }) +
    text(x + 128, cy + 30, `${titles} · ${totals}`, { size: 22, fill: player.titles > 0 ? GOLD : MUTED });

  const tableTop = PAD + PROFILE_H + SECTION_GAP;
  // Sorted by most-played opponent, so a rank number would mislead.
  const table = layoutTable(x, tableTop, "Head-to-head", opponents, "h", HEAD_TO_HEAD_COLUMNS, 0, false);
  const width = PAD + TABLE_W + PAD;
  return toPng(svgDoc(width, tableTop + table.height + PAD, profile + table.svg));
}
