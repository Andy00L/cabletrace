import { describe, expect, test } from "bun:test";
import { gunzipBytes, gzipBytes } from "./frame-compression";

describe("gzipBytes and gunzipBytes", () => {
  test("round-trip bytes into one buffer that starts at offset 0", async () => {
    const original = new Uint8Array(200_000).map((_unused, byteIndex) => (byteIndex * 7) % 251);
    const compressed = await gzipBytes(original);
    expect(compressed.ok).toBe(true);
    if (!compressed.ok) return;
    const restored = await gunzipBytes(compressed.value);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.value).toEqual(original);
    expect(restored.value.byteOffset).toBe(0);
  });

  test("stop at the size cap and report corrupt input", async () => {
    const compressed = await gzipBytes(new Uint8Array(100_000));
    if (!compressed.ok) throw new Error(compressed.reason);
    expect(await gunzipBytes(compressed.value, 1_000)).toEqual({ ok: false, reason: "gunzip output passed 1000 bytes" });
    const corrupt = await gunzipBytes(new TextEncoder().encode("<html>not gzip</html>"));
    expect(corrupt.ok).toBe(false);
    expect(!corrupt.ok && corrupt.reason.startsWith("gunzip failed")).toBe(true);
  });
});
