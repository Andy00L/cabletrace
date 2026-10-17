import { describe, expect, test } from "bun:test";
import { compareImages, downscaleImage, matchColorNear, parseHexColor } from "./compare";
import { decodePng, encodePng, type RgbaImage } from "./png";

function makeImage(width: number, height: number, paint: (column: number, row: number) => [number, number, number]): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      data.set([...paint(column, row), 255], (row * width + column) * 4);
    }
  }
  return { width, height, data };
}

describe("lookdev image checks", () => {
  test("a frame survives the PNG round trip pixel for pixel", () => {
    const image = makeImage(37, 21, (column, row) => [(column * 7) % 256, (row * 13) % 256, (column * row) % 256]);
    const decoded = decodePng(encodePng(image));
    expect(decoded.ok && Array.from(decoded.value.data)).toEqual(Array.from(image.data));
  });

  test("an unchanged frame differs nowhere, a repainted block differs exactly there", () => {
    const baseline = makeImage(20, 20, () => [200, 210, 205]);
    const candidate = makeImage(20, 20, (column, row) => (column < 5 && row < 4 ? [20, 20, 20] : [200, 210, 205]));
    expect(compareImages(baseline, baseline, 0.1)?.differingPixels).toBe(0);
    expect(compareImages(baseline, candidate, 0.1)?.differingPixels).toBe(20);
    expect(compareImages(baseline, makeImage(10, 10, () => [0, 0, 0]), 0.1)).toBeNull();
  });

  test("the box filter averages each block", () => {
    const image = makeImage(4, 2, (column) => (column % 2 === 0 ? [0, 0, 0] : [255, 255, 255]));
    expect(Array.from(downscaleImage(image, 2).data.slice(0, 4))).toEqual([128, 128, 128, 255]);
  });

  test("a data colour two pixels from the probe point is found, a tone-mapped one is not exact", () => {
    const cable = parseHexColor("#2F6BD8");
    const image = makeImage(9, 9, (column, row) => (column === 6 && row === 4 ? [47, 107, 216] : [13, 99, 214]));
    expect(matchColorNear(image, 4, 4, cable, 2)?.deviation).toBe(0);
    expect(matchColorNear(image, 4, 4, cable, 1)?.deviation).toBe(34);
  });
});
