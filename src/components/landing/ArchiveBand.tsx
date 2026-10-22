import { LandingPicture } from "@/components/landing/LandingPicture";
import { readRiseOrderStyle } from "@/components/landing/rise-order";
import { ARCHIVE_ART, type ArchiveArt, type ArchiveArtName } from "@/lib/landing/archive-art";

/** The picture's own title, its painter and year, linked to its page at the Met; the licence is listed on /credits. */
function ArchiveCaption({ art, className = "" }: { art: ArchiveArt; className?: string }) {
  return (
    <figcaption className={`text-small text-muted ${className}`}>
      <a href={art.pageUrl} className="text-ink underline-offset-4 hover:underline" rel="noopener noreferrer">
        {art.title}
      </a>
      . {art.creator}, {art.date}.
    </figcaption>
  );
}

function readArchiveBasePath(name: ArchiveArtName): string {
  return `/landing/archive/${name}`;
}

/**
 * The page's one rest: the first cable expedition's own pictures, painted on board in 1865 (src/lib/landing/archive-art.ts).
 * The statement and the fleet at sea come first, then the deck scene runs the full width of the page.
 */
export function ArchiveBand({ contentClassName }: { contentClassName: string }) {
  const fleet = ARCHIVE_ART["cable-fleet-at-sea"];
  const deck = ARCHIVE_ART["searching-for-the-fault"];
  return (
    <section aria-labelledby="archive-title" className="flex flex-col gap-16">
      <div className={`${contentClassName} grid items-end gap-10 lg:grid-cols-12 lg:gap-x-6`}>
        <div className="flex flex-col gap-4 lg:col-span-5">
          <h2 id="archive-title" className="text-title sm:text-display" data-rise="ready">
            Cable faults have been hunted since 1865.
          </h2>
          <p className="text-lead text-ink" data-rise="ready" style={readRiseOrderStyle(1)}>
            On 31 July 1865 the crew of the Great Eastern hauled the Atlantic cable back up from the bottom and searched it for a fault. CableTrace searches the record a ship leaves instead.
          </p>
        </div>
        <figure className="flex flex-col gap-3 lg:col-span-6 lg:col-start-7" data-rise="ready" style={readRiseOrderStyle(2)}>
          <LandingPicture basePath={readArchiveBasePath("cable-fleet-at-sea")} widths={fleet.widths} width={fleet.width} height={fleet.height} alt={fleet.alt} sizes="(min-width: 1024px) 50vw, 100vw" />
          <ArchiveCaption art={fleet} />
        </figure>
      </div>
      <figure className="flex flex-col gap-3">
        <LandingPicture basePath={readArchiveBasePath("searching-for-the-fault")} widths={deck.widths} width={deck.width} height={deck.height} alt={deck.alt} sizes="100vw" />
        <ArchiveCaption art={deck} className={contentClassName} />
      </figure>
    </section>
  );
}
