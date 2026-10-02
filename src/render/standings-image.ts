import {
  avatarCircle,
  CARD,
  CARD_H,
  championBadge,
  CHAMPION_W,
  CONNECTOR,
  COL_GAP,
  DIM,
  DIVIDER,
  GOLD,
  matchCard,
  MUTED,
  PAD,
  CARD_W,
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
  played: number;
  wins: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
}

const TABLE_W = 620;
const HEADER_H = 40;
const ROW_H = 52;
const KEY_H = 40;
const QUALIFY = 2;

/** Column x positions (relative to the table's left edge) for the numeric columns. */
const COLUMNS = [
  { label: "P", x: 340, value: (r: StandingsImageRow) => String(r.played) },
  { label: "W", x: 390, value: (r: StandingsImageRow) => String(r.wins) },
  { label: "L", x: 440, value: (r: StandingsImageRow) => String(r.losses) },
  { label: "Goals", x: 515, value: (r: StandingsImageRow) => `${r.goalsFor}-${r.goalsAgainst}` },
  {
    label: "GD",
    x: 585,
    value: (r: StandingsImageRow) => {
      const diff = r.goalsFor - r.goalsAgainst;
      return diff > 0 ? `+${diff}` : String(diff);
    },
  },
];

/**
 * The round-robin view: the league table (top 2 marked in gold, since they play the
 * final) beside the final's match card and the champion, in the bracket image's style.
 */
export function renderStandingsImage(
  rows: readonly StandingsImageRow[],
  final: BracketMatch,
  champion: BracketChampion | null,
): Uint8Array {
  const x = PAD;
  const top = PAD + HEADER_H;
  const tableH = rows.length * ROW_H;
  const width = PAD + TABLE_W + COL_GAP + CARD_W + COL_GAP + CHAMPION_W + PAD;
  const height = top + tableH + KEY_H + PAD;
  const parts: string[] = [];

  parts.push(text(x, top - 14, "League", { size: 20, fill: MUTED }));
  for (const column of COLUMNS) parts.push(text(x + column.x, top - 14, column.label, { size: 20, fill: MUTED, anchor: "middle" }));
  parts.push(`<rect x="${x}" y="${top}" width="${TABLE_W}" height="${tableH}" rx="8" fill="${CARD}"/>`);

  rows.forEach((row, i) => {
    const y = top + i * ROW_H;
    const mid = y + ROW_H / 2;
    if (i > 0) {
      const cutoff = i === QUALIFY;
      parts.push(`<line x1="${x}" y1="${y}" x2="${x + TABLE_W}" y2="${y}" stroke="${cutoff ? GOLD : DIVIDER}" stroke-width="${cutoff ? 3 : 2}"/>`);
    }
    const qualified = i < QUALIFY;
    if (qualified) parts.push(`<rect x="${x}" y="${y + 8}" width="5" height="${ROW_H - 16}" rx="2" fill="${GOLD}"/>`);
    parts.push(text(x + 30, mid + 9, String(i + 1), { size: 26, fill: qualified ? GOLD : MUTED, anchor: "middle" }));
    parts.push(avatarCircle(`s${i}`, x + 72, mid, 16, row.avatar, qualified ? GOLD : DIM, 3));
    parts.push(text(x + 100, mid + 9, truncate(row.name, 16), { size: 26, fill: TEXT }));
    for (const column of COLUMNS) {
      parts.push(text(x + column.x, mid + 9, column.value(row), { size: 26, fill: TEXT, anchor: "middle" }));
    }
  });

  parts.push(text(x, top + tableH + KEY_H - 10, "Gold: top 2, who play the final", { size: 20, fill: MUTED }));

  // The final, level with the middle of the table, then the champion.
  const finalX = x + TABLE_W + COL_GAP;
  const cy = Math.max(top + tableH / 2, top + CARD_H / 2 + 70);
  parts.push(matchCard(final, finalX, cy, "final", false));
  parts.push(`<path d="M ${finalX + CARD_W} ${cy} H ${finalX + CARD_W + COL_GAP}" fill="none" stroke="${champion ? GOLD : CONNECTOR}" stroke-width="3"/>`);
  parts.push(championBadge(finalX + CARD_W + COL_GAP + CHAMPION_W / 2 - 20, cy, champion));

  return toPng(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join("")}</svg>`);
}
