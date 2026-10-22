import Link from "next/link";
import { Icon } from "@/components/icons/Icon";

type DiscoverButtonProps = {
  href: string;
  label: string;
  /** `ink` on a light ground, `dusk` on slate. */
  tone?: "ink" | "dusk";
  testId?: string;
  className?: string;
};

/**
 * A pill whose arrow circle sweeps its fill across the label on hover or focus, after ObsidianUI's Discover Button
 * (MIT, obsidianui.dev/docs/discover-button), restyled to the house palette and drawn with the house arrow. The sweep
 * is a clip-path, not a width, so it never relays the page; the `discover-*` rules live in src/app/globals.css.
 */
export function DiscoverButton({ href, label, tone = "ink", testId, className = "" }: DiscoverButtonProps) {
  return (
    <Link href={href} className={`discover-button ${tone === "dusk" ? "discover-button-dusk" : ""} ${className}`} data-testid={testId}>
      <span className="discover-fill" aria-hidden="true" />
      <span className="discover-icon" aria-hidden="true">
        <Icon name="arrowRight" size={22} />
      </span>
      <span className="discover-label">{label}</span>
    </Link>
  );
}
