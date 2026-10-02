import { describe, expect, it } from "bun:test";
import { Resvg } from "@resvg/resvg-js";
import { renderVersusImage, renderWinnerImage } from "./match-images.ts";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function size(png: Uint8Array) {
  const view = new DataView(png.buffer, png.byteOffset);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

function solidPng(color: string): Uint8Array {
  return new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="${color}"/></svg>`)
    .render()
    .asPng();
}

describe("renderVersusImage", () => {
  it("renders a 600x290 PNG with both avatars", () => {
    const png = renderVersusImage({ avatar: solidPng("red"), team: "goons" }, { avatar: solidPng("blue"), team: "gooners" });
    expect([...png.slice(0, 8)]).toEqual(PNG_SIGNATURE);
    expect(size(png)).toEqual({ width: 600, height: 290 });
  });

  it("draws placeholders when avatars are missing, and the avatars change the output", () => {
    const placeholders = renderVersusImage({ avatar: null, team: "goons" }, { avatar: null, team: "gooners" });
    expect(size(placeholders)).toEqual({ width: 600, height: 290 });
    const withAvatar = renderVersusImage({ avatar: solidPng("red"), team: "goons" }, { avatar: null, team: "gooners" });
    expect(same(placeholders, withAvatar)).toBe(false);
  });

  it("colors each side by its team", () => {
    const a = renderVersusImage({ avatar: null, team: "goons" }, { avatar: null, team: "gooners" });
    const b = renderVersusImage({ avatar: null, team: "gooners" }, { avatar: null, team: "goons" });
    expect(same(a, b)).toBe(false);
  });
});

describe("renderWinnerImage", () => {
  it("renders a 260x290 PNG", () => {
    const png = renderWinnerImage({ avatar: solidPng("red"), team: "gooners" });
    expect([...png.slice(0, 8)]).toEqual(PNG_SIGNATURE);
    expect(size(png)).toEqual({ width: 260, height: 290 });
  });

  it("depends on the avatar and the team", () => {
    const placeholder = renderWinnerImage({ avatar: null, team: "goons" });
    expect(same(placeholder, renderWinnerImage({ avatar: solidPng("red"), team: "goons" }))).toBe(false);
    expect(same(placeholder, renderWinnerImage({ avatar: null, team: "gooners" }))).toBe(false);
  });
});
