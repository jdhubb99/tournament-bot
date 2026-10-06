import { winsNeeded } from "../logic/series.ts";
import { TEAMS, type Team } from "../logic/teams.ts";
import { toPng } from "./match-images.ts";

export const BRACKET_FILE = "bracket.png";

export interface BracketSlot {
  /** Null until the player is known (e.g. the final before the semis finish). */
  name: string | null;
  /** Shown instead of a name while the slot is empty, e.g. "Winner of Semifinal 1". */
  placeholder: string;
  avatar: Uint8Array | null;
  /** Null before the match goes live. */
  team: Team | null;
  /** Shown beside first-round rows only: a seed number, or a group finish like "A1". */
  seed: number | string | null;
  /** Goals for a best of 1 (drawn as a number), games won for longer series (drawn as dots); null before anything is reported. */
  score: number | null;
  won: boolean;
  /** True for the player who forfeited a match: drawn as "FF" in place of a score. */
  forfeited: boolean;
}

export interface BracketMatch {
  label: string;
  bestOf: number;
  status: "pending" | "live" | "done";
  p1: BracketSlot;
  p2: BracketSlot;
}

export interface BracketChampion {
  name: string;
  avatar: Uint8Array | null;
}

export const PAD = 40;
export const SEED_W = 34;
export const CARD_W = 300;
const ROW_H = 46;
export const CARD_H = ROW_H * 2;
export const LABEL_H = 28;
const ROUND_ONE_GAP = 36;
export const COL_GAP = 70;
export const CHAMPION_W = 200;
export const AVATAR_R = 15;
const KEY_H = 40;

export const CARD = "#2b2d31";
export const DIVIDER = "#3f4147";
export const CONNECTOR = "#80848e";
export const MUTED = "#949ba4";
export const DIM = "#6d6f78";
export const TEXT = "#f2f3f5";
export const LIVE_RED = "#ed4245";
export const GOLD = "#d4af37";

/** Player names are user input, so escape them before putting them in SVG. */
export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function text(x: number, y: number, value: string, opts: { size: number; fill: string; anchor?: string }): string {
  return `<text x="${x}" y="${y}" font-family="Bebas Neue" font-size="${opts.size}" fill="${opts.fill}" text-anchor="${opts.anchor ?? "start"}">${escapeXml(value)}</text>`;
}

export function avatarCircle(id: string, cx: number, cy: number, r: number, avatar: Uint8Array | null, ring: string, width: number): string {
  const picture = avatar
    ? `<clipPath id="${id}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>
       <image href="data:image/png;base64,${Buffer.from(avatar).toString("base64")}" x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}" clip-path="url(#${id})"/>`
    : `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#4e5058"/>`;
  return `${picture}<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${ring}" stroke-width="${width}"/>`;
}

/** One dot per game needed to win the series, filled for each game won, right-aligned at `right`. */
function pips(right: number, cy: number, needed: number, won: number, color: string): string {
  const left = right - (needed - 1) * 20;
  return Array.from({ length: needed }, (_, i) =>
    i < won
      ? `<circle cx="${left + i * 20}" cy="${cy}" r="7" fill="${color}"/>`
      : `<circle cx="${left + i * 20}" cy="${cy}" r="6" fill="none" stroke="${DIM}" stroke-width="2"/>`,
  ).join("");
}

function row(slot: BracketSlot, bestOf: number, x: number, y: number, id: string, showSeed: boolean, decided: boolean): string {
  const mid = y + ROW_H / 2;
  const parts: string[] = [];
  if (showSeed && slot.seed !== null) parts.push(text(x - 12, mid + 9, String(slot.seed), { size: 24, fill: MUTED, anchor: "end" }));
  if (slot.won && slot.team) parts.push(`<rect x="${x}" y="${y + 6}" width="5" height="${ROW_H - 12}" rx="2" fill="${TEAMS[slot.team].color}"/>`);
  if (slot.name === null) {
    parts.push(text(x + 18, mid + 7, truncate(slot.placeholder, 28), { size: 20, fill: DIM }));
    return parts.join("");
  }
  const ring = slot.team ? TEAMS[slot.team].color : DIM;
  parts.push(avatarCircle(id, x + 18 + AVATAR_R, mid, AVATAR_R, slot.avatar, ring, 3));
  const fill = decided && !slot.won ? MUTED : TEXT;
  parts.push(text(x + 18 + AVATAR_R * 2 + 12, mid + 9, truncate(slot.name, 16), { size: 26, fill }));
  // Goals are numbers; games won in a longer series are dots, so the two can't be confused.
  if (slot.forfeited) {
    parts.push(text(x + CARD_W - 16, mid + 10, "FF", { size: 28, fill: MUTED, anchor: "end" }));
  } else if (bestOf > 1) {
    parts.push(pips(x + CARD_W - 20, mid, winsNeeded(bestOf), slot.score ?? 0, slot.team ? TEAMS[slot.team].color : TEXT));
  } else if (slot.score !== null) {
    parts.push(text(x + CARD_W - 16, mid + 10, String(slot.score), { size: 28, fill, anchor: "end" }));
  }
  return parts.join("");
}

/** One match: label above, a card with two player rows, outlined in red while live. */
export function matchCard(match: BracketMatch, x: number, cy: number, id: string, firstRound: boolean): string {
  const y = cy - CARD_H / 2;
  const live = match.status === "live";
  const label = `${match.label} · Bo${match.bestOf}`;
  return `
    ${text(x, y - 9, label, { size: 20, fill: MUTED })}
    ${live ? `<circle cx="${x + CARD_W - 40}" cy="${y - 16}" r="5" fill="${LIVE_RED}"/>${text(x + CARD_W, y - 9, "Live", { size: 20, fill: LIVE_RED, anchor: "end" })}` : ""}
    <rect x="${x}" y="${y}" width="${CARD_W}" height="${CARD_H}" rx="8" fill="${CARD}" ${live ? `stroke="${LIVE_RED}" stroke-width="3"` : ""}/>
    <line x1="${x}" y1="${cy}" x2="${x + CARD_W}" y2="${cy}" stroke="${DIVIDER}" stroke-width="2"/>
    ${row(match.p1, match.bestOf, x, y, `${id}a`, firstRound, match.status === "done")}
    ${row(match.p2, match.bestOf, x, cy, `${id}b`, firstRound, match.status === "done")}`;
}

/** The champion's avatar ringed in gold with their name, or a dashed "?" until there is one. Centered on (cx, cy). */
export function championBadge(cx: number, cy: number, champion: BracketChampion | null): string {
  if (champion) {
    return (
      avatarCircle("champion", cx, cy - 10, 56, champion.avatar, GOLD, 6) +
      text(cx, cy - 80, "Champion", { size: 26, fill: GOLD, anchor: "middle" }) +
      text(cx, cy + 82, truncate(champion.name, 14), { size: 28, fill: GOLD, anchor: "middle" })
    );
  }
  return (
    `<circle cx="${cx}" cy="${cy - 10}" r="56" fill="none" stroke="${DIM}" stroke-width="4" stroke-dasharray="10 8"/>` +
    text(cx, cy + 2, "?", { size: 48, fill: DIM, anchor: "middle" }) +
    text(cx, cy + 82, "Champion", { size: 26, fill: DIM, anchor: "middle" })
  );
}

/** Splits single-elim matches (in plan order: round 1, then round 2, ...) into rounds. */
export function intoRounds<T>(matches: readonly T[]): T[][] {
  const rounds: T[][] = [];
  let size = (matches.length + 1) / 2;
  let start = 0;
  while (start < matches.length) {
    rounds.push(matches.slice(start, start + size));
    start += size;
    size /= 2;
  }
  return rounds;
}

/** Size of a bracket drawn by `layoutBracket`, measured from its origin. */
export function bracketSize(matchCount: number): { width: number; height: number } {
  const rounds = intoRounds([...Array(matchCount)]);
  const slotH = LABEL_H + CARD_H + ROUND_ONE_GAP;
  return {
    width: SEED_W + rounds.length * (CARD_W + COL_GAP) + CHAMPION_W,
    height: rounds[0]!.length * slotH - ROUND_ONE_GAP,
  };
}

/**
 * Draws a knockout bracket with its top-left corner at (originX, originY): rounds as columns
 * joined by connector lines, then the champion badge. Matches are in plan order.
 */
export function layoutBracket(
  matches: readonly BracketMatch[],
  champion: BracketChampion | null,
  originX: number,
  originY: number,
): string {
  const rounds = intoRounds(matches);
  const slotH = LABEL_H + CARD_H + ROUND_ONE_GAP;
  const centers: number[][] = [rounds[0]!.map((_, i) => originY + LABEL_H + i * slotH + CARD_H / 2)];
  for (let r = 1; r < rounds.length; r++) {
    centers.push(rounds[r]!.map((_, i) => (centers[r - 1]![2 * i]! + centers[r - 1]![2 * i + 1]!) / 2));
  }
  const columnX = (r: number) => originX + SEED_W + r * (CARD_W + COL_GAP);

  const parts: string[] = [];
  rounds.forEach((round, r) => {
    round.forEach((match, i) => {
      const cy = centers[r]![i]!;
      parts.push(matchCard(match, columnX(r), cy, `m${r}-${i}`, r === 0));
      // Connector into the next round (or to the champion from the final).
      const fromX = columnX(r) + CARD_W;
      const midX = fromX + COL_GAP / 2;
      if (r + 1 < rounds.length) {
        const target = centers[r + 1]![Math.floor(i / 2)]!;
        parts.push(`<path d="M ${fromX} ${cy} H ${midX} V ${target} H ${columnX(r + 1)}" fill="none" stroke="${CONNECTOR}" stroke-width="3"/>`);
      } else {
        parts.push(`<path d="M ${fromX} ${cy} H ${fromX + COL_GAP}" fill="none" stroke="${champion ? GOLD : CONNECTOR}" stroke-width="3"/>`);
      }
    });
  });
  parts.push(championBadge(columnX(rounds.length) + CHAMPION_W / 2 - 20, centers.at(-1)![0]!, champion));
  return parts.join("");
}

/**
 * A single-elimination bracket image (4 or 8 players: 3 or 7 matches in plan order), with
 * a key under it when it mixes best-of-1 goal numbers and longer series' win dots.
 */
export function renderBracketImage(matches: readonly BracketMatch[], champion: BracketChampion | null): Uint8Array {
  const size = bracketSize(matches.length);
  const mixed = matches.some((m) => m.bestOf === 1) && matches.some((m) => m.bestOf > 1);
  const width = PAD + size.width + PAD;
  const height = PAD + size.height + (mixed ? KEY_H : 0) + PAD;
  const parts = [layoutBracket(matches, champion, PAD, PAD)];
  if (mixed) parts.push(scoreKey(PAD + SEED_W, PAD + size.height + KEY_H - 8));
  return toPng(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join("")}</svg>`);
}

/** "Numbers are goals (best of 1) · ●○ are games won (best of 3 or 5)", with its baseline at y. */
export function scoreKey(x: number, y: number): string {
  return (
    text(x, y, "Numbers are goals (best of 1)", { size: 20, fill: MUTED }) +
    pips(x + 262, y - 7, 2, 1, MUTED) +
    text(x + 280, y, "are games won (best of 3 or 5)", { size: 20, fill: MUTED })
  );
}
