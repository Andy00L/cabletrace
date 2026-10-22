// Builds the landing's archival pictures: four of Robert Charles Dudley's watercolours of the 1865 and 1866 Atlantic
// cable expeditions, public domain (CC0) at The Metropolitan Museum of Art. Each original is downloaded once into
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
  /** The title a caption on the page shows, when the Met's full title is too long to sit under a picture; /credits keeps the full one. */
  shortTitle?: string;
  date: string;
  /** What the picture shows, for its alt text. */
  alt: string;
  crop: Crop;
  widths: number[];
};

const CACHE_FOLDER = ".scratch/archive-art";
const OUTPUT_FOLDER = "public/landing/archive";
const MANIFEST_PATH = "src/lib/landing/archive-art.ts";
// Pixels cut from each edge of the originals: the scan's dark frame, measured on the deck scene on 21 Oct 2026 and on
// the others on 22 Oct 2026 (mean brightness per row and column, 40 to 45 px of frame, plus a margin); the night
// scene sits on a cream mount with brushed edges, 60 to 95 px wide, so it loses more.
const PIECES: ArchivePiece[] = [
  {
    name: "great-eastern-under-weigh",
    imageUrl: "https://images.metmuseum.org/CRDImages/dp/original/DP801255.jpg",
    pageUrl: "https://www.metmuseum.org/art/collection/search/383821",
    title: "The Great Eastern Under Weigh, July 23rd, 1865: Escort and other Ships, H.M.S. Terrible, H.M.S. Sphinx, The Hawk and Revised: The Caroline",
    shortTitle: "The Great Eastern Under Weigh, July 23rd, 1865",
    date: "1865-66",
    alt: "Watercolour of the Great Eastern under steam on 23 July 1865, smoke trailing from her funnels under a gold evening sky, her escort ships around her on a rolling sea",
    crop: { left: 48, top: 48, right: 40, bottom: 60 },
    widths: [1200, 2000, 2800],
  },
  {
    name: "preparing-to-grapple",
    imageUrl: "https://images.metmuseum.org/CRDImages/dp/original/DP801245.jpg",
    pageUrl: "https://www.metmuseum.org/art/collection/search/383827",
    title: "In the Bows of the Great Eastern: The Cable Broken and Lost, Preparing to Grapple, August 2nd, 1865",
    date: "1865",
    alt: "Watercolour of the Great Eastern's bow on 2 August 1865, after the Atlantic cable broke: a grapnel hangs from the bow, the crew crowd the deck and rigging, and red buoys are swung out over the side",
    crop: { left: 52, top: 52, right: 52, bottom: 56 },
    widths: [1200, 2000],
  },
  {
    name: "albany-at-night",
    imageUrl: "https://images.metmuseum.org/CRDImages/dp/original/DP801236.jpg",
    pageUrl: "https://www.metmuseum.org/art/collection/search/364364",
    title: "The Albany Buoying a Bight of the Cable of 1865 on the Night of August 26th, 1866",
    date: "1866",
    alt: "Watercolour of the Albany at night on 26 August 1866, pitching in a heavy sea under a clouded moon, a line running from her bow into the water",
    crop: { left: 120, top: 140, right: 140, bottom: 120 },
    widths: [1200, 2000, 2800],
  },
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
    shortTitle: piece.shortTitle ?? piece.title,
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
  shortTitle: string;
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
