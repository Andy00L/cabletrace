import Link from "next/link";
import { BrandMark } from "@/components/brand/BrandMark";

type SitePage = "home" | "cases" | "diagnostics";

const NAV_ITEMS: { page: SitePage; href: string; label: string }[] = [
  { page: "home", href: "/", label: "Home" },
  { page: "cases", href: "/cases", label: "Cases" },
];

/**
 * The bar at the top of the pages around the console (style board, board 12): the mark, the sections with the
 * current one on a white pill, and the WebGL check at the far end.
 */
export function SiteHeader({ current }: { current: SitePage }) {
  return (
    <header className="flex h-14 flex-none items-center gap-3 sm:gap-6">
      <Link href="/" aria-label="CableTrace home" className="-mx-2 flex min-h-11 items-center gap-2.5 rounded-full px-2 text-ink">
        <BrandMark size={28} />
        <span className="text-card-title">CableTrace</span>
      </Link>
      <nav aria-label="Sections" className="flex gap-1">
        {NAV_ITEMS.map((item) => {
          const isCurrent = item.page === current;
          return (
            <Link
              key={item.page}
              href={item.href}
              aria-current={isCurrent ? "page" : undefined}
              className={`flex h-10 items-center rounded-full px-3.5 text-label transition-colors duration-140 ease-standard ${isCurrent ? "bg-card text-ink shadow-selected" : "text-muted hover:text-ink"}`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <Link
        href="/diagnostics"
        aria-current={current === "diagnostics" ? "page" : undefined}
        className="ml-auto hidden min-h-11 items-center text-small text-muted transition-colors duration-140 ease-standard hover:text-ink aria-[current=page]:text-ink sm:flex"
        data-testid="diagnostics-link"
      >
        WebGL check
      </Link>
    </header>
  );
}
