import Link from "next/link";
import { BrandMark } from "@/components/brand/BrandMark";
import { StageLoading } from "@/components/console/StageLoading";

// Ghost controls: the console's own controls, without their content, at their own places and sizes (StageOverlays,
// ConsoleDock), on the stage's `soft` tone.
const GHOST_CLASS = "rounded-full bg-card/60";

/**
 * The console's shape while its client part loads: the same bar, stage controls, rail, dock and the stage's loading
 * card at its first step, so nothing moves when the console replaces it. Carries the case title and summary, so the
 * first paint already says what this is.
 */
export function ConsoleSkeleton({ title, subtitle, summary }: { title: string; subtitle: string; summary: string }) {
  return (
    <div className="flex h-dvh flex-col overflow-hidden" aria-busy="true" data-testid="console-skeleton">
      <header className="flex h-14 flex-none items-center gap-5 px-4">
        <Link href="/" aria-label="CableTrace home" className="-mx-2 flex min-h-11 items-center gap-2.5 rounded-full px-2 text-ink">
          <BrandMark size={28} />
          <span className="hidden text-card-title xl:inline">CableTrace</span>
        </Link>
        <h1 className="truncate text-label">{title}</h1>
        <span className="hidden text-small text-muted xl:inline">{subtitle}</span>
        <span className="ml-auto hidden h-11 w-[244px] flex-none rounded-full bg-soft lg:block" aria-hidden="true" />
      </header>
      {/* Under 768 px the console's folded bottom sheet (96 px, ReplayConsole SHEET_PEEK_PX) sits under the dock. */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4 max-md:pb-[112px]">
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-card bg-soft shadow-card">
          <div className={`absolute top-4 left-4 h-11 w-[min(372px,calc(100%-32px))] ${GHOST_CLASS}`} aria-hidden="true" />
          <div className="absolute top-[76px] left-4 hidden max-w-[560px] lg:block">
            <p className="text-body text-muted">{summary}</p>
          </div>
          <StageLoading step="seabed" />
          <div className={`absolute bottom-4 left-4 hidden h-10 w-[330px] md:block ${GHOST_CLASS}`} aria-hidden="true" />
          <div className={`absolute right-4 bottom-4 h-11 w-[188px] lg:right-[392px] ${GHOST_CLASS}`} aria-hidden="true" />
          <div className="absolute top-4 right-4 bottom-4 hidden w-[360px] flex-col gap-3 lg:flex" aria-hidden="true">
            <div className="h-[132px] rounded-row bg-card shadow-card" />
            <div className="flex-1 rounded-row bg-card shadow-card" />
          </div>
        </div>
        {/* The dock is a slate band (ConsoleDock), so its ghost is too: nothing flips from light to dark on load. */}
        <div className="flex h-[196px] flex-none flex-col gap-4 rounded-card bg-slate p-5 shadow-card max-lg:h-[132px]" aria-hidden="true">
          <div className="flex items-center gap-4">
            <span className="size-11 flex-none rounded-full bg-slate-raised" />
            <span className="h-6 w-28 flex-none rounded-chip bg-slate-raised" />
            <span className="h-1.5 flex-1 rounded-full bg-slate-raised" />
          </div>
          <div className="hidden min-h-0 flex-1 gap-6 lg:flex">
            <span className="flex-1 rounded-field bg-slate-raised" />
            <span className="flex-1 rounded-field bg-slate-raised" />
            <span className="flex-1 rounded-field bg-slate-raised" />
          </div>
        </div>
      </div>
      <div className="fixed inset-x-0 bottom-0 h-[96px] rounded-t-card bg-page shadow-popover md:hidden" />
    </div>
  );
}
