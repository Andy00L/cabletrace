# Lookdev

The lookdev harness renders fixed frames of every case's 3D replay on each renderer tier, compares them with approved
baselines, checks that the data colours reach the screen exactly and that the seabed ends in its depth tokens. It is
the outside judge for the 3D view: a change to the scene is done when the harness says so, not when it looks right on
one screen.

## Run it

```bash
bun run build && PORT=3106 bun run start                      # a production build (dev mode draws its own overlay)
bun scripts/lookdev/run-lookdev.ts http://localhost:3106       # every tier, every shot
bun scripts/lookdev/run-lookdev.ts http://localhost:3106 --tier software --only eagle-s
bun scripts/lookdev/run-lookdev.ts http://localhost:3106 --tier webgpu      # the WebGPU tier alone (Windows Chrome)
bun scripts/lookdev/run-lookdev.ts http://localhost:3106 --update   # write new baselines (after approval)
```

| Flag | Meaning |
| --- | --- |
| `--tier software\|hardware\|webgpu\|all` | `all` (the default) always runs software and tries hardware and webgpu; without a GPU, or without Windows Chrome and a WebGPU adapter, those tiers are reported as skipped. Naming a tier makes it required. |
| `--only <text>` | Only the shots whose name contains the text. The per-run tone coverage check is skipped. |
| `--update` | Writes the frames as the new baselines instead of comparing. |
| `--out <dir>` | Where frames, diff images, probe overlays and `report.json` go (default `.scratch/lookdev`, gitignored). |
| `--chromium <path>` | Chromium to drive (default: Playwright's build, then the newest in `~/.cache/ms-playwright`). |
| `--windows-chrome <path>` | The WebGPU tier's browser (default `/mnt/c/Program Files/Google/Chrome/Application/chrome.exe`). |
| `--webgpu-proxy-port <port>` | Port of the WebGPU tier's proxy (default 3329). |

Exit codes: 0 every frame matches its baseline, every data colour is exact and every seabed matches its tokens; 1 a
regression, a colour or token miss, a tone never judged, or a missing baseline; 2 the frames could not be rendered
(server down, browser failed, a named tier not available).

Unit tests for the PNG codec, the image checks and the WebGPU tier's log reading: `bun test scripts/lookdev`.

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
| `ships-turntable` | no case: all nine ship kinds the hull generator builds (`src/lib/ships/`), at typical lengths, in a 3 x 3 grid under the replay's sun; on the GPU tiers each carries its Kelvin wake at 12 knots |

The harness waits for the canvas test hooks the viewer writes (`src/lib/seabed/scene/viewer.ts`): `data-pending-assets`
must be 0 (the sand-ripple texture has loaded), `data-drawn-view` and `data-drawn-at-ms` must match the shot, then
`data-frame-count` must hold still for 0.8 s. The turntable is a page bundled with `Bun.build` and opened from a file
URL (`scripts/lookdev/turntable.ts`); it sets `data-state` on its body when drawn. The cells are shared by the WebGL page
and the WebGPU page (`turntable-scene.ts`); the WebGPU page draws each cell with the tier's own renderer.

### Tiers

| Tier | Chromium flags | What the viewer does |
| --- | --- | --- |
| software | `--use-angle=swiftshader --enable-unsafe-swiftshader` | SwiftShader on the CPU, as test browsers draw: no antialiasing, no shadows, pixel ratio 0.75 with the canvas scaled up by nearest pixel, half grid, flat water |
| hardware | `--use-angle=gl --ignore-gpu-blocklist --enable-gpu --enable-unsafe-webgpu --enable-features=Vulkan` | the WebGL GPU tier: antialiasing, soft sun shadows, full grid, Gerstner waves, sand ripples, detailed hulls with bow waves and Kelvin wakes. WebGPU is on in this browser, but its only adapter is SwiftShader's fallback, so the viewer keeps WebGL |
| webgpu | Windows Chrome: `--headless=new --enable-unsafe-webgpu --force-prefers-reduced-motion`, a profile in `.scratch` | the WebGPU tier (below): the hardware tier's look, drawn by WebGPURenderer with GTAO |

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

Baselines are stored at a third of the frame so the repository stays small. They are written with `--update`. Andy
approved the look on 18 Oct 2026: the 72 baselines of the three tiers in this folder are the approved frames. A change
that moves them needs his approval again before `--update` (plan: ambition pass, 4.4). The harness never grades its
own renders.

## Assets

`public/textures/sand-ripples-normal.jpg` (512 x 512, 80 KB) is the OpenGL normal map of Poly Haven's
[Aerial Beach 01](https://polyhaven.com/a/aerial_beach_01) by Rob Tuytel, CC0, resized from the 1k download. Only the
GPU tiers (hardware and webgpu) load it.

## WebGPU

### The tier

The replay draws on WebGPU only when `navigator.gpu.requestAdapter()` returns an adapter that says it is not a fallback
and whose name is not a CPU renderer's (`src/lib/diagnostics/webgpu-adapter.ts`, `judgeGpuAdapter`; a 3 s timeout).
The viewer makes the GPU device from that adapter itself and hands it to `WebGPURenderer`, then checks the backend is
WebGPU: `WebGPURenderer` would otherwise fall back to WebGL 2 silently. Anything that fails sends the page to the WebGL
tiers as before, so `data-renderer="webgpu"` always means a WebGPU backend on a real GPU. Headless test browsers,
TestSprite included, get SwiftShader's fallback adapter and keep the software tier. The tier's code (three.js's
WebGPU build, the TSL materials and the post-processing, `src/lib/render/webgpu/`) loads with a dynamic import only
when the tier is chosen.

The scene is the WebGL scene. The few materials with custom shading come from a kit
(`src/lib/render/scene-renderer.ts`): the GLSL patches on WebGL, TSL node materials on WebGPU (terrain, water surface,
thinning data tubes, the track and furrow lines, the Kelvin wake, the close-up's caustics), both from the same exported
numbers. On top of the hardware tier's look the tier adds:

- **Ground-truth ambient occlusion** (three.js GTAO, half resolution, denoised) from a depth and normal pre-pass of the
  opaque objects, applied to the ambient light of lit opaque materials only. Its reach follows the camera's height
  (6% of it), so the overview, the vessel view and the close-up get the same reach on screen. It darkens the foot of
  every slope and the creases between hull parts, and puts a contact shadow under the close-up's cable and anchor.
  Data lines, water and wakes never take it, and level open seabed stays on its token.
- **The WebGL tiers' colour handling, kept exact.** `WebGPURenderer` tone maps the whole frame and ignores
  `toneMapped: false`, which would shift the data colours. The tier draws without the renderer's tone mapping and
  each material tone maps (Neutral, exposure 1.02) and sRGB-encodes its own output in the scene pass, as WebGL does in
  each shader. Blending and the 4x MSAA resolve then mix encoded values like the WebGL canvas: mixed in linear light
  instead, the first candidate drew 1 to 2 px cables thinner and broken.

- **Sediment drawn as sprites.** WebGPU draws a point primitive 1 px wide whatever its size, so the close-up's silt
  cloud and the overview's dragging plume vanished in the first candidate. The kit draws them as one instanced sprite
  per particle at WebGL's point size (`createSoftPoints`).

What did not change: the water. The tier draws a TSL port of the WebGL surface (Fresnel sky, GGX sun glints off the
same Gerstner waves) and it reads the same as on the hardware tier. Nothing was added on top: looking down, the surface
reflects 2 to 4% of the sky, and no change to it was judged likely to read clearly better in these frames.

### How the harness drives it

Headless Chromium inside WSL gets only SwiftShader's fallback adapter under every flag set tried (the default flags,
`--enable-features=Vulkan,WebGPU`, the d3d12 environment above, `--use-webgpu-adapter=swiftshader`). Windows Chrome,
started from WSL, gets the machine's GPU (here `amd gcn-5`, not a fallback), but its DevTools port is not reachable
from WSL, so Playwright cannot drive it. `scripts/lookdev/webgpu-capture.ts` drives it through the command line:

- A proxy in front of the app (port 3329) injects a page agent first in every HTML page. The agent waits for the frame
  exactly as the Playwright tiers wait (the canvas hooks, then 0.8 s without a new frame), hides what the shot hides,
  and prints the probes and boxes on the console; `--enable-logging=stderr` writes the console to Chrome's stderr.
- The proxy also injects an async script whose response it holds until the agent releases it. Headless Chrome takes
  its `--screenshot` at the load event, which waits for that script, so the screenshot comes after the settled frame,
  in real time. (`--virtual-time-budget` ran ahead of the GPU's work and shot an empty stage.)
- Headless Chrome on Windows lays the page out at 1,422 x 748 and resizes it to the 1,440 x 900 window right after the
  load event. The agent releases the load, waits for that resize and the viewer's next frame, and only then reports, so
  the probes and boxes it reports are the screenshot's; the harness refuses a report made at any other size.
- Each shot is two Chrome runs, the look with its labels and the bare canvas with its probes; overview shots get a
  third that times the scrub (one-minute steps on the scrubber, input event to the next drawn frame, real time).
- Chrome always runs with `--headless=new` and a profile in `.scratch/lookdev-webgpu-profile`; a run that hangs is
  stopped after 150 s, and only Chrome processes started with that profile are stopped.
- Chrome runs with `--disable-extensions`, and its `TEMP` and `TMP` point at `.scratch/lookdev-webgpu-temp` (passed
  through `WSLENV`, emptied before each run). Without them, the runs of 17 and 18 Oct 2026 left about 1,400 extension
  downloads of 6 to 27 MB in Windows `%TEMP%`: programs installed on Windows (Acrobat, NordVPN) register extensions
  Chrome adds to every profile, and each run quit at its screenshot before the install finished, so the next run
  downloaded them again. A full WebGPU run with both (24 frames, all matching their baselines) left nothing there.

## Results

The first numbers were measured 2026-10-17 on a local production build, WSL2, 8 cores, load average 10 to 13 (other
builds running); the table under "Now" on 2026-10-18 at a load average of 1.5 to 2.3, the WebGPU tier in Windows
Chrome on the laptop's AMD GCN 5 GPU.

**Repeatability.** Two runs of an unchanged build: 0.00% of pixels differ on every frame, on every tier (on WebGPU,
0 differing pixels in all 24 frames, twice, once the GTAO denoiser's noise was seeded).

**Data colours before the fix (the `main` build of 2026-10-17).** The harness failed every overview, which was the point
of building it first:

| Tone | Exact probes, software, overview shots | Typical colour found |
| --- | --- | --- |
| `cable` | 0 of 457 | `#DAECEB`: the lit tube under the 16% water box |
| `pipeline` | 0 of 193 | `#C29D5E` |
| `alarm` | 0 of 150 | `#C86D61` |
| `suspect` | 9 of 26 | median 6 off: Neutral tone mapping darkens near-black |

**After the fix.** The data lines are unlit, outside tone mapping and drawn after the water
(`src/lib/render/data-colors.ts`); the terrain carries the depth tokens and leaves tone mapping out.

**Now (72 frames, every tier exit 0 against its baselines).** Software and hardware match the baselines approved
before the WebGPU tier by 0.00% on every frame: the tier changed nothing they draw.

| Check | Software (24 frames) | Hardware (24 frames) | WebGPU (24 frames) |
| --- | --- | --- | --- |
| `cable` exact | 70 of 71 | 102 of 104 | 102 of 104 |
| `pipeline` exact | 66 of 66 | 134 of 136 | 134 of 136 |
| `alarm` exact | 174 of 174 | 174 of 174 | 174 of 174 |
| `suspect` exact | 73 of 76 | 73 of 76 | 73 of 76 |
| Seabed within 4 of its token (12 frames) | 4,259 of 4,314, worst frame 98.3% | 14,938 of 15,080, worst frame 94.9% | 14,936 of 15,080, worst frame 96.3% |
| Scrub to frame, median of the overview medians | 14 ms (9 to 17) | 17 ms (10 to 20) | 12 ms (9 to 26); 25 ms (10 to 30) on the other run |
| Page load to settled frame, median | 4,347 ms | 3,475 ms | 4,528 ms; 4,584 ms on the other run |

The WebGPU timings come from Windows Chrome in real time, the others from headless Chromium inside WSL, so the
columns compare tiers on one machine, not browsers.

**WebGPU against hardware, frame by frame** (the harness's metric, YIQ difference over 0.03 at a third of the frame):

| Frames | Pixels that differ | What differs |
| --- | --- | --- |
| 12 overviews and the top view | 0.08 to 0.58% | Nothing a viewer would see: GTAO darkens the foot of the steepest slopes by a level or two |
| `eagle-s-2024-after-drag` | 0.44% | The same |
| Vessel views | 1.21 to 8.51% (Newnew Polar Bear 8.51, Yi Peng 3 7.64, Hai Hong Gong 66 5.46, the others 1.2 to 2.7) | Contact shading in the creases between containers and hatch covers and under the superstructure's tiers; the seabed under the water next to the camera shows less of the sand-ripple moire the hardware tier draws there |
| `eagle-s-2024-closeup` | 3.52% | A contact shadow under the cable and the anchor; the slopes' feet slightly darker |
| `ships-turntable` | 1.72% | Creases in the hull detail |

Judged honestly: on the overviews and the top view the two tiers cannot be told apart. In the vessel views and the
close-up the WebGPU frame reads a little more solid (hulls and the anchor sit on what is under them) and the near
seabed is calmer; side by side at full size it is a small step, not a different look. The water, the wakes and the
signal halo read the same on both tiers.

The seabed check found level ground 4 levels lighter than its token: three.js r186 lights Lambert materials with the
scene's environment map, which the relief shade's level reference had left out (`terrain-material.ts`).

**Against `main` (dfb8b44), SwiftShader, three alternating rounds each** (`/cases/eagle-s-2024`, all JavaScript the page
loads, compressed; a one-minute scrub to the next drawn frame, median of 12): JavaScript 408.4 KB against 398.6 KB;
scrub medians 327, 255 and 211 ms against 385, 308 and 496 ms. `bun run perf`: the 3D probe on `/diagnostics` measured
4,685 ms (budget 6,000 ms) at a 68 ms average software frame.
