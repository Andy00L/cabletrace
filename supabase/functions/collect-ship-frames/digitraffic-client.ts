// Fetches Fintraffic Digitraffic AIS data (CC BY 4.0, https://www.digitraffic.fi/en/marine-traffic/) for the frame
// collector and the near-cable recorder (supabase/functions/record-vessel-positions), which both import this file.
import type { Result } from "../../../src/lib/result.ts";

const LOCATIONS_URL = "https://meri.digitraffic.fi/api/ais/v1/locations";
const VESSELS_URL = "https://meri.digitraffic.fi/api/ais/v1/vessels";
// Digitraffic asks every client to identify itself with this header (value shared with the recorder).
const DIGITRAFFIC_USER = "CableTrace/0.1 (github.com/Andy00L/cabletrace)";
const FETCH_TIMEOUT_MS = 15_000;

async function fetchDigitrafficJson(url: string): Promise<Result<unknown>> {
  try {
    const response = await fetch(url, {
      headers: { "Accept-Encoding": "gzip", "Digitraffic-User": DIGITRAFFIC_USER },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return { ok: false, reason: `Digitraffic answered ${response.status} for ${url}` };
    }
    const text = await response.text();
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch {
      return { ok: false, reason: `Digitraffic sent invalid JSON for ${url}` };
    }
  } catch (error) {
    return { ok: false, reason: `Digitraffic unreachable for ${url}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Latest position of every vessel Digitraffic heard since `sinceMs` (GeoJSON, about 400 KB for 1,000 ships). */
export function fetchDigitrafficLocations(sinceMs: number): Promise<Result<unknown>> {
  return fetchDigitrafficJson(`${LOCATIONS_URL}?from=${Math.floor(sinceMs)}`);
}

/**
 * Metadata (name, type, size) of every vessel Digitraffic knows: about 900 entries, 45 KB gzip on the wire. With
 * `sinceMs`, only the entries updated since then (the near-cable recorder refreshes hourly that way).
 */
export function fetchDigitrafficVessels(sinceMs: number | null = null): Promise<Result<unknown>> {
  return fetchDigitrafficJson(sinceMs === null ? VESSELS_URL : `${VESSELS_URL}?from=${Math.floor(sinceMs)}`);
}
