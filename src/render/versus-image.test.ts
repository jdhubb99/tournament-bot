import { describe, expect, it } from "bun:test";
import { Resvg } from "@resvg/resvg-js";
import { renderVersusImage } from "./versus-image.ts";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function size(png: Uint8Array) {
  const view = new DataView(png.buffer, png.byteOffset);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function solidPng(color: string): Uint8Array {
  return new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="${color}"/></svg>`)
    .render()
    .asPng();
}

describe("renderVersusImage", () => {
  it("renders a 600x240 PNG with both avatars", () => {
    const png = renderVersusImage(solidPng("red"), solidPng("blue"));
    expect([...png.slice(0, 8)]).toEqual(PNG_SIGNATURE);
    expect(size(png)).toEqual({ width: 600, height: 240 });
  });

  it("draws placeholders when avatars are missing, and the avatars change the output", () => {
    const placeholders = renderVersusImage(null, null);
    expect(size(placeholders)).toEqual({ width: 600, height: 240 });
    expect(Buffer.from(placeholders).equals(Buffer.from(renderVersusImage(solidPng("red"), null)))).toBe(false);
  });
});
