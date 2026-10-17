# Lookdev

The lookdev harness renders fixed frames of every case's 3D replay on each renderer tier, compares them with approved
baselines, checks that the data colours reach the screen exactly and that the seabed ends in its depth tokens. It is
the outside judge for the 3D view: a change to the scene is done when the harness says so, not when it looks right on
one screen.

## Run it

```bash
bun run build && PORT=3106 bun run start                      # a production build (dev mode draws its own overlay)
bun scripts/lookdev/run-lookdev.ts http://localhost:3106       # both tiers, every shot
bun scripts/lookdev/run-lookdev.ts http://localhost:3106 --tier software --only eagle-s
bun scripts/lookdev/run-lookdev.ts http://localhost:3106 --update   # write new baselines (after approval)
```

| Flag | Meaning |
| --- | --- |
| `--tier software\|hardware\|all` | `all` (the default) always runs software and tries hardware; without a GPU the hardware tier is reported as skipped. Naming a tier makes it required. |
| `--only <text>` | Only the shots whose name contains the text. The per-run tone coverage check is skipped. |
| `--update` | Writes the frames as the new baselines instead of comparing. |
| `--out <dir>` | Where frames, diff images, probe overlays and `report.json` go (default `.scratch/lookdev`, gitignored). |
| `--chromium <path>` | Chromium to drive (default: Playwright's build, then the newest in `~/.cache/ms-playwright`). |

Exit codes: 0 every frame matches its baseline, every data colour is exact and every seabed matches its tokens; 1 a
regression, a colour or token miss, a tone never judged, or a missing baseline; 2 the frames could not be rendered
(server down, browser failed, a named tier not available).

Unit tests for the PNG codec and the image checks: `bun test scripts/lookdev`.

## What it renders

`scripts/lookdev/shots.ts` lists the shots. Each opens `/cases/<slug>?t=<minute>&view=<view>` (the console's URL state)
in headless Chromium at 1,440 x 900, device pixel ratio 1, with `prefers-reduced-motion: reduce`. Reduced motion makes
the viewer "calm": no intro flight, no running signal, no drifting silt, a frame drawn only when something changes. That
makes every frame a pure function of the build, the moment and the camera.

| Shot | Moment |
| --- | --- |
| `<case>-overview`, `<case>-vessel` for every case | the last cut's minute, or the middle of the drag window when the cut comes earlier, never after the window ends |
| `eagle-s-2024-top`, `eagle-s-2024-closeup` | the same minute (16:44 UTC, C-Lion1) |
| `eagle-s-2024-after-drag` | three hours after the drag window ends: the frame with the longest ink (`suspect`) track, since every case drags from its first position |
| `ships-turntable` | no case: all nine ship kinds the hull generator builds (`src/lib/ships/`), at typical lengths, in a 3 x 3 grid under the replay's sun; on the hardware tier each carries its Kelvin wake at 12 knots |

The harness waits for the canvas test hooks the viewer writes (`src/lib/seabed/scene/viewer.ts`): `data-pending-assets`
must be 0 (the sand-ripple texture has loaded), `data-drawn-view` and `data-drawn-at-ms` must match the shot, then
`data-frame-count` must hold still for 0.8 s. The turntable is a page bundled with `Bun.build` and opened from a file
URL (`scripts/lookdev/turntable.ts`); it sets `data-state` on its body when drawn.

### Tiers

| Tier | Chromium flags | What the viewer does |
| --- | --- | --- |
| software | `--use-angle=swiftshader --enable-unsafe-swiftshader` | SwiftShader on the CPU, as test browsers draw: no antialiasing, no shadows, pixel ratio 0.75 with the canvas scaled up by nearest pixel, half grid, flat water |
| hardware | `--use-angle=gl --ignore-gpu-blocklist --enable-gpu --enable-unsafe-webgpu --enable-features=Vulkan` | the GPU tier: antialiasing, soft sun shadows, full grid, Gerstner waves, sand ripples, detailed hulls with bow waves and Kelvin wakes |

On this WSL2 machine headless Chromium reaches the GPU through Mesa's d3d12 driver (`GALLIUM_DRIVER=d3d12`,
`LD_LIBRARY_PATH=/usr/lib/wsl/lib`, both set by the harness when `/usr/lib/wsl/lib` exists). The laptop has two
adapters; on the integrated AMD one three.js shaders failed to link and contexts were lost, so the harness points the
driver at the adapter named in `LOOKDEV_GPU_ADAPTER` (default `NVIDIA`, an RTX 3050 Laptop GPU here). The harness
checks the canvas's `data-renderer` after loading and refuses a frame drawn on the wrong tier.

## What it checks

1. **Look against the baseline.** The 3D view is screenshotted with everything else on the page hidden (the rail and
   stage controls never enter the frame, the 3D labels do), reduced by a 3 x 3 box filter, and compared with
   `scripts/lookdev/baselines/<tier>/<shot>.png`. A pixel differs when its YIQ colour difference (the metric of
   pixelmatch, Kotsarenko and Ramos 2010) passes 0.03, about 8 levels of luma: pixelmatch's default of 0.1 let a
   whole-frame shift of 10 levels pass (0.07% of pixels differed on a regraded seabed). A frame regresses when more
   than 0.5% of its pixels differ. The diff image (differing pixels in `alarm` over a grey copy) goes next to the frame.
2. **Exact data colours.** With the 3D labels hidden too, so DOM text in a data colour cannot pass for a drawn line,
   the canvas is screenshotted at full size. The viewer's lookdev hook (`data-lookdev="on"`, set by the harness before
   the first frame) writes `data-color-probes`: points on every data line drawn on that frame, projected to canvas
   pixels, with their tone (`overview.ts`, `readColorProbes`): five points along each cable and pipeline tube at the
   middle of the drawn tube, up to 16 points of each track tone (leaving out the last 13 minutes, which lie under the
   hull and the wake), and four points on each cut marker's ring. The viewer leaves out a probe whose tube is drawn
   under 2 device pixels wide (it cannot hold a whole pixel of its colour), a probe behind the rail, and a probe the
   relief hides from the camera (64 samples along the sight line). For each probe the harness looks for the expected
   colour within 2 px and 2 per channel:

   | Tone | Hex |
   | --- | --- |
   | `cable` | `#2F6BD8` |
   | `pipeline` | `#B66E12` |
   | `suspect` (the track) | `#141414` |
   | `alarm` | `#D93A26` |

   A tone passes on a frame when at least 60% of its probes are exact (the hull, wakes and crossing lines hide some
   points) and it has at least 3 probes. Across a full run each tone must be judged on at least 20 probes on each
   tier, so a change that hides a tone everywhere, or a hook that stops reporting it, fails instead of passing with
   nothing checked. Each frame's probes are drawn over it in `<shot>.probes.png`. The close-up is judged on its look
   only.
3. **Seabed in its depth tokens.** The water's colour is the seabed's: light absorbed with depth ends in the depth
   tokens of `docs/UI_DESIGN_SYSTEM.md` (Map). The viewer writes `data-seabed-probes`: level, open seabed (normal
   within 2.6 degrees of vertical, baked occlusion over 0.98, at least 1 m deep, on every 23rd grid vertex, in sight of
   the camera) and the token the vertex holds. On the views that look down (overview and top) at least 90% of those
   probes must show their token within 4 per channel (the sky's Fresnel reflection off the surface adds under one
   level at the overview's angle). The vessel view looks along the water, where the surface reflects much of the sky
   (about 35% at 80 degrees from vertical) and the hull covers the seabed, so it is not judged.
4. **Scrub to frame.** On overview shots the harness steps the timeline six minutes with the keyboard and reports the
   median time from the input event to the next drawn frame: the replay's frame time as a user feels it.

### Why no image library

The harness decodes and encodes PNG itself (`scripts/lookdev/png.ts`, 8-bit RGB and RGBA, the PNG specification's
five filters) and computes the YIQ difference in `compare.ts`. Both are short, tested, and saved a dependency.

## Baselines

Baselines are stored at a third of the frame so the repository stays small. They are written with `--update` and are
candidates until Andy approves the look; a fresh-context reviewer scores the frames against the reference board before
that (plan: ambition pass, 4.4). The harness never grades its own renders.

## Assets

`public/textures/sand-ripples-normal.jpg` (512 x 512, 80 KB) is the OpenGL normal map of Poly Haven's
[Aerial Beach 01](https://polyhaven.com/a/aerial_beach_01) by Rob Tuytel, CC0, resized from the 1k download. Only the
hardware tier loads it.

## WebGPU

A WebGPU tier was the stretch goal, to ship only if the harness passed on it. Headless Chromium on this machine offers
one WebGPU adapter, SwiftShader's, with `isFallbackAdapter` true, under every flag set tried (the default flags,
`--enable-features=Vulkan,WebGPU`, the d3d12 environment above, `--use-webgpu-adapter=swiftshader`). With no GPU
adapter to judge a WebGPU tier on, it was not built.

## Results

Measured 2026-10-17 on a local production build, WSL2, 8 cores, load average 10 to 13 (other builds running).

**Repeatability.** Two runs of an unchanged build: 0.00% of pixels differ on every frame, on both tiers.

**Data colours before the fix (the `main` build of 2026-10-17).** The harness failed every overview, which was the point
of building it first:

| Tone | Exact probes, software, overview shots | Typical colour found |
| --- | --- | --- |
| `cable` | 0 of 457 | `#DAECEB`: the lit tube under the 16% water box |
| `pipeline` | 0 of 193 | `#C29D5E` |
| `alarm` | 0 of 150 | `#C86D61` |
| `suspect` | 9 of 26 | median 6 off: Neutral tone mapping darkens near-black |

**After (the candidate baselines, 48 frames, exit 0).** The data lines are unlit, outside tone mapping and drawn after
the water (`src/lib/render/data-colors.ts`); the terrain carries the depth tokens and leaves tone mapping out.

| Check | Software (24 frames) | Hardware (24 frames) |
| --- | --- | --- |
| `cable` exact | 70 of 71 | 102 of 104 |
| `pipeline` exact | 66 of 66 | 134 of 136 |
| `alarm` exact | 176 of 176 | 170 of 170 |
| `suspect` exact | 73 of 76 | 73 of 76 |
| Seabed within 4 of its token (12 frames) | 4,227 of 4,285, worst frame 98.3%, median 0 or 1 | 14,465 of 14,616, worst frame 94.9%, median 0 or 1 |
| Scrub to frame, median of the overview medians | 48 ms (11 to 269) | 19 ms (10 to 23) |
| Page load to settled frame, median | 5,402 ms | 4,247 ms |

The seabed check found level ground 4 levels lighter than its token: three.js r186 lights Lambert materials with the
scene's environment map, which the relief shade's level reference had left out (`terrain-material.ts`).

**Against `main` (dfb8b44), SwiftShader, three alternating rounds each** (`/cases/eagle-s-2024`, all JavaScript the page
loads, compressed; a one-minute scrub to the next drawn frame, median of 12): JavaScript 408.4 KB against 398.6 KB;
scrub medians 327, 255 and 211 ms against 385, 308 and 496 ms. `bun run perf`: the 3D probe on `/diagnostics` measured
4,685 ms (budget 6,000 ms) at a 68 ms average software frame.
