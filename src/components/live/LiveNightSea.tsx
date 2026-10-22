import { AsciiPicture } from "@/components/ascii/AsciiPicture";

// Dudley's night painting, the 1,200 px file the landing already serves (docs/UI_DESIGN_SYSTEM.md, ASCII layer).
const NIGHT_PAINTING_SRC = "/landing/archive/albany-at-night-1200.webp";
// Glyph cell width in CSS px, the case list's size, so the two night seas read as one.
const NIGHT_SEA_CELL_PX = 7;
// Each glyph's colour moves this far toward slate: fainter than the case list's 0.35, since the globe and its panels
// sit on top and the sea must stay behind them.
const NIGHT_SEA_TONE_SHARE = 0.55;

/**
 * The slate field around the live globe: the night painting as faint glyphs, cropped to cover the stage at any size
 * without stretching (the canvas keeps the painting's 1,200 by 729 proportions and is sized by the stage's container
 * units, anchored at the bottom so the sea stays in view). Decorative and inert; the stage sets the slate fill.
 * It shimmers beside the globe's frame loop without slowing it: on the 1,440 by 900 stage (software renderer, a loaded
 * machine, 22 Oct 2026, two runs of two rounds) the shimmer cost the main thread about 10 ms a second at rest (32 to
 * 40 ms with it, 21 to 34 without), and a drag turned the globe at 7 to 13 fps with it and 5.5 to 12.5 without, the
 * same within run-to-run noise. AsciiPicture pauses it off screen and under reduced motion.
 */
export function LiveNightSea() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden [container-type:size]" aria-hidden="true">
      <AsciiPicture
        src={NIGHT_PAINTING_SRC}
        cellPx={NIGHT_SEA_CELL_PX}
        ramp="dense"
        tone="slate"
        toneShare={NIGHT_SEA_TONE_SHARE}
        background="slate"
        isShimmering
        className="absolute bottom-0 left-1/2 h-[max(100cqh,calc(100cqw*729/1200))] w-[max(100cqw,calc(100cqh*1200/729))] -translate-x-1/2"
      />
    </div>
  );
}
