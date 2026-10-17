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

## Exceptions to the design kit

Each one is Andy's explicit decision and wins over the default rule in the kit for this project:

1. TikTok Sans is a Google Fonts family (the kit bans Google fonts for the signature face).
2. The page is a light gray (`#F3F3F1`) under white cards (the kit flags the stock UI gray); it stays warm neutral, never cool.
3. The current rail item sits on a white disc behind its icon (the kit bans a box behind an icon), following the Wealthsimple reference.
4. Screens are drawn directly on a claude.ai Design canvas by the agent instead of the Claude Design prompt loop; the canvas replaces `ui-design/palette.html` as the approved palette card.
5. No brand accent: `ink` carries every interactive state.
