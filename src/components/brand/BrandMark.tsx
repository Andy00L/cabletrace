type BrandMarkProps = {
  size?: number;
};

// The CableTrace mark: a cable line with a break in it.
export function BrandMark({ size = 28 }: BrandMarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path d="M3 16 C 7 16, 8.5 12.5, 12 12.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M16 15.5 C 19.5 15.5, 21 12, 25 12" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}
