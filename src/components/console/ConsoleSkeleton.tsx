import Link from "next/link";
import { BrandMark } from "@/components/brand/BrandMark";

/**
 * The console's shape while its client part loads: the same bar, stage, rail and dock boxes, so nothing moves
 * when the console replaces it. Carries the case title and summary, so the first paint already says what this is.
 */
export function ConsoleSkeleton({ title, subtitle, summary }: { title: string; subtitle: string; summary: string }) {
  return (
    <div className="flex h-dvh flex-col overflow-hidden" aria-busy="true">
      <header className="flex h-14 flex-none items-center gap-5 px-4">
        <Link href="/" aria-label="CableTrace home" className="-mx-2 flex min-h-11 items-center gap-2.5 rounded-full px-2 text-ink">
          <BrandMark size={28} />
          <span className="hidden text-card-title xl:inline">CableTrace</span>
        </Link>
        <h1 className="truncate text-label">{title}</h1>
        <span className="hidden text-small text-muted xl:inline">{subtitle}</span>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4">
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-card bg-soft shadow-card">
          <div className="absolute top-4 bottom-4 left-4 hidden max-w-[560px] lg:block">
            <p className="text-body text-muted">{summary}</p>
          </div>
          <div className="absolute top-4 right-4 bottom-4 hidden w-[360px] flex-col gap-3 lg:flex">
            <div className="h-[132px] rounded-row bg-card shadow-card" />
            <div className="flex-1 rounded-row bg-card shadow-card" />
          </div>
        </div>
        <div className="h-[196px] flex-none rounded-card bg-card shadow-card max-lg:h-[132px]" />
      </div>
    </div>
  );
}
