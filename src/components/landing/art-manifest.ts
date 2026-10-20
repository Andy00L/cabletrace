// Written by scripts/art/build-landing-art.ts; do not edit by hand. Sizes are the cropped source's, in px.
export type ArtName = "art-1" | "art-1-phone" | "art-2" | "art-2-phone" | "art-3" | "art-3-phone";

export type ArtEntry = { width: number; height: number; widths: readonly number[] };

export const ART_MANIFEST: Readonly<Record<ArtName, ArtEntry>> = {
  "art-1": {
    "width": 2913,
    "height": 1128,
    "widths": [
      960,
      1600,
      2400
    ]
  },
  "art-1-phone": {
    "width": 1635,
    "height": 2088,
    "widths": [
      600,
      1200
    ]
  },
  "art-2": {
    "width": 2539,
    "height": 1313,
    "widths": [
      960,
      1600,
      2400
    ]
  },
  "art-2-phone": {
    "width": 1694,
    "height": 2220,
    "widths": [
      600,
      1200
    ]
  },
  "art-3": {
    "width": 2559,
    "height": 1450,
    "widths": [
      960,
      1600,
      2400
    ]
  },
  "art-3-phone": {
    "width": 1692,
    "height": 2200,
    "widths": [
      600,
      1200
    ]
  }
};
