import Link from "next/link";
import { AnchorFigure } from "@/components/landing/AnchorFigure";
import { ArtPicture } from "@/components/landing/ArtPicture";
import { Icon } from "@/components/icons/Icon";
import { EvidenceNote } from "@/components/landing/EvidenceNote";
import { describeLandingRecord, LandingFooter } from "@/components/landing/LandingFooter";
import { LandingStickyBar } from "@/components/landing/LandingStickyBar";
import { LiveWatch, SHIPS_LAST_HOUR_PHRASE } from "@/components/landing/LiveWatch";
import { NewestCaseNote } from "@/components/landing/NewestCaseNote";
import { ProofNumbers, type ProofFigure } from "@/components/landing/ProofNumbers";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { CABLE_CASES } from "@/data/cases";
import { EAGLE_S_2024 } from "@/data/cases/eagle-s-2024";
import { REGIONS } from "@/data/regions";
import { loadLandingLive } from "@/lib/landing/landing-live";
import { ART_MANIFEST } from "@/components/landing/art-manifest";
import type { CSSProperties } from "react";

// The console opens on the Eagle S replay, the case every board and lookdev frame starts from.
const CONSOLE_PATH = `/cases/${EAGLE_S_2024.slug}`;
// The evidence note explains one placed position: the C-Lion1 cut, placed from Cinia's own description.
const EVIDENCE_CUT_LABEL = "C-Lion1";
// The press scales the pill to 0.97 (the design system's press, as LiveDock's buttons); hover only shifts the fill and
// slides the chevron 2 px, the pill itself never moves.
const INK_PILL_CLASS =
  "group flex h-12 items-center justify-center gap-1 rounded-full bg-ink pr-5 pl-6 text-label text-card transition-[background-color,scale] duration-80 ease-standard hover:bg-ink-hover active:scale-[0.97]";
// Where the recorder figures are counted, readable without signing in (src/proxy.ts, isPublicRoute).
const HEALTH_PATH = "/api/health";
const CONTENT_CLASS = "mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-20";
// The hero block the sticky bar watches: once it has scrolled away, the bar brings its action back (LandingStickyBar).
const HERO_BLOCK_ID = "landing-hero";
// The furrow notes are placed in percentages of the furrow picture alone, not of the picture and its plate caption.
const FURROW_RATIO_STYLE: CSSProperties & Record<`--${string}`, string> = {
  "--furrow-ratio": `${ART_MANIFEST["art-2"].width} / ${ART_MANIFEST["art-2"].height}`,
};

function buildProofFigures(cablesWatched: number | null, positionsLastHour: number | null): ProofFigure[] {
  const sourceCount = CABLE_CASES.reduce((total, cableCase) => total + cableCase.sources.length, 0);
  return [
    { value: String(CABLE_CASES.length), label: "cases on file", detail: `${sourceCount} sources, each quote linked to its page and an archived copy` },
    { value: cablesWatched === null ? "-" : cablesWatched.toLocaleString("en-US"), label: "cables and pipelines watched", detail: `OpenStreetMap and EMODnet lines in ${REGIONS.length} regions`, source: { href: HEALTH_PATH, label: "Live count" } },
    { value: String(REGIONS.length), label: "regions recorded every minute", detail: `Digitraffic in the Gulf of Finland, aisstream.io in all ${REGIONS.length}`, source: { href: HEALTH_PATH, label: "Recorder status" } },
    { value: positionsLastHour === null ? "-" : positionsLastHour.toLocaleString("en-US"), label: "positions in the last hour", detail: "every ship within 3 km of a watched line", source: { href: HEALTH_PATH, label: "Live count" } },
  ];
}

/**
 * The public front door. Andy's three engravings are the layout, not pictures on it: the type is set into their empty
 * sky and water the way a footer sits in the sky of a print (his reference, 20 Oct 2026). No cards. Every number is read
 * from the recorder or the case files. The rest of the app sits behind sign-in (src/proxy.ts).
 */
export default async function LandingPage() {
  const newestCase = CABLE_CASES[0];
  const evidenceCut = EAGLE_S_2024.cuts.find((cut) => cut.label === EVIDENCE_CUT_LABEL) ?? EAGLE_S_2024.cuts[0];
  const live = await loadLandingLive();
  const summary = live.recorder.ok ? live.recorder.value.summary : null;
  const figures = buildProofFigures(summary?.cablesWatched ?? null, summary?.positionsLastHour ?? null);
  const linesWatched = summary ? `${summary.cablesWatched} cables and pipelines` : "the cables and pipelines";
  const stickyStateLine = summary ? `${summary.shipsLastHour.toLocaleString("en-US")} ${SHIPS_LAST_HOUR_PHRASE}` : null;
  const closingRecord = describeLandingRecord({ cases: CABLE_CASES, cablesWatched: summary?.cablesWatched ?? null, regionCount: REGIONS.length });

  return (
    // Every anchor target keeps clear of the sticky bar's 56 px when the page jumps to it.
    <div className="min-h-dvh overflow-x-clip bg-paper [&_[id]]:scroll-mt-16">
      <LandingStickyBar heroId={HERO_BLOCK_ID} stateLine={stickyStateLine} action={{ href: CONSOLE_PATH, label: "Open the console" }} />
      <main>
        {/* The gulf at anchor: the headline in its sky on the left, the live watch in its sky on the right. On a phone
            the sky holds the headline and the live watch follows the picture. */}
        <section aria-labelledby="landing-title" className="relative flex flex-col">
          <div className={`relative z-10 ${CONTENT_CLASS} lg:px-6`}>
            <SiteHeader current="home" />
            <div id={HERO_BLOCK_ID} className="flex max-w-[800px] flex-col gap-5 pt-8 lg:px-14 lg:pt-16">
              <h1 id="landing-title" className="paper-halo text-title sm:text-hero">
                Ships are crossing the world&apos;s cables right now.
              </h1>
              <p className="paper-halo max-w-[560px] text-body text-muted sm:text-heading sm:font-normal">
                CableTrace watches every ship near {linesWatched} in {REGIONS.length} regions, and replays each cut from its sources, minute by minute.
              </p>
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <Link href={CONSOLE_PATH} className={INK_PILL_CLASS} data-testid="open-console">
                  Open the console
                  <Icon name="chevronRight" className="transition-transform duration-140 ease-standard group-hover:translate-x-0.5" />
                </Link>
                <Link href="/sign-in" className="flex h-12 items-center rounded-full px-4 text-label text-ink hover:bg-ink/5" data-testid="landing-sign-in">
                  Sign in
                </Link>
              </div>
            </div>
          </div>
          <div className="order-2 -mt-[48vw] md:-mt-[10vw] lg:-mt-[8vw]">
            <ArtPicture
              desktop="art-1"
              phone="art-1-phone"
              isPriority
              hasPlateCaption
              className="art-dissolve"
              alt="Engraving of a crude oil tanker at anchor in the Gulf of Finland, rocky pine shore in the foreground, a church and a lighthouse on the far coast, one vermilion buoy"
            />
          </div>
          <div className={`relative z-10 order-3 ${CONTENT_CLASS} pt-4 pb-6 lg:pointer-events-none lg:absolute lg:inset-x-0 lg:top-[88px] lg:p-0 lg:px-20`}>
            <div className="lg:pointer-events-auto lg:ml-auto lg:w-[380px]">
              <LiveWatch live={live} />
            </div>
          </div>
        </section>

        {/* The figure: how a dragged anchor parts a cable, drawn from the replay's own numbers (AnchorFigure.tsx). */}
        <section aria-label="How a dragged anchor parts a cable" className={`${CONTENT_CLASS} pt-10`}>
          <AnchorFigure />
        </section>

        <section aria-label="On file" className={`${CONTENT_CLASS} pt-14 pb-10`}>
          <ProofNumbers figures={figures} />
        </section>

        {/* The furrow: the newest case in the open water left of the chain, the evidence in the water right of it. Below
            1,280 px the water is too shallow for type, so both sit above the picture. */}
        {newestCase && evidenceCut && (
          <section aria-label="The newest case and its evidence" className="relative flex flex-col">
            <div
              style={FURROW_RATIO_STYLE}
              className={`relative z-10 ${CONTENT_CLASS} grid gap-10 md:grid-cols-2 xl:pointer-events-none xl:absolute xl:inset-x-0 xl:top-0 xl:block xl:aspect-(--furrow-ratio) xl:max-w-none xl:px-0`}
            >
              <div className="xl:pointer-events-auto xl:absolute xl:top-[22%] xl:left-[4%] xl:w-[27%]">
                <NewestCaseNote cableCase={newestCase} />
              </div>
              <div className="xl:pointer-events-auto xl:absolute xl:top-[16%] xl:right-[2%] xl:w-[21%]">
                <EvidenceNote cableCase={EAGLE_S_2024} cut={evidenceCut} />
              </div>
            </div>
            <div className="order-2 -mt-[24vw] md:-mt-[4vw] xl:mt-0">
              <ArtPicture
                desktop="art-2"
                phone="art-2-phone"
                hasPlateCaption
                className="art-dissolve-short"
                alt="Engraving in section: a tanker on the surface, its chain running down to an anchor that ploughs a furrow across the seabed toward a cable, a vermilion mark where it frays"
              />
            </div>
          </section>
        )}

        {/* The threads: the closing line and the footer in the sky above the globe, the way the reference print carries
            its footer. */}
        <section aria-labelledby="landing-closing-title" className="relative flex flex-col">
          <div className={`relative z-10 ${CONTENT_CLASS} flex flex-col gap-14 pt-16`}>
            <div className="flex flex-col items-start gap-6">
              <h2 id="landing-closing-title" className="paper-halo max-w-[960px] text-title sm:text-display">
                Every cut on file, replayed from its sources.
              </h2>
              {closingRecord && (
                <p className="paper-halo -mt-3 max-w-[720px] text-body text-muted tabular-nums" data-testid="landing-record">
                  {closingRecord}
                </p>
              )}
              <Link href={CONSOLE_PATH} className={INK_PILL_CLASS}>
                Open the console
                <Icon name="chevronRight" className="transition-transform duration-140 ease-standard group-hover:translate-x-0.5" />
              </Link>
            </div>
            <LandingFooter />
          </div>
          <div className="order-2 -mt-[44vw] md:-mt-[14vw] lg:-mt-[13vw]">
            <ArtPicture
              desktop="art-3"
              phone="art-3-phone"
              hasPlateCaption
              className="art-dissolve-top"
              alt="Engraved globe seen from above the North Atlantic: Scandinavia and the Baltic, dotted sea routes, a compass rose, vermilion rings over the Gulf of Finland"
            />
          </div>
        </section>
      </main>
    </div>
  );
}
