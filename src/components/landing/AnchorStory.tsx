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
 * "How a dragged anchor cuts a cable": the anchor figure held in place while three statements scroll past it; the
 * statement nearest the middle of the screen is in full ink and sets the figure's stage. On a phone the figure holds
 * at the top, under the sticky bar, and the statements scroll beneath it.
 */
export function AnchorStory({ statements, figure, caption, contentClassName }: AnchorStoryProps) {
  const statementRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  // Syncs with the browser's IntersectionObserver, which React does not own: the statement crossing the middle band
  // of the screen becomes the active one.
  useEffect(() => {
    const middleObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = statementRefs.current.indexOf(entry.target instanceof HTMLDivElement ? entry.target : null);
          if (index >= 0) setActiveIndex(index);
        }
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    for (const statement of statementRefs.current) if (statement) middleObserver.observe(statement);
    return () => middleObserver.disconnect();
  }, []);

  const activeStage = statements[activeIndex]?.stage ?? "drop";
  return (
    <section aria-labelledby="anchor-title" className={`${contentClassName} flex flex-col lg:grid lg:grid-cols-12 lg:gap-x-6`}>
      <h2 id="anchor-title" className="pb-8 text-title sm:text-display lg:col-span-5 lg:row-start-1 lg:pb-0">
        How a dragged anchor cuts a cable
      </h2>
      <div className="sticky top-14 z-10 order-2 -mx-4 h-[54svh] overflow-hidden bg-page px-4 py-2 sm:-mx-6 sm:px-6 lg:top-[14vh] lg:overflow-visible lg:order-none lg:col-span-6 lg:col-start-7 lg:row-span-5 lg:row-start-1 lg:mx-0 lg:h-[560px] lg:self-start lg:p-0">
        <AnchorFigureStage stage={activeStage}>{figure}</AnchorFigureStage>
      </div>
      {statements.map((statement, index) => (
        <div
          key={statement.stage}
          ref={(element) => {
            statementRefs.current[index] = element;
          }}
          className="order-3 flex min-h-[60svh] flex-col justify-center gap-3 lg:order-none lg:col-span-5 lg:min-h-[80vh]"
          style={{ gridRowStart: index + 2 }}
          data-stage={statement.stage}
          aria-current={index === activeIndex ? "step" : undefined}
        >
          <h3 className={`text-title transition-colors duration-220 ease-standard ${index === activeIndex ? "text-ink" : "text-muted"}`}>{statement.title}</h3>
          <p className="max-w-[44ch] text-body text-ink">{statement.detail}</p>
        </div>
      ))}
      <div className="order-4 pt-6 lg:order-none lg:col-span-5" style={{ gridRowStart: statements.length + 2 }}>
        {caption}
      </div>
    </section>
  );
}
