import { Resvg } from "@resvg/resvg-js";
import { join } from "node:path";
import { TEAMS, type Team } from "../logic/teams.ts";

export const VERSUS_FILE = "versus.png";

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

function side({ avatar, team }: VersusSide, cx: number, id: string): string {
  const { name, color } = TEAMS[team];
  const picture = avatar
    ? `<image href="data:image/png;base64,${Buffer.from(avatar).toString("base64")}" x="${cx - RADIUS}" y="${AVATAR_Y - RADIUS}" width="${RADIUS * 2}" height="${RADIUS * 2}" clip-path="url(#${id})"/>`
    : `<circle cx="${cx}" cy="${AVATAR_Y}" r="${RADIUS}" fill="#4e5058"/>`;
  return `
    <clipPath id="${id}"><circle cx="${cx}" cy="${AVATAR_Y}" r="${RADIUS}"/></clipPath>
    ${picture}
    <circle cx="${cx}" cy="${AVATAR_Y}" r="${RADIUS}" fill="none" stroke="${color}" stroke-width="8"/>
    <text x="${cx}" y="${AVATAR_Y + RADIUS + 50}" font-family="Bebas Neue" font-size="44" fill="${color}" text-anchor="middle">${name}</text>`;
}

/**
 * Both players' avatars side by side with "VS" between them. Each avatar is ringed and
 * labelled in its team's color, and "VS" is split down the middle: "V" in the left team's
 * color, "S" in the right's.
 * Transparent background, so it reads in light and dark themes.
 */
export function renderVersusImage(p1: VersusSide, p2: VersusSide): Uint8Array {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <linearGradient id="vs" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0.5" stop-color="${TEAMS[p1.team].color}"/>
      <stop offset="0.5" stop-color="${TEAMS[p2.team].color}"/>
    </linearGradient>
    ${side(p1, 130, "p1")}
    ${side(p2, WIDTH - 130, "p2")}
    <text x="${WIDTH / 2}" y="${AVATAR_Y + 34}" font-family="Bebas Neue" font-size="96" fill="url(#vs)" text-anchor="middle">VS</text>
  </svg>`;
  const resvg = new Resvg(svg, { font: { fontFiles: [FONT_FILE], loadSystemFonts: false, defaultFontFamily: "Bebas Neue" } });
  return resvg.render().asPng();
}
