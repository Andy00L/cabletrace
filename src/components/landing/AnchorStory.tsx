"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnchorFigureStage } from "@/components/landing/AnchorFigureStage";
import type { FigureStage } from "@/lib/landing/anchor-figure-model";

export type AnchorStoryStatement = { stage: FigureStage; title: string; detail: string };

type AnchorStoryProps = {
  /** The three statements, in the order the drag happens; each one drives the figure to its stage. */
  statements: readonly AnchorStoryStatement[];
  /** The anchor figure, rendered on the server (AnchorFigure); this section only tells it which stage to show. */
  figure: ReactNode;
  /** The figure's caption (what is drawn and what is illustrated), under the statements. */
  caption: ReactNode;
  contentClassName: string;
};

/**
 * "How a dragged anchor cuts a cable": the anchor figure held in place while the reader scrolls through three
 * statements; the one in the middle of the screen sets the figure's stage. From 1,024 px the statements scroll in the
 * left column beside the held figure, the active one in full ink. Below that the figure and the active statement hold
 * together under the sticky bar while empty markers scroll past, so no text ever slides under the figure.
 */
export function AnchorStory({ statements, figure, caption, contentClassName }: AnchorStoryProps) {
  const markerRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  // Syncs with the browser's IntersectionObserver, which React does not own: the marker crossing the middle band of
  // the screen (a statement block from 1,024 px, an empty spacer below) makes its statement the active one. Markers
  // hidden at the current width never intersect.
  useEffect(() => {
    const middleObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || !(entry.target instanceof HTMLElement)) continue;
          const index = Number(entry.target.dataset.statementIndex);
          if (Number.isInteger(index)) setActiveIndex(index);
        }
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    for (const marker of markerRefs.current) if (marker) middleObserver.observe(marker);
    return () => middleObserver.disconnect();
  }, []);

  const activeStage = statements[activeIndex]?.stage ?? "drop";
  const registerMarker = (slot: number) => (element: HTMLDivElement | null) => {
    markerRefs.current[slot] = element;
  };
  return (
    <section aria-labelledby="anchor-title" className={`${contentClassName} flex flex-col lg:grid lg:grid-cols-12 lg:gap-x-6`}>
      <h2 id="anchor-title" className="pb-6 text-title sm:text-display lg:col-span-5 lg:row-start-1 lg:pb-0">
        How a dragged anchor cuts a cable
      </h2>
      {/* Held: the figure, and below 1,024 px the active statement under it, on the page's ground. */}
      <div className="sticky top-14 z-10 -mx-4 flex flex-col gap-3 bg-page px-4 pt-2 pb-4 sm:-mx-6 sm:px-6 lg:top-[14vh] lg:col-span-6 lg:col-start-7 lg:row-span-5 lg:row-start-1 lg:mx-0 lg:block lg:self-start lg:p-0">
        <div className="h-[50svh] overflow-hidden lg:h-[560px] lg:overflow-visible">
          <AnchorFigureStage stage={activeStage}>{figure}</AnchorFigureStage>
        </div>
        <div className="grid lg:hidden" aria-live="polite">
          {statements.map((statement, index) => (
            <div
              key={statement.stage}
              className={`col-start-1 row-start-1 flex flex-col gap-2 transition-opacity duration-220 ease-standard ${index === activeIndex ? "opacity-100" : "pointer-events-none opacity-0"}`}
              aria-hidden={index !== activeIndex}
            >
              <h3 className="text-heading">{statement.title}</h3>
              <p className="text-body text-ink">{statement.detail}</p>
            </div>
          ))}
        </div>
      </div>
      {/* Below 1,024 px: empty markers that scroll under the held panel, one screen's worth per statement. */}
      {statements.map((statement, index) => (
        <div key={`marker-${statement.stage}`} ref={registerMarker(statements.length + index)} data-statement-index={index} className="h-[55svh] lg:hidden" aria-hidden="true" />
      ))}
      {/* From 1,024 px: the statements themselves scroll in the left column. */}
      {statements.map((statement, index) => (
        <div
          key={statement.stage}
          ref={registerMarker(index)}
          data-statement-index={index}
          data-stage={statement.stage}
          className="hidden min-h-[80vh] flex-col justify-center gap-3 lg:col-span-5 lg:flex"
          style={{ gridRowStart: index + 2 }}
          aria-current={index === activeIndex ? "step" : undefined}
        >
          <h3 className={`text-title transition-colors duration-220 ease-standard ${index === activeIndex ? "text-ink" : "text-muted"}`}>{statement.title}</h3>
          <p className="max-w-[44ch] text-body text-ink">{statement.detail}</p>
        </div>
      ))}
      <div className="pt-6 lg:col-span-5" style={{ gridRowStart: statements.length + 2 }}>
        {caption}
      </div>
    </section>
  );
}
