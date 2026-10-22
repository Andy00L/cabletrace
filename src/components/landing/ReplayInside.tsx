import { AsciiPicture } from "@/components/ascii/AsciiPicture";
import { EvidenceNote } from "@/components/landing/EvidenceNote";
import { LandingPicture } from "@/components/landing/LandingPicture";
import { readRiseOrderStyle } from "@/components/landing/rise-order";
import { FlipText } from "@/components/ui/FlipText";
import type { CableCase, CaseCut } from "@/lib/cases/case-file";
import { CONSOLE_STILLS } from "@/lib/landing/replay-footage";

// The painting the section's glyph plate is drawn from, at its smallest width (src/lib/landing/archive-art.ts).
const PLATE_SOURCE = "/landing/archive/great-eastern-under-weigh-1200.webp";

type ReplayInsideProps = {
  /** The case the stills and the source card come from (Eagle S). */
  cableCase: CableCase;
  cut: CaseCut;
  contentClassName: string;
};

/**
 * "Inside a replay": three things the console does, each a short statement beside the real thing at its own size.
 * The vessel view and the cut are stills of the console (src/lib/landing/replay-footage.ts); the source card is the
 * console's own, built from the case file. The rows differ in width so the column never reads as a zigzag.
 */
export function ReplayInside({ cableCase, cut, contentClassName }: ReplayInsideProps) {
  const vesselStill = CONSOLE_STILLS.vessel;
  const closeupStill = CONSOLE_STILLS.closeup;
  return (
    <section aria-labelledby="inside-title" className={`${contentClassName} flex flex-col gap-24 md:gap-36`}>
      <div className="grid items-center gap-8 md:grid-cols-12 md:gap-x-6">
        <div className="flex flex-col gap-4 md:col-span-5">
          <FlipText as="h2" id="inside-title" text="Inside a replay" className="text-title sm:text-display" rise="ready" />
          <p className="text-lead text-ink" data-rise="ready" style={readRiseOrderStyle(1)}>
            Each case opens in a console that rebuilds the hours around the cut from the ship&apos;s track, the seabed and the published statements.
          </p>
        </div>
        {/* The Great Eastern again, as glyphs: dusk on slate where the section used to leave the page empty. */}
        <div className="overflow-hidden rounded-card bg-slate md:col-span-7" data-rise="ready" style={readRiseOrderStyle(2)}>
          <AsciiPicture src={PLATE_SOURCE} region={[0.3, 0.32, 0.56, 0.5]} cellPx={5} ramp="dense" background="slate" tone="dusk" toneShare={0.3} isShimmering className="h-56 w-full md:h-[340px]" />
        </div>
      </div>

      <div className="grid items-center gap-8 md:grid-cols-12 md:gap-x-6">
        <div className="flex flex-col gap-3 md:col-span-4" data-rise="ready">
          <h3 className="text-title">Ride with the ship.</h3>
          <p className="text-body text-ink">The Vessel view follows the tanker as it drags. The anchor cam shows its anchor on the seabed, drawn from the chain out and the depth under it.</p>
        </div>
        <div className="overflow-hidden rounded-inner md:col-span-8" data-rise="ready" style={readRiseOrderStyle(1)}>
          <LandingPicture basePath={`/landing/stills/${vesselStill.name}`} widths={vesselStill.widths} width={vesselStill.width} height={vesselStill.height} alt={vesselStill.alt} sizes="(min-width: 768px) 66vw, 100vw" />
        </div>
      </div>

      <div className="grid items-end gap-8 md:grid-cols-12 md:gap-x-6">
        <div className="overflow-hidden rounded-inner md:col-span-6 md:col-start-2" data-rise="ready">
          <LandingPicture basePath={`/landing/stills/${closeupStill.name}`} widths={closeupStill.widths} width={closeupStill.width} height={closeupStill.height} alt={closeupStill.alt} sizes="(min-width: 768px) 50vw, 100vw" />
        </div>
        <div className="flex flex-col gap-3 md:col-span-4 md:col-start-9 md:pb-8" data-rise="ready" style={readRiseOrderStyle(1)}>
          <h3 className="text-title">Go down to the cut.</h3>
          <p className="text-body text-ink">At the cut the camera goes down to the cable on the seabed&apos;s surveyed depth, where the anchor crossed it.</p>
        </div>
      </div>

      <div className="grid items-start gap-8 md:grid-cols-12 md:gap-x-6">
        <div className="flex flex-col gap-3 md:col-span-4 md:pt-10" data-rise="ready">
          <h3 className="text-title">Every line has a source.</h3>
          <p className="text-body text-ink">Each position, event and number in a replay links to the statement it came from and to an archived copy of it.</p>
        </div>
        <div className="md:col-span-5 md:col-start-7" data-rise="ready" style={readRiseOrderStyle(1)}>
          <EvidenceNote cableCase={cableCase} cut={cut} />
        </div>
      </div>
    </section>
  );
}
