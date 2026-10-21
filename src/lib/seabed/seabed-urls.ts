import type { SeabedFileUrls } from "@/lib/seabed/seabed-data";
import { SEABED_FILE_VERSIONS } from "@/lib/seabed/seabed-file-versions";

// URLs of public/seabed's files with their content version (seabed-file-versions.ts), so the browser may keep them a
// year without asking again (next.config.ts, /seabed/:path*) and a changed file still arrives under a new URL. The
// terrain worker never imports this module (its bundle's own hash is listed here): the page hands it the URLs.

/** `/seabed/<name>?v=<version>`, or the bare path for a file without a version (a file the build has not seen). */
export function readSeabedFileUrl(name: string): string {
  const version = SEABED_FILE_VERSIONS[name];
  return version ? `/seabed/${name}?v=${version}` : `/seabed/${name}`;
}

/** The versioned URLs of an area's features and depth grid. */
export function readSeabedFileUrls(area: string): SeabedFileUrls {
  return { features: readSeabedFileUrl(`${area}-seabed.json`), terrain: readSeabedFileUrl(`${area}-terrain.bin`) };
}
