// Encodes one crop's frames into the files replay-footage.ts names: an H.264 MP4 and an AV1 WebM, each at
// the lowest CRF that keeps it under its budget, and the posters (AVIF and WebP) from the very frame the video starts
// on, so nothing jumps when playback starts.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import type { FootageCrop, FootageFile, ReplayFootage } from "../../src/lib/landing/replay-footage";
import type { Result } from "../../src/lib/result";
import { findFramePath } from "./capture-replay";

/** A written file, its size and its budget (null: none set), with what a reader of the report needs to know. */
export type EncodedFile = { sitePath: string; bytes: number; budgetBytes: number | null; note: string };

// Budgets in bytes (1 MB = 1,000,000 bytes), from the footage brief of 21 Oct 2026: desktop MP4 3.0 MB, desktop WebM
// 2.2 MB, phone MP4 1.6 MB. The brief sets none for the phone WebM: it is held to the phone MP4's.
const BUDGET_BYTES: Readonly<Record<FootageCrop, Readonly<Record<"mp4" | "webm", number>>>> = {
  desktop: { mp4: 3_000_000, webm: 2_200_000 },
  phone: { mp4: 1_600_000, webm: 1_600_000 },
};
// The CRF ranges searched: the low end is as fine as the picture needs (x264 18 and SVT-AV1 26 hold the 1 px cables
// and the labels' text), the high end where the text starts to smear.
const CRF_RANGES: Readonly<Record<"mp4" | "webm", { lowest: number; highest: number }>> = {
  mp4: { lowest: 18, highest: 38 },
  webm: { lowest: 26, highest: 55 },
};
// Encoder speeds: x264 `slow` and SVT-AV1 preset 6. With `veryslow` one CRF search of the 645 desktop frames took
// about 10 minutes on this machine's 4 cores (21 Oct 2026), and SVT-AV1 preset 4 was slower still.
// A keyframe every 2 s, so the page's seek to an event decodes at most 2 s of frames.
const KEYFRAME_INTERVAL_FRAMES = 60;
// Poster qualities, as the landing art's (scripts/art/build-landing-art.ts) with a little more for the fine lines.
const POSTER_AVIF_QUALITY = 60;
const POSTER_WEBP_QUALITY = 82;

// sRGB screenshots to BT.709 limited-range YUV, tagged so browsers convert them back with the same matrix.
const COLOR_ARGUMENTS = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"];

function buildVideoArguments(input: { container: "mp4" | "webm"; crf: number; framesPattern: string; framesPerSecond: number; file: FootageFile; outputPath: string }): string[] {
  const { container, crf, framesPattern, framesPerSecond, file, outputPath } = input;
  const filter = `crop=${file.width}:${file.height}:0:0,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p`;
  const codec =
    container === "mp4"
      ? ["-c:v", "libx264", "-preset", "slow", "-profile:v", "high", "-crf", String(crf), "-movflags", "+faststart", "-tag:v", "avc1"]
      : ["-c:v", "libsvtav1", "-preset", "6", "-crf", String(crf)];
  return ["-loglevel", "error", "-y", "-framerate", String(framesPerSecond), "-i", framesPattern, "-vf", filter, ...codec, "-g", String(KEYFRAME_INTERVAL_FRAMES), ...COLOR_ARGUMENTS, "-an", outputPath];
}

/** Encodes at one CRF; the file's size in bytes. */
function encodeAtCrf(argumentsList: string[], outputPath: string): Result<number> {
  const encoded = spawnSync("ffmpeg", argumentsList, { encoding: "utf8" });
  if (encoded.status !== 0) return { ok: false, reason: `ffmpeg failed on ${outputPath}: ${encoded.stderr.trim()}` };
  return { ok: true, value: statSync(outputPath).size };
}

/**
 * The lowest CRF in the range whose file fits the budget (bisection: a higher CRF is a smaller file). Each try is
 * written to `triesDirectory` and the chosen one copied to the output, so no CRF is encoded twice. When even the
 * range's highest CRF is over the budget, that file is written and the caller reports it over.
 */
function encodeWithinBudget(input: { container: "mp4" | "webm"; budgetBytes: number; framesPattern: string; framesPerSecond: number; file: FootageFile; outputPath: string; triesDirectory: string }): Result<{ crf: number; bytes: number }> {
  const { container, budgetBytes, outputPath, triesDirectory } = input;
  const range = CRF_RANGES[container];
  const findTryPath = (crf: number) => path.join(triesDirectory, `${path.parse(outputPath).name}-crf${crf}.${container}`);
  const encodeCrf = (crf: number) => encodeAtCrf(buildVideoArguments({ ...input, crf, outputPath: findTryPath(crf) }), findTryPath(crf));
  mkdirSync(triesDirectory, { recursive: true });
  let lowCrf = range.lowest;
  let highCrf = range.highest;
  const highest = encodeCrf(highCrf);
  if (!highest.ok) return highest;
  let best = { crf: highCrf, bytes: highest.value };
  if (highest.value <= budgetBytes) {
    while (lowCrf < highCrf) {
      const middleCrf = Math.floor((lowCrf + highCrf) / 2);
      const middle = encodeCrf(middleCrf);
      if (!middle.ok) return middle;
      if (middle.value <= budgetBytes) {
        best = { crf: middleCrf, bytes: middle.value };
        highCrf = middleCrf;
      } else {
        lowCrf = middleCrf + 1;
      }
    }
  }
  copyFileSync(findTryPath(best.crf), outputPath);
  rmSync(triesDirectory, { recursive: true, force: true });
  return { ok: true, value: best };
}

/** PSNR (dB) of the video's first decoded frame against the poster's source frame: the two must look the same. */
function measureFirstFramePsnr(videoPath: string, posterSourcePath: string, file: FootageFile): number | null {
  const filter = `[0:v]trim=end_frame=1,format=yuv420p[first];[1:v]crop=${file.width}:${file.height}:0:0,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[poster];[first][poster]psnr`;
  const measured = spawnSync("ffmpeg", ["-hide_banner", "-i", videoPath, "-i", posterSourcePath, "-lavfi", filter, "-f", "null", "-"], { encoding: "utf8" });
  const match = /average:([\d.]+|inf)/.exec(measured.stderr);
  if (!match?.[1]) return null;
  return match[1] === "inf" ? Number.POSITIVE_INFINITY : Number(match[1]);
}

/** Where a site path ("/landing/...") lives on disk. */
export function toPublicPath(publicDirectory: string, sitePath: string): string {
  return path.join(publicDirectory, ...sitePath.split("/").filter((segment) => segment.length > 0));
}

/** Writes an image's AVIF and WebP from a PNG, cut to `width` x `height` from its top left and resized to `outputWidth`. */
export async function writeImagePair(input: { sourcePath: string; width: number; height: number; outputWidth: number; avifPath: string; webpPath: string }): Promise<{ avifBytes: number; webpBytes: number }> {
  const { sourcePath, width, height, outputWidth, avifPath, webpPath } = input;
  mkdirSync(path.dirname(avifPath), { recursive: true });
  const cropped = sharp(sourcePath).extract({ left: 0, top: 0, width, height }).resize({ width: outputWidth, kernel: "lanczos3" });
  await cropped.clone().avif({ quality: POSTER_AVIF_QUALITY, effort: 6 }).toFile(avifPath);
  await cropped.clone().webp({ quality: POSTER_WEBP_QUALITY, effort: 6 }).toFile(webpPath);
  return { avifBytes: statSync(avifPath).size, webpBytes: statSync(webpPath).size };
}

/** Encodes a crop's MP4 and WebM and writes its posters. */
export async function encodeCrop(input: { footage: ReplayFootage; crop: FootageCrop; framesDirectory: string; publicDirectory: string }): Promise<Result<EncodedFile[]>> {
  const { footage, crop, framesDirectory, publicDirectory } = input;
  const file: FootageFile = footage.files[crop];
  const framesPattern = path.join(framesDirectory, "frame-%05d.png");
  const posterSourcePath = findFramePath(framesDirectory, 0);
  const triesDirectory = path.join(framesDirectory, "encode-tries");
  const written: EncodedFile[] = [];
  for (const container of ["mp4", "webm"] as const) {
    const sitePath = file[container];
    const outputPath = toPublicPath(publicDirectory, sitePath);
    mkdirSync(path.dirname(outputPath), { recursive: true });
    rmSync(outputPath, { force: true });
    const budgetBytes = BUDGET_BYTES[crop][container];
    console.log(`[encodeCrop] ${crop} ${container}: searching the CRF for ${(budgetBytes / 1_000_000).toFixed(1)} MB`);
    const encoded = encodeWithinBudget({ container, budgetBytes, framesPattern, framesPerSecond: footage.framesPerSecond, file, outputPath, triesDirectory });
    if (!encoded.ok) return encoded;
    const psnr = measureFirstFramePsnr(outputPath, posterSourcePath, file);
    written.push({ sitePath, bytes: encoded.value.bytes, budgetBytes, note: `CRF ${encoded.value.crf}, first frame against the poster's frame ${psnr === null ? "not measured" : `${psnr.toFixed(1)} dB PSNR`}` });
  }
  const posters = await writeImagePair({ sourcePath: posterSourcePath, width: file.width, height: file.height, outputWidth: file.width, avifPath: toPublicPath(publicDirectory, file.posterAvif), webpPath: toPublicPath(publicDirectory, file.posterWebp) });
  written.push({ sitePath: file.posterAvif, bytes: posters.avifBytes, budgetBytes: null, note: "frame 0" });
  written.push({ sitePath: file.posterWebp, bytes: posters.webpBytes, budgetBytes: null, note: "frame 0" });
  return { ok: true, value: written };
}
