type LandingPictureProps = {
  /** The files' path without the width and extension: `/landing/archive/searching-for-the-fault` for `...-1200.avif`. */
  basePath: string;
  widths: readonly number[];
  /** The full picture's size, for its ratio. */
  width: number;
  height: number;
  alt: string;
  /** How wide the picture renders, for the browser's pick among the widths. */
  sizes: string;
  /** The hero's painting: loaded at once and first, since it is the page's largest picture. Every other one is lazy. */
  isPriority?: boolean;
  /** Fills its box (which sets the size) and crops to it, centred on `objectPosition`, instead of keeping its ratio. */
  isCover?: boolean;
  objectPosition?: string;
  className?: string;
};

function buildSourceSet(basePath: string, widths: readonly number[], format: "avif" | "webp"): string {
  return widths.map((width) => `${basePath}-${width}.${format} ${width}w`).join(", ");
}

/**
 * A still or an archival picture on the landing, AVIF then WebP at the widths it was built at (the console stills from
 * src/lib/landing/replay-footage.ts, the archive from src/lib/landing/archive-art.ts). Its box keeps the picture's
 * ratio so nothing shifts while it loads, unless it covers a box sized by its parent (the hero's painting).
 */
export function LandingPicture({ basePath, widths, width, height, alt, sizes, isPriority = false, isCover = false, objectPosition, className = "" }: LandingPictureProps) {
  const fallbackWidth = widths[0] ?? width;
  return (
    <picture className={isCover ? "contents" : undefined}>
      <source type="image/avif" srcSet={buildSourceSet(basePath, widths, "avif")} sizes={sizes} />
      <source type="image/webp" srcSet={buildSourceSet(basePath, widths, "webp")} sizes={sizes} />
      <img
        src={`${basePath}-${fallbackWidth}.webp`}
        width={width}
        height={height}
        alt={alt}
        loading={isPriority ? "eager" : "lazy"}
        fetchPriority={isPriority ? "high" : undefined}
        decoding="async"
        style={objectPosition ? { objectPosition } : undefined}
        className={`block w-full ${isCover ? "h-full object-cover" : "h-auto"} ${className}`}
      />
    </picture>
  );
}
