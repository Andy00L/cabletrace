# Lookdev

The lookdev harness renders fixed frames of every case's 3D replay on each renderer tier, compares them with approved
baselines, and checks that the data colours reach the screen exactly. It is the outside judge for the 3D view: a change
to the scene is done when the harness says so, not when it looks right on one screen.

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
| `--only <text>` | Only the shots whose name contains the text. |
| `--update` | Writes the frames as the new baselines instead of comparing. |
| `--out <dir>` | Where frames, diff images and `report.json` go (default `.scratch/lookdev`, gitignored). |
| `--chromium <path>` | Chromium to drive (default: Playwright's build, then the newest in `~/.cache/ms-playwright`). |

Exit codes: 0 every frame matches its baseline and every data colour is exact; 1 a regression, a colour miss, or a
missing baseline; 2 the frames could not be rendered (server down, browser failed, a named tier not available).

Unit tests for the PNG codec and the image checks: `bun test scripts/lookdev`.

## What it renders

`scripts/lookdev/shots.ts` lists the shots. Each opens `/cases/<slug>?t=<minute>&view=<view>` (the console's URL state)
in headless Chromium at 1,440 x 900, device pixel ratio 1, with `prefers-reduced-motion: reduce`. Reduced motion makes
the viewer "calm": no intro flight, no running signal, no drifting silt, a frame drawn only when something changes. That
makes every frame a pure function of the build, the moment and the camera.

| Shot | Moment |
| --- | --- |
| `<case>-overview`, `<case>-vessel` for all five cases | the last cut's minute, or the middle of the drag window when the cut comes earlier, never after the window ends |
| `eagle-s-2024-top`, `eagle-s-2024-closeup` | the same minute (16:44 UTC, C-Lion1) |
| `eagle-s-2024-after-drag` | three hours after the drag window ends: the only frame with an ink (`suspect`) track, since every case drags from its first position |

The harness waits for the canvas test hooks the viewer writes (`src/lib/seabed/scene/viewer.ts`): `data-drawn-view`
and `data-drawn-at-ms` must match the shot, then `data-frame-count` must hold still for 0.8 s.

### Tiers

| Tier | Chromium flags | What the viewer does |
| --- | --- | --- |
| software | `--use-angle=swiftshader --enable-unsafe-swiftshader` | SwiftShader on the CPU, as test browsers draw: no antialiasing, no shadows, pixel ratio 0.75, half grid |
| hardware | `--use-angle=gl --ignore-gpu-blocklist --enable-gpu --enable-unsafe-webgpu --enable-features=Vulkan` | the GPU tier: antialiasing, soft shadows, full grid |

On this WSL2 machine headless Chromium reaches the GPU through Mesa's d3d12 driver (`GALLIUM_DRIVER=d3d12`,
`LD_LIBRARY_PATH=/usr/lib/wsl/lib`, both set by the harness when `/usr/lib/wsl/lib` exists). The laptop has two
adapters; on the integrated AMD one three.js shaders failed to link and contexts were lost, so the harness points the
driver at the adapter named in `LOOKDEV_GPU_ADAPTER` (default `NVIDIA`, an RTX 3050 Laptop GPU here). The harness
checks the canvas's `data-renderer` after loading and refuses a frame drawn on the wrong tier.

## What it checks

1. **Look against the baseline.** The 3D view is screenshotted with everything else on the page hidden (the rail and
   stage controls never enter the frame, the 3D labels do), reduced by a 3 x 3 box filter, and compared with
   `scripts/lookdev/baselines/<tier>/<shot>.png`. A pixel differs when its YIQ colour difference passes 0.1 (the metric
   and default threshold of pixelmatch, Kotsarenko and Ramos 2010); a frame regresses when more than 0.5% of its
   pixels differ. The diff image (differing pixels in `alarm` over a grey copy) goes next to the frame.
2. **Exact data colours.** With the 3D labels hidden too, so DOM text in a data colour cannot pass for a drawn line,
   the canvas is screenshotted at full size. The viewer's lookdev hook (`data-lookdev="on"`, set by the harness before
   the first frame) writes `data-color-probes`: points on every data line drawn on that frame, projected to canvas
   pixels, with their tone (`overview.ts`, `readColorProbes`): five points along each cable and pipeline tube at the
   middle of the drawn tube, up to 16 points of each track tone (leaving out the last 13 minutes, which lie under the
   hull and the wake), and four points on each cut marker's ring. For each probe the harness looks for the expected
   colour within 2 px and 2 per channel:

   | Tone | Hex |
   | --- | --- |
   | `cable` | `#2F6BD8` |
   | `pipeline` | `#B66E12` |
   | `suspect` (the track) | `#141414` |
   | `alarm` | `#D93A26` |

   A tone passes when at least 60% of its probes are exact (terrain, the hull and crossing lines hide some points)
   and it has at least 3 probes. Overview shots require `cable` and `alarm`; the after-drag shot also requires
   `suspect`. The close-up is judged on its look only.
3. **Scrub to frame.** On overview shots the harness steps the timeline six minutes with the keyboard and reports the
   median time from the input event to the next drawn frame: the replay's frame time as a user feels it.

### Why no image library

The harness decodes and encodes PNG itself (`scripts/lookdev/png.ts`, 8-bit RGB and RGBA, the PNG specification's
five filters) and computes the YIQ difference in `compare.ts`. Both are short, tested, and saved a dependency.

## Baselines

Baselines are stored at a third of the frame (about 50 KB each) so the repository stays small. They are written with
`--update` and committed only once Andy has approved the look; a fresh-context reviewer scores the frames against the
reference board before that (plan: ambition pass, 4.4). The harness never grades its own renders.

## Results

Measured 2026-10-17 on a local production build, WSL2, 8 cores, load average 7 to 13 (other builds running).

**Repeatability.** Two runs of an unchanged build: 0.00% of pixels differ on all 13 frames, on the software tier and on the hardware tier.

**Data colours before the fix (the `main` build of 2026-10-17).** The harness fails every overview, which is the point
of building it first:

| Tone | Exact probes, software, overview shots | Typical colour found |
| --- | --- | --- |
| `cable` | 0 of 457 | `#DAECEB`: the lit tube under the 16% water box |
| `pipeline` | 0 of 193 | `#C29D5E` |
| `alarm` | 0 of 150 | `#C86D61` |
| `suspect` | 9 of 26 | median 6 off: Neutral tone mapping darkens near-black |
