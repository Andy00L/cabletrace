import type { CSSProperties } from "react";

/**
 * The style that places a part in its section's entrance: 0 rises first, each next one 70 ms later
 * (src/app/globals.css, `[data-rise]`; LandingMotion arms them).
 */
export function readRiseOrderStyle(order: number): CSSProperties & Record<"--rise-order", number> {
  return { "--rise-order": order };
}
