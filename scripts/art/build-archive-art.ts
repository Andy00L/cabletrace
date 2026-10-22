// Builds the landing's archival pictures: two of Robert Charles Dudley's watercolours of the 1865 Atlantic cable
// expedition, public domain (CC0) at The Metropolitan Museum of Art. Each original is downloaded once into
// .scratch/archive-art/ (gitignored), its mount and scan border are cropped off, and it is written to
// public/landing/archive/ as AVIF and WebP at the widths the page asks for. The page reads sizes and credits from
// src/lib/landing/archive-art.ts, which this script writes.
// Usage: bun scripts/art/build-archive-art.ts
import sharp from "sharp";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

type Crop = { left: number; top: number; right: number; bottom: number };
type ArchivePiece = {
  name: string;
  /** The Met's original file and its object page (Open Access, read 21 Oct 2026). */
  imageUrl: string;
  pageUrl: string;
  title: string;
  date: string;
  /** What the picture shows, for its alt text. */
  alt: string;
  crop: Crop;
  widths: number[];
};

const CACHE_FOLDER = ".scratch/archive-art";
const OUTPUT_FOLDER = "public/landing/archive";
const MANIFEST_PATH = "src/lib/landing/archive-art.ts";
// Pixels cut from each edge of the originals, measured on 21 Oct 2026: the scan's dark frame on the deck scene, the
// cream mount and a torn left edge on the fleet at sea.
const PIECES: ArchivePiece[] = [
  {
    name: "searching-for-the-fault",
    imageUrl: "https://images.metmuseum.org/CRDImages/dp/original/DP801260.jpg",
    pageUrl: "https://www.metmuseum.org/art/collection/search/383826",
    title: "Searching for the Fault after Hauling Back the Cable from the Bottom of the Atlantic, July 31st, 1865",
    date: "1865",
    alt: "Watercolour of the Great Eastern's deck in 1865: men in coats and bowler hats pass the hauled-up Atlantic cable through their hands, looking for the fault",
    crop: { left: 44, top: 44, right: 44, bottom: 52 },
    widths: [1200, 2000, 2800],
  },
  {
    name: "cable-fleet-at-sea",
    imageUrl: "https://images.metmuseum.org/CRDImages/dp/original/DP801239.jpg",
    pageUrl: "https://www.metmuseum.org/art/collection/search/364369",
    title: "Telegraph Cable Fleet at Sea, 1865",
    date: "1865-66",
    alt: "Watercolour of the Great Eastern under steam and sail in a rough sea in 1865, two escort ships behind her and a red buoy marking the cable",
    crop: { left: 72, top: 40, right: 44, bottom: 40 },
    widths: [1200, 2000, 2800],
  },
];
const CREATOR = "Robert Charles Dudley";
const LICENCE = { name: "Public domain (CC0)", url: "https://creativecommons.org/publicdomain/zero/1.0/" };

/** The original from the cache, downloaded first when it is missing. */
async function readOriginal(piece: ArchivePiece): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
  const path = `${CACHE_FOLDER}/${piece.name}.jpg`;
  if (existsSync(path)) return { ok: true, path };
  const response = await fetch(piece.imageUrl, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) return { ok: false, reason: `HTTP ${response.status} for ${piece.imageUrl}` };
  writeFileSync(path, Buffer.from(await response.arrayBuffer()));
  return { ok: true, path };
}

type ManifestEntry = { width: number; height: number; widths: number[] };

async function buildPiece(piece: ArchivePiece, originalPath: string): Promise<ManifestEntry> {
  const metadata = await sharp(originalPath).metadata();
  const width = (metadata.width ?? 0) - piece.crop.left - piece.crop.right;
  const height = (metadata.height ?? 0) - piece.crop.top - piece.crop.bottom;
  const cropped = sharp(originalPath).extract({ left: piece.crop.left, top: piece.crop.top, width, height });
  for (const outputWidth of piece.widths) {
    const resized = cropped.clone().resize({ width: outputWidth });
    await resized.clone().avif({ quality: 50, effort: 6 }).toFile(`${OUTPUT_FOLDER}/${piece.name}-${outputWidth}.avif`);
    await resized.clone().webp({ quality: 72, effort: 6 }).toFile(`${OUTPUT_FOLDER}/${piece.name}-${outputWidth}.webp`);
  }
  return { width, height, widths: piece.widths };
}

mkdirSync(CACHE_FOLDER, { recursive: true });
mkdirSync(OUTPUT_FOLDER, { recursive: true });
const entries: string[] = [];
for (const piece of PIECES) {
  const original = await readOriginal(piece);
  if (!original.ok) {
    console.error(`[buildArchiveArt] ${piece.name}: ${original.reason}`);
    process.exit(1);
  }
  const entry = await buildPiece(piece, original.path);
  console.log(`[buildArchiveArt] ${piece.name} ${entry.width} x ${entry.height}`);
  entries.push(`  ${JSON.stringify(piece.name)}: ${JSON.stringify({
    width: entry.width,
    height: entry.height,
    widths: entry.widths,
    title: piece.title,
    creator: CREATOR,
    date: piece.date,
    alt: piece.alt,
    pageUrl: piece.pageUrl,
    licence: LICENCE,
  })},`);
}
const manifestSource = `// Written by scripts/art/build-archive-art.ts; do not edit by hand. Sizes are the cropped original's, in px.
export type ArchiveArtName = ${PIECES.map((piece) => JSON.stringify(piece.name)).join(" | ")};

export type ArchiveArt = {
  width: number;
  height: number;
  widths: readonly number[];
  title: string;
  creator: string;
  date: string;
  alt: string;
  pageUrl: string;
  licence: { name: string; url: string };
};

/** Files at /landing/archive/<name>-<width>.avif and .webp. */
export const ARCHIVE_ART: Readonly<Record<ArchiveArtName, ArchiveArt>> = {
${entries.join("\n")}
};
`;
writeFileSync(MANIFEST_PATH, manifestSource);
console.log(`[buildArchiveArt] wrote ${MANIFEST_PATH}`);
