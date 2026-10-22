import Link from "next/link";
import { AnchorFigure, AnchorFigureCaption } from "@/components/landing/AnchorFigure";
import { AnchorStory, type AnchorStoryStatement } from "@/components/landing/AnchorStory";
import { AsciiPicture } from "@/components/ascii/AsciiPicture";
import { ArchiveBand } from "@/components/landing/ArchiveBand";
import { ArchiveCaption, readArchiveBasePath } from "@/components/landing/ArchiveCaption";
import { CaseLedger } from "@/components/landing/CaseLedger";
import { HeroReplay } from "@/components/landing/HeroReplay";
import { describeLandingRecord, LandingFooter } from "@/components/landing/LandingFooter";
import { LandingMotion } from "@/components/landing/LandingMotion";
import { LandingPicture } from "@/components/landing/LandingPicture";
import { LandingStickyBar } from "@/components/landing/LandingStickyBar";
import { LiveWatch, SHIPS_LAST_HOUR_PHRASE } from "@/components/landing/LiveWatch";
import { OpenReplayDialog } from "@/components/landing/OpenReplayDialog";
import { ReplayInside } from "@/components/landing/ReplayInside";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { DiscoverButton } from "@/components/ui/DiscoverButton";
import { FlipText } from "@/components/ui/FlipText";
import { CABLE_CASES } from "@/data/cases";
import { EAGLE_S_2024 } from "@/data/cases/eagle-s-2024";
import { REGIONS } from "@/data/regions";
import { ARCHIVE_ART } from "@/lib/landing/archive-art";
import type { AnchorFigureFacts } from "@/lib/landing/anchor-figure-model";
import { loadAnchorFigureFacts } from "@/lib/landing/load-anchor-figure-facts";
import { loadLandingLive } from "@/lib/landing/landing-live";
import { CONSOLE_STILLS, EAGLE_S_FOOTAGE } from "@/lib/landing/replay-footage";
import { formatUtcDate } from "@/lib/replay/format-utc";

// The console opens on the Eagle S replay, the case every board and lookdev frame starts from.
const CONSOLE_PATH = `/cases/${EAGLE_S_2024.slug}`;
// The source card explains one placed position: the C-Lion1 cut, placed from Cinia's own description.
const EVIDENCE_CUT_LABEL = "C-Lion1";
// The moments the hero's list offers, from the Eagle S case file (src/data/cases/eagle-s-2024.ts): the first cable
// failing, the crew's first report, the turn back, the telecom cables, the C-Lion1 fault and the lost anchor.
const HERO_MOMENTS_UTC = ["2024-12-25T10:26:00Z", "2024-12-25T11:05:00Z", "2024-12-25T11:50:00Z", "2024-12-25T16:00:00Z", "2024-12-25T16:44:00Z", "2024-12-25T17:00:00Z"];
const CONTENT_CLASS = "mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-8";
// The hero block the sticky bar watches: once it has scrolled away, the bar brings its action back (LandingStickyBar).
const HERO_BLOCK_ID = "landing-hero";
// A painting's caption set on the painting itself, as a small white label (on a phone the hero's sits under it instead).
// At 768 px the hero's window starts 334 px from the left edge, so the label (24 px in) keeps to 280 px there.
const PAINTING_LABEL_CLASS = "md:max-w-[280px] lg:max-w-[340px] md:rounded-field md:bg-card md:py-2 md:text-caption md:font-normal";
// The hero's painting at its smallest width, for the glyph band under it (a canvas samples it once).
const HERO_ASCII_SOURCE = "/landing/archive/great-eastern-under-weigh-1200.webp";

/**
 * The three statements beside the anchor figure, with the model's own numbers for the Eagle S at the C-Lion1 cut
 * (src/lib/landing/load-anchor-figure-facts.ts); without them the statements keep their claims and drop the figures.
 */
function buildAnchorStatements(facts: AnchorFigureFacts | null): AnchorStoryStatement[] {
  if (!facts) {
    return [
      { stage: "drop", title: "The anchor drops.", detail: "The anchor goes down on its chain to the seabed while the ship keeps moving." },
      { stage: "drag", title: "It drags along the seabed.", detail: "Instead of holding, the anchor ploughs a furrow through the clay behind the ship." },
      { stage: "cut", title: "The cable parts.", detail: "When the flukes catch a cable, the chain's pull tears through its armour." },
    ];
  }
  const anchorTonnes = (facts.chain.anchorMassKg / 1000).toFixed(1);
  return [
    {
      stage: "drop",
      title: "The anchor drops.",
      detail: `The ${facts.vesselName}'s anchor, an estimated ${anchorTonnes} t on ${facts.chain.chainDiameterMm} mm chain for a ${Math.round(facts.lengthMetres)} m ship, goes down to the seabed ${Math.round(facts.depthMetres)} m below.`,
    },
    {
      stage: "drag",
      title: "It drags along the seabed.",
      detail: `The ship keeps going at about ${facts.speedKnots.toFixed(1)} kn, so the anchor never holds: it ploughs a furrow through the clay behind it.`,
    },
    {
      stage: "cut",
      title: "The cable parts.",
      detail: `The flukes catch ${facts.cutLabel} and the chain's pull tears through its armour. The replay places that moment from the operator's own words.`,
    },
  ];
}

/**
 * The public front door, built as "the product performs": the hero is the console itself replaying the Eagle S, the
 * sections below show what a replay holds, how a dragged anchor cuts a cable, every case on file, the recorder's live figures and the 1865 expedition's
 * own pictures, and the page ends with the console's first step already open. Every number is read from the recorder
 * or the case files. The rest of the app sits behind sign-in (src/proxy.ts).
 */
export default async function LandingPage() {
  const evidenceCut = EAGLE_S_2024.cuts.find((cut) => cut.label === EVIDENCE_CUT_LABEL) ?? EAGLE_S_2024.cuts[0];
  const heroMoments = HERO_MOMENTS_UTC.flatMap((atUtc) => EAGLE_S_FOOTAGE.events.filter((event) => event.atMs === Date.parse(atUtc)).slice(0, 1));
  const [live, figureFacts] = await Promise.all([loadLandingLive(), loadAnchorFigureFacts()]);
  if (!figureFacts.ok) console.error(`[LandingPage] anchor figure facts: ${figureFacts.reason}`);
  const anchorStatements = buildAnchorStatements(figureFacts.ok ? figureFacts.value : null);
  const summary = live.recorder.ok ? live.recorder.value.summary : null;
  const stickyStateLine = summary ? `${summary.shipsLastHour.toLocaleString("en-US")} ${SHIPS_LAST_HOUR_PHRASE}` : null;
  const closingRecord = describeLandingRecord({ cases: CABLE_CASES, cablesWatched: summary?.cablesWatched ?? null, regionCount: REGIONS.length });
  const replayChoices = CABLE_CASES.map((cableCase) => ({ slug: cableCase.slug, title: cableCase.vessel.name, dateLabel: formatUtcDate(Date.parse(cableCase.cuts[0].atUtc)) }));
  const globeStill = CONSOLE_STILLS.globe;
  const heroPainting = ARCHIVE_ART["great-eastern-under-weigh"];
  const closingPainting = ARCHIVE_ART["albany-at-night"];

  return (
    // Every anchor target keeps clear of the sticky bar's 56 px when the page jumps to it.
    <div className="min-h-dvh overflow-x-clip bg-page [&_[id]]:scroll-mt-16">
      <LandingStickyBar heroId={HERO_BLOCK_ID} stateLine={stickyStateLine} action={{ href: CONSOLE_PATH, label: "Open the console" }} />
      <LandingMotion />
      <main className="flex flex-col gap-28 md:gap-48">
        {/*
          A wide screen sets the bar and the headline in the painting's evening sky and lays the console's window over its
          sea; a phone reads the headline first, then the painting, then the window and the moments.
        */}
        <section aria-labelledby="landing-title">
          <div className="relative isolate">
            <div className={`${CONTENT_CLASS} flex flex-col md:min-h-[min(88svh,820px)]`}>
              <SiteHeader current="home" />
              <div className="flex flex-col gap-8 pt-10 pb-10 md:pt-14 lg:pt-20">
                <FlipText as="h1" id="landing-title" text="Every cable cut, replayed." className="text-hero" />
                <div id={HERO_BLOCK_ID} className="flex max-w-[540px] flex-col gap-8">
                  <p className="text-lead text-ink">
                    CableTrace rebuilds each undersea cable cut minute by minute, from the ship&apos;s own track, the seabed and the published sources.
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <DiscoverButton href={CONSOLE_PATH} label="Open the console" testId="open-console" />
                    <Link href="/sign-in" className="flex h-12 items-center rounded-full px-4 text-label text-ink hover:bg-card/60" data-testid="landing-sign-in">
                      Sign in
                    </Link>
                  </div>
                </div>
              </div>
            </div>
            <figure className="relative md:absolute md:inset-0 md:-z-10">
              <div className="aspect-[4/3] overflow-hidden md:aspect-auto md:h-full">
                <LandingPicture
                  basePath={readArchiveBasePath("great-eastern-under-weigh")}
                  widths={heroPainting.widths}
                  width={heroPainting.width}
                  height={heroPainting.height}
                  alt={heroPainting.alt}
                  sizes="100vw"
                  isPriority
                  isCover
                  objectPosition="62% 42%"
                  className="landing-settle [--settle-from:1.05]"
                />
              </div>
              {/* The phone's band samples the part of the painting its 4:3 crop shows. */}
              <AsciiPicture src={HERO_ASCII_SOURCE} region={[0.14, 0.72, 0.63, 0.26]} cellPx={6} ramp="dense" isInverted tone="ink" toneShare={0.2} fadeShare={0.65} className="h-24 w-full md:hidden" />
              <ArchiveCaption
                art={heroPainting}
                className={`px-4 pt-3 sm:px-6 md:absolute md:bottom-8 md:left-6 md:px-3.5 lg:left-[max(2rem,calc(50vw-688px))] ${PAINTING_LABEL_CLASS}`}
              />
            </figure>
          </div>
          {/* The painting's sea carries on as glyphs into the page (the ASCII layer); a phone's band sits in the figure,
              between the painting and its caption. */}
          <AsciiPicture src={HERO_ASCII_SOURCE} region={[0, 0.72, 1, 0.26]} cellPx={7} ramp="dense" isInverted tone="ink" toneShare={0.2} fadeShare={0.65} className="hidden h-40 w-full md:block" />
          <div className={`${CONTENT_CLASS} grid grid-cols-1 gap-y-8 pt-8 md:grid-cols-12 md:gap-x-6 md:pt-0`}>
            <HeroReplay
              footage={EAGLE_S_FOOTAGE}
              events={heroMoments}
              listTitle="Eagle S, 25 December 2024. Pick a moment."
              consoleHref={CONSOLE_PATH}
              stageClassName="relative md:col-span-7 md:col-start-6 md:row-start-1 md:-mt-[288px] md:self-start"
              listClassName="md:col-span-5 md:row-start-1 md:pt-10"
            />
          </div>
        </section>

        <ReplayInside cableCase={EAGLE_S_2024} cut={evidenceCut} contentClassName={CONTENT_CLASS} />

        <AnchorStory statements={anchorStatements} figure={<AnchorFigure />} caption={<AnchorFigureCaption className="max-w-[60ch] text-body text-ink" />} contentClassName={CONTENT_CLASS} />

        <CaseLedger cases={CABLE_CASES} contentClassName={CONTENT_CLASS} />

        <LiveWatch
          live={live}
          contentClassName={CONTENT_CLASS}
          globe={
            <LandingPicture basePath={`/landing/stills/${globeStill.name}`} widths={globeStill.widths} width={globeStill.width} height={globeStill.height} alt={globeStill.alt} sizes="(min-width: 768px) 40vw, 100vw" />
          }
        />

        <ArchiveBand contentClassName={CONTENT_CLASS} />

        {/*
          The page closes on the night of 26 August 1866, when the Albany buoyed the cable lost the year before: the painting
          sits at 45% on ink, which keeps white text over its brightest cloud at 4.5:1 or more, with the closing line and the
          console's first step, already open.
        */}
        <section aria-labelledby="landing-closing-title" className="relative isolate overflow-hidden bg-ink text-card">
          <figure className="absolute inset-0 -z-10">
            <LandingPicture
              basePath={readArchiveBasePath("albany-at-night")}
              widths={closingPainting.widths}
              width={closingPainting.width}
              height={closingPainting.height}
              alt={closingPainting.alt}
              sizes="100vw"
              isCover
              objectPosition="45% 35%"
              className="opacity-45"
            />
            <ArchiveCaption
              art={closingPainting}
              className={`absolute bottom-6 left-4 max-w-[calc(100%-2rem)] rounded-field bg-card px-3 py-2 sm:left-6 md:right-6 md:left-auto md:px-3.5 lg:right-[max(2rem,calc(50vw-688px))] ${PAINTING_LABEL_CLASS}`}
            />
          </figure>
          <div className={`${CONTENT_CLASS} grid min-h-[80svh] gap-12 pt-16 pb-32 md:grid-cols-12 md:gap-x-6 md:py-24`}>
            <div className="flex flex-col gap-6 self-end md:col-span-6">
              <FlipText as="h2" id="landing-closing-title" text="Watch it happen." className="text-hero" rise="ready" />
              {closingRecord && (
                <p className="max-w-[44ch] text-lead tabular-nums" data-testid="landing-record">
                  {closingRecord} Sign in with Google or an email code, and the console opens on the case you pick.
                </p>
              )}
            </div>
            <div className="self-center md:col-span-5 md:col-start-8">
              <OpenReplayDialog cases={replayChoices} />
            </div>
          </div>
        </section>
      </main>
      <LandingFooter contentClassName={CONTENT_CLASS} />
    </div>
  );
}
