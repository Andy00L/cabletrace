import type { Result } from "@/lib/result";

/** Downloads and parses one of the globe's static files (public/globe/); never throws. */
export async function fetchStaticJson(url: string): Promise<Result<unknown>> {
  try {
    const response = await fetch(url);
    if (!response.ok) return { ok: false, reason: `${url} answered ${response.status}` };
    return { ok: true, value: await response.json() };
  } catch (error) {
    return { ok: false, reason: `${url} unreachable: ${error instanceof Error ? error.message : String(error)}` };
  }
}
