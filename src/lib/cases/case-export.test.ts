import { describe, expect, test } from "bun:test";
import { EAGLE_S_2024 } from "@/data/cases/eagle-s-2024";
import { buildCaseFileExport, sha256Hex, toCanonicalJson, verifyCaseFileExport } from "./case-export";

describe("toCanonicalJson", () => {
  test("sorts keys at every level, so key order never changes the bytes", () => {
    expect(toCanonicalJson({ b: 1, a: { d: [3, { f: true, e: null }], c: "x" } })).toBe('{"a":{"c":"x","d":[3,{"e":null,"f":true}]},"b":1}');
    expect(toCanonicalJson({ a: 1, b: 2 })).toBe(toCanonicalJson({ b: 2, a: 1 }));
  });

  test("leaves out undefined values as JSON does", () => {
    expect(toCanonicalJson({ a: undefined, b: [undefined] })).toBe('{"b":[null]}');
  });
});

describe("sha256Hex", () => {
  test("matches the FIPS 180-2 test vector for 'abc'", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("verifyCaseFileExport", () => {
  test("an exported case checks out after a JSON round trip with other formatting", async () => {
    const exported = await buildCaseFileExport(EAGLE_S_2024);
    const reread: unknown = JSON.parse(JSON.stringify(exported, null, 2));
    const check = await verifyCaseFileExport(reread);
    expect(check.ok && check.value.isIntact).toBe(true);
  });

  test("one added sentence in the summary breaks the hash", async () => {
    const exported = await buildCaseFileExport(EAGLE_S_2024);
    const tampered = { ...exported, case: { ...exported.case, summary: `${exported.case.summary} Edited.` } };
    const check = await verifyCaseFileExport(tampered);
    expect(check.ok && check.value.isIntact).toBe(false);
  });

  test("a file of another format is refused", async () => {
    expect((await verifyCaseFileExport({ format: "something-else" })).ok).toBe(false);
  });
});
