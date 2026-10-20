import type { ReactNode } from "react";

/**
 * A card printed on the landing's paper (board 13, restyled after Andy asked for fewer plain white cards): paper on
 * paper, lifted by a shadow and framed by the engravings' own plate mark, a fine ink rule with a second one inset.
 */
export function Plate({ children, className = "", testId }: { children: ReactNode; className?: string; testId?: string }) {
  return (
    <div className={`relative rounded-card border border-ink/20 bg-paper shadow-raised ${className}`} data-testid={testId}>
      <span className="pointer-events-none absolute inset-1.5 rounded-[19px] border border-ink/10" aria-hidden="true" />
      <div className="relative">{children}</div>
    </div>
  );
}
