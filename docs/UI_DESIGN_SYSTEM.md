# CableTrace UI design system

The single source of truth for every value the interface uses. Components read these values as tokens; a literal color, radius, shadow or duration in a component is a bug.

House style: a calm gray page, white cards and ink actions, where the only color on screen is data (cables, ships, the alarm). Reference for softness and detail: Wealthsimple's product UI, never copied.

Theme: light only for the first version. Palette approved by Andy on 2026-10-16 on the style board canvas.

## Palette

### Interface

| Token | Hex | Use | Contrast |
|---|---|---|---|
| `page` | `#F2EADA` | Parchment: the field under everything, the 1865 painting's sky lifted. | `ink` 14.5:1, `muted` 5.9:1 |
| `paper` | `#F9F1E2` | The sign-in, sign-up and account pages: the median paper of Andy's engravings (style board, 19 Oct 2026). | `ink` 16.4:1, `muted` 5.5:1 on it |
| `card` | `#FBF7EE` | Vellum: cards, list rows, the map frame (never pure white). | `ink` 16.2:1, `muted` 6.6:1 |
| `soft` | `#E7DCC4` | Tan: second buttons, segmented control track, selected rows, disabled fill | `muted` 5.2:1 |
| `ink` | `#1C1A16` | Sepia-black: text, icons, the main action fill | 16.2:1 on card, 14.5:1 on page |
| `ink-hover` | `#36322A` | Main action on hover | |
| `muted` | `#5F584C` | Secondary text, unselected segments | 6.6:1 on card, 5.9:1 on page, 5.2:1 on soft |
| `faint` | `#A39A88` | Disabled text, decorative ticks. Never body text. | |
| `slate` | `#2B2E2A` | The night sea: dark bands (the replay's dock and status, the cases page and the globe's field) | `page` 11.5:1, `mist` 6.0:1, `dusk` 7.8:1 on it |
| `slate-raised` | `#3A3D38` | Controls and tracks on slate | |
| `mist` | `#A9AD9F` | Secondary text on slate | 6.0:1 on slate |
| `dusk` | `#DFBF84` | Accent on slate: play, playhead, the Discover Button's fill there | 7.8:1 on slate |
| `brass` | `#8A6A2E` | Accent on light: links, focus rings. As text only on `card` (4.7:1; 4.2:1 on page) | |

The interface tones come from Robert Charles Dudley's *The Great Eastern Under Weigh, July 23rd, 1865*, the front page's painting (approved by Andy on the style board of 22 Oct 2026, replacing the grey `#F3F3F1` field and white cards). The interactive colour is still `ink` on light (one ink pill per view) and `dusk` on slate; `brass` marks links and focus. The data colours below did not change, and neither did the 3D scene.

### Data

| Token | Hex | Drawn as |
|---|---|---|
| `cable` | `#2F6BD8` | Power cable 2.5px, telecom cable 1.5px |
| `pipeline` | `#B66E12` | 3px line. Labels use `pipeline-text` `#8A520D`. |
| `suspect` | `#141414` | The suspect ship's track, 2px, heading arrow at its head |
| `alarm` | `#D93A26` | Anchor drag segment (3.5px), cable breaks, alerts, errors and destructive actions. White on it is 4.6:1. |
| `ship` | `#A8A8A2` | Other ships, 3.5px dots, context only |
| `live` | `#2E9E5B` | Live dots and the live line. Never text (3.4:1). |
| `density` | `#3F7E86` | The live globe's ship density at the Planet tier, graduated dots at 78%. The approved water teal (water B), picked by Andy on board 25, 20 Oct 2026. |

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
| `hero` | 44 to 84 / 1.02 | 600 | -0.035em | The landing's headline, closing line and ledger figures only: `clamp(2.75rem, 1.2rem + 4.5vw, 5.25rem)`, 84 px from 1,440 px |
| `lead` | 20 / 30 | 400 | 0 | The landing's supporting sentences |
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

The 600-weight sizes (`hero`, `display`, `title`, `heading`) take their own fallback face, Arial Bold or Liberation Sans Bold at 91.8%, which wraps like TikTok Sans at 600 while the web font loads (`src/app/layout.tsx`). Body text keeps Next's fallback at 104.34%. Both faces list Liberation Sans, which has Arial's widths, for Linux.

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

Transform and opacity only. Every fade carries a 8 to 12px rise. `prefers-reduced-motion` collapses everything to opacity with the same end layout. The live dot's ping, the cable signal and the live globe's fault ripple (approved by Andy, 20 Oct 2026) are the only ambient loops. On the landing the ping runs on one dot only, the recorder's status beside "Live watch"; the region dots are still (Andy, 21 Oct 2026), and reduced motion drops the ring.

One move runs longer than `duration-hero`: the live globe's dive to a cut (1,600 ms on `ease-standard`, see Live globe), the globe's one hero move, built under exception 6 for review on the live result.

## Components

- **Buttons.** Main: `ink` pill, white text, 15/500. Second: `soft` pill, `ink` text. Text button: `ink` with a `faint` underline at 4px offset. Destructive: `alarm` pill. States: hover `ink-hover`, pressed `press-scale`, focus `focus-ring`, disabled `soft` with `faint` text, loading keeps the width and shows three dots.
- **Field.** 48px, radius 12, `page` fill inside cards, 20px stroke icon on the left, a visible `<label>` above. Focus and error per the depth table.
- **Segmented control.** `soft` track, radius 999, 4px padding; the selected segment is a `card` pill with `shadow-selected` and 600 text; others `muted` 500. Used for periods (6h, 24h, 3d, 7d, All) and for Measured / Illustrated.
- **List row.** A `card` tile, radius 20, `shadow-row`, on the `page`. Left: a 32px sample of the line it stands for (cable, pipeline). Middle: title 15/500 and subtitle 13 `muted`. Right: a tabular date and a chevron.
- **Number card.** Label 14 `muted`, `display` number, a status line, a sparkline in the data color it measures.
- **Detection card.** A 10px `alarm` dot, the heading, the UTC time; a two-column list of the measured signals; Replay (main) and Dismiss (second).
- **Icon rail.** A `page` capsule of 44px round targets, 20px icons at 1.6px stroke, no labels. The current page sits on a `card` disc with `shadow-selected`. New alerts show an 8px `alarm` dot.
- **Icons.** One custom set: 20px grid, 1.6px stroke, round caps and joins.

## ASCII layer

Approved by Andy on the style board of 22 Oct 2026, after ascii-magic.com: Dudley's paintings redrawn as glyphs, each glyph in the colour of the patch it replaces (`AsciiPicture`, `src/components/ascii/AsciiPicture.tsx`; the arithmetic in `src/lib/ascii/ascii-grid.ts`). It fills what would be an empty field, never carries meaning (hidden from assistive technology), and never sits under body text at more than low contrast.

- **Styles** (`AsciiStyle`, after ascii-magic.com's styles, Andy, 22 Oct 2026: "use different ones accordingly"). Each place takes the style that suits what sits on it:

  | Place | Style | Why |
  |---|---|---|
  | Under the front page's painting | `halftone`, 6 px dots in the painting's colours, fading into `page` | A print screen after the watercolour: the painting turns to print, then to page. |
  | Beside "Inside a replay" | `glyph` (`dense` ramp), 5 px, `dusk` on `slate`, shimmering | The one classic ASCII plate, where the page was empty; nothing sits on it. |
  | The front page's case ledger | `binary`, 8 px 0s and 1s, half toned to `slate`, flipping slowly | The cases as data; faint enough for the heading on it. |
  | The cases page | `braille`, 7 px cells of 2 by 4 dots, toned to `slate` | Four times a glyph's detail at the same size, so the night sea reads as texture behind the list. |
  | The live globe's field | `dither`, 4 px pixels, toned to `slate`, still | Holds still beside the globe's own motion; costs nothing after one draw. |
  | The replay's dock | `hatch`, engraved strokes, toned to `slate`, still | Horizontal lines run with the timeline and stay quiet behind the charts. |

- **Fade.** The last rows thin out on a 4 x 4 Bayer pattern and pale toward the ground, so a band ends in the page without a gradient.
- **Motion.** A character style on screen may shimmer: 1.2% of its cells step one place on the ramp (a digit flips, a braille dot toggles) and back every 140 ms. Shapes hold still. Nothing moves under reduced motion or off screen.
- **Cost.** One canvas draw per size change, once the box has held its size for 200 ms (a 1,440 by 200 px band is about 4,000 glyphs); the pictures are the 1,200 px files the page already serves. The canvas draws in software (`willReadFrequently`), so it never competes with the 3D view for the GPU.

**Flip Text** (`src/components/ui/FlipText.tsx`, after ObsidianUI, MIT): a heading's letters turn once around their x axis and rise 8 px under the pointer, 400 ms `ease-enter`, CSS only. **Discover Button** (`src/components/ui/DiscoverButton.tsx`, after ObsidianUI, MIT): the main call to action, a pill whose arrow circle sweeps its fill across the label in 480 ms (a clip-path), `ink` on light and `dusk` on slate.

## Signature element: the signal

The cable under watch carries a faint 12px halo of `cable` at 12% and a short white light that runs along it while the line is healthy. At a break the line stops on both sides of the cut and the break marker (a white disc with an `alarm` ring and center) sits in the gap. Placement: the map, empty states and the sign-in art. Nowhere else.

## Hero moment

The replay: as the timeline plays, the suspect ship's track turns `alarm` where its anchor drags, reaches the cable, and the signal stops at the cut.

The 3D seabed is the main replay view (Andy, 2026-10-16): the overview shows the gulf with depth exaggerated, and the close-up at the cut shows the anchor, the chain and the torn cable ends. The flat map is the overview for lists and alerts.

Each seabed area picks its own exaggeration from its elevation range (`chooseSceneExaggeration` in `src/lib/seabed/scene-scales.ts`): the largest of 20, 10, 5, 3, 2 or 1 that keeps the drawn relief within 7 km, land never more than water. The Baltic blocks keep 20 and 10; the southern Red Sea draws 10 and 3, Keelung 3 and 3, Svalbard 2 and 2. The view's scale note states the area's own factors.

## Map sources and credits

- Depth: EMODnet Bathymetry Consortium, EMODnet Digital Bathymetry (DTM 2024), https://doi.org/10.12770/cf51df64-56f9-4a99-b1aa-36b8d7b743a1 (CC BY 4.0).
- Land and coast: Natural Earth (public domain), or derived from the depth grid.
- Land heights and the coastline in the 3D seabed: Copernicus DEM GLO-30, produced using Copernicus WorldDEM-30 (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA.
- Pipelines: EMODnet Human Activities.
- Cables: OpenStreetMap contributors (ODbL 1.0). The files derived from it (`public/globe/cables.json` and the lines in `public/seabed/*-seabed.json`) are offered under the same ODbL 1.0, as its share-alike clause requires; the stage credits OpenStreetMap wherever its lines show.
- Cables no open dataset maps are traced off a published map, and the replay's credit line names that map (EE-S1 off Yle's map, `scripts/seabed/build-seabed.ts`, `tracedLines`). The line is read from each area's seabed file.

## Exceptions to the design kit

Each one is Andy's explicit decision and wins over the default rule in the kit for this project:

1. TikTok Sans is a Google Fonts family (the kit bans Google fonts for the signature face).
2. The page is a light gray (`#F3F3F1`) under white cards (the kit flags the stock UI gray); it stays warm neutral, never cool.
3. The current rail item sits on a white disc behind its icon (the kit bans a box behind an icon), following the Wealthsimple reference.
4. Screens are drawn directly on a design canvas by the agent instead of a separate prompt-and-generate loop; the canvas replaces `ui-design/palette.html` as the approved palette card.
5. No brand accent: `ink` carries every interactive state.
6. For the console boards (6 to 12, 2026-10-17) Andy approved building without waiting for his review of each board: the boards are drawn first and checked against anti-slop by the agent, and Andy reviews the live result.

## Console

The case replay is one screen (boards 6 to 11 on the style board canvas). The document never scrolls; a panel scrolls inside itself when its content is longer than the panel. Everything the old page stacked under the replay opens on demand, in two interactions or fewer.

### Layout

| Width | Layout |
|---|---|
| 1024 px and up | 56 px top bar on the `page` tone (mark, case switcher, place and date, the mode control Replay, Ship, Evidence, copy link, shortcuts). Under it the stage: the 3D view in one `card`-radius tile, 16 px from the edges. Over the stage's right edge the rail: 360 px of vellum cards, 16 px inset, folding away to give the view the whole width; the camera frames the subject in the clear part while it is open. Under the stage the dock, a slate band (Dock and status, below): transport, timeline and three charts on the replay's time axis. |
| 768 to 1023 px | The rail becomes a sheet over the stage's right side, opened from a button on the stage. The dock keeps the transport and the timeline; the charts move into Ship mode. |
| Under 768 px | The stage takes the top of the screen, the transport and the timeline sit under it, and the rail's content lives in a bottom sheet with two snap points: folded, its handle and the mode switch (96 px); open, 85% of the screen with its content scrolling inside. Drag the header or press the handle; picking a mode, or a link that names one, opens it. Popovers become bottom sheets. The page never scrolls. 16 px gutter, 44 px targets. |

Inside the stage, inset 16 px: the view switch top left (with Measured and Illustrated under it at the cut), the anchor status top centre from 1400 px (narrower, under the view switch), the legend (only the kinds of line the area draws: the southern Red Sea has no pipeline) and the scale button bottom left, the camera controls (Director, reset, full screen; board 22) bottom right of the clear part. Reset (`reset-view`) puts the view on screen back on its opening framing; whatever holds the camera lets go first, the director (turned off) and in the Vessel view a ship camera (back to Follow), since a held camera is drawn over any preset (`view-reset.ts`). On the Vessel view's own follow camera, which takes no orbit or zoom, it is disabled with a tooltip saying there is nothing to reset. While the replay plays, the anchor status also counts down to the next event in replay time ("next event in 38 min", and from a day out "in 5 days 10 h", from 640 px). In a case without a drag, while the sources place the ship on one point (Hai Hong Gong 66 at the wreck), the status reads "Ship held at one point, no anchor drag", the ship's label "reconstructed, held at one point", and the vessel card names the place and the run's times with their sources (`vessel-held`), so a still ship reads as the record, not a stalled replay.

### Director

The camera director (`src/lib/seabed/scene/director/`, board 21) picks the shot from the replay time: establishing until the ship's first known position, follow while it sails, approach in the 6 minutes before a cut it can be watched reaching, the cut's close-up for 2 minutes after it, then the aftermath. A plain link to a case starts with the director on; a link that names a view or a moment opens exactly that, with the director off. Picking a view, a view key, Follow, or dragging, pinching or scrolling the picture takes the camera from the director; the Director button (`director-toggle`, `data-state` on or off, the stage's one ink control while it directs) gives it back. Reset takes the camera from the director too, and frames the view the director was showing as that view opens. The view switch always shows the view on screen. Between shots the camera flies for `duration-hero` on `ease-standard` and cuts into and out of the close-up; reduced motion cuts everywhere, with the same shots.

The replay clock runs 30 times slower from 6 minutes before each cut to 2 minutes after it, easing in and out over 2 minutes of replay time on each side (`replay-pace.ts`): Eagle S's C-Lion1 cut plays in about 12 s (14 s with the ramps), the whole window in about 67 s instead of 40 s.

The director frames every shot on the overview scene with the storyboard's method (`framing.ts`): each subject inside the safe area (the stage minus its controls bands, 72 px top and bottom, 112 px on top on a phone, and the right column the rail or the anchor cam takes) with a 24 px margin, from the angle the relief hides least. The viewer gives it a typed port (`viewer.director`, `viewer-port.ts`): the subjects, the sight-line test, a camera pose, the close-up's orbit, the anchor's figures, a second view and the hover readout. The camera driver (`camera-driver.ts`) loads after the viewer, never before the first frame.

**Anchor cam** (board 22, `anchor-cam`, `data-state` anchor or swapped, `data-size` rest or expanded): while the anchor is on the seabed, a 360 px window top right of the stage (the rail starts under it) shows the seabed from behind the anchor, labelled illustrated, with depth, chain out, the distance to the nearest cable under the case's name and the anchor's speed over the seabed (`anchor-cam-depth`, `-chain`, `-cable`, `-speed`). Swap (`anchor-cam-swap`) puts the anchor cam in the main view and the ship in the window; expand (`anchor-cam-expand`) grows it to 640 px, or as wide as the stage's height allows with the rail's tab under it (420 px on a 720 px tall window); grown, the status pill keeps the row under the view switcher. When the rail would have under 240 px under the anchor cam (a short window, or the window grown), it folds to a tab (`rail-tab`: "Show panel" over what it holds) that opens the whole rail over the stage's right column, on the page tone (`rail-tab-panel`), while the pointer rests on it, and stays open after a press until Escape, a press outside, or its Hide button. On a phone it starts folded to a pill (`anchor-cam-open`), so nothing is drawn for it until it is opened. Its picture is a second pass of the same renderer at the window's own size, every frame while the window is open (on a GPU it skips a frame right after a slow one, never below 20 a second): WebGPU draws it straight into the window's canvas, WebGL draws it in a corner of the stage's canvas and copies it out before the stage's frame.

**Ship cameras** (`ship-camera-switch`): Follow, Bridge view and Anchor cam on the vessel card and the rail's ship card, each in the Vessel view; none is pressed while the director or another view holds the camera.

**Hover readout** (`stage-hover-readout`): a mouse resting on the sea gets a small card by the pointer with the water's depth there, the nearest cable and its distance, and when the ship passed nearest and how far off (`hover-readout.ts`, `ground-readout.ts`). Mouse only; a drag or a touch moves the camera instead.

**Labels** keep 8 px inside the stage (a label cut by the edge slides back in; one mostly outside hides) and never sit on a control or card: the console marks those `data-label-blocker` (the stage controls, the status island, the rail, the anchor cam, the cards), and the label placer hides a label that would cover one (`labels.ts`, `hideOverlappingLabels`).

While the 3D view loads, the stage shows one progress line in two parts, the seabed and then the ship and scene (`stage-loading`, `data-state` seabed or ship); the console's skeleton draws the same card at its first step.

### Dock and status

Approved by Andy on the style board of 22 Oct 2026 ("Dock and status" in slate): the dock and the anchor status are the console's two dark pieces; every card stays vellum on parchment.

- **Dock** (`ConsoleDock`). A `slate` band with Dudley's night sea engraved behind it (`AsciiPicture`, `hatch` style, Andy's pick for the dock: the Albany painting's lower 26%, horizontal strokes on 4 px lines, each as thick as its patch is bright, every stroke 65% toward `slate`, held still). Strokes cover about 46% of the band, so they take more toning than glyphs: at 45% the brightest stood at 3.1:1 on slate. Measured on the 1440 x 900 render at 65%: 1.1:1 against slate at the median, 1.6:1 at the 95th percentile, 2.1:1 at the brightest. Every line of text in the dock carries a slate halo (2, 4, 4 and 8 px, as `map-label-halo` does in vellum) so the strokes around a letter fall back to slate: behind the dock's `mist` text the ground holds it at 4.4 to 5.4:1 at the 95th percentile and 4.2 to 4.9:1 at the 99th (5.5 to 5.9:1 at the median; over bare strokes it would keep 3.7:1 at the 95th), `dusk` labels at 4.5:1 or more at the 99th, `page` at 7.4:1 or more. The AIS strip's vellum card over the timeline drops the halo. The canvas draws once per size change and never animates. The console's skeleton draws the dock in `slate` with `slate-raised` ghosts.
- **Transport.** Play is a `dusk` disc with a `slate` glyph (7.8:1), `page` on hover; the UTC clock in `page`, "UTC" and the local time in `mist`.
- **Timeline.** Track `slate-raised`, the played part `dusk`, the drag window `alarm` at 40% and `alarm` where played, event ticks `faint` (4.9:1) and faults `alarm`. The head is a `dusk` ring on `slate`; its focus ring is `slate` then `dusk`. A cut keeps the signature break marker (a `card` disc in an `alarm` ring); its label is `dusk` text, because `alarm` on slate is 3.0:1, enough for a mark, never for text.
- **Anchor status** (`StatusIsland`). A `slate` pill with `page` text, the `alarm` dot and the countdown and chevron in `mist`. Opened, its quotes sit on `slate-raised` (`page` text 9.2:1, `mist` 4.8:1) and its source numbers are `dusk` links.
- **Light parts.** Text links on `card` are `brass` (4.7:1) with a `brass` underline at 40%: the source numbers and "Ship details". On a selected row they turn `ink`, since brass on `soft` is 3.7:1. Selected rows (the current event, the open card's row in Evidence, the ship's name while its card is open, the current case in the switcher) sit on `soft`; hover stays `page`. The anchor cam's frame is `slate`.

### Layers

One named stack, low to high: `stage` (0), `stage-controls` (10), `rail` and `dock` (20), `popover` (30, cards anchored to an object or a control), `sheet` (40), `dialog` (50), `toast` (60). Tokens `--layer-*` in `globals.css`.

- One layer open at a time; a source popover opened from inside the sources sheet is the one exception.
- Evidence is never more than two interactions from the console's first state (`scripts/checks/evidence-reach.ts`): each row of the sources sheet keeps its page and archive links visible under the row (its quotes fold inside it), each step of What followed shows its quotes beside its source numbers, and at the cut the scale popover gives both the illustrated and the measured sentence, the current one first.
- The console's first Tab stop is "Skip to the replay timeline" (`skip-to-timeline`), hidden until focused, which moves focus to the scrubber. Shortcuts work everywhere except in a field that takes typing; on the scrubber the arrow keys keep their one-minute step and the other shortcuts still work.
- Every layer gives focus back to the control that opened it when it closes (`useReturnFocusToOpener`, `scripts/checks/keyboard-path.ts`).
- Content is visible by default: no layer and no text waits for an animation to appear.
- Sheets and dialogs trap focus and return it to their trigger; Esc closes the top layer; every layer opens from the keyboard, because each object in the 3D view also has a rail row or a button that opens the same layer.
- A card anchored to a 3D object follows it every frame the camera moves, opens beside the object and its label, stays in the part of the stage the rail leaves clear, and flips side near an edge. From 768 to 1023 px it opens under or over the object instead; under 768 px every card docks to the bottom of the screen as a sheet. When its object leaves the view (behind the camera, off the canvas or under the rail) the card hides without closing, and a Show button stacked over the camera controls slides the camera back to the object. In the close-up, or before the ship's first position, the card sits at the top of the stage.
- Each position placed from statements is a small `ink` ring on the track. Clicking or tapping the ship, a cut marker or a ring (or a label) in the overview opens its card there; a press that moves more than 6 px or lasts over 0.5 s stays an orbit, and the pointer turns to a hand over a target. The vessel card always sits on the ship, whether the scene or the ship's name in the rail opened it; a cut or placement card sits on its marker when the scene or a link opened it, and beside its control otherwise. Picking a cut or a position row in Evidence also slides the camera to it, and the row of the open card stays highlighted (`aria-current`), as does the ship's name while the vessel card is open. The viewer side is `projectTarget` and `centerOnTarget` in `src/lib/seabed/scene/viewer.ts`.
- The vessel card holds three figures at the replay moment (speed, course over ground, distance to the nearest mapped line), a line saying whether they come from AIS or a straight line between placed positions, the evidence label with its citations, and two actions: Follow (the Vessel view) and Ship details (Ship mode in the rail). Course is the direction of travel over the 4 minutes around the moment; no case track carries a reported heading.
- Labels in the overview never overlap: after each frame, a label whose text would cover a higher-ranked one hides until it is clear (vessel, then cuts, then cable and pipeline names, then place names; `hideOverlappingLabels` in `src/lib/seabed/scene/labels.ts`). The hidden ones return as the camera zooms in.
- Motion: popovers and cards enter in `duration-standard` with `ease-enter` and a 6 px rise, sheets in `duration-large`; exits are 20% shorter with `ease-exit`; reduced motion keeps opacity only.

### URL state

| Key | Values | Default |
|---|---|---|
| `t` | replay minute in UTC, `2024-12-25T16:44Z` | the ship's first known position (an earlier window start stays a scrub away) |
| `view` | `overview`, `top`, `vessel`, `closeup` | `overview` |
| `mode` | `replay`, `ship`, `evidence` | `replay` |
| `detail` | `measured`, `illustrated` (close-up only) | `illustrated` |
| `layer` | `vessel`, `cut-<cut slug>`, `placement-<index>`, `source-<id>`, `sources`, `aftermath`, `shortcuts` | none |

Following the ship is the `vessel` view, so it has no key of its own. The director has no key either: it is on when the link names neither `view` nor `t`. While it directs, the `view` written into the link is the view on screen.

The codec is `src/lib/console/console-state.ts`. Opening a layer pushes a history entry, so Back closes it; time, view and mode replace the current entry. While the replay plays the URL is left alone; pausing or seeking writes `t`.

### Case file

Evidence mode ends with the case file: `/cases/<slug>/case-file`, a JSON download of every position, quote, source and archived copy, with the SHA-256 of the case's canonical form (keys sorted, no whitespace; `src/lib/cases/case-export.ts`). The row shows the hash's first 12 characters; `bun scripts/cases/verify-case-file.ts <file or URL>` recomputes it and exits 0 when the file is intact, 1 when it was altered.

### Charts

The dock's three charts share the timeline's window: speed over ground, distance to the nearest mapped cable or pipeline, and water under the ship (a line over a fill, depth growing downward). A stretch bounded by a placed position is drawn dashed and the chart says how it was derived under its title; a stretch between two AIS fixes is solid. Built by `src/lib/cases/case-series.ts` on the server. Each surface has its own tones (`CaseCharts`, `surface`), every line at 3:1 or more against its ground:

| | On `slate` (the dock) | On `card` (Ship mode under 1024 px) |
|---|---|---|
| Speed | `page` line, 11.5:1 | `ink` |
| Nearest line | `cable` mixed 75% with `page` (`#608BD9`), 4.1:1; `cable` itself is 2.8:1 on slate | `cable` |
| Water | `mist` line (6.0:1) over `mist` at 16% | `muted` line over `depth-40` |
| Titles, units, axis, note | `page`; `mist` | `ink`; `muted`, axis `faint` |
| Drag window | `alarm` at 10% | `alarm` at 5% |
| Cursor | 1 px `page`, value ring on `slate` | 1 px `ink`, value ring on `card` |

### Components

Primitives are written in `src/components/ui/` on the tokens above. Behaviour comes from Radix; motion is CSS only (the layer keyframes in `globals.css` and transitions on the motion tokens). The `motion` library was tried and left out: its features chunk alone weighed 45 KB compressed, most of the replay page's 60 KB budget for the console.

| Component | Source and licence | What changed |
|---|---|---|
| Dialog, Sheet | `@radix-ui/react-dialog` 1.3.1 (MIT), structure after shadcn/ui's dialog and sheet (MIT) | Written without `cn` or `tailwind-merge`: tailwind-merge would treat our `text-label` size and `text-ink` colour as one conflicting group. Tokens only; `scrim`; focus returns to the trigger. |
| Popover | `@radix-ui/react-popover` 1.3.1 (MIT), structure after shadcn/ui's popover | Same rules; `shadow-popover`, radius `row`. |
| Anchor status island | Idea from bencho.dev `dynamic-island` (MIT, Lorenzo Cabra, https://bencho.dev/blocks/dynamic-island) | Kept: the pill and its expanded card are one shape; width, height and corner transition together (`interpolate-size`, a snap where unsupported) and the content fades in. Dropped: the spring, the demo activities, `lucide-react`, the blur, the overshoot. The fill is `slate` since 22 Oct 2026 (Dock and status, above). Code written here. |
| Timeline snapping | Idea from bencho.dev `time-scrubber` (MIT) | Kept: releasing the scrubber near an event or a cut lands on it. The ruler and fling were not adopted: the native range input keeps the keyboard and screen reader path the tests use. |
| Toast | Idea from bencho.dev `toast-stack` (MIT) | One toast at a time ("Link copied"), bottom centre, `duration-standard`; no stack, no hover fan. |
| Icons | `src/components/icons/` | One set drawn here on a 20 px grid, 1.6 px stroke, round caps and joins. No `lucide-react`. |

## Site pages

The landing, the case list, the live globe, the watchlist and the WebGL check share one bar (`src/components/layout/SiteHeader.tsx`): the mark (it links to the landing), the sections Cases, Live and Watchlist with the current one on a `card` pill with `shadow-selected`, and the WebGL check at the far end. Under 640 px the mark drops its name and the WebGL check hides. Content sits 24 px from the edges up to 1,440 px wide.

| Page | 1024 px and up | Under 1024 px |
|---|---|---|
| Landing | See "Landing" below. | |
| Case list | Under the bar, a `slate` field (radius 24) fills the page: Dudley's night painting as glyphs at its top (`AsciiPicture`, 7 px cells, `dense` ramp, 35% toward `slate`, the last 20% of its rows thinning into the slate, shimmering on screen), at its own 1,200 by 729 proportions so a long list never stretches it. On it the head: "Cases" in `page` with Flip Text, the intro in `mist`, the count ("10 cases in 5 regions") in `mist` at the far end; the head and the region names carry a `slate` text halo (blurred 3, 8 and 14 px) so the glyphs fade out around them. Then the cases grouped by region (Gulf of Finland, Central Baltic, Norway and Svalbard, Taiwan Strait, Red Sea; `src/lib/cases/case-regions.ts`), region names in `page` and their counts in `mist`, newest first in each, as compact `card` rows: a 112 px sketch (map colours unchanged) beside place, date, title and one line of facts. A shadow does not read on slate, so a row has none: on hover it steps to `page`, and its focus ring is `dusk` on a `slate` gap. Three columns from 1,280 px, two from 768 px, so a dozen cases fit one screen. Measured on the render, 22 Oct 2026: the intro in `mist` 6.0:1 on its median background pixel and 5.7:1 on the brightest 5%; the title in `page` 10.3:1 on the brightest 5%; rows `ink` 16.2:1, `muted` 6.6:1. | One column. The painting spans the field's width (about 218 px tall at 390 px), so its moonlit clouds sit behind the intro: `mist` 6.0:1 median, 4.4:1 on the brightest 5%. |
| Watchlist | Two cards side by side: alerts of the last 24 hours (the detector's findings on a watched ship, a watched cable, or a cable cut in a watched case; `alarm` for an alert, `ink` for a watch) and the watched items with a remove button each. Signed out, the page sends the reader to sign in. | The two cards stack. |
| Sign in, sign up (board 16) | On `paper`, the threads engraving rising from the bottom; Clerk's form centred, 420 px, styled as a plate: Google first as the ink pill, the email code under it, the development-tier note below (`src/components/account/AccountPage.tsx`). | Same, full width with the 16 px gutter. |

The whole app sits behind sign-in (Andy, 17 Oct 2026). Public: the landing, the data and credits page (`/credits`), the sign-in and sign-up pages, `/api/health`, and static files (the landing's MP4 and WebM footage included). Every other page sends a signed-out reader to sign in and back to the exact link afterwards (same origin only); every other API answers 401 (`src/proxy.ts`). Anyone can create an account, with Google or a code by email. Clerk's script loads on the pages behind sign-in and the account pages (`src/components/account/ClerkAppProvider.tsx`, used by their layouts) and never on the landing; it keeps the short-lived session cookie fresh for the APIs those pages call. Pages stay prerendered; the proxy checks the session before serving them. A Watch button (bookmark icon) sits in the console's top bar for the case, in a cut card for its cable, and in the vessel card for the ship when its MMSI is published; it does not ask whether the item is already watched, so pages carry no session check. Watched items live in `public.watch_items`, reachable only by the server with the secret key, at most 100 per reader.

## Landing

The public front door (`src/app/page.tsx`), redesigned on 21 Oct 2026 with the taste skill (direction "The product performs", palette and pictures approved by Andy that day), and on 22 Oct 2026 opened and closed on Robert Charles Dudley's watercolours of the 1865 and 1866 Atlantic cable expeditions at Andy's request ("add the same style of image you put in the footer to the header"): the console's footage sits in a window over the first one, on `page` with `ink` and `card`, `alarm` only where a cable fails, `live` only on live dots. No eyebrows, no hairline rules, no text shadows, no gradients; surfaces part by a step in tone (`card` and `soft` bands on `page`). Content runs to 1,440 px with 16, 24 and 32 px gutters; sections sit 112 px apart on a phone and 192 px from 768 px.

| Section | 1024 px and up | Under 1024 px |
|---|---|---|
| Hero | Dudley's *The Great Eastern Under Weigh, July 23rd, 1865* fills the band behind the bar, at up to 88svh (820 px): the `hero` headline "Every cable cut, replayed." in Flip Text, the `lead` sentence, the Discover Button "Open the console" (`open-console`) and "Sign in" sit in its evening sky, and its caption is a small `card` label on its sea, bottom left. Under the band its sea carries on for 160 px as glyphs (the ASCII layer) thinning into the page. Then the Eagle S moments (`hero-moments`) on the left; on the right the stage, the console's own footage and dock in a `card` window (`HeroReplay`), rising 288 px over the glyphs and the painting's sea. | Headline, sentence and actions on `page`, then the painting at 4:3, its 96 px glyph band and its caption, then the stage, then the moments. |
| Inside a replay | "Inside a replay" (Flip Text) and its sentence on the left, and on the right, where the page was empty, a 340 px plate of the Great Eastern in glyphs, `dusk` on `slate`, shimmering. Then three statements, each beside the real thing at its own size: the Vessel view with the anchor cam (still), the cut (still), and the console's source card for the C-Lion1 placement (`landing-evidence`). The rows differ in width. | The heading, then the plate (224 px), then each statement above its picture. |
| Anchor | "How a dragged anchor cuts a cable": the anchor figure (below) held in a 560 px sticky box on the right while three statements scroll on the left, "The anchor drops.", "It drags along the seabed.", "The cable parts.", each with the model's own numbers; the one in the middle of the screen is in `ink` (the others `muted`) and sets the figure's stage (`AnchorStory`). The figure's caption follows, at `body` in `ink`. | The figure and the active statement hold together under the sticky bar (the figure in a 50svh box) while empty markers scroll past, so no text slides under the figure. |
| Cases | A `slate` band the width of the page with the night painting in glyphs behind it: a two-line `display` heading (count of cases in `mist`, count of sources in `page`) and the Discover Button "See every case" in `dusk`; every case as one band, `card` and `soft` alternating: the first cut's date, the case and where, the lines cut, the source count (`landing-cases`, `case-card-<slug>`). A band turns `dusk` on hover and opens the replay. | Each band stacks date, case, lines and sources. |
| Live | The statement, the recorder's state with the page's one pulse, the eight regions and the live globe's still on the left; on the right the recorder's figures as a ledger at `hero` size, right-aligned on one edge with their captions beside (`landing-numbers`, `recorder-ships`), and the three closest passes as the console's list (`live-crossings`). | One column. |
| Archive | The page's one rest: "Cable faults have been hunted since 1865." beside Dudley's bow of the Great Eastern on 2 August 1865, the cable broken and lost and the grapnel ready, then his deck scene of 31 July 1865 the full width of the page, each captioned with its title linked to the Met (`src/lib/landing/archive-art.ts`). | One column. |
| Close | Dudley's *The Albany Buoying a Bight of the Cable of 1865 on the Night of August 26th, 1866* at 45% on `ink` (white text stays at 4.5:1 or more over its brightest cloud), its caption a `card` label bottom right: "Watch it happen." at `hero` size bottom-left with the record line (`describeLandingRecord`), and the console's first step already open on the right: a case list, the four views and "Open the replay" (`OpenReplayDialog`, `open-replay`). | The line, then the panel, the caption at the bottom. |
| Footer | One quiet line: what this is, the links (Cases, Live, Watchlist, Data and credits, Source on GitHub), Health and the year. The data and picture credits live on `/credits` (`src/app/credits/page.tsx`), which mirrors README.md's sources table. | Three short lines. |

**Hero replay** (`HeroReplay.tsx`). Real footage of the console replaying the Eagle S (`src/lib/landing/replay-footage.ts`, recorded by `bun run footage`), desktop 16:10 and phone 4:5. Until the video draws its first frame the stage shows its poster, which is that frame. The hero's painting, not the poster, is the page's largest paint, so it is the one picture loaded eagerly at `fetchpriority="high"`. The dock under it is the console's own: play and pause (`hero-play`), the UTC clock (`hero-clock`), a scrubber, "Open in the console". The moments list moves the footage to the picked time; the clock and the marked moment follow the footage. It pauses off screen, and under reduced motion it waits for Play.

**Motion.** The hero's painting settles once on load from 1.05 scale over 1,500 ms (`landing-settle` with `--settle-from`), and the stage's picture opens (`landing-shutter`, 1,100 ms, then `landing-settle` from 1.12 scale over 1,500 ms). Parts below the fold marked `data-rise` rise 24 px with opacity over 800 ms `ease-enter`, 70 ms apart in reading order (`--rise-order`, `readRiseOrderStyle`), the first time they come on screen (`LandingMotion`); parts already on screen are never hidden, and nothing moves under reduced motion. Buttons press to 0.98.

The live figures show ships within 3 km of a cable in the last hour (`recorder_summary`), positions in the last hour, lines watched and regions; which regions the recorder heard in the last 15 minutes; and the three latest passes within 150 m of a cable: the line, the flag the MMSI implies, speed and distance, never a ship's name. They read at most once a minute for every visitor together (`src/lib/landing/landing-live.ts`, `use cache` with a 60 s life) and say "as of" the read time. States: recording, last run failed, behind by N minutes, not started, unreachable; no pass in the hour; a read that failed.

**Sticky bar** (`LandingStickyBar.tsx`, `landing-sticky-bar`, `data-state` shown or hidden). Hidden while the hero block is on screen; once it has passed under the top 56 px, a 56 px bar on `card` slides in at the top on `layer-panel`: the mark (a button back to the top), the ships-in-the-last-hour line from 768 px, and "Open the console" as a 40 px ink pill. Enters in 220 ms `ease-enter` from `translateY(-100%)` with opacity, leaves in 176 ms `ease-exit`; instant under reduced motion. Hidden, it is `inert`. Every element with an id keeps `scroll-margin-top` of 64 px, so a jump never lands under the bar.

The archive pictures (four Dudley watercolours, public domain at the Met) are cropped of their mount and served as AVIF and WebP at 1,200, 2,000 and 2,800 px by `scripts/art/build-archive-art.ts`, which also writes their titles (with a short form for captions), dates and licence into the manifest the captions and `/credits` read.

### The anchor figure

Fig 1 (`src/components/landing/AnchorFigure.tsx`) shows how a dragged anchor parts a cable, as an isometric cutaway block of the Gulf of Finland under the bow of Eagle S, built with the Anatomy kit (MIT, copied into `src/components/iso/` with its licence). The page pins it in a sticky square and steps it through three stages beside three statements: `drop` (the anchor let go, hanging), `drag` (ploughing toward a cable) and `cut` (the cable parted). The page wraps the figure in `AnchorFigureStage` (`src/components/landing/AnchorFigureStage.tsx`) with the stage; each change plays the drag between the two moments in 900 ms on `ease-standard`, and jumps under reduced motion. The figure fills its box: a label row (`Fig 1`, the title), a square drawing centred in what is left, and the readout in tabular figures with the hint under it. Its caption is `AnchorFigureCaption`, for the page to place.

- **Truth.** Every number is the console's: the depth and speed at the C-Lion1 cut from the replay's own series, the chain from the detector's anchor model (`src/lib/ships/anchor-chain.ts`: 330 m of 84 mm stud-link chain per anchor, 9.3 t anchors, hung as a catenary). The parts follow real construction: a Spek stockless anchor in a dimension sheet's proportions (shank, crown, pin, stops, tripping palms, flukes, D-shackle, swivel, end link), stud links of 6 by 3.6 diameters, a generic double-armoured telecom cable (serving, armour wires, sheath, conductor, steel tube with fibres) whose torn ends step back layer by layer, the bow's forecastle, windlasses, bitts, pipes and manifold. Length and depth share one scale; the anchor (7 times), the chain's links (6 times) and the cable are drawn larger than life, and the caption says so. The model glue is `src/lib/landing/anchor-figure-model.ts`; the drawing's truths are tested in `anchor-figure-frame.test.ts`.
- **Colour.** The console's tokens only, mixed in `anchor-figure.css`: outlines `ink`, four shades of ink toward `page`, faces `card`, the ship in `ship` greys, the cable in `cable` blues, the water a light `cable` tone deepening to the seabed (the only gradient), the clay in `soft`. One accent, `alarm`, on the cut and the torn ends only. No rule, fill or shadow around the figure.
- **Camera.** While the anchor drops, the whole block shows, the ship's bow, the hawse and the anchor hanging on its swivel, turned to face the viewer so its Spek outline (shank, crown, two broad flukes) reads at once. On the seabed the view comes in twice as close, on the anchor and the cable it meets, then on the anchor and the parted ends; the move is the same 900 ms step. The ship is drawn to a break line near the block's aft end, on purpose.
- **Seabed.** The flukes cut twin trenches with spoil berms on their outer lips; the anchor's shadow lies in them; a mound of spoil heaps up ahead of the flukes, except where a cable lies in its way.
- **Control.** Inside the figure the reader pays out or hauls in chain: drag sideways (left pays out), arrow keys by 10 m (Shift 50), Home and End to the ends.
- **WebGL.** Only the silt thrown up behind the flukes is a shader (`anchor-figure-plume.ts`); without WebGL a stipple of dots draws the same cloud.
- **Weight.** The drawing (about 110 KB compressed) is built at build time and served from `/figures/anchor-figure.svg`, fetched when the figure nears the view, so the page's HTML carries only its shell (1.3 KB compressed); the motion loads when the figure is on screen and stops when it leaves.
- **Checks.** The kit's audit (clearance, support, depth order) passes on every stage, on the snag in between and through the anchor's fall onto the seabed, and every texture line ends on something (`lines.mjs`).

## Live globe

`/live` shows the last 24 hours of ship frames (one every 10 minutes, written by `supabase/functions/collect-ship-frames`) on a 3D globe, in the replay console's shell: the section bar, the stage, the rail floating over its right edge from 1024 px, and the dock. It is a recorded day, never real time, and the stage says so.

- **Field** (`src/components/live/LiveNightSea.tsx`, since 22 Oct 2026). The stage is `slate`, and behind the globe's transparent canvas Dudley's night painting runs as faint glyphs (`AsciiPicture`, 7 px cells, `dense` ramp, 55% toward `slate`), so the globe floats on the night sea. The canvas keeps the painting's 1,200 by 729 proportions and covers the stage through container units, anchored at the bottom so the sea stays in view; the loading, empty and failed states sit on the same field. It shimmers like every plate; measured beside the globe's loop on a software renderer, it did not slow it (about 10 ms a second of main thread at rest; a drag turned the globe at 7 to 13 fps with it and 5.5 to 12.5 without, within run-to-run noise). Everything over the stage stays on `card`: the recorded-day label, the breadcrumb, the ladder, the legend, the notes and the rail's cards (ink 16.2:1, muted 6.6:1 on them). The credits button on slate takes a `dusk` focus ring and steps to `page` on hover, since a shadow does not read there.
- **Globe** (`src/lib/globe/globe-viewer.ts`). Natural Earth land in `page` (parchment, since 22 Oct 2026, so the globe on slate is not a white ball; the 3D seabed keeps `land`) on `depth-40` water, a 1 px coast in the seabed contour tone, the limb darkened a little so the sphere reads round, and a faint `depth-40` rim against the slate field. Northern Europe (12 W to 45 E, 48 to 72 N), where the replays and the recorder are, sits on a sharper patch so coasts stay crisp when the camera flies down to a ship.
- **Tiers** (`src/lib/globe/globe-tier.ts`, chosen by Andy on 20 Oct 2026, board 25). Zoom by sea, not by land. Planet from 2 Earth radii out (the opening view, 3.6), Sea from 1.18 (the ladder flies to 1.45), Strait closer (1.1), and Ship: the picked ship at 1.04 (the closest the camera comes), kept under the stage's centre as the day plays until a drag, another flight, another pick or a zoom out past Strait (`followShip`). A zoom ladder (the segmented control; Ship always takes the press, and with no ship picked, or one the frames at that minute do not hold, a note under the ladder says why it did not fly and what to do, `live-ship-tier-note`) and a breadcrumb ("World > Baltic Sea > Gulf of Finland > ship", hidden at Planet) sit under the recorded-day label (on a phone the ladder moves under the dock, so the stage keeps at most two rows of controls); each step flies there in 900 ms. The address keeps `tier` and `at` (longitude, latitude) and reopens the view without a flight.
- **Density** (Planet, `src/lib/globe/ship-density.ts`). The moment's ships counted in cells of about 220 by 220 km (2 degree bands, fewer cells toward the poles), one dot per occupied cell whose area grows with its count up to 150 ships, 2.6 to 14 px on a 900 px stage and smaller on a shorter one (down to 55%, a phone), fading as its cell turns toward the limb. Between 1.8 and 2.3 Earth radii the dots cross over with the ship dots on a smoothstep. Tone: `density` at 78% (Andy's pick on board 25).
- **Seas** (`src/lib/globe/sea-areas.ts`, `public/globe/seas.json`, built by `scripts/globe/build-seas.ts`). Natural Earth's 1:50m marine areas drawn into quarter-degree cells, arms counted for their sea (the Gulf of Finland for the Baltic), each sea grown 2 degrees into the coastal gaps so a ship in port counts. At Planet the 30 busiest seas get a stacked label (name, ship count) on their most open-water cell, busiest first where two collide (the seabed's label placer).
- **Fault ripple** (`src/lib/globe/fault-ripples.ts`). When a draft case's fault window overlaps the recorded day, its watched cable carries two `alarm` rings growing from its middle point to 64 px over 3.2 s, half a period apart, fading as they grow; the legend adds "Fault signal today". A draft names the cable, not the spot, so the ring marks the cable only. Reduced motion and a CPU renderer draw one still ring.
- **Watched regions.** Their boxes are outlined in `ink` at 32% from the Sea tier down. A region is listed under every sea holding at least a fifth of its box.
- **Tier rails.** Planet: "Busiest seas in this frame", eight rows with a count bar (`ink` at 70% on `soft`), each flying to its sea. Sea: the sea's ships in a `display` figure, the watched regions in it with their ships (each flying to the Strait tier), and its cuts on file. Strait and Ship keep the rail as it was.
- **Ships.** One `ship` dot each, blended on the GPU between the two frames around the moment. A ship missing from one frame fades in or out; a move faster than 50 knots jumps instead of streaking. The selected ship carries an `ink` ring. Ship type reads in the card, never as a color.
- **Coverage.** Sea farther than about 55 km from every ship heard in the frames loaded so far is hatched in screen space (a `depth-deep` line every 7 px on `depth-40`, `src/lib/globe/coverage.ts`); the legend says "No feed hears this sea" and its popover counts the frames.
- **Lines.** The world's submarine cables and pipelines from OpenStreetMap (`public/globe/cables.json`, built by `scripts/globe/build-cables.ts`, ODbL, credited on the stage) at token widths in `cable` and `pipeline`, half width from orbit and never under 1.5 device px, loaded after the globe shows. The replays' lines carry the signal: an opaque 12 px halo of `cable` at 12% over `depth-40`, and a light running along each watched cable in 7 s while it faces the camera (at rest at 30% when motion is reduced). A selected line is redrawn on a white casing 3 px wider.
- **Incidents.** Each case's primary cut is a break marker (16 px, 22 px selected); its card holds the ship, the date, the cut, Fly to the seabed (second button) and Open the case (text button). The list is derived on the server from the case files (`src/lib/globe/incidents.ts`), so the page never ships them.
- **Dive.** One camera move of 1,600 ms on `ease-standard`, prefetching the case meanwhile, then a same-document view transition: the globe's last frame scales from 1 to 1.04 and fades over 384 ms `ease-exit` while the case console rises 8 px over 480 ms `ease-enter`. Reduced motion: no flight, the fade only.
- **Rail.**
  - The moment: ships heard, by feed, the coverage sentence (coastal receivers only; open ocean looks empty because no receiver hears it), and the feed check where both feeds cover a region: an `alarm` dot and "Feeds disagree" when Digitraffic holds under 90% of aisstream's moving class A ships or under 95% of shared positions lie within 250 m, a `live` dot and "Feeds agree" otherwise (`live-feed-check`, `data-state`).
  - The selected incident, ship or line. A ship shows its last report, flag (from the MMSI's first three digits, ITU's table in `src/lib/globe/maritime-identification-digits.ts`), size, draught, destination, heading and the report's age. A line lists the ships whose move between two frames crossed it or came within 3 km (the recorder's distance); "Check the whole day" loads the remaining frames.
  - The anchor-drag watch over every watched region (`recent_detections`, alerts first).
  - Draft cases from the fault signals, always labelled "Draft case", their signals as a title and a link only.
  - Cable cuts on file.
  - A pick on the globe marks its row (`aria-current`) and scrolls the rail to it; a row flies the camera there once its frame is drawn.
- **Dock.** Play (a day in 72 s), the UTC clock and date, and the day as a scrubber with a tick for each stored frame, so a missing slot shows as a gap.
- **Data path.** Frames come through `/api/ship-frames`, which the Vercel CDN caches (two days for a sealed frame), so Supabase serves each frame about once.
- **Test hooks.**
  - `live-globe` carries `data-state` before the day loads, then `data-ship-count` and `data-frame-count`.
  - `live-globe-view` carries `data-state` loading, ready or failed.
  - Others: `live-ship-count`, `live-ship-card` (with `data-mmsi`), `live-detections`, `live-detection-<id>`, `live-play`, `live-scrubber`, `live-clock`, `live-credits`.
  - Lines and incidents: `live-coverage-legend`, `live-line-card` (`data-line-id`, `data-passage-count`), `live-line-check-day`, `live-line-passage-<mmsi>`, `live-incidents`, `live-incident-<slug>`, `live-incident-card` (`data-slug`), `live-incident-dive` (`data-state`), `live-incident-link`.
  - Tiers: `live-tier` (`data-tier` planet, sea, strait or ship), `live-tier-ladder` (buttons carry `data-value` and `aria-pressed`), `live-breadcrumb`, `live-busiest-seas`, `live-busiest-sea`, `live-sea-card`, `live-sea-ship-count`, `live-sea-region-<id>`, `live-sea-label`, `live-density-legend` (Planet only), `live-ripple-legend` (when a ripple shows), `live-ship-tier-note` (a press on Ship that could not fly).
  - Ship and drafts: `live-ship-type`, `live-ship-details`, `live-draft-cases` (`data-state`), `live-draft-case-<id>`, `live-draft-ship-<id>-<mmsi>`, `live-draft-cases-empty`.

