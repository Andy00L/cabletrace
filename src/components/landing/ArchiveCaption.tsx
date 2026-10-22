import type { ArchiveArt, ArchiveArtName } from "@/lib/landing/archive-art";

/** The files of one archival picture, at /landing/archive/<name>-<width>.avif and .webp (scripts/art/build-archive-art.ts). */
export function readArchiveBasePath(name: ArchiveArtName): string {
  return `/landing/archive/${name}`;
}

/** The picture's title (short form), its painter and year, linked to its page at the Met; /credits lists the full title and the licence. */
export function ArchiveCaption({ art, className = "" }: { art: ArchiveArt; className?: string }) {
  return (
    <figcaption className={`text-small text-muted ${className}`}>
      <a href={art.pageUrl} className="text-ink underline-offset-4 hover:underline" rel="noopener noreferrer">
        {art.shortTitle}
      </a>
      . {art.creator}, {art.date}.
    </figcaption>
  );
}
