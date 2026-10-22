// Builds the landing and sign-in art from Andy's three engravings (ui-design/references/landing-art/, gitignored):
// each piece is cropped inside its printed plate mark, its paper is moved onto the page's paper tone, and it is written
// to public/art/ as AVIF and WebP at the widths the page asks for. No blurred placeholder: a blur of fine engraved lines
// turns grey, while the bare paper the page already shows is the right colour to wait on. The page reads the sizes from
// src/components/landing/art-manifest.ts, which this script writes.
// Usage: bun scripts/art/build-landing-art.ts
import sharp, { type Sharp } from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";

type Crop = { left: number; top: number; right: number; bottom: number };
type ArtPiece = { name: string; crop: Crop; widths: number[] };
type ArtPlate = { number: string; caption: string };

const SOURCE_FOLDER = "ui-design/references/landing-art";
const OUTPUT_FOLDER = "public/art";
const MANIFEST_PATH = "src/components/landing/art-manifest.ts";
// The page's paper tone, approved on the style board on 2026-10-19 (docs/UI_DESIGN_SYSTEM.md, Landing):
// the median paper of the six pieces. sourceRef: src/app/globals.css (--color-paper).
const PAPER_RGB = [0xf9, 0xf1, 0xe2];
// A pixel brighter than this luma (0 to 255) counts as bare paper when measuring a piece's paper colour.
const PAPER_LUMA_FLOOR = 228;
// Pixels to cut from each edge, measured from the printed plate lines on 2026-10-18 (style board build).
const PIECES: ArtPiece[] = [
  { name: "art-1", crop: { left: 145, top: 104, right: 110, bottom: 112 }, widths: [960, 1600, 2400] },
  { name: "art-1-phone", crop: { left: 110, top: 108, right: 111, bottom: 108 }, widths: [600, 1200] },
  { name: "art-2", crop: { left: 105, top: 104, right: 108, bottom: 119 }, widths: [960, 1600, 2400] },
  { name: "art-2-phone", crop: { left: 82, top: 0, right: 80, bottom: 84 }, widths: [600, 1200] },
  { name: "art-3", crop: { left: 96, top: 0, right: 97, bottom: 86 }, widths: [960, 1600, 2400] },
  { name: "art-3-phone", crop: { left: 80, top: 0, right: 84, bottom: 104 }, widths: [600, 1200] },
];

// The book-plate caption under each engraving on the landing (src/components/landing/ArtPicture.tsx): a plate number and
// one line on what the picture shows, written from the pictures on 21 Oct 2026. A phone cut is the same scene cropped,
// so it shares its piece's plate. Rewrite a caption when its piece is swapped.
const PLATES: Record<string, ArtPlate> = {
  "art-1": { number: "I", caption: "A tanker at anchor off a rocky shore of pines, a church and a lighthouse on the far coast, one vermilion buoy." },
  "art-2": { number: "II", caption: "In section: a tanker's chain runs to an anchor ploughing the seabed, and the cable below frays at one vermilion mark." },
  "art-3": { number: "III", caption: "Northern Europe on the globe, sea routes dotted in, a compass rose, vermilion rings at the mouth of the Gulf of Finland." },
};

function findMedian(values: number[]): number {
  const sorted = [...values].sort((first, second) => first - second);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/** The median colour of a piece's bare paper, sampled on every seventh pixel. */
async function measurePaper(image: Sharp): Promise<number[]> {
  const { data } = await image.clone().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const channels: number[][] = [[], [], []];
  for (let offset = 0; offset < data.length; offset += 3 * 7) {
    const red = data[offset] ?? 0;
    const green = data[offset + 1] ?? 0;
    const blue = data[offset + 2] ?? 0;
    if (0.2126 * red + 0.7152 * green + 0.0722 * blue <= PAPER_LUMA_FLOOR) continue;
    channels[0]?.push(red);
    channels[1]?.push(green);
    channels[2]?.push(blue);
  }
  return channels.map((values) => findMedian(values));
}

type ManifestEntry = { width: number; height: number; widths: number[] };

async function buildPiece(piece: ArtPiece): Promise<ManifestEntry> {
  const input = `${SOURCE_FOLDER}/${piece.name}.jpg`;
  const metadata = await sharp(input).metadata();
  const width = (metadata.width ?? 0) - piece.crop.left - piece.crop.right;
  const height = (metadata.height ?? 0) - piece.crop.top - piece.crop.bottom;
  const cropped = sharp(input).extract({ left: piece.crop.left, top: piece.crop.top, width, height });
  const paper = await measurePaper(cropped);
  // A white-point move per channel: the paper lands on the page's paper tone, the ink keeps its value.
  const multipliers = PAPER_RGB.map((target, channel) => target / (paper[channel] || 255));
  const graded = cropped.linear(multipliers, [0, 0, 0]);
  for (const outputWidth of piece.widths) {
    const resized = graded.clone().resize({ width: outputWidth });
    await resized.clone().avif({ quality: 52, effort: 6 }).toFile(`${OUTPUT_FOLDER}/${piece.name}-${outputWidth}.avif`);
    await resized.clone().webp({ quality: 74, effort: 6 }).toFile(`${OUTPUT_FOLDER}/${piece.name}-${outputWidth}.webp`);
  }
  return { width, height, widths: piece.widths };
}

mkdirSync(OUTPUT_FOLDER, { recursive: true });
const manifest: Record<string, ManifestEntry> = {};
for (const piece of PIECES) {
  manifest[piece.name] = await buildPiece(piece);
  console.log(`[buildLandingArt] ${piece.name} ${manifest[piece.name]?.width} x ${manifest[piece.name]?.height}`);
}
const manifestSource = `// Written by scripts/art/build-landing-art.ts; do not edit by hand. Sizes are the cropped source's, in px.
export type ArtName = ${PIECES.map((piece) => `"${piece.name}"`).join(" | ")};

export type ArtEntry = { width: number; height: number; widths: readonly number[] };

export const ART_MANIFEST: Readonly<Record<ArtName, ArtEntry>> = ${JSON.stringify(manifest, null, 2)};

export type ArtPlate = { number: string; caption: string };

/** The plate caption under each engraving on the landing (ArtPicture.tsx); a phone cut shares its piece's plate. */
export const ART_PLATES: Readonly<Record<Exclude<ArtName, \`\${string}-phone\`>, ArtPlate>> = ${JSON.stringify(PLATES, null, 2)};
`;
writeFileSync(MANIFEST_PATH, manifestSource);
console.log(`[buildLandingArt] wrote ${MANIFEST_PATH}`);
