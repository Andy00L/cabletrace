import type { Result } from "../../../src/lib/result";
import type { RgbaImage } from "../png";

// Decodes a JPEG photograph into RGBA pixels at a given width with ffmpeg (already on the machine for the demo video
// work), so the photo match needs no image library (docs/LOOKDEV.md, "Why no image library").

/** The photograph scaled to `width` pixels wide (height in proportion), or why it could not be read. */
export async function loadPhoto(photoPath: string, width: number): Promise<Result<RgbaImage>> {
  const ffmpeg = Bun.spawn(["ffmpeg", "-loglevel", "error", "-i", photoPath, "-vf", `scale=${width}:-2:flags=area`, "-f", "rawvideo", "-pix_fmt", "rgba", "-"], { stdout: "pipe", stderr: "pipe" });
  const [pixels, errorText, exitCode] = await Promise.all([new Response(ffmpeg.stdout).arrayBuffer(), new Response(ffmpeg.stderr).text(), ffmpeg.exited]);
  if (exitCode !== 0) return { ok: false, reason: `ffmpeg could not read ${photoPath}: ${errorText.trim()}` };
  const data = new Uint8Array(pixels);
  const height = data.length / (width * 4);
  if (!Number.isInteger(height) || height === 0) return { ok: false, reason: `ffmpeg returned ${data.length} bytes, not whole rows of ${width} px` };
  return { ok: true, value: { width, height, data } };
}
