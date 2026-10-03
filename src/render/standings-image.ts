import {
  avatarCircle,
  bracketSize,
  CARD,
  CARD_H,
  championBadge,
  CHAMPION_W,
  CONNECTOR,
  COL_GAP,
  DIM,
  DIVIDER,
  GOLD,
  layoutBracket,
  LIVE_RED,
  matchCard,
  MUTED,
  PAD,
  CARD_W,
  SEED_W,
  text,
  TEXT,
  truncate,
  type BracketChampion,
  type BracketMatch,
} from "./bracket-image.ts";
import { toPng } from "./match-images.ts";

export interface StandingsImageRow {
  name: string;
  avatar: Uint8Array | null;
  /** Dropped out with /tournament forfeit: the name is dimmed. */
  dropped: boolean;
  played: number;
  wins: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
}

export const TABLE_W = 620;
const HEADER_H = 40;
const ROW_H = 52;
const KEY_H = 40;
/** Rows to mark at the top of a table, one color each, optionally with a cutoff line below them. */
export interface Highlight {
  colors: readonly string[];
  cutoff: boolean;
}

/** League and group tables: the top 2 move on, in gold above a gold cutoff line. */
const QUALIFIERS: Highlight = { colors: [GOLD, GOLD], cutoff: true };
const UP_NEXT_HEADER_H = 44;
const UP_NEXT_LINE_H = 34;
const UP_NEXT_NAMES_X = 190;
const GROUP_GAP = 24;
const UP_NEXT_PAD = 10;

/** A league match still to play, for the "Up next" list under the table. */
export interface UpcomingMatch {
  label: string;
  p1: string;
  p2: string;
  live: boolean;
}

/** A numeric column: its header, its center x relative to the table's left edge, and how to show a row's value. */
export interface Column<T> {
  label: string;
  x: number;
  value: (row: T) => string;
}

/** "+3", "0", "-2". */
export const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** The league and group table columns. */
const STANDINGS_COLUMNS: Column<StandingsImageRow>[] = [
  { label: "P", x: 340, value: (r) => String(r.played) },
  { label: "W", x: 390, value: (r) => String(r.wins) },
  { label: "L", x: 440, value: (r) => String(r.losses) },
  { label: "Goals", x: 515, value: (r) => `${r.goalsFor}-${r.goalsAgainst}` },
  { label: "GD", x: 585, value: (r) => signed(r.goalsFor - r.goalsAgainst) },
];

type UpNext = { matches: readonly UpcomingMatch[]; more: number };
const NOTHING_UP_NEXT: UpNext = { matches: [], more: 0 };

/**
 * A titled table ("League", "Group A") with its top-left corner at (x, top): rank (unless
 * `ranked` is false), avatar and name, then `columns`. The first rows are marked in
 * `highlight.colors` (rank, a bar on the left, and the avatar ring), one color per row,
 * with a line in the last color below them if `highlight.cutoff`. Returns the SVG and its height.
 */
export function layoutTable<T extends { name: string; avatar: Uint8Array | null; dropped?: boolean }>(
  x: number,
  top: number,
  title: string,
  rows: readonly T[],
  id: string,
  columns: readonly Column<T>[],
  highlight: Highlight,
  ranked = true,
): { svg: string; height: number } {
  const tableTop = top + HEADER_H;
  const parts: string[] = [text(x, tableTop - 14, title, { size: 20, fill: MUTED })];
  for (const column of columns) parts.push(text(x + column.x, tableTop - 14, column.label, { size: 20, fill: MUTED, anchor: "middle" }));
  parts.push(`<rect x="${x}" y="${tableTop}" width="${TABLE_W}" height="${rows.length * ROW_H}" rx="8" fill="${CARD}"/>`);

  rows.forEach((row, i) => {
    const y = tableTop + i * ROW_H;
    const mid = y + ROW_H / 2;
    if (i > 0) {
      const cutoff = highlight.cutoff && i === highlight.colors.length;
      const stroke = cutoff ? highlight.colors.at(-1)! : DIVIDER;
      parts.push(`<line x1="${x}" y1="${y}" x2="${x + TABLE_W}" y2="${y}" stroke="${stroke}" stroke-width="${cutoff ? 3 : 2}"/>`);
    }
    const color = highlight.colors[i];
    if (color) parts.push(`<rect x="${x}" y="${y + 8}" width="5" height="${ROW_H - 16}" rx="2" fill="${color}"/>`);
    if (ranked) parts.push(text(x + 30, mid + 9, String(i + 1), { size: 26, fill: color ?? MUTED, anchor: "middle" }));
    parts.push(avatarCircle(`${id}${i}`, x + 72, mid, 16, row.avatar, color ?? DIM, 3));
    parts.push(text(x + 100, mid + 9, truncate(row.name, 16), { size: 26, fill: row.dropped ? DIM : TEXT }));
    for (const column of columns) parts.push(text(x + column.x, mid + 9, column.value(row), { size: 26, fill: TEXT, anchor: "middle" }));
  });
  return { svg: parts.join(""), height: HEADER_H + rows.length * ROW_H };
}

/**
 * Stage matches still to play, on a card like the table so the text reads in light and dark
 * themes: the live one (red dot), then the next few in play order, then "+N more".
 * Top-left at (x, top); height 0 when there's nothing left.
 */
export function layoutUpNext(x: number, top: number, upNext: UpNext): { svg: string; height: number } {
  if (upNext.matches.length === 0) return { svg: "", height: 0 };
  const lines = upNext.matches.length + (upNext.more > 0 ? 1 : 0);
  const cardTop = top + UP_NEXT_HEADER_H;
  const parts = [
    text(x, cardTop - 14, "Up next", { size: 20, fill: MUTED }),
    `<rect x="${x}" y="${cardTop}" width="${TABLE_W}" height="${lines * UP_NEXT_LINE_H + UP_NEXT_PAD * 2}" rx="8" fill="${CARD}"/>`,
  ];
  const lineY = (i: number) => cardTop + UP_NEXT_PAD + i * UP_NEXT_LINE_H + 23;
  upNext.matches.forEach((m, i) => {
    if (m.live) parts.push(`<circle cx="${x + 22}" cy="${lineY(i) - 8}" r="5" fill="${LIVE_RED}"/>`);
    parts.push(text(x + 36, lineY(i), m.label, { size: 24, fill: m.live ? LIVE_RED : MUTED }));
    parts.push(text(x + UP_NEXT_NAMES_X, lineY(i), `${truncate(m.p1, 16)}  vs  ${truncate(m.p2, 16)}`, { size: 24, fill: TEXT }));
  });
  if (upNext.more > 0) parts.push(text(x + 36, lineY(upNext.matches.length), `+${upNext.more} more`, { size: 22, fill: MUTED }));
  return { svg: parts.join(""), height: UP_NEXT_HEADER_H + lines * UP_NEXT_LINE_H + UP_NEXT_PAD * 2 };
}

export const svgDoc = (width: number, height: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;

/**
 * The round-robin view: the league table (top 2 marked in gold, since they play the
 * final) beside the final's match card and the champion, in the bracket image's style.
 */
export function renderStandingsImage(
  rows: readonly StandingsImageRow[],
  final: BracketMatch,
  champion: BracketChampion | null,
  upNext: UpNext = NOTHING_UP_NEXT,
): Uint8Array {
  const x = PAD;
  const table = layoutTable(x, PAD, "League", rows, "s", STANDINGS_COLUMNS, QUALIFIERS);
  const keyBottom = PAD + table.height + KEY_H;
  const list = layoutUpNext(x, keyBottom, upNext);
  const width = PAD + TABLE_W + COL_GAP + CARD_W + COL_GAP + CHAMPION_W + PAD;
  const height = keyBottom + list.height + PAD;

  // The final, level with the middle of the table, then the champion.
  const finalX = x + TABLE_W + COL_GAP;
  const tableTop = PAD + HEADER_H;
  const cy = Math.max(tableTop + (table.height - HEADER_H) / 2, tableTop + CARD_H / 2 + 70);
  return toPng(
    svgDoc(
      width,
      height,
      table.svg +
        text(x, keyBottom - 10, "Gold: top 2, who play the final", { size: 20, fill: MUTED }) +
        list.svg +
        matchCard(final, finalX, cy, "final", false) +
        `<path d="M ${finalX + CARD_W} ${cy} H ${finalX + CARD_W + COL_GAP}" fill="none" stroke="${champion ? GOLD : CONNECTOR}" stroke-width="3"/>` +
        championBadge(finalX + CARD_W + COL_GAP + CHAMPION_W / 2 - 20, cy, champion),
    ),
  );
}

/**
 * The groups view: Group A and Group B tables (top 2 of each in gold) stacked on the left,
 * with the semifinals, final and champion as a bracket on the right. `playoffs` is
 * [Semifinal 1, Semifinal 2, Final].
 */
export function renderGroupsImage(
  groups: { A: readonly StandingsImageRow[]; B: readonly StandingsImageRow[] },
  playoffs: readonly BracketMatch[],
  champion: BracketChampion | null,
  upNext: UpNext = NOTHING_UP_NEXT,
): Uint8Array {
  const x = PAD;
  const tableA = layoutTable(x, PAD, "Group A", groups.A, "a", STANDINGS_COLUMNS, QUALIFIERS);
  const tableB = layoutTable(x, PAD + tableA.height + GROUP_GAP, "Group B", groups.B, "b", STANDINGS_COLUMNS, QUALIFIERS);
  const tablesBottom = PAD + tableA.height + GROUP_GAP + tableB.height;
  const keyBottom = tablesBottom + KEY_H;
  const list = layoutUpNext(x, keyBottom, upNext);

  // The playoff bracket, centered beside the two tables.
  const bracket = bracketSize(playoffs.length);
  const bracketX = x + TABLE_W + COL_GAP - SEED_W;
  const bracketY = Math.max(PAD, PAD + (tablesBottom - PAD - bracket.height) / 2);
  const width = bracketX + bracket.width + PAD;
  const height = Math.max(keyBottom + list.height, bracketY + bracket.height) + PAD;

  return toPng(
    svgDoc(
      width,
      height,
      tableA.svg +
        tableB.svg +
        text(x, keyBottom - 10, "Gold: top 2 of each group, who play the semifinals", { size: 20, fill: MUTED }) +
        list.svg +
        layoutBracket(playoffs, champion, bracketX, bracketY),
    ),
  );
}
