"use client";

import { useConsole } from "@/components/console/console-context";
import type { CitationView } from "@/lib/cases/case-console";

/**
 * What the links sit on, which sets their tone (docs/UI_DESIGN_SYSTEM.md, Palette): `card` takes brass (4.7:1 on
 * vellum), `soft` takes ink (brass is 3.7:1 on tan, short of text contrast), `slate` takes dusk (7.8:1).
 */
export type CitationSurface = "card" | "soft" | "slate";

const CITATION_TONES: Record<CitationSurface, { labelClass: string; linkClass: string }> = {
  card: { labelClass: "text-muted", linkClass: "text-brass decoration-brass/40 hover:decoration-brass" },
  soft: { labelClass: "text-muted", linkClass: "text-ink decoration-faint hover:decoration-ink" },
  slate: { labelClass: "text-mist", linkClass: "text-dusk decoration-dusk/40 hover:decoration-dusk" },
};

/**
 * "Sources 15, 31" where each number opens that source's card next to it: the shortest path from any claim to
 * the page and the quote behind it.
 */
export function CitationButtons({ citations, className = "", surface = "card" }: { citations: readonly CitationView[]; className?: string; surface?: CitationSurface }) {
  const { openLayer } = useConsole();
  const sourceIds = [...new Set(citations.map((citation) => citation.sourceId))];
  if (sourceIds.length === 0) return null;
  const tones = CITATION_TONES[surface];
  return (
    <span className={`text-micro font-normal ${tones.labelClass} ${className}`}>
      {sourceIds.length === 1 ? "Source " : "Sources "}
      {sourceIds.map((sourceId, index) => (
        <span key={sourceId}>
          {index > 0 && ", "}
          <button
            type="button"
            onClick={(event) => openLayer({ kind: "source", sourceId }, event.currentTarget)}
            className={`-my-1 rounded-chip py-1 font-medium underline underline-offset-3 transition-colors duration-140 ease-standard ${tones.linkClass}`}
            aria-label={`Source ${sourceId}`}
          >
            {sourceId}
          </button>
        </span>
      ))}
    </span>
  );
}
