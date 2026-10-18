# Performance

How fast CableTrace loads and draws, how to measure it again, and what is left to do. Numbers are lab numbers from one
WSL2 machine (8 cores) in headless Chrome for Testing 156 (Playwright cache build 1248), recorded on 2026-10-17.

## Measure

```bash
bun run build && PORT=3200 bun run start      # local production build
bun run perf http://localhost:3200             # or: bun run perf https://cabletrace.vercel.app
bun run perf <url> --runs 9 --chromium /path/to/chrome
bun run perf <url> --profile 3g-phone          # a phone on 3G (section "Phones on 3G")
```

`scripts/perf/measure-pages.ts` loads `/` and `/diagnostics` once per run in a fresh browser context (cold HTTP
cache), 1440 x 900 viewport, no network or CPU throttling, and fetches `/api/health` from Bun. Pages alternate inside
each run so warm-up and drift favor neither. It prints the median and the min-max range per metric, then the budget
table, and exits 0 (all budgets met), 1 (a budget broken) or 2 (could not measure).

| Metric | Source |
| --- | --- |
| TTFB, FCP | Navigation Timing `responseStart`, paint entry `first-contentful-paint` |
| LCP | last `largest-contentful-paint` entry after the page settles |
| CLS | `layout-shift` entries without recent input, largest session window (1 s gap, 5 s cap) |
| JS, CSS, font KB | encoded (compressed) response bodies, headers excluded. Chromium reports 0 bytes for MapLibre's worker script, so the tool fetches that one again with `decompress: false` and counts it |
| Long tasks | `longtask` entries: count and longest |
| Streamed and client parts | a MutationObserver injected before page scripts marks the first time each `[data-testid][data-state]` element reaches a state (`recorder-status`, `map-probe` rendered, `scene-probe` measured) |

Headless Chromium has no GPU here: WebGL runs on SwiftShader (on the CPU). Every 3D number below is a slow-machine
bound, not what a laptop with a graphics card sees. The same holds for headless test runners such as TestSprite.

Other processes on the machine move the numbers. Check `uptime` first; a load average above 2 inflates the 3D figures.

**Playwright is a devDependency** (`playwright` 1.58.2, exact). The tool has to drive a real browser to read paint,
layout-shift and long-task entries, and resolving Playwright from a gitignored folder would not be repeatable. It is
dev only and adds nothing to any page bundle. `bun install` does not download a browser: the tool uses Playwright's own
Chromium build when installed (`bunx playwright install chromium`), otherwise the newest `chromium-*` build in
`~/.cache/ms-playwright`, otherwise `--chromium` or `PERF_CHROMIUM_PATH`.

## Budgets

Desktop, broadband. The tool enforces them.

| Budget | Limit |
| --- | --- |
| LCP on `/` and `/diagnostics` | under 1,500 ms |
| CLS on `/` and `/diagnostics` | under 0.05 |
| JS on `/` | under 200 KB compressed |
| 3D probe measured on `/diagnostics` (SwiftShader) | under 6,000 ms |
| Errors | no failed request, no 4xx or 5xx, no page error, `/api/health` answers 200 |

## Results

Median (min-max) of 5 runs. Times in ms from navigation start.

### Local production build (`next start`, gzip)

Before: commit `eb55e09`, load average 1.0. After: this change, load average under 2 for the page runs.

| Metric | Before | After |
| --- | --- | --- |
| `/` TTFB / FCP / LCP | 7 / 60 (60-76) / 60 (60-76) | 6 / 76 (56-84) / 76 (56-84) |
| `/` CLS | 0.000 | 0.000 |
| `/` JS / CSS / font KB | 143.0 / 14.7 / 68.3 | 143.3 / 14.7 / 68.3 |
| `/` live recorder card streamed | not measured yet | 129 (117-421) |
| `/diagnostics` FCP / LCP | 72 (64-96) | 64 (60-96) |
| `/diagnostics` JS KB (MapLibre 287, three.js 185, worker 141) | 746.8 | 747.0 |
| `/diagnostics` long tasks / longest | 5 (5-8) / 154 (149-165) | 4 (4-5) / 123 (91-131) |
| Map probe rendered | 791 (769-821) | 584 (565-591) |
| 3D probe measured | 5,661 (5,522-6,662) | **4,157 (4,149-4,231)** |
| 3D average frame (SwiftShader) | 29.3 to 35.7 | 31.4 to 32.6 |
| `/api/health` TTFB | 142 (134-265) | 206 (141-295) |

The home FCP difference is inside run-to-run noise: an interleaved run (below) puts the original build at 140 and
this change at 116. `/api/health` runs the same code before and after; its spread is Supabase.

### Interleaved before and after, under load

The lead's browser work pushed the load average from 2.8 to 10.8 during this run, so both builds ran alternately on
ports 3201 (original) and 3200 (this change), one run each, five rounds.

| Metric (median of 5) | Original | This change |
| --- | --- | --- |
| 3D probe measured | 11,407 (6,334-13,614) | 4,394 (4,342-4,789) |
| Map probe rendered | 1,283 (806-2,115) | 838 (752-1,219) |
| `/diagnostics` long tasks / longest | 86 / 392 | 9 / 160 |
| `/` FCP | 140 (76-208) | 116 (68-124) |

On a slow or busy machine the original probe ran 180 frames at 60 to 75 ms each; the time cap keeps it near 4.4 s.

### Live site (https://cabletrace.vercel.app, brotli, edge yul1, function iad1)

The changes here are not deployed, so the live numbers are the "before" side. Run the tool against the pull request's
preview URL for the "after" side.

| Metric | Live |
| --- | --- |
| `/` TTFB / LCP / CLS | 38 (33-282) / 116 (96-376) / 0.000 |
| `/` JS / CSS / font KB | 147.8 / 15.0 / 68.6 |
| `/` live recorder card streamed (second run, load average up to 8) | 438 (325-1,244) |
| `/diagnostics` LCP / JS KB | 104 (96-264) / 622.7 |
| `/diagnostics` long tasks / longest | 6 (5-7) / 156 (148-172) |
| Map probe rendered | 921 (849-1,016) |
| 3D probe measured | **6,717 (6,412-7,047): over budget** |
| `/api/health` TTFB | 366 (159-452) |

## Changes

1. **3D probe finishes in 4.2 s instead of 5.7 to 6.7 s** (`src/components/diagnostics/SceneProbe.tsx`). Profiling
   showed the run length was 180 frames times the software frame time (about 31 ms on SwiftShader); startup was
   only about 250 ms. Timing now stops at 180 frames or 3.5 s, whichever comes first. A 60 Hz display still times 180
   frames in 3.0 s, so GPU results do not change. Two side fixes keep the figures clean:
   - Shaders compile with `renderer.compileAsync` before timing, so the first timed frame is no longer the compile.
     With `KHR_parallel_shader_compile` (most GPU browsers) the compile also leaves the main thread free; headless
     SwiftShader lacks the extension and compiles in place.
   - Timing waits for the map probe to settle (5 s at most). With fewer frames, MapLibre's start-up tasks (50 to 90
     ms each) had pushed the slow-frame figure from 33.4 to 50.0 ms in all three profiled runs; with the wait it read
     33.4 ms in two of three. The map also draws about 200 ms sooner, since the 3D loop no longer competes with it.
   - One untimed frame shows the seabed while it waits, and an unmount during the compile now frees the WebGL context.
   - Risk: on a slow renderer "Frames timed" now reads about 110, not 180. A test that asserts 180 would fail there.
2. **Font fallback matched to TikTok Sans** (`src/app/layout.tsx`). next/font has no metrics for TikTok Sans (the build
   warned "Failed to find font override values"), so the swap from the system font reflowed body text. On a 150 ms,
   1.6 Mbps network the font lands after first paint and shifted the layout by 0.011 to 0.020 per load. A
   `TikTok Sans Fallback` face on local Arial now carries `size-adjust: 104.34%`, measured in Chromium as TikTok Sans's
   average glyph width at the body setting (weight 400, optical size 16: 0.4761 em) against Arial's 0.4563 em, with
   Next's own sample string. The face file's default instance (weight 300, optical size 36) would have given 94.17%,
   which is why the numbers are measured rather than read from the file. This machine has no Arial, so the check ran
   with DejaVu Sans and its own measured adjustment standing in: the shift fell to 0.0002. Broadband loads were
   already at 0.000 and stay there.
3. **The measurement tool** (`scripts/perf/measure-pages.ts`, `bun run perf`).

## Checked and left as is

- `/` ships 143 KB of compressed JS, the Next.js and React baseline. Of it, 7 KB is the `/diagnostics` page chunk and
  10.5 KB of MapLibre CSS that Next prefetches because the link is on screen; both load at idle priority.
- The live recorder card streams 438 ms after navigation on Vercel against 129 ms locally. It is not on the LCP path
  (LCP is the intro paragraph from the static shell) and its placeholder keeps CLS at 0. Supabase sits behind
  Cloudflare, so moving the function from iad1 to an Oregon region would move the cross-country round trip between
  the edge and the function rather than remove it; no region change is recommended for a single read.
- `/vendor/maplibre-gl-worker.mjs` is served with `max-age=0` and an ETag, so repeat visits revalidate (one 304).
  Its name carries no version, so a long cache would risk a worker and library mismatch after an upgrade.
- `.next/static/media` holds copies of MapLibre's module, worker and dev builds (about 5 MB) that Turbopack emits from
  `new URL(..., import.meta.url)` patterns. No page requests them; they only add to the deployment size.

## For the lead: 3D replay

Reviewed read-only from a snapshot of the working tree at 01:19 (overview, close-up, viewer, terrain, data files).
Timings come from a scratch harness that bundled those files with Bun and ran the same steps as
`createSeabedViewer` in headless Chromium on SwiftShader, at a 1,200 x 700 stage, device pixel ratio 1, mid-drag with
the vessel, wake, anchor and plume on screen. The machine's load average sat between 2 and 12 during these runs, partly
from SwiftShader's own threads, so read them as ranges.

| Step | Measured |
| --- | --- |
| Bundle: three.js, addons and scene code | 685 KB minified, 182 KB gzip |
| `smoothElevations`, 1 pass over 625 x 481 | 10 to 25 ms |
| Terrain grid geometry and normals (part of `buildOverview`) | 120 to 194 ms |
| PMREM room environment (part of `buildOverview`) | 75 to 126 ms |
| `buildOverview` | 320 to 702 ms |
| `buildCloseUp` (both patches) | 209 to 431 ms |
| First overview render (compile, uploads, shadow map) | 546 to 1,170 ms |
| Overview frame, as written (antialias, PCF shadows 2,048) | 864 to 1,620 ms |
| Overview frame, no antialias, no shadows | 415 to 719 ms |
| Overview frame, no antialias, no shadows, half grid, pixel ratio 0.5 | about 117 ms (95th percentile) |
| Close-up frame, as written / cheap settings | 281 to 554 ms / 67 to 83 ms |
| Main thread during the overview loop | blocked by long tasks the whole time, in every variant |

Recommendations, highest gain first:

1. **Add a software-renderer tier and render on demand** (`src/lib/seabed/scene/viewer.ts`). On SwiftShader the overview
   draws at about one frame per second and the main thread never frees up, so the replay page freezes for headless test
   runners (TestSprite included) and for machines without a usable GPU. Detect the renderer with `readRendererName` and
   `classifyRenderer` from `src/lib/diagnostics/webgl-renderer.ts` (antialias is fixed at context creation, so read
   the name from a throwaway context first). For `software`: `antialias: false`, shadows off, pixel ratio 0.5 to 1,
   half-resolution terrain. Measured gain: 864 to 1,620 ms per frame down to about 117 ms. For every tier, stop the
   `requestAnimationFrame` loop when nothing moves (clock paused, camera move finished, damping settled), and while the
   canvas is off screen (IntersectionObserver) or the tab is hidden; restart on input, clock change or resize. Today the
   loop renders both the scene and the CSS2D labels every frame forever.
2. **Build the close-up on first use** (`close-up.ts`, `viewer.ts`). `buildCloseUp` runs at load and builds two
   241 x 241 patches (illustrated and measured, 58,081 vertices each, about 13 noise octaves per vertex for the
   illustrated one) whether or not the close-up is ever opened: 209 to 431 ms of main thread plus about 8 MB of
   geometry. Build it when the view first switches to `closeup` (the 190 ms crossfade hides most of it), and build the
   measured patch on the first toggle of the detail switch. Expected: the full 209 to 431 ms off the load path.
3. **Compile shaders ahead, including hidden objects** (`viewer.ts`). The first overview render takes 546 to 1,170 ms
   on SwiftShader: one full frame plus every shader compile and buffer upload, all on the main thread. Call
   `await renderer.compileAsync(scene, camera)` before starting the loop; with `KHR_parallel_shader_compile` (most GPU
   browsers) the compiles then leave the main thread free. three.js
   compiles only visible objects (`traverseVisible`, three.module.js), and the cut pieces, cut markers, labels, anchor
   and plume start hidden, so their shaders compile on the frame they appear: at the cut, the moment the replay is
   about. Make them visible for the compile call, then hide them again.
4. **Lower the overview grid or offer it per tier** (`public/seabed/gulf-of-finland-terrain.bin`, `overview.ts`). The
   625 x 481 grid is 300,625 vertices and 599,040 triangles. At half resolution the geometry build drops from 120 to
   44 ms, the file from 601 KB (417 KB gzip) to 151 KB (109 KB gzip), and a SwiftShader frame from 864 to 1,620 ms to
   about 687 ms with everything else unchanged. Row-delta encoding of the int16 file only saves 12%. Check after deploy
   whether Vercel compresses `.bin` (`curl -sI -H "Accept-Encoding: br" <url>`); octet-stream is often sent as is.
5. **Trim per-frame allocations** (`overview.ts`, `wake.ts`). `update` calls `sceneAt` 43 times a frame (2 objects
   each), builds a new `vesselFrame`, heading and `getPointAt` vector, and parses hex colors with `Color.set(string)`;
   `wake.update` allocates three arrays and closures. Roughly 100 to 150 short-lived objects a frame. Low priority: pass
   target vectors (`getPointAt(t, target)`), keep `THREE.Color` constants, reuse the wake arrays.
6. **Keep three.js behind the dynamic import.** `SeabedView` loads the viewer with `import("@/lib/seabed/scene/viewer")`,
   which keeps the 182 KB gzip out of the route's first load. Keep every three-dependent module behind that import;
   one static import from a client component of the route would put it back on the critical path.

Measured and not worth changing: turning off terrain shadow casting (frame time unchanged within noise, 900 to 988
against 929 to 949 ms), the close-up plume update (0.3 to 0.7 ms a frame), and the 11 CSS2D labels.

### Applied in the replay (`src/lib/seabed/scene/viewer.ts`)

Recommendations 1 to 3 are in, plus the tiered grid from 4:

- The viewer reads the renderer name from a throwaway context. On a software renderer it draws without antialiasing
  or shadows, at pixel ratio 0.75 at most, on every second row and column of the terrain grid
  (`downsampleElevations`), with ambient motion off. The canvas carries `data-renderer="software"` or `"hardware"`.
- A "calm" scene (software renderer or reduced motion) draws a frame only when the replay moment, the camera, the
  view or the size changes. Every tier stops drawing while the view is off screen (IntersectionObserver).
- The close-up is built the first time it is shown.
- Shaders compile with `compileAsync` before the first frame, hidden objects included.
- The replay clock steps up to 0.25 s a frame (was 0.1 s), so playback keeps its pace at a software frame time.

Checked on the production build in headless Chromium on SwiftShader, `/cases/eagle-s-2024`, 1,440 x 900: the 3D view
was ready 1.2 s after navigation, a no-op round trip to the main thread took 0 ms with the scene idle, and 3 s of
playback moved the replay clock 55 minutes (the intended pace is 58).

## WebGPU tier

Measured 2026-10-18 on a local production build. The case page is `/cases/eagle-s-2024`; JS is every script the page
loads, compressed (gzip from `next start`), headers excluded.

| What | Software | Hardware | WebGPU |
| --- | --- | --- | --- |
| Case page JS, `main` at c9b9024 | 418.4 KB, 16 scripts | 418.4 KB, 16 scripts | no such tier |
| Case page JS, with the WebGPU tier | 420.9 KB, 17 scripts | 420.9 KB, 17 scripts | 620.4 KB, 18 scripts |

- The other tiers pay 2.5 KB: the adapter check (`src/lib/diagnostics/webgpu-adapter.ts`) and the renderer seam. The
  viewer chunk that holds them is 74.5 KB raw, 27.3 KB gzip.
- The WebGPU tier adds one chunk, loaded by the dynamic import in `viewer.ts` only after the adapter check passes:
  713.2 KB raw, 199.5 KB as served (three.js's WebGPU renderer, TSL, GTAO and the denoiser, and the tier's materials).
  The build's chunk graph lists that one file for the import, and Windows Chrome's resource list on the WebGPU tier
  showed it as the only script the other tiers do not load. The WebGPU total is the other tiers' 420.9 KB plus that
  chunk; Windows Chrome cannot be driven by Playwright from WSL, so it was not counted request by request.
- Frame times on the WebGPU tier (Windows Chrome, AMD GCN 5, real time, lookdev harness): scrub to the next drawn
  frame, median of the overview medians 12 and 25 ms on two runs; page load to settled frame, median 4,528 and
  4,584 ms. The hardware tier (WebGL, WSL Chromium on the RTX 3050 through d3d12) measured 17 ms and 3,475 ms on the
  same build. Different browsers on different GPUs, so this says the tier keeps up, not which tier is faster.
- `bun run perf` on the same build: every budget passes (`/` 187.0 KB of JS, the `/diagnostics` 3D probe 4,264 ms on
  SwiftShader). Headless Chromium has no real WebGPU adapter, so the perf tool and every headless test runner stay on
  the software tier.

## Not measured

- Mobile devices and GPUs other than one: the 3D figures above are SwiftShader, the lookdev's hardware tier ran on
  Mesa d3d12 over an RTX 3050, and the WebGPU tier on one AMD GCN 5 adapter through Windows Chrome (WebGPU tier
  section). No phone was measured.
- Throttled networks beyond `/` and one case page: the 3g-phone profile covers those two (section "Phones on 3G").
- Interaction latency (INP): the tool loads pages and does not click; long tasks are the proxy.
- The live site after these changes: not deployed from here.

## One screen

`bun scripts/perf/check-one-screen.ts <baseUrl>` loads `/`, `/cases`, `/live` and every published case page at 1440 x 900, 1280 x 720 and 1024 x 768 in headless Chromium and checks that the document does not scroll or overflow sideways, and that on a case page the 3D view covers at least 65% of a 1440 x 900 viewport (plan/prompts/ui-console.md, section 6). It also prints the share no panel floats over. Exit codes: 0 every target met, 1 a target missed, 2 the pages could not be measured.

Measured on a local production build (`bun run start`), 2026-10-17:

| Page and viewport | Before the console (main at 4073ba5) | With the console |
|---|---|---|
| `/cases/eagle-s-2024`, 1440 x 900 | 2,410 px tall; 3D view 38.4% of the viewport | 900 px; 3D view 65.4%, 49.6% clear of the rail |
| `/cases/eagle-s-2024`, 1280 x 720 | 2,542 px; 32.7% | 720 px; 57.1%, 41.9% clear |
| `/cases/eagle-s-2024`, 1024 x 768 | 3,250 px; 18.0% | 768 px; 59.3% (the rail starts folded below 1,280 px) |
| `/`, 1280 x 720 and 1024 x 768 | 876 px | 720 and 768 px: home is one screen (board 12a) |
| `/cases`, 1280 x 720 and 1024 x 768 | 801 and 774 px | 720 and 768 px: ten cases in compact rows grouped by region, three columns from 1,280 px |

`bun scripts/perf/check-one-screen.ts` exits 0 on every page and viewport above.

Compressed JavaScript per page, measured on Vercel (production at 4073ba5 against the console's preview, 2026-10-17):

| Page | Before | With the console | Budget |
|---|---|---|---|
| `/cases/eagle-s-2024` | 362.6 KB | 402.1 KB (+39.5 KB) | +60 KB for the console |
| `/` | 159.4 KB | 195.2 KB (Next prefetches the replay route's chunks for the case links on screen) | under 200 KB |

The first console build weighed 452.4 KB on the case page and 245.1 KB on home; dropping the `motion` library for CSS transitions brought both under budget.

## Live globe

Measured 2026-10-17 on the Vercel preview of the live globe and a local production build, headless Chromium on SwiftShader (no GPU), with the collector's frames of that morning:

| What | Result |
|---|---|
| Globe drawing, from navigation | 0.8 to 1.8 s locally, 1.3 s on the preview |
| First ships on screen, from navigation | within 0.1 s of the globe: 10,435 ships in the 09:30 UTC frame |
| A frame on the wire | 65 to 160 KB compressed for 4,220 to 10,435 ships (about 15 bytes a ship) |
| Frames through the CDN | first request `x-vercel-cache: MISS`, the next `HIT`; Supabase serves each frame about once |
| JS on `/live` | 382 KB compressed with three.js, which loads only when the globe mounts |
| JS on `/` and `/cases` | 197.6 KB. Before two fixes: 314 KB, because the land parser imported three.js into the /live route chunk and home prefetched it; then 212 KB from prefetching /live at all. The parser moved to a three-free module, and the Live links no longer prefetch |

Not measured: frame rate on a real GPU and on a phone, and a full day of frames (the collector started at 09:10 UTC on 17 Oct 2026).

World lines, line crossings and the dive (PR 30), measured the same evening on SwiftShader on a shared machine under a
load of 14 to 17, alternating main and the branch six runs a side:

| What | Result |
|---|---|
| Globe ready, from navigation | main 2,319 and 3,095 ms; with the world lines 1,913 and 2,461 ms, after moving the lines' fetch, build and shader compile to after the globe shows (before that move the branch was 0.4 to 1 s slower than main) |
| World lines file | `public/globe/cables.json`, 4,186 lines, 567 KB raw, 112.8 KB on the wire |
| Ships that crossed a clicked line | 41 frames checked in 5.1 s; 14 s on a later run with more frames under load 14 |
| Dive into a case | the view transition started 3.1 s after the click and the case console was in place 1.25 s later |
| JS on `/live` | 391.8 KB, up 20.5 KB for three.js line addons and the new cards |

Home's JS crossed its budget with PR 19 and PR 20 (200.2 KB, then 202.7 KB, measured on each production deployment):
home prefetches the case console's chunks for its case links, and the section bar prefetched the WebGL check's probes.
The WebGL check link no longer prefetches (PR 37): home loads 195.4 KB on production, under the 200 KB budget.

`/api/health` reads Supabase three times a call, so its answer is cached at the CDN for 30 s (PR 35): the second
request is `x-vercel-cache: HIT`.

## Phones on 3G

`bun run perf <url> --profile 3g-phone` measures a mid-range phone on 3G: a 390 x 844 viewport at device pixel ratio 3,
1.6 Mbps down, 750 kbps up, a 300 ms round trip (Chromium's `Network.emulateNetworkConditions`) and the CPU slowed 4
times (`Emulation.setCPUThrottlingRate`). It loads `/` and `/cases/eagle-s-2024` in a fresh context per run and counts
the compressed bytes of the responses that ended before each moment. Chromium adds the emulated latency to the body,
not to the headers, so TTFB under this profile reads as unthrottled; LCP and every "done at" time include it (a 117 KB
file took 928 ms throttled against 182 ms without, the latency plus 117 KB at 200 KB/s).

| Budget (plan/prompts/landing-and-sign-in.md and ui-console-2.md) | Limit |
| --- | --- |
| `/` first screen (LCP) | under 2,500 ms |
| Bytes before the first screen | under 250 KB |
| Console shell drawn (the 3D view's frame exists, still loading) | under 3,000 ms |
| Console first 3D frame (`seabed-view` ready) | under 6,000 ms |
| Bytes before the first 3D frame | under 1 MB |
| CLS on both pages | under 0.05 |

Baseline, live site, 18 Oct 2026, 3 runs, load average 0.6 (median, min-max):

| Measure | Result |
| --- | --- |
| `/` first screen (LCP) | 1,260 ms (1,232-1,300), 80.1 KB before it: pass |
| `/` CLS | 0.302 in two of three runs: fails. Today's home gets replaced by the landing page |
| Console shell drawn | 2,705 ms (2,695-2,800): pass |
| Console first 3D frame | 10,086 ms (9,695-10,967): over the 6,000 ms budget |
| Bytes before the first 3D frame | 1,040.8 KB: over the 1 MB budget (427.6 KB of it JavaScript) |

Not measured yet: frame rate while playing, interaction latency and long tasks while dragging, panning or scrubbing on
the phone; they need a scripted interaction, which this tool does not run.

