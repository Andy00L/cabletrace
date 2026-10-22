import type { Metadata } from "next";
import { AsciiPicture } from "@/components/ascii/AsciiPicture";
import { CaseCard } from "@/components/cases/CaseCard";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { FlipText } from "@/components/ui/FlipText";
import { CABLE_CASES } from "@/data/cases";
import { toReplaySceneInput } from "@/lib/cases/case-file";
import { groupByCaseRegion } from "@/lib/cases/case-regions";
import { loadCaseSketch } from "@/lib/cases/load-case-sketch";

const INTRO = "Subsea cable cuts by ships, replayed in 3D from the published record. Every position says how it is known.";
// Dudley's night painting, the 1,200 px file the landing already serves (docs/UI_DESIGN_SYSTEM.md, ASCII layer).
const NIGHT_PAINTING_SRC = "/landing/archive/albany-at-night-1200.webp";
// Glyph cell width in CSS px: 7 px cells keep the moon, the clouds and the wave crests legible between the rows.
const NIGHT_SEA_CELL_PX = 7;
// How far each glyph's own colour moves toward slate (the style board of 22 Oct 2026 asks for about a third), and the
// share of the glyph rows that thin out into the slate at the bottom of the picture, so it ends without an edge.
const NIGHT_SEA_TONE_SHARE = 0.35;
const NIGHT_SEA_FADE_SHARE = 0.2;
// Text that sits straight on the glyphs carries a slate halo, blurred 3, 8 and 14 px: the glyphs fade out around each
// line of text, darkening only behind the text, never a band. Measured on the render (22 Oct 2026), the intro's `mist`
// keeps 6.0:1 on its median background pixel and 5.7:1 (1,440 px) or 4.4:1 (390 px, over the moonlit clouds) on the
// brightest 5%.
const ON_GLYPHS_TEXT_CLASS = "[text-shadow:0_0_3px_var(--color-slate),0_0_8px_var(--color-slate),0_0_14px_var(--color-slate)]";

export const metadata: Metadata = {
  title: "Cases",
  description: INTRO,
};

// Every case with its sketch, grouped by region and newest first inside each region, as compact rows in two columns
// from 768 px and three from 1,280 px, so a dozen cases fit one screen. The list sits on a slate field with Dudley's
// night painting redrawn as glyphs behind its head (style board, 22 Oct 2026); the rows stay vellum. The sketches are
// read from the seabed files at build time.
export default async function CasesPage() {
  const sketchList = await Promise.all(CABLE_CASES.map((cableCase) => loadCaseSketch(toReplaySceneInput(cableCase))));
  const sketchesBySlug = new Map(CABLE_CASES.map((cableCase, index) => [cableCase.slug, sketchList[index] ?? null]));
  const regionGroups = groupByCaseRegion(CABLE_CASES, (cableCase) => cableCase.seabedArea);
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[1440px] flex-col px-4 pb-6 sm:px-6">
      <SiteHeader current="cases" />
      <main className="relative isolate mt-2 flex flex-1 flex-col gap-6 overflow-hidden rounded-card bg-slate px-4 pt-6 pb-4 sm:px-6 lg:px-8 lg:pt-8">
        {/* The painting keeps its own proportions, so the list's height never stretches it; below it the field is plain slate. */}
        <AsciiPicture
          src={NIGHT_PAINTING_SRC}
          cellPx={NIGHT_SEA_CELL_PX}
          ramp="dense"
          tone="slate"
          toneShare={NIGHT_SEA_TONE_SHARE}
          background="slate"
          fadeShare={NIGHT_SEA_FADE_SHARE}
          fadeTo="slate"
          isShimmering
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 aspect-[1200/729] w-full"
        />
        <div className={`flex flex-col gap-2 lg:flex-row lg:items-baseline lg:gap-5 ${ON_GLYPHS_TEXT_CLASS}`}>
          <FlipText as="h1" text="Cases" className="text-title text-page" />
          <p className="text-body text-mist">{INTRO}</p>
          <p className="text-caption font-normal text-mist tabular-nums lg:ml-auto">
            {CABLE_CASES.length} cases in {regionGroups.length} regions
          </p>
        </div>
        <div className="gap-5 md:columns-2 xl:columns-3" data-testid="case-list">
          {regionGroups.map((group) => (
            <section key={group.region.id} aria-labelledby={`region-${group.region.id}`} className="mb-5 flex break-inside-avoid flex-col gap-2.5" data-testid={`case-region-${group.region.id}`}>
              <h2 id={`region-${group.region.id}`} className={`flex items-baseline gap-2 px-1 text-card-title text-page ${ON_GLYPHS_TEXT_CLASS}`}>
                {group.region.name}
                <span className="text-caption font-normal text-mist tabular-nums">{group.items.length === 1 ? "1 case" : `${group.items.length} cases`}</span>
              </h2>
              {group.items.map((cableCase) => (
                <CaseCard key={cableCase.slug} cableCase={cableCase} sketch={sketchesBySlug.get(cableCase.slug) ?? null} />
              ))}
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
