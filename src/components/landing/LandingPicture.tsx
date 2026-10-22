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
  className?: string;
};

function buildSourceSet(basePath: string, widths: readonly number[], format: "avif" | "webp"): string {
  return widths.map((width) => `${basePath}-${width}.${format} ${width}w`).join(", ");
}

/**
 * A still or an archival picture on the landing, AVIF then WebP at the widths it was built at (the console stills from
 * src/lib/landing/replay-footage.ts, the archive from src/lib/landing/archive-art.ts). Lazy, since none of them is the
 * hero's picture; its box keeps the picture's ratio so nothing shifts while it loads. ArtPicture serves the engravings
 * instead, whose desktop and phone cuts are different files.
 */
export function LandingPicture({ basePath, widths, width, height, alt, sizes, className = "" }: LandingPictureProps) {
  const fallbackWidth = widths[0] ?? width;
  return (
    <picture>
      <source type="image/avif" srcSet={buildSourceSet(basePath, widths, "avif")} sizes={sizes} />
      <source type="image/webp" srcSet={buildSourceSet(basePath, widths, "webp")} sizes={sizes} />
      <img src={`${basePath}-${fallbackWidth}.webp`} width={width} height={height} alt={alt} loading="lazy" decoding="async" className={`block h-auto w-full ${className}`} />
    </picture>
  );
}
