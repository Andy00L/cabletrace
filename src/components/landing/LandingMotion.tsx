"use client";

import { useEffect } from "react";

// A part counts as arrived once this share of it is on screen.
const ARRIVAL_THRESHOLD = 0.15;

/**
 * The landing's entrances: every element marked `data-rise` (with `--rise-order` for its place in its section) that
 * is still below the fold when the page loads rises into place once, the first time it comes on screen. Parts already
 * on screen are left alone, nothing is armed under reduced motion, and without this script everything simply shows
 * (src/app/globals.css). Renders nothing.
 */
export function LandingMotion() {
  // Syncs with the browser's IntersectionObserver and the reduced-motion setting, which React does not own.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const arrivalObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || !(entry.target instanceof HTMLElement)) continue;
          entry.target.dataset.rise = "in";
          arrivalObserver.unobserve(entry.target);
        }
      },
      { threshold: ARRIVAL_THRESHOLD },
    );
    for (const part of document.querySelectorAll<HTMLElement>("[data-rise]")) {
      if (part.getBoundingClientRect().top < window.innerHeight) continue;
      part.dataset.rise = "armed";
      arrivalObserver.observe(part);
    }
    return () => arrivalObserver.disconnect();
  }, []);
  return null;
}
