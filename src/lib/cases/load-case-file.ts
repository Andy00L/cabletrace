import { cacheLife } from "next/cache";
import { findCableCase } from "@/data/cases";
import { buildCaseFileExport, type CaseFileExport } from "@/lib/cases/case-export";

/**
 * The downloadable file of one case, built once at build time. Cached because Next counts the Web Crypto hash as
 * work it cannot prerender otherwise; the case is fixed data, so the file never changes until the next deploy.
 */
export async function loadCaseFileExport(slug: string): Promise<CaseFileExport | null> {
  "use cache";
  cacheLife("max");
  const cableCase = findCableCase(slug);
  return cableCase ? buildCaseFileExport(cableCase) : null;
}
