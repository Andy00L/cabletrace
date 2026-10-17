import { deflateSync, inflateSync } from "node:zlib";
import type { Result } from "../../src/lib/result";

// A minimal PNG codec for the lookdev harness: 8-bit RGB or RGBA, not interlaced, which is what Chromium screenshots
// and the baselines are. Written here instead of adding a dependency (docs/LOOKDEV.md, "Why no image library").
// Format: PNG specification, third edition (W3C, 2025), sections 5 (datastream), 7 (filtering) and 9 (filter types).

export type RgbaImage = { width: number; height: number; data: Uint8Array };

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
// Colour types (PNG spec, table 11.1): 2 truecolour, 6 truecolour with alpha.
const COLOR_TYPE_RGB = 2;
const COLOR_TYPE_RGBA = 6;

const CRC_TABLE = Array.from({ length: 256 }, (_slot, tableIndex) => {
  let crc = tableIndex;
  for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function computeCrc(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** The Paeth predictor (PNG spec, section 9.4). */
function predictPaeth(left: number, above: number, upperLeft: number): number {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

/** Decodes an 8-bit RGB or RGBA, non-interlaced PNG into RGBA pixels. */
export function decodePng(bytes: Uint8Array): Result<RgbaImage> {
  if (bytes.length < PNG_SIGNATURE.length || PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) return { ok: false, reason: "not a PNG file" };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let channels = 0;
  const compressedParts: Uint8Array[] = [];
  while (offset + 8 <= bytes.length) {
    const chunkLength = view.getUint32(offset);
    const chunkType = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const chunkData = bytes.subarray(offset + 8, offset + 8 + chunkLength);
    offset += 12 + chunkLength;
    if (chunkType === "IHDR") {
      const headerView = new DataView(chunkData.buffer, chunkData.byteOffset, chunkData.byteLength);
      width = headerView.getUint32(0);
      height = headerView.getUint32(4);
      const bitDepth = chunkData[8];
      const colorType = chunkData[9];
      const interlace = chunkData[12];
      if (bitDepth !== 8 || interlace !== 0 || (colorType !== COLOR_TYPE_RGB && colorType !== COLOR_TYPE_RGBA)) {
        return { ok: false, reason: `unsupported PNG (bit depth ${bitDepth}, colour type ${colorType}, interlace ${interlace})` };
      }
      channels = colorType === COLOR_TYPE_RGBA ? 4 : 3;
    } else if (chunkType === "IDAT") {
      compressedParts.push(chunkData);
    } else if (chunkType === "IEND") {
      break;
    }
  }
  if (width === 0 || height === 0 || channels === 0) return { ok: false, reason: "PNG has no image header" };
  let filtered: Uint8Array;
  try {
    filtered = inflateSync(Buffer.concat(compressedParts));
  } catch (error) {
    return { ok: false, reason: `PNG data does not inflate: ${error instanceof Error ? error.message : String(error)}` };
  }
  const stride = width * channels;
  if (filtered.length < height * (stride + 1)) return { ok: false, reason: "PNG data is shorter than its header says" };
  const raw = new Uint8Array(height * stride);
  for (let row = 0; row < height; row += 1) {
    const filterType = filtered[row * (stride + 1)];
    const sourceStart = row * (stride + 1) + 1;
    const rowStart = row * stride;
    for (let column = 0; column < stride; column += 1) {
      const encoded = filtered[sourceStart + column] ?? 0;
      const left = column >= channels ? (raw[rowStart + column - channels] ?? 0) : 0;
      const above = row > 0 ? (raw[rowStart - stride + column] ?? 0) : 0;
      const upperLeft = row > 0 && column >= channels ? (raw[rowStart - stride + column - channels] ?? 0) : 0;
      let predicted = 0;
      if (filterType === 1) predicted = left;
      else if (filterType === 2) predicted = above;
      else if (filterType === 3) predicted = (left + above) >> 1;
      else if (filterType === 4) predicted = predictPaeth(left, above, upperLeft);
      else if (filterType !== 0) return { ok: false, reason: `unknown PNG filter type ${filterType} on row ${row}` };
      raw[rowStart + column] = (encoded + predicted) & 0xff;
    }
  }
  if (channels === 4) return { ok: true, value: { width, height, data: raw } };
  const rgba = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    rgba[pixel * 4] = raw[pixel * 3] ?? 0;
    rgba[pixel * 4 + 1] = raw[pixel * 3 + 1] ?? 0;
    rgba[pixel * 4 + 2] = raw[pixel * 3 + 2] ?? 0;
    rgba[pixel * 4 + 3] = 255;
  }
  return { ok: true, value: { width, height, data: rgba } };
}

function buildChunk(chunkType: string, chunkData: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + chunkData.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, chunkData.length);
  chunk.set(Array.from(chunkType, (character) => character.charCodeAt(0)), 4);
  chunk.set(chunkData, 8);
  view.setUint32(8 + chunkData.length, computeCrc(chunk.subarray(4, 8 + chunkData.length)));
  return chunk;
}

/**
 * Encodes RGB pixels (alpha dropped: the frames are opaque) with the Paeth filter on every row, which compresses
 * rendered terrain best of the five filters in a check on the lookdev frames.
 */
export function encodePng(image: RgbaImage): Uint8Array {
  const { width, height, data } = image;
  const stride = width * 3;
  const filtered = new Uint8Array(height * (stride + 1));
  const rgbAt = (row: number, column: number) => (row < 0 || column < 0 ? 0 : (data[(row * width + Math.floor(column / 3)) * 4 + (column % 3)] ?? 0));
  for (let row = 0; row < height; row += 1) {
    filtered[row * (stride + 1)] = 4;
    for (let column = 0; column < stride; column += 1) {
      const value = rgbAt(row, column);
      const predicted = predictPaeth(rgbAt(row, column - 3), rgbAt(row - 1, column), rgbAt(row - 1, column - 3));
      filtered[row * (stride + 1) + 1 + column] = (value - predicted) & 0xff;
    }
  }
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width);
  headerView.setUint32(4, height);
  header.set([8, COLOR_TYPE_RGB, 0, 0, 0], 8);
  const parts = [PNG_SIGNATURE, buildChunk("IHDR", header), buildChunk("IDAT", deflateSync(filtered, { level: 9 })), buildChunk("IEND", new Uint8Array(0))];
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let writeOffset = 0;
  for (const part of parts) {
    output.set(part, writeOffset);
    writeOffset += part.length;
  }
  return output;
}
