import { Resvg } from "@resvg/resvg-js";
import { join } from "node:path";
import { TEAMS, type Team } from "../logic/teams.ts";

export const VERSUS_FILE = "versus.png";
export const WINNER_FILE = "winner.png";
export const SCOREBOARD_FILE = "scoreboard.png";

// resvg doesn't pick up system fonts reliably, so the font ships with the repo.
const FONT_FILE = join(import.meta.dir, "..", "..", "assets", "fonts", "BebasNeue-Regular.ttf");
const WIDTH = 600;
const HEIGHT = 290;
const RADIUS = 100;
const AVATAR_Y = 120;

export interface VersusSide {
  /** PNG bytes, or null if the download failed (drawn as a grey circle). */
  avatar: Uint8Array | null;
  team: Team;
}

/** An avatar ringed in its team's color with a label underneath (the team name by default). */
function side({ avatar, team }: VersusSide, cx: number, id: string, label = TEAMS[team].name): string {
  const { color } = TEAMS[team];
  const picture = avatar
    ? `<image href="data:image/png;base64,${Buffer.from(avatar).toString("base64")}" x="${cx - RADIUS}" y="${AVATAR_Y - RADIUS}" width="${RADIUS * 2}" height="${RADIUS * 2}" clip-path="url(#${id})"/>`
    : `<circle cx="${cx}" cy="${AVATAR_Y}" r="${RADIUS}" fill="#4e5058"/>`;
  return `
    <clipPath id="${id}"><circle cx="${cx}" cy="${AVATAR_Y}" r="${RADIUS}"/></clipPath>
    ${picture}
    <circle cx="${cx}" cy="${AVATAR_Y}" r="${RADIUS}" fill="none" stroke="${color}" stroke-width="8"/>
    <text x="${cx}" y="${AVATAR_Y + RADIUS + 50}" font-family="Bebas Neue" font-size="44" fill="${color}" text-anchor="middle">${label}</text>`;
}

/** Two ringed avatars side by side with `center` drawn between them. */
function twoSides(p1: VersusSide, p2: VersusSide, center: string): Uint8Array {
  return toPng(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    ${side(p1, 130, "p1")}
    ${side(p2, WIDTH - 130, "p2")}
    ${center}
  </svg>`);
}

/**
 * Both players' avatars side by side with "VS" between them. Each avatar is ringed and
 * labelled in its team's color, and "VS" is split down the middle: "V" in the left team's
 * color, "S" in the right's.
 * Transparent background, so it reads in light and dark themes.
 */
export function renderVersusImage(p1: VersusSide, p2: VersusSide): Uint8Array {
  return twoSides(
    p1,
    p2,
    `<linearGradient id="vs" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0.5" stop-color="${TEAMS[p1.team].color}"/>
      <stop offset="0.5" stop-color="${TEAMS[p2.team].color}"/>
    </linearGradient>
    <text x="${WIDTH / 2}" y="${AVATAR_Y + 34}" font-family="Bebas Neue" font-size="96" fill="url(#vs)" text-anchor="middle">VS</text>`,
  );
}

/** Same layout as the versus image, with the series score (games won) in place of "VS", each number in its team's color. */
export function renderScoreboardImage(p1: VersusSide, p2: VersusSide, p1Wins: number, p2Wins: number): Uint8Array {
  // Smaller than "VS" so "1–0" fits in the gap between the rings.
  const y = AVATAR_Y + 28;
  const text = (x: number, color: string, value: string | number) =>
    `<text x="${x}" y="${y}" font-family="Bebas Neue" font-size="80" fill="${color}" text-anchor="middle">${value}</text>`;
  return twoSides(
    p1,
    p2,
    text(WIDTH / 2 - 34, TEAMS[p1.team].color, p1Wins) + text(WIDTH / 2, "#80848e", "–") + text(WIDTH / 2 + 34, TEAMS[p2.team].color, p2Wins),
  );
}

/**
 * The winner's avatar ringed in their team's color with "WINNER" underneath. Uploaded as a
 * file because Discord doesn't reliably show avatar links as embed thumbnails.
 */
export function renderWinnerImage(winner: VersusSide): Uint8Array {
  const width = 260;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${HEIGHT}" viewBox="0 0 ${width} ${HEIGHT}">
    ${side(winner, width / 2, "w", "Winner")}
  </svg>`;
  return toPng(svg);
}

function toPng(svg: string): Uint8Array {
  const resvg = new Resvg(svg, { font: { fontFiles: [FONT_FILE], loadSystemFonts: false, defaultFontFamily: "Bebas Neue" } });
  return resvg.render().asPng();
}
