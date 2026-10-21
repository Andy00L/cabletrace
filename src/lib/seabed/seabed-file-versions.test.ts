import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { measureSeabedFileVersions, SEABED_FILE_VERSIONS_PATH, writeSeabedFileVersionsModule } from "../../../scripts/seabed/seabed-file-versions";

test("every seabed file's URL version matches its content (else run bun scripts/seabed/build-seabed-file-versions.ts)", () => {
  const expected = writeSeabedFileVersionsModule(measureSeabedFileVersions());
  expect(readFileSync(SEABED_FILE_VERSIONS_PATH, "utf8")).toBe(expected);
});
