"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/brand/BrandMark";

// The bar is 56 px tall (h-14), the site header's height (src/components/layout/SiteHeader.tsx). The hero counts as gone
// once it has passed under the bar, so the root's top edge is moved down by that much.
const BAR_HEIGHT_PX = 56;

type LandingStickyBarProps = {
  /** The id of the hero block (headline, sentence, main action); the bar shows once that block has scrolled away. */
  heroId: string;
  /** One short line of live state, or null when the recorder could not be read (the line is then left out). */
  stateLine: string | null;
  /** The hero's main action, same destination and words. */
  action: { href: string; label: string };
};

/** The mark takes the reader back to the top of the landing; a link to "/" would not scroll on the page it names. */
function scrollToTop() {
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, behavior: prefersReducedMotion ? "auto" : "smooth" });
}

/**
 * The landing's compact bar: hidden while the hero is on screen, it slides in at the top once the hero has scrolled
 * away, so the console stays one click away down the page. The mark (back to the top), the live line from 768 px, and
 * the hero's action as a 40 px ink pill (the dense size, docs/UI_DESIGN_SYSTEM.md). Hidden, it is inert: no tab stop,
 * nothing read aloud. Reduced motion makes the slide instant (src/app/globals.css).
 */
export function LandingStickyBar({ heroId, stateLine, action }: LandingStickyBarProps) {
  const [isShown, setIsShown] = useState(false);

  // Syncs with the browser's IntersectionObserver on the hero block, which React does not own.
  useEffect(() => {
    const hero = document.getElementById(heroId);
    if (!hero) {
      console.error(`[LandingStickyBar] no hero block with id ${heroId}`);
      return;
    }
    const heroObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          // Out of view above the bar's line, not below it: the bar never shows before the hero has been passed.
          const rootTop = entry.rootBounds?.top ?? BAR_HEIGHT_PX;
          setIsShown(!entry.isIntersecting && entry.boundingClientRect.top < rootTop);
        }
      },
      { rootMargin: `-${BAR_HEIGHT_PX}px 0px 0px 0px` },
    );
    heroObserver.observe(hero);
    return () => heroObserver.disconnect();
  }, [heroId]);

  return (
    <div
      className={`fixed inset-x-0 top-0 z-(--layer-panel) bg-card transition-[translate,opacity] ${isShown ? "translate-y-0 opacity-100 duration-220 ease-enter" : "-translate-y-full opacity-0 duration-176 ease-exit"}`}
      inert={!isShown}
      data-testid="landing-sticky-bar"
      data-state={isShown ? "shown" : "hidden"}
    >
      {/* The landing's content column (src/app/page.tsx, CONTENT_CLASS), so the mark and the pill line up with the page. */}
      <div className="mx-auto flex h-14 w-full max-w-[1440px] items-center gap-6 px-4 sm:px-6 lg:px-20">
        <button type="button" onClick={scrollToTop} aria-label="CableTrace, back to the top" className="-mx-2 flex min-h-11 flex-none cursor-pointer items-center gap-2.5 rounded-full px-2 text-ink">
          <BrandMark size={26} />
          <span className="text-card-title">CableTrace</span>
        </button>
        {stateLine && <p className="hidden min-w-0 truncate text-small text-muted md:block">{stateLine}</p>}
        <Link
          href={action.href}
          className="ml-auto flex h-10 flex-none items-center justify-center rounded-full bg-ink px-5 text-label text-card transition-colors duration-140 ease-standard hover:bg-ink-hover"
          data-testid="sticky-open-console"
        >
          {action.label}
        </Link>
      </div>
    </div>
  );
}
