import Link from "next/link";
import { ArtPicture } from "@/components/landing/ArtPicture";
import { EvidencePlate } from "@/components/landing/EvidencePlate";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { LiveWatchCard } from "@/components/landing/LiveWatchCard";
import { NewestCasePlate } from "@/components/landing/NewestCasePlate";
import { ProofNumbers, type ProofFigure } from "@/components/landing/ProofNumbers";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { CABLE_CASES } from "@/data/cases";
import { EAGLE_S_2024 } from "@/data/cases/eagle-s-2024";
import { REGIONS } from "@/data/regions";
import { toReplaySceneInput } from "@/lib/cases/case-file";
import { loadCaseSketch } from "@/lib/cases/load-case-sketch";
import { loadLandingLive } from "@/lib/landing/landing-live";

// The console opens on the Eagle S replay, the case every board and lookdev frame starts from.
const CONSOLE_PATH = `/cases/${EAGLE_S_2024.slug}`;
// The evidence plate explains one placed position: the C-Lion1 cut, placed from Cinia's own description.
const EVIDENCE_CUT_LABEL = "C-Lion1";
const INK_PILL_CLASS =
  "flex h-12 items-center justify-center rounded-full bg-ink px-6 text-label text-card transition-colors duration-140 ease-standard hover:bg-ink-hover";

function buildProofFigures(cablesWatched: number | null, positionsLastHour: number | null): ProofFigure[] {
  const sourceCount = CABLE_CASES.reduce((total, cableCase) => total + cableCase.sources.length, 0);
  return [
    { value: String(CABLE_CASES.length), label: "cases on file", detail: `${sourceCount} sources, each quote linked to its page and an archived copy` },
    { value: cablesWatched === null ? "-" : cablesWatched.toLocaleString("en-US"), label: "cables and pipelines watched", detail: `OpenStreetMap and EMODnet lines in ${REGIONS.length} regions` },
    { value: String(REGIONS.length), label: "regions recorded every minute", detail: `Digitraffic in the Gulf of Finland, aisstream.io in all ${REGIONS.length}` },
    { value: positionsLastHour === null ? "-" : positionsLastHour.toLocaleString("en-US"), label: "positions in the last hour", detail: "every ship within 3 km of a watched line" },
  ];
}

/**
 * The public front door (style board, board 13, approved 19 Oct 2026): Andy's three engravings dissolving into the
 * paper, the live watch in ink over the first one, the newest case and one placed position on the others. Every
 * number is read from the recorder or the case files. The rest of the app sits behind sign-in (src/proxy.ts).
 */
export default async function LandingPage() {
  const newestCase = CABLE_CASES[0];
  const evidenceCut = EAGLE_S_2024.cuts.find((cut) => cut.label === EVIDENCE_CUT_LABEL) ?? EAGLE_S_2024.cuts[0];
  const [live, newestSketch] = await Promise.all([loadLandingLive(), newestCase ? loadCaseSketch(toReplaySceneInput(newestCase)) : Promise.resolve(null)]);
  const summary = live.recorder.ok ? live.recorder.value.summary : null;
  const figures = buildProofFigures(summary?.cablesWatched ?? null, summary?.positionsLastHour ?? null);
  const linesWatched = summary ? `${summary.cablesWatched} cables and pipelines` : "the cables and pipelines";

  return (
    <div className="min-h-dvh bg-paper">
      <div className="mx-auto w-full max-w-[1440px] px-4 sm:px-6">
        <SiteHeader current="home" />
      </div>
      <main className="mx-auto flex w-full max-w-[1440px] flex-col">
        <section aria-labelledby="landing-title" className="relative flex flex-col">
          <div className="relative z-10 flex max-w-[800px] flex-col gap-5 px-4 pt-8 sm:px-6 lg:px-20 lg:pt-14">
            <h1 id="landing-title" className="text-title sm:text-hero">
              Ships are crossing the world&apos;s cables right now.
            </h1>
            <p className="max-w-[620px] text-body text-muted sm:text-heading sm:font-normal">
              CableTrace watches every ship near {linesWatched} in {REGIONS.length} regions, and replays each cut from its sources, minute by minute.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Link href={CONSOLE_PATH} className={INK_PILL_CLASS} data-testid="open-console">
                Open the console
              </Link>
              <Link href="/sign-in" className="flex h-12 items-center rounded-full px-4 text-label text-ink hover:bg-ink/5" data-testid="landing-sign-in">
                Sign in
              </Link>
            </div>
          </div>
          {/* The sky of the first engraving runs up behind the headline; the live card floats in it on wide screens. On a
              phone the card comes first, under the buttons, so the live numbers are the first screen. */}
          <div className="art-dissolve order-3 -mt-4 lg:order-none lg:-mt-32">
            <ArtPicture
              desktop="art-1"
              phone="art-1-phone"
              isPriority
              alt="Engraving of a crude oil tanker at anchor in the Gulf of Finland, rocky pine shore in the foreground, a church and a lighthouse on the far coast, one vermilion buoy"
            />
          </div>
          <div className="relative z-10 order-2 mt-8 px-4 sm:px-6 lg:absolute lg:top-4 lg:right-6 lg:order-none lg:mt-0 lg:w-[392px] lg:px-0">
            <LiveWatchCard live={live} />
          </div>
        </section>

        {newestCase && (
          <section aria-label="The newest case" className="relative mt-4 lg:mt-0">
            <div className="art-dissolve">
              <ArtPicture
                desktop="art-2"
                phone="art-2-phone"
                alt="Engraving in section: a tanker on the surface, its chain running down to an anchor that ploughs a furrow across the seabed toward a cable, a vermilion mark where it frays"
              />
            </div>
            <div className="relative z-10 -mt-24 flex flex-col gap-4 px-4 sm:px-6 lg:absolute lg:top-[18%] lg:left-14 lg:mt-0 lg:px-0">
              <NewestCasePlate cableCase={newestCase} sketch={newestSketch} />
            </div>
            <p className="relative z-10 mt-6 max-w-[620px] px-4 text-body text-muted sm:px-6 lg:-mt-10 lg:px-14">
              The newest case on file. Every replay starts from the published record: police statements, operator notices, court rulings.
            </p>
          </section>
        )}

        <section aria-label="On file" className="px-4 pt-16 sm:px-6 lg:px-14">
          <ProofNumbers figures={figures} />
        </section>

        {evidenceCut && (
          <section aria-label="The evidence" className="relative mt-12">
            <div className="art-dissolve">
              <ArtPicture
                desktop="art-3"
                phone="art-3-phone"
                alt="Engraved globe seen from above the North Atlantic: Scandinavia and the Baltic, dotted sea routes, a compass rose, vermilion rings over the Gulf of Finland"
              />
            </div>
            <div className="relative z-10 -mt-24 flex justify-end px-4 sm:px-6 lg:absolute lg:top-[10%] lg:right-14 lg:mt-0 lg:px-0">
              <EvidencePlate cableCase={EAGLE_S_2024} cut={evidenceCut} />
            </div>
          </section>
        )}

        <section aria-labelledby="landing-closing-title" className="flex flex-col items-start gap-6 px-4 pt-12 pb-16 sm:px-6 lg:px-14">
          <h2 id="landing-closing-title" className="max-w-[720px] text-title sm:text-display">
            Every cut on file, replayed from its sources.
          </h2>
          <Link href={CONSOLE_PATH} className={INK_PILL_CLASS}>
            Open the console
          </Link>
        </section>
        <div className="px-4 pb-8 sm:px-6 lg:px-14">
          <LandingFooter />
        </div>
      </main>
    </div>
  );
}
