import { describe, expect, test } from "bun:test";
import { readZipEntries } from "./zip-entries";

// Test fixture only: a one-entry ZIP (APPNOTE.TXT 4.3.7, 4.3.12, 4.3.16) whose directory declares `declaredBytes`
// as the entry's uncompressed size, whatever the deflated data really holds. The reader does not check CRCs.
async function buildZip(name: string, content: Uint8Array, declaredBytes: number): Promise<Uint8Array> {
  const compressed = new Uint8Array(await new Response(new Blob([content.slice()]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
  const nameBytes = new TextEncoder().encode(name);
  const localHeader = new DataView(new ArrayBuffer(30));
  localHeader.setUint32(0, 0x04034b50, true);
  localHeader.setUint16(8, 8, true);
  localHeader.setUint32(18, compressed.length, true);
  localHeader.setUint32(22, declaredBytes, true);
  localHeader.setUint16(26, nameBytes.length, true);
  const directoryOffset = 30 + nameBytes.length + compressed.length;
  const directoryEntry = new DataView(new ArrayBuffer(46));
  directoryEntry.setUint32(0, 0x02014b50, true);
  directoryEntry.setUint16(10, 8, true);
  directoryEntry.setUint32(20, compressed.length, true);
  directoryEntry.setUint32(24, declaredBytes, true);
  directoryEntry.setUint16(28, nameBytes.length, true);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, 1, true);
  end.setUint16(10, 1, true);
  end.setUint32(12, 46 + nameBytes.length, true);
  end.setUint32(16, directoryOffset, true);
  const parts = [new Uint8Array(localHeader.buffer), nameBytes, compressed, new Uint8Array(directoryEntry.buffer), nameBytes, new Uint8Array(end.buffer)];
  const archive = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    archive.set(part, offset);
    offset += part.length;
  }
  return archive;
}

describe("readZipEntries", () => {
  const content = new TextEncoder().encode("<Unavailability_MarketDocument/>".repeat(200));

  test("reads a deflated entry of the size it declares", async () => {
    const entries = await readZipEntries(await buildZip("outage.xml", content, content.length));
    expect(entries.ok && entries.value[0]?.bytes.length).toBe(content.length);
  });

  test("stops an entry that inflates past the size it declares", async () => {
    const entries = await readZipEntries(await buildZip("outage.xml", content, 100));
    expect(entries).toEqual({ ok: false, reason: "a ZIP entry inflates past the 100 bytes it declares" });
  });
});
