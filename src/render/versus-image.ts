import { Resvg } from "@resvg/resvg-js";
import { join } from "node:path";

export const VERSUS_FILE = "versus.png";

// resvg doesn't pick up system fonts reliably, so the font ships with the repo.
const FONT_FILE = join(import.meta.dir, "..", "..", "assets", "fonts", "BebasNeue-Regular.ttf");
const WIDTH = 600;
const HEIGHT = 240;
const RADIUS = 100;
const YELLOW = "#f1c40f";

function avatar(png: Uint8Array | null, cx: number, id: string): string {
  const cy = HEIGHT / 2;
  const picture = png
    ? `<image href="data:image/png;base64,${Buffer.from(png).toString("base64")}" x="${cx - RADIUS}" y="${cy - RADIUS}" width="${RADIUS * 2}" height="${RADIUS * 2}" clip-path="url(#${id})"/>`
    : `<circle cx="${cx}" cy="${cy}" r="${RADIUS}" fill="#4e5058"/>`;
  return `
    <clipPath id="${id}"><circle cx="${cx}" cy="${cy}" r="${RADIUS}"/></clipPath>
    ${picture}
    <circle cx="${cx}" cy="${cy}" r="${RADIUS}" fill="none" stroke="${YELLOW}" stroke-width="6"/>`;
}

/**
 * Both players' avatars side by side with "VS" between them, as a PNG with a
 * transparent background (reads well in light and dark Discord themes).
 * A missing avatar (download failed) is drawn as a grey circle.
 */
export function renderVersusImage(p1: Uint8Array | null, p2: Uint8Array | null): Uint8Array {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    ${avatar(p1, 130, "p1")}
    ${avatar(p2, WIDTH - 130, "p2")}
    <text x="${WIDTH / 2}" y="${HEIGHT / 2 + 34}" font-family="Bebas Neue" font-size="96" fill="${YELLOW}" text-anchor="middle">VS</text>
  </svg>`;
  const resvg = new Resvg(svg, { font: { fontFiles: [FONT_FILE], loadSystemFonts: false, defaultFontFamily: "Bebas Neue" } });
  return resvg.render().asPng();
}
