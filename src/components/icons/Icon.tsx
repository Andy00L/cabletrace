import type { ReactNode } from "react";

// The house icon set (docs/UI_DESIGN_SYSTEM.md, Icons): drawn on a 20 px grid with a 1.6 px stroke, round caps and
// round joins, in the current text color. Server-safe: no client code.

const ICON_PATHS = {
  chevronDown: <path d="M6 8.5 10 12.5 14 8.5" />,
  chevronRight: <path d="M8 5.5 12.5 10 8 14.5" />,
  chevronLeft: <path d="M12 5.5 7.5 10 12 14.5" />,
  close: <path d="M6 6 14 14M14 6 6 14" />,
  link: (
    <>
      <path d="M8.6 11.4a3 3 0 0 0 4.3 0l2.2-2.2a3 3 0 0 0-4.3-4.3l-.9.9" />
      <path d="M11.4 8.6a3 3 0 0 0-4.3 0l-2.2 2.2a3 3 0 0 0 4.3 4.3l.9-.9" />
    </>
  ),
  keyboard: (
    <>
      <rect x="2.8" y="5.2" width="14.4" height="9.6" rx="2.4" />
      <path d="M6 8.4h.01M8.7 8.4h.01M11.3 8.4h.01M14 8.4h.01M7.2 11.6h5.6" />
    </>
  ),
  info: (
    <>
      <circle cx="10" cy="10" r="7.2" />
      <path d="M10 9.2v4.2M10 6.6h.01" />
    </>
  ),
  reset: (
    <>
      <path d="M4.4 9.2a5.8 5.8 0 1 1 1.4 4.6" />
      <path d="M4 5.4v3.8h3.8" />
    </>
  ),
  follow: (
    <>
      <circle cx="10" cy="10" r="2.4" />
      <path d="M10 2.8v2.6M10 14.6v2.6M2.8 10h2.6M14.6 10h2.6" />
    </>
  ),
  fullscreen: <path d="M3.6 7.4V4.6a1 1 0 0 1 1-1h2.8M12.6 3.6h2.8a1 1 0 0 1 1 1v2.8M16.4 12.6v2.8a1 1 0 0 1-1 1h-2.8M7.4 16.4H4.6a1 1 0 0 1-1-1v-2.8" />,
  exitFullscreen: <path d="M7.4 3.6v2.8a1 1 0 0 1-1 1H3.6M16.4 7.4h-2.8a1 1 0 0 1-1-1V3.6M12.6 16.4v-2.8a1 1 0 0 1 1-1h2.8M3.6 12.6h2.8a1 1 0 0 1 1 1v2.8" />,
  search: (
    <>
      <circle cx="9" cy="9" r="5.2" />
      <path d="m13 13 3.4 3.4" />
    </>
  ),
  external: (
    <>
      <path d="M8 4.6H5.4a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V12" />
      <path d="M11 4.4h4.6V9M15.4 4.6 9.6 10.4" />
    </>
  ),
  archive: (
    <>
      <rect x="3.4" y="4.2" width="13.2" height="3.6" rx="1.2" />
      <path d="M4.6 7.8v6.8a1 1 0 0 0 1 1h8.8a1 1 0 0 0 1-1V7.8M8.2 10.8h3.6" />
    </>
  ),
  panel: (
    <>
      <rect x="3" y="3.6" width="14" height="12.8" rx="2.4" />
      <path d="M12 3.6v12.8" />
    </>
  ),
  check: <path d="m5 10.4 3.2 3.2L15 6.8" />,
  // A film camera: the director, who picks the shot (board 22).
  director: (
    <>
      <rect x="2.8" y="5.4" width="10.4" height="9.2" rx="2.2" />
      <path d="m13.2 8.6 4-2.2v7.2l-4-2.2" />
    </>
  ),
  bookmark: <path d="M6.2 3.4h7.6a1.2 1.2 0 0 1 1.2 1.2v12l-5-3.3-5 3.3v-12a1.2 1.2 0 0 1 1.2-1.2Z" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof ICON_PATHS;

/** One house icon. Decorative by default; give `label` when the icon is the only content of a control. */
export function Icon({ name, size = 20, className, label }: { name: IconName; size?: number; className?: string; label?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {ICON_PATHS[name]}
    </svg>
  );
}
