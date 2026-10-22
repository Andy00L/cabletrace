import { AsciiPicture } from "@/components/ascii/AsciiPicture";

// Dudley's night painting, the 1,200 px file the landing already serves (docs/UI_DESIGN_SYSTEM.md, ASCII layer).
const NIGHT_PAINTING_SRC = "/landing/archive/albany-at-night-1200.webp";
// Pixel width in CSS px: the globe's night sea is an ordered dither, fine enough to read as texture behind the globe.
const NIGHT_SEA_CELL_PX = 4;
// Each pixel's colour moves this far toward slate: fainter than the case list's 0.35, since the globe and its panels
// sit on top and the sea must stay behind them.
const NIGHT_SEA_TONE_SHARE = 0.55;

/**
 * The slate field around the live globe: the night painting as a faint ordered dither, cropped to cover the stage at
 * any size without stretching (the canvas keeps the painting's 1,200 by 729 proportions and is sized by the stage's container
 * units, anchored at the bottom so the sea stays in view). Decorative and inert; the stage sets the slate fill.
 * A dither holds still (AsciiPicture shimmers only character styles), so it costs the globe's frame loop nothing after
 * its one draw per size change.
 */
export function LiveNightSea() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden [container-type:size]" aria-hidden="true">
      <AsciiPicture
        src={NIGHT_PAINTING_SRC}
        style="dither"
        cellPx={NIGHT_SEA_CELL_PX}
        tone="slate"
        toneShare={NIGHT_SEA_TONE_SHARE}
        background="slate"
        className="absolute bottom-0 left-1/2 h-[max(100cqh,calc(100cqw*729/1200))] w-[max(100cqw,calc(100cqh*1200/729))] -translate-x-1/2"
      />
    </div>
  );
}
