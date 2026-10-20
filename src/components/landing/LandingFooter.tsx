import Link from "next/link";
import { BrandMark } from "@/components/brand/BrandMark";

// The footer is laid into the sky above the globe engraving, like type on a print (Andy's reference, 20 Oct 2026):
// the mark and one line, link columns, then the credits every page owes its sources and the hackathon line.
const REPOSITORY_URL = "https://github.com/Andy00L/cabletrace";

type FooterLink = { label: string; href: string; isExternal: boolean };

const FOOTER_COLUMNS: { title: string; links: FooterLink[] }[] = [
  {
    title: "Console",
    links: [
      { label: "Cases", href: "/cases", isExternal: false },
      { label: "Live", href: "/live", isExternal: false },
      { label: "Watchlist", href: "/watchlist", isExternal: false },
      { label: "WebGL check", href: "/diagnostics", isExternal: false },
    ],
  },
  {
    title: "Data",
    links: [
      { label: "Fintraffic Digitraffic", href: "https://www.digitraffic.fi/en/", isExternal: true },
      { label: "aisstream.io", href: "https://aisstream.io", isExternal: true },
      { label: "EMODnet Bathymetry", href: "https://emodnet.ec.europa.eu/en/bathymetry", isExternal: true },
      { label: "OpenStreetMap", href: "https://www.openstreetmap.org/copyright", isExternal: true },
    ],
  },
  {
    title: "Project",
    links: [
      { label: "Source on GitHub", href: REPOSITORY_URL, isExternal: true },
      { label: "Health", href: "/api/health", isExternal: false },
      { label: "Sign in", href: "/sign-in", isExternal: false },
    ],
  },
];

export function LandingFooter() {
  return (
    <footer className="paper-halo flex flex-col gap-8" aria-label="Site">
      <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex max-w-[340px] flex-col gap-3">
          <span className="flex items-center gap-2.5 text-ink">
            <BrandMark size={26} />
            <span className="text-card-title">CableTrace</span>
          </span>
          <p className="text-small text-muted">Ships near the world&apos;s cables, recorded every minute, and every cut on file replayed from its sources.</p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-12 gap-y-6 sm:grid-cols-3">
          {FOOTER_COLUMNS.map((column) => (
            <div key={column.title} className="flex flex-col gap-2">
              <h2 className="text-label">{column.title}</h2>
              <ul className="flex flex-col gap-1.5">
                {column.links.map((link) => (
                  <li key={link.label}>
                    {link.isExternal ? (
                      <a href={link.href} className="text-small text-muted hover:text-ink" rel="noopener noreferrer">
                        {link.label}
                      </a>
                    ) : (
                      <Link href={link.href} prefetch={false} className="text-small text-muted hover:text-ink">
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
      <div className="flex flex-col gap-2 border-t border-ink/20 pt-4 text-caption font-normal text-muted md:flex-row md:justify-between md:gap-8">
        <p className="max-w-[760px]">
          Ship positions: Fintraffic Digitraffic (CC BY 4.0) and aisstream.io. Depth: EMODnet Bathymetry (CC BY 4.0) and GEBCO. Land: Copernicus DEM GLO-30.
          Lines: OpenStreetMap contributors (ODbL). Art generated with Google Nano Banana.
        </p>
        <p className="flex-none">Built for the TestSprite Hackathon, Season 4</p>
      </div>
    </footer>
  );
}
