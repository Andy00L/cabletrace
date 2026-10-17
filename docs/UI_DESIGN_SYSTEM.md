# CableTrace UI design system

The single source of truth for every value the interface uses. Components read these values as tokens; a literal color, radius, shadow or duration in a component is a bug.

House style: a calm gray page, white cards and ink actions, where the only color on screen is data (cables, ships, the alarm). Reference for softness and detail: Wealthsimple's product UI, never copied.

Theme: light only for the first version. Palette approved by Andy on 2026-10-16 on the style board canvas.

## Palette

### Interface

| Token | Hex | Use | Contrast |
|---|---|---|---|
| `page` | `#F3F3F1` | The field under everything. Warm neutral, never the cool `#F3F4F6` family. | |
| `card` | `#FFFFFF` | Cards, list rows, the map frame | |
| `soft` | `#E8E8E5` | Second buttons, segmented control track, disabled fill | |
| `ink` | `#141414` | Text, icons, the main action fill | 18.4:1 on card, 16.7:1 on page |
| `ink-hover` | `#2B2B29` | Main action on hover | |
| `muted` | `#62625D` | Secondary text, unselected segments | 6.1:1 on card, 5.5:1 on page, 5.0:1 on soft |
| `faint` | `#9A9A94` | Disabled text, decorative ticks. Never body text. | 2.8:1 on card |

There is no brand accent. The interactive color is `ink`: one ink pill per view.

### Data

| Token | Hex | Drawn as |
|---|---|---|
| `cable` | `#2F6BD8` | Power cable 2.5px, telecom cable 1.5px |
| `pipeline` | `#B66E12` | 3px line. Labels use `pipeline-text` `#8A520D`. |
| `suspect` | `#141414` | The suspect ship's track, 2px, heading arrow at its head |
| `alarm` | `#D93A26` | Anchor drag segment (3.5px), cable breaks, alerts, errors and destructive actions. White on it is 4.6:1. |
| `ship` | `#A8A8A2` | Other ships, 3.5px dots, context only |
| `live` | `#2E9E5B` | Live dots and the live line. Never text (3.4:1). |

Every data line on the map sits on a white casing (`#FFFFFF` at 90%, 2 to 3px wider than the line), so each line keeps at least 3:1 against its casing over any depth band. Map labels use a 3.5px white halo (`paint-order: stroke`).

### Map

| Token | Hex | Depth |
|---|---|---|
| `land` | `#FAFAF8` | Land |
| `coast` | `#E9EAE6` | Land pixels that touch the sea |
| `depth-10` | `#ECF0EF` | 0 to 10 m |
| `depth-20` | `#E6EBEA` | 10 to 20 m |
| `depth-30` | `#E0E7E6` | 20 to 30 m |
| `depth-40` | `#DAE2E1` | 30 to 40 m |
| `depth-50` | `#D4DDDC` | 40 to 50 m |
| `depth-75` | `#CED8D7` | 50 to 75 m |
| `depth-100` | `#C8D3D2` | 75 to 100 m |
| `depth-deep` | `#C2CECD` | Over 100 m |

## Type

One family: TikTok Sans (SIL Open Font License 1.1, served by Google Fonts, variable weight and optical size). Weights 400, 500 and 600; 600 is the ceiling. Every number that can change (speeds, positions, times, counts) uses `font-variant-numeric: tabular-nums`.

| Token | Size / line | Weight | Tracking | Use |
|---|---|---|---|---|
| `display` | 44 / 48 | 600 | -0.02em | The big number on a card |
| `title` | 32 / 38 | 600 | -0.015em | Page titles |
| `heading` | 22 / 28 | 600 | -0.01em | Section headings |
| `card-title` | 18 / 24 | 500 | 0 | Card titles |
| `label` | 15 / 20 | 500 | 0 | Button text, list row titles |
| `body` | 16 / 24 | 400 | 0 | Running text |
| `small` | 14 / 20 | 400 | 0 | Row subtitles, table cells |
| `caption` | 13 / 18 | 500 | 0 | Metadata in `muted` |
| `micro` | 12 / 16 | 500 | +0.01em | Map labels, attribution. The smallest size. |

Sentence case everywhere, including map labels. No uppercase labels.

## Space and shape

- Spacing on a 4px base: 4, 8, 12, 16, 20, 24, 28, 32, 48, 56, 64.
- Radii: card 24, inner 16 (the map inside its card, nested tiles), list row 20, field 12, chip 8, pill 999. An inner radius is always smaller than its parent's.
- Card padding 24 to 28. Page padding 56 top, 64 sides on desktop; 16 sides on a phone.
- Touch targets at least 44px. Buttons 44px tall (40px in dense cards).

## Depth

One light from above. No borders on cards: surfaces separate by tone and shadow.

| Token | Value | Use |
|---|---|---|
| `shadow-card` | `0 1px 2px rgba(20,20,18,0.04), 0 4px 12px rgba(20,20,18,0.04), 0 16px 32px rgba(20,20,18,0.04)` | Cards at rest |
| `shadow-row` | `0 1px 2px rgba(20,20,18,0.04), 0 4px 12px rgba(20,20,18,0.04)` | List rows at rest |
| `shadow-raised` | `0 2px 4px rgba(20,20,18,0.06), 0 8px 20px rgba(20,20,18,0.08)` | Row hover: the shadow deepens, nothing moves |
| `shadow-selected` | `0 1px 2px rgba(20,20,18,0.08), 0 2px 6px rgba(20,20,18,0.06)` | The selected segment, the current rail item |
| `focus-ring` | `0 0 0 2px #FFFFFF, 0 0 0 4px #141414` | Keyboard focus on every interactive element |
| `field-focus` | `0 0 0 2px #141414` | A focused field (field turns `card`) |
| `field-error` | `0 0 0 2px #D93A26` | A field with an error, message below in `alarm` |
| `shadow-popover` | `0 2px 4px rgba(20,20,18,0.06), 0 12px 28px rgba(20,20,18,0.10), 0 24px 48px rgba(20,20,18,0.06)` | Cards, popovers and sheets that float over the console |
| `scrim` | `#141414` at 20% | Behind a sheet or dialog that takes the focus (approved 2026-10-17) |

## Motion

| Token | Value |
|---|---|
| `duration-micro` | 80ms (press, toggles) |
| `duration-small` | 140ms (hover, segment slide) |
| `duration-standard` | 220ms (cards, panels, popovers) |
| `duration-large` | 320ms (sheets, map camera moves inside the UI) |
| `duration-hero` | 480ms (the replay's hero moment) |
| `ease-enter` | `cubic-bezier(0.16, 1, 0.3, 1)` |
| `ease-exit` | `cubic-bezier(0.4, 0, 1, 1)`, exits about 20% shorter than enters |
| `ease-standard` | `cubic-bezier(0.4, 0, 0.2, 1)` |
| `stagger` | 40ms |
| `press-scale` | 0.97 |
| `overshoot` | none |

Transform and opacity only. Every fade carries a 8 to 12px rise. `prefers-reduced-motion` collapses everything to opacity with the same end layout. The live dot's ping and the cable signal are the only ambient loops.

## Components

- **Buttons.** Main: `ink` pill, white text, 15/500. Second: `soft` pill, `ink` text. Text button: `ink` with a `faint` underline at 4px offset. Destructive: `alarm` pill. States: hover `ink-hover`, pressed `press-scale`, focus `focus-ring`, disabled `soft` with `faint` text, loading keeps the width and shows three dots.
- **Field.** 48px, radius 12, `page` fill inside cards, 20px stroke icon on the left, a visible `<label>` above. Focus and error per the depth table.
- **Segmented control.** `soft` track, radius 999, 4px padding; the selected segment is a `card` pill with `shadow-selected` and 600 text; others `muted` 500. Used for periods (6h, 24h, 3d, 7d, All) and for Measured / Illustrated.
- **List row.** A `card` tile, radius 20, `shadow-row`, on the `page`. Left: a 32px sample of the line it stands for (cable, pipeline). Middle: title 15/500 and subtitle 13 `muted`. Right: a tabular date and a chevron.
- **Number card.** Label 14 `muted`, `display` number, a status line, a sparkline in the data color it measures.
- **Detection card.** A 10px `alarm` dot, the heading, the UTC time; a two-column list of the measured signals; Replay (main) and Dismiss (second).
- **Icon rail.** A `page` capsule of 44px round targets, 20px icons at 1.6px stroke, no labels. The current page sits on a `card` disc with `shadow-selected`. New alerts show an 8px `alarm` dot.
- **Icons.** One custom set: 20px grid, 1.6px stroke, round caps and joins.

## Signature element: the signal

The cable under watch carries a faint 12px halo of `cable` at 12% and a short white light that runs along it while the line is healthy. At a break the line stops on both sides of the cut and the break marker (a white disc with an `alarm` ring and center) sits in the gap. Placement: the map, empty states and the sign-in art. Nowhere else.

## Hero moment

The replay: as the timeline plays, the suspect ship's track turns `alarm` where its anchor drags, reaches the cable, and the signal stops at the cut.

The 3D seabed is the main replay view (Andy, 2026-10-16): the overview shows the gulf with depth exaggerated, and the close-up at the cut shows the anchor, the chain and the torn cable ends. The flat map is the overview for lists and alerts.

## Map sources and credits

- Depth: EMODnet Bathymetry Consortium, EMODnet Digital Bathymetry (DTM 2024), https://doi.org/10.12770/cf51df64-56f9-4a99-b1aa-36b8d7b743a1 (CC BY 4.0).
- Land and coast: Natural Earth (public domain), or derived from the depth grid.
- Land heights and the coastline in the 3D seabed: Copernicus DEM GLO-30, produced using Copernicus WorldDEM-30 (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA.
- Pipelines: EMODnet Human Activities.
- Cables: OpenStreetMap contributors (ODbL). The share-alike question is open before they ship.
- Cables no open dataset maps are traced off a published map, and the replay's credit line names that map (EE-S1 off Yle's map, `scripts/seabed/build-seabed.ts`, `tracedLines`). The line is read from each area's seabed file.

## Exceptions to the design kit

Each one is Andy's explicit decision and wins over the default rule in the kit for this project:

1. TikTok Sans is a Google Fonts family (the kit bans Google fonts for the signature face).
2. The page is a light gray (`#F3F3F1`) under white cards (the kit flags the stock UI gray); it stays warm neutral, never cool.
3. The current rail item sits on a white disc behind its icon (the kit bans a box behind an icon), following the Wealthsimple reference.
4. Screens are drawn directly on a claude.ai Design canvas by the agent instead of the Claude Design prompt loop; the canvas replaces `ui-design/palette.html` as the approved palette card.
5. No brand accent: `ink` carries every interactive state.
6. For the console boards (6 to 12, 2026-10-17) Andy approved building without waiting for his review of each board: the boards are drawn first and checked against anti-slop by the agent, and Andy reviews the live result.

## Console

The case replay is one screen (boards 6 to 11 on the style board canvas). The document never scrolls; a panel scrolls inside itself when its content is longer than the panel. Everything the old page stacked under the replay opens on demand, in two interactions or fewer.

### Layout

| Width | Layout |
|---|---|
| 1024 px and up | 56 px top bar on the `page` tone (mark, case switcher, place and date, the mode control Replay, Ship, Evidence, copy link, shortcuts). Under it the stage: the 3D view in one `card`-radius tile, 16 px from the edges. Over the stage's right edge the rail: 360 px of white cards, 16 px inset, folding away to give the view the whole width; the camera frames the subject in the clear part while it is open. Under the stage the dock: transport, timeline and three charts on the replay's time axis. |
| 768 to 1023 px | The rail becomes a sheet over the stage's right side, opened from a button on the stage. The dock keeps the transport and the timeline; the charts move into Ship mode. |
| Under 768 px | The stage takes the top of the screen, the transport and the timeline sit under it, and the rail's content lives in a bottom sheet with two snap points: folded, its handle and the mode switch (96 px); open, 85% of the screen with its content scrolling inside. Drag the header or press the handle; picking a mode, or a link that names one, opens it. Popovers become bottom sheets. The page never scrolls. 16 px gutter, 44 px targets. |

Inside the stage, inset 16 px: the view switch top left (with Measured and Illustrated under it at the cut), the anchor status top centre, the legend and the scale button bottom left, the camera controls (reset, follow, full screen) bottom right of the clear part.

### Layers

One named stack, low to high: `stage` (0), `stage-controls` (10), `rail` and `dock` (20), `popover` (30, cards anchored to an object or a control), `sheet` (40), `dialog` (50), `toast` (60). Tokens `--layer-*` in `globals.css`.

- One layer open at a time; a source popover opened from inside the sources sheet is the one exception.
- Content is visible by default: no layer and no text waits for an animation to appear.
- Sheets and dialogs trap focus and return it to their trigger; Esc closes the top layer; every layer opens from the keyboard, because each object in the 3D view also has a rail row or a button that opens the same layer.
- A card anchored to a 3D object follows it every frame the camera moves, opens beside the object and its label, stays in the part of the stage the rail leaves clear, and flips side near an edge. From 768 to 1023 px it opens under or over the object instead; under 768 px every card docks to the bottom of the screen as a sheet. When its object leaves the view (behind the camera, off the canvas or under the rail) the card hides without closing, and a Show button stacked over the camera controls slides the camera back to the object. In the close-up, or before the ship's first position, the card sits at the top of the stage.
- Each position placed from statements is a small `ink` ring on the track. Clicking or tapping the ship, a cut marker or a ring (or a label) in the overview opens its card there; a press that moves more than 6 px or lasts over 0.5 s stays an orbit, and the pointer turns to a hand over a target. The vessel card always sits on the ship, whether the scene or the ship's name in the rail opened it; a cut or placement card sits on its marker when the scene or a link opened it, and beside its control otherwise. Picking a cut or a position row in Evidence also slides the camera to it, and the row of the open card stays highlighted (`aria-current`), as does the ship's name while the vessel card is open. The viewer side is `projectTarget` and `centerOnTarget` in `src/lib/seabed/scene/viewer.ts`.
- The vessel card holds three figures at the replay moment (speed, course over ground, distance to the nearest mapped line), a line saying whether they come from AIS or a straight line between placed positions, the evidence label with its citations, and two actions: Follow (the Vessel view) and Ship details (Ship mode in the rail). Course is the direction of travel over the 4 minutes around the moment; no case track carries a reported heading.
- Motion: popovers and cards enter in `duration-standard` with `ease-enter` and a 6 px rise, sheets in `duration-large`; exits are 20% shorter with `ease-exit`; reduced motion keeps opacity only.

### URL state

| Key | Values | Default |
|---|---|---|
| `t` | replay minute in UTC, `2024-12-25T16:44Z` | the ship's first known position (an earlier window start stays a scrub away) |
| `view` | `overview`, `top`, `vessel`, `closeup` | `overview` |
| `mode` | `replay`, `ship`, `evidence` | `replay` |
| `detail` | `measured`, `illustrated` (close-up only) | `illustrated` |
| `layer` | `vessel`, `cut-<cut slug>`, `placement-<index>`, `source-<id>`, `sources`, `aftermath`, `shortcuts` | none |

Following the ship is the `vessel` view, so it has no key of its own.

The codec is `src/lib/console/console-state.ts`. Opening a layer pushes a history entry, so Back closes it; time, view and mode replace the current entry. While the replay plays the URL is left alone; pausing or seeking writes `t`.

### Case file

Evidence mode ends with the case file: `/cases/<slug>/case-file`, a JSON download of every position, quote, source and archived copy, with the SHA-256 of the case's canonical form (keys sorted, no whitespace; `src/lib/cases/case-export.ts`). The row shows the hash's first 12 characters; `bun scripts/cases/verify-case-file.ts <file or URL>` recomputes it and exits 0 when the file is intact, 1 when it was altered.

### Charts

The dock's three charts share the timeline's window: speed over ground (`ink`), distance to the nearest mapped cable or pipeline (`cable`), and water under the ship (`muted` line over a `depth-40` fill, depth growing downward). A stretch bounded by a placed position is drawn dashed and the chart says how it was derived under its title; a stretch between two AIS fixes is solid. The drag window is a 5% `alarm` band, the cursor a 1 px `ink` line with a ring on the value. Built by `src/lib/cases/case-series.ts` on the server.

### Components

Primitives are written in `src/components/ui/` on the tokens above. Behaviour comes from Radix; motion is CSS only (the layer keyframes in `globals.css` and transitions on the motion tokens). The `motion` library was tried and left out: its features chunk alone weighed 45 KB compressed, most of the replay page's 60 KB budget for the console.

| Component | Source and licence | What changed |
|---|---|---|
| Dialog, Sheet | `@radix-ui/react-dialog` 1.3.1 (MIT), structure after shadcn/ui's dialog and sheet (MIT) | Written without `cn` or `tailwind-merge`: tailwind-merge would treat our `text-label` size and `text-ink` colour as one conflicting group. Tokens only; `scrim`; focus returns to the trigger. |
| Popover | `@radix-ui/react-popover` 1.3.1 (MIT), structure after shadcn/ui's popover | Same rules; `shadow-popover`, radius `row`. |
| Anchor status island | Idea from bencho.dev `dynamic-island` (MIT, Lorenzo Cabra, https://bencho.dev/blocks/dynamic-island) | Kept: the pill and its expanded card are one shape; width, height and corner transition together (`interpolate-size`, a snap where unsupported) and the content fades in. Dropped: the spring, the demo activities, `lucide-react`, the blur, the overshoot, the black fill (a white pill keeps one ink control per view). Code written here. |
| Timeline snapping | Idea from bencho.dev `time-scrubber` (MIT) | Kept: releasing the scrubber near an event or a cut lands on it. The ruler and fling were not adopted: the native range input keeps the keyboard and screen reader path the tests use. |
| Toast | Idea from bencho.dev `toast-stack` (MIT) | One toast at a time ("Link copied"), bottom centre, `duration-standard`; no stack, no hover fan. |
| Icons | `src/components/icons/` | One set drawn here on a 20 px grid, 1.6 px stroke, round caps and joins. No `lucide-react`. |

## Site pages

Home, the case list, the live globe, the watchlist and the WebGL check share one bar (`src/components/layout/SiteHeader.tsx`): the mark, the sections with the current one on a `card` pill with `shadow-selected`, and the WebGL check at the far end. Content sits 24 px from the edges up to 1,440 px wide.

| Page | 1024 px and up | Under 1024 px |
|---|---|---|
| Home (board 12a) | One screen. Left, 400 px: the title, what CableTrace does, the live recorder card and a link to the recorded day on the globe. Right: the two newest cases as wide cards (sketch beside place, date, title and three facts) sharing the column's height. Between 1,024 and 1,280 px the sketch keeps 16:9 so no cut is cropped. | One column that scrolls; the sketch sits over the text. |
| Case list (board 12b) | Four tiles to a row, five from 1,280 px (sketch over place, date, title and one line of facts), so two rows of cases fit one screen. | Two to a row from 640 px, one under it. |
| Watchlist | Two cards side by side: alerts of the last 24 hours (the detector's findings on a watched ship, a watched cable, or a cable cut in a watched case; `alarm` for an alert, `ink` for a watch) and the watched items with a remove button each. Signed out, the page sends the reader to sign in. | The two cards stack. |
| Sign in, sign up | Clerk's form in the middle of the page, colored from the tokens (`src/app/(account)/layout.tsx`). | Same. |

Accounts (Clerk) exist only for the watchlist. Clerk's script loads on the account pages alone, and its proxy runs only on those paths and `/api/watchlist` (`src/proxy.ts`), so the other pages stay static. A Watch button (bookmark icon) sits in the console's top bar for the case, in a cut card for its cable, and in the vessel card for the ship when its MMSI is published; it does not ask whether the item is already watched, so pages carry no session check. Watched items live in `public.watch_items`, reachable only by the server with the secret key, at most 100 per reader.

## Live globe

`/live` shows the last 24 hours of ship frames (one every 10 minutes, written by `supabase/functions/collect-ship-frames`) on a 3D globe, in the replay console's shell: the section bar, the stage, the rail floating over its right edge from 1024 px, and the dock. It is a recorded day, never real time, and the stage says so.

- **Globe** (`src/lib/globe/globe-viewer.ts`). Natural Earth land in `land` on `depth-40` water, a 1 px coast in the seabed contour tone, the limb darkened a little so the sphere reads round, and a faint `depth-40` rim against the page. Northern Europe (12 W to 45 E, 48 to 72 N), where the replays and the recorder are, sits on a sharper patch so coasts stay crisp when the camera flies down to a ship.
- **Ships.** One `ship` dot each, blended on the GPU between the two frames around the moment. A ship missing from one frame fades in or out; a move faster than 50 knots jumps instead of streaking. The selected ship carries an `ink` ring. Ship type reads in the card, never as a color.
- **Lines.** The cables and pipelines of the replays' seabed areas, in their data colors.
- **Rail.**
  - The moment: ships heard, by feed, and the coverage sentence (coastal receivers only; open ocean looks empty because no receiver hears it).
  - The selected ship: its last report in the frame, then its name and size when a feed sent them.
  - The anchor-drag watch (`recent_detections`, alerts first): a row selects that ship and flies the camera to it.
- **Dock.** Play (a day in 72 s), the UTC clock and date, and the day as a scrubber with a tick for each stored frame, so a missing slot shows as a gap.
- **Data path.** Frames come through `/api/ship-frames`, which the Vercel CDN caches (two days for a sealed frame), so Supabase serves each frame about once.
- **Test hooks.**
  - `live-globe` carries `data-state` before the day loads, then `data-ship-count` and `data-frame-count`.
  - `live-globe-view` carries `data-state` loading, ready or failed.
  - Others: `live-ship-count`, `live-ship-card` (with `data-mmsi`), `live-detections`, `live-detection-<id>`, `live-play`, `live-scrubber`, `live-clock`, `live-credits`.

