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

## Case page load

`bun run perf <url> --profile case-click` opens `/cases` on the GPU (the lookdev harness's hardware tier, Mesa d3d12
on the RTX 3050), clicks each of Eagle S, Yi Peng 3 and Hong Tai 58 in turn, in a fresh signed-in context per click,
and times from the click to the console drawn and to the 3D view's first frame; "usable" is the later of the two. The
viewer's own load steps are performance marks (`seabed:data-and-code`, `seabed:renderer`, `seabed:overview`,
`seabed:first-frame`), printed per case. The budget is 2,000 ms on desktop.

Main (824842b) and this branch, local production builds on ports 3412 and 3411, alternating, 5 runs each, median
(min-max) in ms from the click, cold HTTP cache:

| Case | Main, load 1.3 | Main, load 1.0 | Branch, load 1.0 | Branch, load 0.6 to 1.4 |
| --- | --- | --- | --- | --- |
| Eagle S | 2,473 (2,442-2,702) | 2,511 (2,481-2,754) | **1,025** (1,017-1,108) | **1,201** (1,070-1,279) |
| Yi Peng 3 | 2,497 (2,443-2,604) | 2,531 (2,520-2,615) | **1,072** (1,051-1,093) | **1,256** (1,225-1,276) |
| Hong Tai 58 | 1,792 (1,764-1,842) | 1,800 (1,778-1,878) | **780** (775-834) | **905** (792-1,062) |

The console draws 340 to 355 ms after the click on both. Before the sign-in gate, with the old tool (whose sign-in tab
warmed the cache, below), main measured 5,072, 4,839 and 3,585 ms at a load of 5.6 to 9.7.

Where the time went on main (profiled on the GPU tier): 49 shader programs linked on the first draw, about 100 ms each
(this ANGLE on d3d12 has no `KHR_parallel_shader_compile`, so a link resolves when three.js first queries the program,
4.5 s in all); the relief occlusion bake, 1.0 s; the page's first WebGL context, 0.7 s, opened twice (a probe context,
then the renderer's); the PMREM environment, 0.55 s; the overview build, 2.5 s; and every step after the one before.

What changed (`src/lib/seabed/scene/`, `src/lib/render/`, `src/components/replay/SeabedView.tsx`):

- **A terrain worker per area** (`terrain-worker.ts`, served as a Bun bundle at `public/seabed/terrain-worker.js`,
  since Turbopack 16.4 ships `new Worker(new URL(...))` as the TypeScript source). It starts fetching the area's files
  while the console renders (`warmSeabedArea`), decodes them, and builds the terrain's arrays (grid, normals, colours,
  occlusion) at the grid step the renderer tier asks for, then transfers them without a copy. The worker and each built
  step stay for the page's life, so another case on the same area, or a client navigation back, neither fetches nor
  builds again. Where workers fail, the main thread builds.
- **Relief occlusion 4 times faster** (`relief-occlusion.ts`): the sample offsets and distances are precomputed in
  typed arrays; the output is identical.
- **One WebGL context, opened early** (`src/lib/render/webgl-canvas.ts`): after the console's first paint, while the
  data downloads; it tells a CPU renderer from a GPU and is the context the renderer draws on. A browser with a WebGPU
  device opens none.
- **A first frame of four programs.** The block, its lines, labels and markers draw first. The vessel, the wakes, the
  anchor rig, the water and the signal (the refinement) compile one program per task afterwards
  (`compileProgramByProgram`, `src/lib/render/webgl-scene-renderer.ts`: each link is forced in its own task, so the
  page stays responsive) and appear about 3.5 s later. The ship's detail level loads with a dynamic import. Hidden
  objects are compiled too, so the cut does not stall.
- **The sky's PMREM** waits for the sky texture and gets its own compile, after the first frame.

On the 3G phone profile (SwiftShader, CPU slowed 4 times) the software tier used to wait for a full-grid build it then
threw away, because the area was warmed at the GPU tier's step before the tier was known. The worker now fetches first
and builds only the step asked for: the first 3D frame moved from 7.1 to 8.2 s to 4.0 to 5.3 s in the same probe at a
load of 6 to 10.

**The tools measure a cold cache now.** The perf tool used to sign in on a tab of the measured context, and Clerk sends
the reader to `/cases/eagle-s-2024` after signing in, so the measured load found the case page's scripts and the Baltic
seabed files already cached. The tool signs in once per browser now (`signInOnce`, `scripts/lookdev/tier-launch.ts`)
and starts each measured context from that session, with an empty cache. That also made it sign in once per run
instead of once per page or click (15 sign-ins for a 5-run case-click profile), and the sign-in helper's 30 s timeout
had stopped about one run in three under load.

3G phone, same builds alternating, 3 runs each, cold cache, median (min-max):

| Measure | Main, load 1.9 | Main, load 3.2 | Branch, load 1.9 | Branch, load 3.2 |
| --- | --- | --- | --- | --- |
| Console shell drawn | 3,647 (3,601-3,727) | 4,143 (3,660-4,856) | 3,745 (3,643-3,775) | 3,645 (3,619-3,679) |
| Console first 3D frame | 12,860 (12,854-13,321) | 14,927 (13,971-16,757) | **10,428** (10,414-10,507) | **10,368** (10,323-10,583) |
| KB before the first 3D frame | 1,593.1 | 1,593.1 | 1,610.1 | 1,610.2 |

With a cold cache both builds miss the shell (3,000 ms), first 3D frame (6,000 ms) and 1 MB budgets; the branch is
2.4 to 4.6 s faster to the first 3D frame and loads 17 KB more before it (the worker bundle, 12.9 KB raw). With the old
warm sign-in tab the branch measured 1,188 ms to the shell and 6,819 ms to the first 3D frame at load 8.

### Second round: under 1.5 s on desktop (21 Oct 2026)

`.scratch/case-load/click-to-ready.ts` clicks a case card on `/cases` and times until the 3D view says ready (its
first frame), GPU tier on Mesa d3d12, cache cleared before each click; local production builds of main (5c0148a) and
this branch, median (min-max) in ms, load 0.5 to 1.4:

| Case | Main, desktop | Branch, desktop | Main, phone | Branch, phone |
| --- | --- | --- | --- | --- |
| Eagle S | 2,511 (2,417-3,654) | **1,445** (1,362-1,468) | 4,169 (4,165-4,220) | **2,554** (2,494-2,578) |
| Yi Peng 3 | 2,554 (2,109-4,420) | **1,503** (1,433-1,541) | 4,488 (4,379-4,550) | **2,510** (2,493-2,620) |

Desktop is 1,440 x 900, 5 runs; phone is 390 x 844 at DPR 3 with the CPU slowed 4 times, 3 runs. What changed: the
renderer is kept across replays (`src/lib/render/renderer-pool.ts`), the viewer's code starts downloading while the
console renders, the WebGPU adapter's budget counts idle page time, the seabed files load at content-versioned URLs
cached a year (`src/lib/seabed/seabed-urls.ts`), the terrain worker builds the likely grid step as soon as the files
are in, the map's tubes are polyline tubes (`polyline-tube.ts`), the ship's hull, house and anchor are built after the
first frame, and a phone (`src/lib/render/compact-screen.ts`) draws the half grid on WebGL at a pixel ratio of at most
1.5, with the plain hulls and no sand ripples.

## Replay frame pacing (21 Oct 2026)

Andy noticed the replays did not animate smoothly. `scripts/perf/windows-frame-pacing.ts` measures it on Windows
Chrome and the machine's own GPU (the lookdev harness's agent, mode `frame-pacing`, motion allowed): on a case page
with its 3D view ready, it records every animation frame's interval while the replay idles 3 s, plays 8 s, moves
through four views and is scrubbed, with Chrome's long animation frames and the JS sampling profiler (`--profile`).
The GPU tier inside WSL cannot judge this: Mesa's d3d12 holds about 20 fps there even when idle.

**WebGPU rebuilt every shader every frame.** The anchor cam draws the same scene from under the surface, and the
underwater look swapped `scene.fog` between the haze (linear) and the water column (exponential). On WebGPU a different
fog changes every material's cache key, so three.js disposed every render object and built every node material again,
twice per anchor-cam frame; each rebuilt scene material also re-ran the setup of the AO nodes it reads, which reset the
GTAO and render-to-texture quads every frame. Counted in 4 s of playback: 468 render objects recreated. The WebGPU kit
now keeps one fog node blended by an "underwater" uniform (`createFogSwitch`, `src/lib/render/webgpu/webgpu-kit.ts`);
WebGL still swaps `scene.fog`, whose programs stay cached.

**First draws.** A compile does not pay for everything a first draw does (shadow maps, texture uploads, and on WebGPU
every pipeline of its render passes, which `compileAsync` does not reach). So the close-up is built and compiled after
the refinement, the anchor cam's underwater programs are compiled with the scene on WebGL, and on a quiet replay
(no new moment, no input, the camera at rest for 1.5 s) a warm-up draws what has not been seen yet where nobody sees
it: on WebGPU the overview's later objects (the cut pieces, markers, the underwater dressing) two a frame, then the
close-up; on WebGL the close-up in one draw (`warmUpBatch`, `src/lib/seabed/scene/viewer.ts`). The director's camera
fit bisects 30 times instead of 60 (5 mm on 5,000 km).

**The anchor cam in the main view (WebGPU).** three.js runs a render pipeline's passes (the pre-pass, GTAO, the
denoise and the scene pass) once per browser frame. The anchor cam draws before the main view, so on every frame it
drew (each 125 ms) the main view reused its pictures and showed the anchor cam instead; the lookdev's WebGPU vessel
shots caught it. Each draw now gives the passes new update references (`onReference`, `buildScenePipeline` in
`src/lib/render/webgpu/webgpu-scene-renderer.ts`), so they run once per draw. The warm-up also skips objects with
empty geometry: the close-up's spare cable pieces made three's WebGPU draw throw (a fat line with no instances draws
an infinite count), and from then on no frame reached the screen (the blank WebGPU overviews).

Windows Chrome, Eagle S, 1,440 x 900 at DPR 1, local production builds, fps of the page's animation frames and the
longest frame (ms). Main: two runs on WebGPU (the second with Chrome's frame-rate limit off), one on WebGL. Branch,
with the anchor cam fix: three runs on WebGPU, one on WebGL.

| Scene | Main, WebGPU | Branch, WebGPU | Main, WebGL | Branch, WebGL |
| --- | --- | --- | --- | --- |
| Idle 3 s | 0 to 5.5 fps | 11.6 to 12.9 fps, max 84 to 500 (the warm-up) | 59.7 fps, max 18 | 59.8 fps, max 17 |
| Playing 8 s | 1.9 to 3.6 fps, max 2,950 | **55.1 to 58.6 fps**, max 67 to 350 | 56.1 fps, max 267 | **58.6 fps**, max 117 |
| View changes 6 s | 3.1 to 4.6 fps, max 2,650 | **36.9 to 43.5 fps**, max 967 to 1,450 | 35.4 fps, max 2,717 | **58 fps**, max 133 |
| Scrub 2 s | 5.9 to 12.8 fps, max 540 | **59.7 to 59.8 fps**, max 17 | 47.4 fps, max 683 | **59.4 fps**, max 17 |

Outside the WebGPU warm-up, the branch's p50 and p95 frames are 16.7 and 16.8 to 17.2 ms in every scene. Left: the warm-up holds a few
frames for 0.1 to 0.5 s on a paused, untouched replay (on purpose, instead of while playing); it warms the playback's
objects before the close-up, so a reader who opens "At the cut" before it got there waits 1 to 1.5 s on WebGPU (the
view changes' longest frame, mostly GPU work: 0.25 s of script); each WebGPU anchor cam frame (every 125 ms) is a
second full pass of the pipeline; the room's reflections (0.1 to 1.5 s) and the close-up's build (0.2 to 0.6 s) run
in one go each, on quiet frames too; an earlier WebGL run saw one program link on its first use during a scrub (main
shows the same 683 ms frame); and the console's React updates take about 2 ms a frame while playing.

## Not measured

- Mobile devices and GPUs other than one: the 3D figures above are SwiftShader, the lookdev's hardware tier ran on
  Mesa d3d12 over an RTX 3050, the WebGPU tier and the frame pacing on this laptop through Windows Chrome (WebGPU tier
  section). Phones are emulated in Chromium (CPU slowed 4 times); no real phone was measured.
- Throttled networks beyond `/` and one case page: the 3g-phone profile covers those two (section "Phones on 3G").
- Interaction latency (INP): the tool loads pages and does not click; long tasks are the proxy.
- The live site after these changes: not deployed from here.

## One screen

`bun scripts/perf/check-one-screen.ts <baseUrl>` signs in as the tools' test reader, then loads `/cases`, `/live` and every published case page (the front page scrolls by design since PR 51) at 1440 x 900, 1280 x 720 and 1024 x 768 in headless Chromium and checks that the document does not scroll or overflow sideways, and that on a case page the 3D view covers at least 65% of a 1440 x 900 viewport (plan/prompts/ui-console.md, section 6). It also prints the share no panel floats over. Exit codes: 0 every target met, 1 a target missed, 2 the pages could not be measured.

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

The tiers (Planet, Sea, Strait, Ship), measured 20 Oct 2026 on two local production builds side by side, origin/main
and the tiers branch, signed in, SwiftShader at 1440 x 900, three runs alternating, load average 5:

| What | main | tiers |
| --- | --- | --- |
| JS on `/live`, compressed, after the sign-in page | 265.2 KB | 269.7 KB (+4.5 KB: the tier modules, CSS2DRenderer, the cards) |
| Static globe files on the wire | 209.8 KB | 227.3 KB (+17.5 KB: `seas.json`, 56 KB raw) |
| Globe ready, from navigation (median, min-max) | 1,796 ms (1,413-3,353) | 1,885 ms (1,596-4,443) |

Binning a frame into density cells and counting it by sea runs once per frame pair, not per drawn frame. The globe
still draws nothing while idle: the labels are placed only on frames the camera or the data changed.

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

### The landing and the sign-in gate (20 Oct 2026)

The landing replaced the home page, and every page but the landing now sits behind sign-in. Local production build
(`bun run start`), 3 runs each, median (min-max):

| Measure | Old home (18 Oct baseline) | Landing |
| --- | --- | --- |
| Desktop `/` LCP | 388 ms (240-536), live site | 536 ms (424-872): pass |
| Desktop `/` JS | 195.7 KB | 185.5 KB: pass (Clerk's script never loads on the landing) |
| 3G phone `/` first screen (LCP) | 1,260 ms, 80.1 KB before it | 2,140 ms (2,120-2,176), 39.4 KB before it: pass |
| 3G phone `/` CLS | 0.302 in two of three runs | 0.004: pass |

The landing's first screen on a phone is the headline, the buttons and the live card; the engraving sits below it, so
the headline is the LCP element and the 64 KB phone art no longer delays it. The phone CLS came from the headline and
the sentence re-wrapping when TikTok Sans arrived: the heading fallback face and the Liberation Sans sources in
`src/app/layout.tsx` make both fonts wrap identically at 360, 390, 430 and 600 px (measured with font requests blocked
against loaded). The live card's data is read at most once a minute into the cached page (`use cache`, 60 s), so
it costs the visitor nothing at request time.

**Signing in.** The perf tool, the console checks (`scripts/checks/console-page.ts`) and the lookdev harness sign in
as `cabletrace-tools+clerk_test@example.com` before opening a page behind the gate (`scripts/auth/sign-in-test-user.ts`,
about 5 s). The perf tool and the lookdev harness sign in once per browser, unthrottled and outside the measured
load, and start each measured context from that session with an empty cache (section "Case page load"). The lookdev harness's WebGPU tier drives Windows Chrome, which
cannot fill the form: its proxy sends a session token made through Clerk's Backend API instead
(`scripts/lookdev/session-token.ts`). Clerk test addresses and Backend API sessions are for the development instance;
a production instance needs another route in for these tools.

