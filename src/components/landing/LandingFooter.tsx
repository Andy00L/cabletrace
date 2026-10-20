// The data credits and licences every page owes its sources (docs/UI_DESIGN_SYSTEM.md, Credits), the repository and
// the hackathon line. The art credit is the one Andy gave for his engravings.
const REPOSITORY_URL = "https://github.com/Andy00L/cabletrace";

export function LandingFooter() {
  return (
    <footer className="flex flex-col gap-4 border-t border-ink/15 pt-6 text-caption font-normal text-muted md:flex-row md:items-start md:justify-between">
      <p className="max-w-[720px]">
        Ship positions: Fintraffic Digitraffic (CC BY 4.0) and aisstream.io. Depth: EMODnet Bathymetry (CC BY 4.0) and GEBCO. Land:
        Copernicus DEM GLO-30. Lines: OpenStreetMap contributors (ODbL). Art generated with Google Nano Banana.
      </p>
      <p className="flex flex-none gap-6">
        <a href={REPOSITORY_URL} className="text-ink underline underline-offset-2" rel="noopener noreferrer">
          Source on GitHub
        </a>
        <span>Built for the TestSprite Hackathon, Season 4</span>
      </p>
    </footer>
  );
}
