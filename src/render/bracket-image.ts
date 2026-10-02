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
  /** Seed number, shown beside first-round rows only. */
  seed: number | null;
  /** Goals for a best of 1, games won for longer series; null before anything is reported. */
  score: number | null;
  won: boolean;
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

const PAD = 40;
const SEED_W = 34;
const CARD_W = 300;
const ROW_H = 46;
const CARD_H = ROW_H * 2;
const LABEL_H = 28;
const ROUND_ONE_GAP = 36;
const COL_GAP = 70;
const CHAMPION_W = 200;
const AVATAR_R = 15;

const CARD = "#2b2d31";
const DIVIDER = "#3f4147";
const CONNECTOR = "#80848e";
const MUTED = "#949ba4";
const DIM = "#6d6f78";
const TEXT = "#f2f3f5";
const LIVE_RED = "#ed4245";
const GOLD = "#d4af37";

/** Player names are user input, so escape them before putting them in SVG. */
export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function text(x: number, y: number, value: string, opts: { size: number; fill: string; anchor?: string }): string {
  return `<text x="${x}" y="${y}" font-family="Bebas Neue" font-size="${opts.size}" fill="${opts.fill}" text-anchor="${opts.anchor ?? "start"}">${escapeXml(value)}</text>`;
}

function avatarCircle(id: string, cx: number, cy: number, r: number, avatar: Uint8Array | null, ring: string, width: number): string {
  const picture = avatar
    ? `<clipPath id="${id}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>
       <image href="data:image/png;base64,${Buffer.from(avatar).toString("base64")}" x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}" clip-path="url(#${id})"/>`
    : `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#4e5058"/>`;
  return `${picture}<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${ring}" stroke-width="${width}"/>`;
}

function row(slot: BracketSlot, x: number, y: number, id: string, showSeed: boolean, decided: boolean): string {
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
  if (slot.score !== null) parts.push(text(x + CARD_W - 16, mid + 10, String(slot.score), { size: 28, fill, anchor: "end" }));
  return parts.join("");
}

function card(match: BracketMatch, x: number, cy: number, id: string, firstRound: boolean): string {
  const y = cy - CARD_H / 2;
  const live = match.status === "live";
  const label = `${match.label} · Bo${match.bestOf}`;
  return `
    ${text(x, y - 9, label, { size: 20, fill: MUTED })}
    ${live ? `<circle cx="${x + CARD_W - 40}" cy="${y - 16}" r="5" fill="${LIVE_RED}"/>${text(x + CARD_W, y - 9, "Live", { size: 20, fill: LIVE_RED, anchor: "end" })}` : ""}
    <rect x="${x}" y="${y}" width="${CARD_W}" height="${CARD_H}" rx="8" fill="${CARD}" ${live ? `stroke="${LIVE_RED}" stroke-width="3"` : ""}/>
    <line x1="${x}" y1="${cy}" x2="${x + CARD_W}" y2="${cy}" stroke="${DIVIDER}" stroke-width="2"/>
    ${row(match.p1, x, y, `${id}a`, firstRound, match.status === "done")}
    ${row(match.p2, x, cy, `${id}b`, firstRound, match.status === "done")}`;
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

/**
 * A single-elimination bracket: rounds as columns joined by connector lines, each match
 * a card with two player rows, and the champion in gold at the end once there is one.
 * Matches must be in plan order with 3 (4 players) or 7 (8 players) entries.
 */
export function renderBracketImage(matches: readonly BracketMatch[], champion: BracketChampion | null): Uint8Array {
  const rounds = intoRounds(matches);
  const firstCount = rounds[0]!.length;
  const slotH = LABEL_H + CARD_H + ROUND_ONE_GAP;
  const width = PAD + SEED_W + rounds.length * (CARD_W + COL_GAP) + CHAMPION_W + PAD;
  const height = PAD + firstCount * slotH - ROUND_ONE_GAP + PAD;

  const centers: number[][] = [rounds[0]!.map((_, i) => PAD + LABEL_H + i * slotH + CARD_H / 2)];
  for (let r = 1; r < rounds.length; r++) {
    centers.push(rounds[r]!.map((_, i) => (centers[r - 1]![2 * i]! + centers[r - 1]![2 * i + 1]!) / 2));
  }
  const columnX = (r: number) => PAD + SEED_W + r * (CARD_W + COL_GAP);

  const parts: string[] = [];
  rounds.forEach((round, r) => {
    round.forEach((match, i) => {
      const cy = centers[r]![i]!;
      parts.push(card(match, columnX(r), cy, `m${r}-${i}`, r === 0));
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

  const finalY = centers.at(-1)![0]!;
  const cx = columnX(rounds.length) + CHAMPION_W / 2 - 20;
  if (champion) {
    parts.push(avatarCircle("champion", cx, finalY - 10, 56, champion.avatar, GOLD, 6));
    parts.push(text(cx, finalY - 80, "Champion", { size: 26, fill: GOLD, anchor: "middle" }));
    parts.push(text(cx, finalY + 82, truncate(champion.name, 14), { size: 28, fill: GOLD, anchor: "middle" }));
  } else {
    parts.push(`<circle cx="${cx}" cy="${finalY - 10}" r="56" fill="none" stroke="${DIM}" stroke-width="4" stroke-dasharray="10 8"/>`);
    parts.push(text(cx, finalY + 2, "?", { size: 48, fill: DIM, anchor: "middle" }));
    parts.push(text(cx, finalY + 82, "Champion", { size: 26, fill: DIM, anchor: "middle" }));
  }

  return toPng(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join("")}</svg>`);
}
