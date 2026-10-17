"use client";

import { useMemo, useState, type ReactNode } from "react";
import { CitationButtons } from "@/components/console/CitationButtons";
import { useConsole } from "@/components/console/console-context";
import { Icon } from "@/components/icons/Icon";
import { CloseButton, LayerCard, type LayerAnchor } from "@/components/ui/LayerCard";
import { LayerSheet } from "@/components/ui/LayerSheet";
import type { CitationView, ConsoleSource } from "@/lib/cases/case-console";
import { toCutSlug } from "@/lib/console/console-state";

const SHORTCUTS = [
  { keys: "Space", action: "Play or pause" },
  { keys: "Left and right arrows", action: "Previous or next event (on the scrubber: one minute)" },
  { keys: "1, 2, 3, 4", action: "Overview, From above, Vessel, At the cut" },
  { keys: "F", action: "Follow the ship" },
  { keys: "Esc", action: "Close the card or sheet on top" },
  { keys: "?", action: "This list" },
] as const;

/**
 * Where a card sits: next to the control that opened it, or, when it was opened by a link or its control has gone
 * (a dialog that closed to open it), near the top middle of the stage.
 */
function createAnchor(opener: HTMLElement | null, stageElement: HTMLElement | null): LayerAnchor | null {
  if (!opener && !stageElement) return null;
  return {
    getBoundingClientRect() {
      if (opener?.isConnected) return opener.getBoundingClientRect();
      const rect = stageElement?.getBoundingClientRect() ?? new DOMRect(0, 0, window.innerWidth, window.innerHeight);
      return new DOMRect(rect.left + rect.width / 2, rect.top + rect.height / 3, 0, 0);
    },
  };
}

function Quote({ citation }: { citation: CitationView }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-field bg-page px-3.5 py-3">
      <p className="text-small">{citation.translation ?? citation.quote}</p>
      {citation.translation && <p className="text-caption font-normal text-muted">{citation.quote}</p>}
    </div>
  );
}

function CardHeader({ eyebrow, title, onClose, mark }: { eyebrow: string; title: string; onClose: () => void; mark?: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      {mark}
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-caption font-normal text-muted">{eyebrow}</span>
        <h2 className="text-card-title">{title}</h2>
      </div>
      <span className="ml-auto">
        <CloseButton onClick={onClose} />
      </span>
    </div>
  );
}

function SourceLinks({ source }: { source: ConsoleSource }) {
  return (
    <div className="flex flex-wrap gap-2">
      <a href={source.url} target="_blank" rel="noopener noreferrer" className="flex h-10 items-center gap-2 rounded-full bg-soft px-4 text-label text-ink transition-colors duration-140 ease-standard hover:bg-page">
        <Icon name="external" />
        Open the page
      </a>
      {source.archivedUrl && (
        <a href={source.archivedUrl} target="_blank" rel="noopener noreferrer" className="flex h-10 items-center gap-2 rounded-full bg-soft px-4 text-label text-ink transition-colors duration-140 ease-standard hover:bg-page">
          <Icon name="archive" />
          Archived copy
        </a>
      )}
    </div>
  );
}

/** Every card, sheet and dialog the console can open, driven by the `layer` state (one at a time). */
export function ConsoleLayers({ stageElement, opener }: { stageElement: HTMLElement | null; opener: HTMLElement | null }) {
  const { consoleCase, layer, closeLayer, seekTo, setView } = useConsole();
  const [sourceFilter, setSourceFilter] = useState("");
  const anchor = useMemo(() => createAnchor(opener, stageElement), [opener, stageElement]);
  // A card opened from the dock opens above it; anything else opens beside its control, toward the stage.
  const cardSide = opener?.closest("[data-console-dock]") ? "top" : "left";

  const filteredSources = useMemo(() => {
    const needle = sourceFilter.trim().toLowerCase();
    return needle === "" ? consoleCase.sources : consoleCase.sources.filter((source) => `${source.title} ${source.publisher}`.toLowerCase().includes(needle));
  }, [consoleCase.sources, sourceFilter]);

  const cut = layer.kind === "cut" ? consoleCase.cuts[layer.cutIndex] : undefined;
  const position = layer.kind === "placement" ? consoleCase.positions[layer.positionIndex] : undefined;
  const source = layer.kind === "source" ? consoleCase.sources.find((candidate) => candidate.id === layer.sourceId) : undefined;
  const { vessel } = consoleCase;

  return (
    <>
      <LayerCard isOpen={layer.kind === "cut" && cut !== undefined} onClose={closeLayer} anchor={anchor} label={cut ? `${cut.label} cut` : "Cut"} boundary={null} side={cardSide} align={cardSide === "top" ? "center" : "start"} testId="cut-card">
        {cut && (
          <>
            <CardHeader
              eyebrow={`${cut.owner}${toCutSlug(cut.cableName).replaceAll("-", "") !== toCutSlug(cut.label).replaceAll("-", "") ? `, ${cut.cableName}` : ""}`}
              title={`${cut.label} cut`}
              onClose={closeLayer}
              mark={
                <svg width="18" height="18" viewBox="0 0 14 14" aria-hidden="true" className="mt-1 flex-none">
                  <circle cx="7" cy="7" r="5.5" fill="var(--color-card)" stroke="var(--color-alarm)" strokeWidth="2" />
                  <circle cx="7" cy="7" r="2" fill="var(--color-alarm)" />
                </svg>
              }
            />
            <p className="flex items-baseline gap-2">
              <span className="text-heading tabular-nums">{cut.timeLabel}</span>
              <span className="text-label text-muted">UTC{cut.dayLabel ? `, ${cut.dayLabel}` : ""}</span>
            </p>
            <p className="text-caption font-normal text-muted">{cut.placement}</p>
            {cut.citations.map((citation, index) => (
              <Quote key={index} citation={citation} />
            ))}
            <CitationButtons citations={cut.citations} />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  seekTo(cut.atMs);
                  setView("closeup");
                }}
                className="flex h-10 items-center rounded-full bg-soft px-4 text-label text-ink transition-colors duration-140 ease-standard hover:bg-page active:scale-[0.97]"
              >
                Go to the close-up
              </button>
            </div>
          </>
        )}
      </LayerCard>

      <LayerCard isOpen={layer.kind === "placement" && position !== undefined} onClose={closeLayer} anchor={anchor} label="How this position is placed" boundary={null} side={cardSide} testId="placement-popover">
        {position && (
          <>
            <CardHeader eyebrow={`${position.timeLabel} UTC${position.dayLabel ? `, ${position.dayLabel}` : ""}, placed from statements`} title={position.place} onClose={closeLayer} />
            <p className="text-small">{position.placement}</p>
            {position.citations.map((citation, index) => (
              <Quote key={index} citation={citation} />
            ))}
            <CitationButtons citations={position.citations} />
            <button
              type="button"
              onClick={() => seekTo(position.atMs)}
              className="flex h-10 items-center self-start rounded-full bg-soft px-4 text-label text-ink transition-colors duration-140 ease-standard hover:bg-page active:scale-[0.97]"
            >
              Move the replay to {position.timeLabel}
            </button>
          </>
        )}
      </LayerCard>

      <LayerCard isOpen={layer.kind === "source" && source !== undefined} onClose={closeLayer} anchor={anchor} label={source ? `Source ${source.id}` : "Source"} boundary={null} side={cardSide} width={380} testId="source-popover">
        {source && (
          <>
            <CardHeader eyebrow={`Source ${source.id}, ${source.publisher}, ${source.publishedLabel}`} title={source.title} onClose={closeLayer} />
            <p className="text-caption font-normal text-muted">Quoted {source.uses.length === 1 ? "once" : `${source.uses.length} times`} in this case:</p>
            <ul className="flex flex-col gap-2">
              {source.uses.map((use, index) => (
                <li key={index} className="flex flex-col gap-1">
                  <span className="text-micro text-muted">{use.supports}</span>
                  <Quote citation={{ sourceId: source.id, quote: use.quote, translation: use.translation }} />
                </li>
              ))}
            </ul>
            <SourceLinks source={source} />
          </>
        )}
      </LayerCard>

      <LayerCard isOpen={layer.kind === "vessel"} onClose={closeLayer} anchor={anchor} label={vessel.name} boundary={stageElement} testId="vessel-card">
        <CardHeader eyebrow={`${vessel.type}, ${vessel.flag} flag`} title={vessel.name} onClose={closeLayer} />
        <p className="text-caption font-normal text-muted">{vessel.evidence}</p>
        <CitationButtons citations={vessel.citations} />
      </LayerCard>

      <LayerSheet
        isOpen={layer.kind === "sources"}
        onClose={closeLayer}
        title="Sources"
        description={`${consoleCase.sources.length} pages. Every quote in this case is copied from them.`}
        placement="sheet"
        testId="source-list"
      >
        <label className="mb-3 flex h-11 items-center gap-2.5 rounded-field bg-page px-3.5 text-muted focus-within:bg-card focus-within:shadow-[0_0_0_2px_var(--color-ink)]">
          <Icon name="search" />
          <span className="sr-only">Filter sources</span>
          <input
            type="search"
            value={sourceFilter}
            onChange={(event) => setSourceFilter(event.target.value)}
            placeholder="Filter by title or publisher"
            className="min-w-0 flex-1 bg-transparent text-small text-ink outline-none placeholder:text-muted"
          />
        </label>
        {filteredSources.length === 0 && <p className="px-2 py-4 text-small text-muted">No source title or publisher contains {sourceFilter.trim()}.</p>}
        <ol className="flex flex-col gap-1">
          {filteredSources.map((entry) => (
            <li key={entry.id}>
              <details className="group rounded-field transition-colors duration-140 ease-standard open:bg-page">
                <summary className="grid cursor-pointer list-none grid-cols-[28px_minmax(0,1fr)_20px] gap-x-2.5 rounded-field px-2.5 py-3 hover:bg-page">
                  <span className="text-caption text-muted tabular-nums">{entry.id}</span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-small font-medium wrap-anywhere">{entry.title}</span>
                    <span className="text-caption font-normal text-muted">
                      {entry.publisher}, {entry.publishedLabel}
                    </span>
                  </span>
                  <Icon name="chevronDown" className="mt-0.5 text-muted transition-transform duration-220 ease-standard group-open:rotate-180" />
                </summary>
                <div className="flex flex-col gap-2.5 px-2.5 pt-1 pb-3.5 pl-[48px]">
                  {entry.uses.map((use, index) => (
                    <div key={index} className="flex flex-col gap-1">
                      <span className="text-micro text-muted">{use.supports}</span>
                      <p className="rounded-field bg-card px-3 py-2.5 text-small">{use.translation ?? use.quote}</p>
                    </div>
                  ))}
                  <SourceLinks source={entry} />
                </div>
              </details>
            </li>
          ))}
        </ol>
      </LayerSheet>

      <LayerSheet isOpen={layer.kind === "aftermath"} onClose={closeLayer} title="What followed" description="Recovery, investigation and court steps after the replay window, as the sources state them." placement="dialog" testId="aftermath-card">
        <ol className="flex flex-col gap-1">
          {consoleCase.aftermath.map((step) => (
            <li key={`${step.atMs}-${step.title}`} className="grid grid-cols-[100px_minmax(0,1fr)] gap-x-3 rounded-field px-2 py-2.5">
              <span className="text-small text-muted tabular-nums">{step.dateLabel}</span>
              <span className="flex flex-col gap-1">
                <span className="text-small">{step.title}</span>
                <CitationButtons citations={step.citations} />
              </span>
            </li>
          ))}
        </ol>
      </LayerSheet>

      <LayerSheet isOpen={layer.kind === "shortcuts"} onClose={closeLayer} title="Keyboard shortcuts" description="They work anywhere in the console except inside a text field." placement="dialog" testId="shortcuts-dialog">
        <dl className="grid grid-cols-[minmax(0,180px)_minmax(0,1fr)] gap-x-4 gap-y-3 text-small">
          {SHORTCUTS.map((shortcut) => (
            <div key={shortcut.keys} className="contents">
              <dt className="font-medium">{shortcut.keys}</dt>
              <dd className="text-muted">{shortcut.action}</dd>
            </div>
          ))}
        </dl>
      </LayerSheet>
    </>
  );
}
