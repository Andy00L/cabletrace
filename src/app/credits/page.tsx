import type { Metadata } from "next";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { ARCHIVE_ART } from "@/lib/landing/archive-art";

export const metadata: Metadata = {
  title: "Data and credits",
  description: "Where CableTrace's ship positions, depths, land, lines and pictures come from, and under which licences.",
};

type Credit = { what: string; source: string; href: string | null; licence: string };

// One row per kind of data, as README.md lists them ("Data sources and licences"); keep the two in step. These are the
// credits the landing's footer carried until 21 Oct 2026.
const DATA_CREDITS: Credit[] = [
  { what: "Water depth, Europe", source: "EMODnet Bathymetry Consortium, EMODnet Digital Bathymetry (DTM 2024)", href: "https://emodnet.ec.europa.eu/en/bathymetry", licence: "CC BY 4.0" },
  { what: "Water depth, Taiwan and Red Sea", source: "GEBCO Compilation Group (2026) GEBCO 2026 Grid (doi:10.5285/4f68d5c7-45eb-f999-e063-7086abc036fa)", href: "https://www.gebco.net/data-products/gridded-bathymetry-data", licence: "Public domain" },
  {
    what: "Land heights and coast",
    source: "Copernicus DEM GLO-30, produced using Copernicus WorldDEM-30 (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA",
    href: "https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM",
    licence: "Copernicus DEM licence, free with attribution",
  },
  { what: "Cables, seabed blocks and globe", source: "OpenStreetMap contributors", href: "https://www.openstreetmap.org/copyright", licence: "ODbL 1.0" },
  {
    what: "Cable routes, Red Sea (SEACOM, AAE-1, EIG)",
    source: "Traced off the maps in Nick Harrington and Michael Cuddington (Meta), Misinformation in the Red Sea, LINX slides, Nov 2024; schematic beyond them",
    // The archived copy the Rubymar case cites (src/data/cases/rubymar-2024.ts, source 7).
    href: "https://web.archive.org/web/20261017164505/https://www.linx.net/wp-content/uploads/2024/11/Misinformation-in-the-Red-Sea-1.pdf",
    licence: "No licence published; credited",
  },
  { what: "Pipelines", source: "EMODnet Human Activities", href: "https://emodnet.ec.europa.eu/en/human-activities", licence: "CC BY 4.0" },
  { what: "Globe land and named seas", source: "Natural Earth 1:50m", href: "https://www.naturalearthdata.com/about/terms-of-use/", licence: "Public domain" },
  { what: "Sand ripple detail", source: "Poly Haven, Aerial Beach 01 by Rob Tuytel", href: "https://polyhaven.com/a/aerial_beach_01", licence: "CC0" },
  { what: "Recorded AIS, Yi Peng 3 and Vezhen", source: "Danish Maritime Authority AIS archive", href: null, licence: "DMA terms for the archive" },
  { what: "Recorded AIS, Svalbard", source: "Norwegian Coastal Administration, Kystdatahuset", href: null, licence: "NLOD" },
  { what: "Live positions, Gulf of Finland", source: "Fintraffic, digitraffic.fi", href: "https://www.digitraffic.fi/en/", licence: "CC BY 4.0" },
  { what: "Live positions, other regions and the globe", source: "aisstream.io", href: "https://aisstream.io", licence: "No terms published; kept 2 days, credited" },
  { what: "Flags from MMSI", source: "ITU, Maritime Identification Digits table (read 17 Oct 2026)", href: null, licence: "Facts, credited" },
  { what: "Fault signals", source: "NGA Maritime Safety Information broadcast warnings; IODA (Georgia Tech) outage alerts", href: null, licence: "US government work; IODA shown as title and link only" },
];

// The Copernicus licence asks for this sentence with modified data (README.md).
const COPERNICUS_NOTICE =
  "The organisations in charge of the Copernicus programme by law or by delegation do not incur any liability for any use of the Copernicus WorldDEM-30.";

/**
 * Every source the site's data and pictures come from, with its licence: the attribution the licences ask for, linked
 * from the landing's footer. Public, like the landing (src/proxy.ts).
 */
export default function CreditsPage() {
  const archivePictures = Object.values(ARCHIVE_ART);
  return (
    <div className="min-h-dvh bg-page">
      <div className="mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-8">
        <SiteHeader current="home" />
      </div>
      <main className="mx-auto flex w-full max-w-[880px] flex-col gap-16 px-4 pt-16 pb-24 sm:px-6">
        <div className="flex flex-col gap-4">
          <h1 className="text-title sm:text-display">Data and credits</h1>
          <p className="text-lead text-ink">Every replay and every live figure is built from public data. These are its sources and their licences.</p>
        </div>
        <section aria-labelledby="data-title" className="flex flex-col gap-4">
          <h2 id="data-title" className="text-heading">Data</h2>
          <ul className="flex flex-col gap-1">
            {DATA_CREDITS.map((credit, index) => (
              <li key={credit.what} className={`grid gap-x-6 gap-y-1 rounded-field px-5 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,0.8fr)] ${index % 2 === 0 ? "bg-card" : "bg-soft"}`}>
                <span className="text-body text-ink">{credit.what}</span>
                {credit.href === null ? (
                  <span className="text-body text-ink">{credit.source}</span>
                ) : (
                  <a href={credit.href} className="text-body text-ink underline underline-offset-4" rel="noopener noreferrer">
                    {credit.source}
                  </a>
                )}
                <span className="text-small text-muted">{credit.licence}</span>
              </li>
            ))}
          </ul>
          <p className="text-small text-muted">{COPERNICUS_NOTICE}</p>
        </section>
        <section aria-labelledby="pictures-title" className="flex flex-col gap-4">
          <h2 id="pictures-title" className="text-heading">Pictures</h2>
          <ul className="flex flex-col gap-1">
            {archivePictures.map((picture, index) => (
              <li key={picture.pageUrl} className={`flex flex-col gap-1 rounded-field px-5 py-4 ${index % 2 === 0 ? "bg-card" : "bg-soft"}`}>
                <a href={picture.pageUrl} className="text-body text-ink underline underline-offset-4" rel="noopener noreferrer">
                  {picture.title}
                </a>
                <span className="text-small text-muted">
                  {picture.creator}, {picture.date}. The Metropolitan Museum of Art,{" "}
                  <a href={picture.licence.url} className="underline underline-offset-4" rel="noopener noreferrer">
                    {picture.licence.name}
                  </a>
                  .
                </span>
              </li>
            ))}
            <li className={`flex flex-col gap-1 rounded-field px-5 py-4 ${archivePictures.length % 2 === 0 ? "bg-card" : "bg-soft"}`}>
              <span className="text-body text-ink">The engraving on the sign-in and account pages</span>
              <span className="text-small text-muted">Generated with Google Nano Banana.</span>
            </li>
            <li className={`flex flex-col gap-1 rounded-field px-5 py-4 ${archivePictures.length % 2 === 0 ? "bg-soft" : "bg-card"}`}>
              <span className="text-body text-ink">The replay footage and stills on the front page</span>
              <span className="text-small text-muted">Recorded from CableTrace&apos;s own console.</span>
            </li>
          </ul>
        </section>
      </main>
    </div>
  );
}
