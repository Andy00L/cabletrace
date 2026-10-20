// Starts loading a case's seabed area before the reader opens the case, so the replay's first 3D frame does not wait
// for the area's files on the click (Andy's target, 20 Oct 2026: a replay usable within 1 s of the click). The loader
// lives behind a dynamic import, so pages that only link to cases (the case list, the globe) carry none of it until
// a reader shows intent. Warming twice is free: warmSeabedArea starts one worker per area per page.

/** Starts fetching and decoding `area` in its worker; never throws (a failed warm-up only means a cold open). */
export function warmCaseArea(area: string): void {
  import("@/lib/seabed/scene/seabed-scene-load")
    .then((module) => module.warmSeabedArea(area))
    .catch((error: unknown) => console.warn(`[warmCaseArea] ${area}: ${error instanceof Error ? error.message : String(error)}`));
}
