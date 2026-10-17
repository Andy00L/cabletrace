"use client";

import { useConsole } from "@/components/console/console-context";
import type { CitationView } from "@/lib/cases/case-console";

/**
 * "Sources 15, 31" where each number opens that source's card next to it: the shortest path from any claim to
 * the page and the quote behind it.
 */
export function CitationButtons({ citations, className = "" }: { citations: readonly CitationView[]; className?: string }) {
  const { openLayer } = useConsole();
  const sourceIds = [...new Set(citations.map((citation) => citation.sourceId))];
  if (sourceIds.length === 0) return null;
  return (
    <span className={`text-micro font-normal text-muted ${className}`}>
      {sourceIds.length === 1 ? "Source " : "Sources "}
      {sourceIds.map((sourceId, index) => (
        <span key={sourceId}>
          {index > 0 && ", "}
          <button
            type="button"
            onClick={(event) => openLayer({ kind: "source", sourceId }, event.currentTarget)}
            className="-my-1 rounded-chip py-1 font-medium text-ink underline decoration-faint underline-offset-3 transition-colors duration-140 ease-standard hover:decoration-ink"
            aria-label={`Source ${sourceId}`}
          >
            {sourceId}
          </button>
        </span>
      ))}
    </span>
  );
}
