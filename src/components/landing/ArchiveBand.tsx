import { ArchiveCaption, readArchiveBasePath } from "@/components/landing/ArchiveCaption";
import { LandingPicture } from "@/components/landing/LandingPicture";
import { readRiseOrderStyle } from "@/components/landing/rise-order";
import { FlipText } from "@/components/ui/FlipText";
import { ARCHIVE_ART } from "@/lib/landing/archive-art";

/**
 * The page's one rest: the first cable expedition's own pictures, painted on board in 1865 (src/lib/landing/archive-art.ts).
 * The statement and the bow made ready to grapple come first, then the deck scene runs the full width of the page.
 * The dates in the statement are the paintings' own titles.
 */
export function ArchiveBand({ contentClassName }: { contentClassName: string }) {
  const bow = ARCHIVE_ART["preparing-to-grapple"];
  const deck = ARCHIVE_ART["searching-for-the-fault"];
  return (
    <section aria-labelledby="archive-title" className="flex flex-col gap-16">
      <div className={`${contentClassName} grid items-end gap-10 lg:grid-cols-12 lg:gap-x-6`}>
        <div className="flex flex-col gap-4 lg:col-span-5">
          <FlipText as="h2" id="archive-title" text="Cable faults have been hunted since 1865." className="text-title sm:text-display" rise="ready" />
          <p className="text-lead text-ink" data-rise="ready" style={readRiseOrderStyle(1)}>
            On 31 July 1865 the crew of the Great Eastern hauled the Atlantic cable back up from the bottom and searched it for a fault. Two days later it broke and was lost, and they made ready to grapple for it. CableTrace searches the record a ship leaves instead.
          </p>
        </div>
        <figure className="flex flex-col gap-3 lg:col-span-6 lg:col-start-7" data-rise="ready" style={readRiseOrderStyle(2)}>
          <LandingPicture basePath={readArchiveBasePath("preparing-to-grapple")} widths={bow.widths} width={bow.width} height={bow.height} alt={bow.alt} sizes="(min-width: 1024px) 50vw, 100vw" />
          <ArchiveCaption art={bow} />
        </figure>
      </div>
      <figure className="flex flex-col gap-3">
        <LandingPicture basePath={readArchiveBasePath("searching-for-the-fault")} widths={deck.widths} width={deck.width} height={deck.height} alt={deck.alt} sizes="100vw" />
        <ArchiveCaption art={deck} className={contentClassName} />
      </figure>
    </section>
  );
}
