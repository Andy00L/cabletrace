"use client";

import * as Popover from "@radix-ui/react-popover";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BrandMark } from "@/components/brand/BrandMark";
import { CaseSketchMap } from "@/components/cases/CaseCard";
import { useConsole } from "@/components/console/console-context";
import { Icon } from "@/components/icons/Icon";
import { SegmentedControl, type SegmentOption } from "@/components/ui/SegmentedControl";
import { WatchButton } from "@/components/watchlist/WatchButton";
import type { CaseSketch } from "@/lib/cases/case-sketch";
import { fetchCaseSketches } from "@/lib/cases/case-sketches-api";
import type { ConsoleMode } from "@/lib/console/console-state";

/** One case in the switcher, by its names; its sketch arrives from /cases/sketches when the switcher is reached for. */
export type CaseSwitcherItem = { slug: string; title: string; subtitle: string; vesselName: string };

const MODE_OPTIONS: readonly SegmentOption<ConsoleMode>[] = [
  { value: "replay", label: "Replay" },
  { value: "ship", label: "Ship" },
  { value: "evidence", label: "Evidence" },
];
// How long the "Link copied" note stays (ms): long enough to read three words twice.
const TOAST_DURATION_MS = 2400;

type CopyState = { kind: "idle" } | { kind: "copied" } | { kind: "failed" };

/** The console's top bar: the mark, the case switcher, the place and date, the mode control, copy link, shortcuts. */
export function ConsoleTopBar({ switcherCases }: { switcherCases: CaseSwitcherItem[] }) {
  const { consoleCase, mode, setMode, openLayer } = useConsole();
  const [copyState, setCopyState] = useState<CopyState>({ kind: "idle" });
  // The switcher's sketches, fetched once on the first hover, focus or open; until then the rows show their names only.
  const [sketches, setSketches] = useState<ReadonlyMap<string, CaseSketch | null> | null>(null);
  const hasRequestedSketchesRef = useRef(false);
  function loadSketches() {
    if (hasRequestedSketchesRef.current) return;
    hasRequestedSketchesRef.current = true;
    void fetchCaseSketches().then((outcome) => {
      if (!outcome.ok) {
        console.error(`[ConsoleTopBar] ${outcome.reason}`);
        hasRequestedSketchesRef.current = false;
        return;
      }
      setSketches(outcome.value);
    });
  }

  // Hides the copy note after a moment: a timer, which React does not own.
  useEffect(() => {
    if (copyState.kind === "idle") return;
    const timer = setTimeout(() => setCopyState({ kind: "idle" }), TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [copyState]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopyState({ kind: "copied" });
    } catch (error) {
      console.error(`[ConsoleTopBar] copy failed: ${error instanceof Error ? error.message : String(error)}`);
      setCopyState({ kind: "failed" });
    }
  }

  return (
    <header className="flex h-14 flex-none items-center gap-3 px-4 sm:gap-5">
      <Link href="/" aria-label="CableTrace home" className="-mx-2 flex min-h-11 items-center gap-2.5 rounded-full px-2 text-ink">
        <BrandMark size={28} />
        <span className="hidden text-card-title xl:inline">CableTrace</span>
      </Link>
      <Popover.Root
        onOpenChange={(isOpen) => {
          if (isOpen) loadSketches();
        }}
      >
        <Popover.Trigger
          onPointerEnter={loadSketches}
          onFocus={loadSketches}
          className="flex h-10 min-w-0 items-center gap-1.5 rounded-full bg-soft pr-2.5 pl-3.5 text-label text-ink transition-colors duration-140 ease-standard hover:bg-page data-[state=open]:bg-card data-[state=open]:shadow-selected" data-testid="case-switcher">
          <span className="truncate">{consoleCase.title}</span>
          <Icon name="chevronDown" size={18} className="flex-none text-muted" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={8}
            collisionPadding={16}
            className="z-(--layer-popover) flex w-[420px] max-w-[calc(100vw-32px)] flex-col gap-1 rounded-row bg-card p-2 shadow-popover outline-none data-[state=closed]:animate-layer-exit data-[state=open]:animate-layer-enter"
          >
            <p className="px-3 pt-2 pb-1 text-caption text-muted">Cases</p>
            {switcherCases.map((item) => {
              const isCurrent = item.slug === consoleCase.slug;
              const sketch = sketches?.get(item.slug) ?? null;
              return (
                <Link
                  key={item.slug}
                  href={`/cases/${item.slug}`}
                  aria-current={isCurrent ? "page" : undefined}
                  className={`grid grid-cols-[96px_minmax(0,1fr)] items-center gap-3.5 rounded-field p-2 transition-colors duration-140 ease-standard hover:bg-page ${isCurrent ? "bg-page" : ""}`}
                >
                  <span className="block aspect-video overflow-hidden rounded-chip bg-depth-40">
                    {sketch && <CaseSketchMap sketch={sketch} vesselName={item.vesselName} />}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-label">{item.title}</span>
                    <span className="truncate text-caption font-normal text-muted">{item.subtitle}</span>
                  </span>
                </Link>
              );
            })}
            <Link href="/cases" className="flex min-h-11 items-center gap-1 rounded-field px-3 text-label text-ink transition-colors duration-140 ease-standard hover:bg-page">
              All cases
              <Icon name="chevronRight" />
            </Link>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <span className="hidden truncate text-small text-muted tabular-nums xl:inline">{consoleCase.subtitle}</span>
      <div className="ml-auto flex items-center gap-2">
        <div className="hidden md:block">
          <SegmentedControl label="Mode" options={MODE_OPTIONS} value={mode} onChange={setMode} testId="mode-switch" />
        </div>
        <WatchButton kind="case" watchRef={consoleCase.slug} label={consoleCase.title} testId="watch-case" />
        <button
          type="button"
          onClick={() => void copyLink()}
          className="flex h-10 items-center gap-2 rounded-full px-3.5 text-label text-ink transition-colors duration-140 ease-standard hover:bg-soft active:scale-[0.97]"
          data-testid="copy-link"
        >
          <Icon name="link" />
          <span className="hidden sm:inline">Copy link</span>
        </button>
        <button
          type="button"
          onClick={(event) => openLayer({ kind: "shortcuts" }, event.currentTarget)}
          aria-label="Keyboard shortcuts"
          className="grid size-10 place-items-center rounded-full bg-soft text-ink transition-colors duration-140 ease-standard hover:bg-page active:scale-[0.97]"
        >
          <Icon name="keyboard" />
        </button>
      </div>
      <p
        role="status"
        aria-live="polite"
        className={`pointer-events-none fixed bottom-6 left-1/2 z-(--layer-toast) -translate-x-1/2 rounded-full bg-card px-4 py-2.5 text-label text-ink shadow-popover ${copyState.kind === "idle" ? "invisible" : "animate-layer-enter"}`}
      >
        {copyState.kind === "copied" ? "Link copied" : copyState.kind === "failed" ? "Could not copy: use the address bar" : ""}
      </p>
    </header>
  );
}
