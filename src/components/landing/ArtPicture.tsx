import type { CSSProperties } from "react";
import { ART_MANIFEST, ART_PLATES, type ArtName } from "@/components/landing/art-manifest";

// Below this width the page serves the 4:5 phone cut of each piece (the landing prompt, section 4.3).
const PHONE_MEDIA = "(max-width: 767px)";
// The art spans the content column, at most 1,440 px wide.
const DESKTOP_SIZES = "(min-width: 1440px) 1440px, 100vw";

type ArtPictureProps = {
  desktop: Exclude<ArtName, `${string}-phone`>;
  phone: Extract<ArtName, `${string}-phone`>;
  alt: string;
  /** The hero piece is the page's largest paint: fetched first, never lazily. */
  isPriority?: boolean;
  /** Prints the piece's plate number and caption under it, like a plate in a book (the landing; never the sign-in art). */
  hasPlateCaption?: boolean;
  /** Classes for the image itself, such as its dissolve mask, so a caption under it stays outside the mask. */
  className?: string;
};

function buildSourceSet(name: ArtName, format: "avif" | "webp"): string {
  return ART_MANIFEST[name].widths.map((width) => `/art/${name}-${width}.${format} ${width}w`).join(", ");
}

/**
 * One of Andy's engravings as a responsive picture: AVIF then WebP, the phone cut under 768 px. Its box keeps the
 * piece's ratio, so nothing shifts while it loads over the bare paper. With `hasPlateCaption` it becomes a figure with
 * the plate line from the art manifest under it.
 */
export function ArtPicture({ desktop, phone, alt, isPriority = false, hasPlateCaption = false, className = "" }: ArtPictureProps) {
  const desktopArt = ART_MANIFEST[desktop];
  const phoneArt = ART_MANIFEST[phone];
  const style: CSSProperties & Record<`--${string}`, string> = {
    "--art-ratio": `${desktopArt.width} / ${desktopArt.height}`,
    "--art-ratio-phone": `${phoneArt.width} / ${phoneArt.height}`,
  };
  const fallbackWidth = desktopArt.widths[1] ?? desktopArt.widths[0] ?? 1600;
  const picture = (
    <picture>
      <source media={PHONE_MEDIA} type="image/avif" srcSet={buildSourceSet(phone, "avif")} sizes="100vw" />
      <source media={PHONE_MEDIA} type="image/webp" srcSet={buildSourceSet(phone, "webp")} sizes="100vw" />
      <source type="image/avif" srcSet={buildSourceSet(desktop, "avif")} sizes={DESKTOP_SIZES} />
      <source type="image/webp" srcSet={buildSourceSet(desktop, "webp")} sizes={DESKTOP_SIZES} />
      <img
        src={`/art/${desktop}-${fallbackWidth}.webp`}
        alt={alt}
        width={desktopArt.width}
        height={desktopArt.height}
        loading={isPriority ? "eager" : "lazy"}
        fetchPriority={isPriority ? "high" : "auto"}
        decoding={isPriority ? "sync" : "async"}
        style={style}
        className={`block h-auto w-full aspect-(--art-ratio-phone) md:aspect-(--art-ratio) ${className}`}
      />
    </picture>
  );
  if (!hasPlateCaption) return picture;
  const plate = ART_PLATES[desktop];
  return (
    <figure>
      {picture}
      <figcaption className="paper-halo mx-auto max-w-[760px] px-4 pt-3 pb-8 text-center text-caption font-normal text-balance text-muted" data-testid={`plate-${desktop}`}>
        <span className="font-medium text-ink">Plate {plate.number}.</span> {plate.caption}
      </figcaption>
    </figure>
  );
}
