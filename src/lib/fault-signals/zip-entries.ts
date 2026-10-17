import type { Result } from "@/lib/result";

// A small ZIP reader for the ENTSO-E outage answers, which come as a ZIP of XML documents ("A maximum of 200 XML
// documents contained in the ZIP response", ENTSO-E Transparency Platform RESTful API collection, read 17 Oct 2026).
// Reads the central directory (APPNOTE.TXT 4.3.12 to 4.3.16), so entries written with a trailing data descriptor
// still have their sizes. Stored and deflated entries only; ZIP64 archives are refused. Inflating uses the
// DecompressionStream global that Deno, Bun and browsers share, so this file needs no runtime import.

export type ZipEntry = { name: string; bytes: Uint8Array };

const END_OF_DIRECTORY_SIGNATURE = 0x06054b50;
const DIRECTORY_ENTRY_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const END_OF_DIRECTORY_SIZE = 22;
const MAX_COMMENT_SIZE = 0xffff;
const ZIP64_MARKER = 0xffffffff;
const METHOD_STORED = 0;
const METHOD_DEFLATED = 8;
// The answer is at most 200 XML outage documents; anything past this is not an ENTSO-E answer.
const MAX_ENTRY_COUNT = 1000;
const MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;

/** Whether the bytes start like a ZIP archive ("PK\x03\x04"). */
export function isZipArchive(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true) === LOCAL_HEADER_SIGNATURE;
}

function findEndOfDirectory(view: DataView): number | null {
  const lowestStart = Math.max(0, view.byteLength - END_OF_DIRECTORY_SIZE - MAX_COMMENT_SIZE);
  for (let offset = view.byteLength - END_OF_DIRECTORY_SIZE; offset >= lowestStart; offset -= 1) {
    if (view.getUint32(offset, true) === END_OF_DIRECTORY_SIGNATURE) return offset;
  }
  return null;
}

/**
 * Inflates one entry, stopping as soon as the output passes `declaredBytes`: the 50 MB cap trusts the sizes the
 * directory declares, so an entry that lies about its size must not inflate past it (security re-review, 17 Oct 2026).
 */
async function inflateRaw(compressed: Uint8Array, declaredBytes: number): Promise<Result<Uint8Array>> {
  try {
    const reader = new Blob([compressed.slice()]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
    const chunks: Uint8Array[] = [];
    let inflatedBytes = 0;
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      inflatedBytes += chunk.value.length;
      if (inflatedBytes > declaredBytes) {
        await reader.cancel();
        return { ok: false, reason: `a ZIP entry inflates past the ${declaredBytes} bytes it declares` };
      }
      chunks.push(chunk.value);
    }
    const inflated = new Uint8Array(inflatedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      inflated.set(chunk, offset);
      offset += chunk.length;
    }
    return { ok: true, value: inflated };
  } catch (error) {
    return { ok: false, reason: `a ZIP entry does not inflate: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Every file of the archive with its content; one unreadable entry fails the whole archive. */
export async function readZipEntries(bytes: Uint8Array): Promise<Result<ZipEntry[]>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.byteLength < END_OF_DIRECTORY_SIZE) return { ok: false, reason: "too short to be a ZIP archive" };
  const endOffset = findEndOfDirectory(view);
  if (endOffset === null) return { ok: false, reason: "no ZIP end of central directory" };
  const entryCount = view.getUint16(endOffset + 10, true);
  const directoryOffset = view.getUint32(endOffset + 16, true);
  if (entryCount > MAX_ENTRY_COUNT) return { ok: false, reason: `${entryCount} ZIP entries, more than ${MAX_ENTRY_COUNT}` };
  if (directoryOffset === ZIP64_MARKER) return { ok: false, reason: "ZIP64 archives are not read" };
  const nameDecoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  let totalBytes = 0;
  let cursor = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > view.byteLength || view.getUint32(cursor, true) !== DIRECTORY_ENTRY_SIGNATURE) return { ok: false, reason: "a malformed ZIP directory entry" };
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = nameDecoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    cursor += 46 + nameLength + extraLength + commentLength;
    if (compressedSize === ZIP64_MARKER || uncompressedSize === ZIP64_MARKER || localOffset === ZIP64_MARKER) return { ok: false, reason: "ZIP64 archives are not read" };
    totalBytes += uncompressedSize;
    if (totalBytes > MAX_UNCOMPRESSED_BYTES) return { ok: false, reason: `the ZIP holds more than ${MAX_UNCOMPRESSED_BYTES} bytes` };
    if (localOffset + 30 > view.byteLength || view.getUint32(localOffset, true) !== LOCAL_HEADER_SIGNATURE) return { ok: false, reason: `ZIP entry ${name} has no local header` };
    const dataStart = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    if (compressed.length !== compressedSize) return { ok: false, reason: `ZIP entry ${name} is cut short` };
    if (method === METHOD_STORED) {
      entries.push({ name, bytes: compressed.slice() });
      continue;
    }
    if (method !== METHOD_DEFLATED) return { ok: false, reason: `ZIP entry ${name} uses compression method ${method}` };
    const inflated = await inflateRaw(compressed, uncompressedSize);
    if (!inflated.ok) return inflated;
    if (inflated.value.length !== uncompressedSize) return { ok: false, reason: `ZIP entry ${name} inflates to the wrong size` };
    entries.push({ name, bytes: inflated.value });
  }
  return { ok: true, value: entries };
}
