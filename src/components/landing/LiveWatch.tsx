import type { ReactNode } from "react";
import { readRiseOrderStyle } from "@/components/landing/rise-order";
import { REGIONS } from "@/data/regions";
import { readFlagFromMmsi } from "@/lib/globe/ship-identity";
import type { LandingLive } from "@/lib/landing/landing-live";
import { CLOSE_PASS_METRES, type CloseCrossing } from "@/lib/landing/live-watch";
import type { RecorderHealth } from "@/lib/recorder/recorder-summary";

// The recorder keeps positions within 3 km of a cable.
// sourceRef: supabase/migrations/20261017020000_live_recorder.sql (ingest_vessel_positions, near_cable_metres default 3000).
const NEAR_CABLE_KILOMETRES = 3;
/** What the first ledger figure counts; the sticky bar repeats it once the hero has scrolled away (LandingStickyBar.tsx). */
export const SHIPS_LAST_HOUR_PHRASE = `ships within ${NEAR_CABLE_KILOMETRES} km of a cable in the last hour`;

// Short names for the region list, so the eight fit two columns on a phone; the full names are in
// src/data/regions and on /live.
const REGION_SHORT_NAMES: Readonly<Record<string, string>> = {
  "gulf-of-finland": "Gulf of Finland",
  "central-baltic": "Central Baltic",
  "norway-svalbard": "Norway and Svalbard",
  "taiwan-strait": "Taiwan Strait",
  "north-sea-shetland": "North Sea",
  perth: "Perth",
  "english-channel": "English Channel",
  "danish-straits-kattegat": "Danish straits",
};

// Lines split into several OpenStreetMap ways keep the way number in their stored name, "IFA 2000 (way/117931186)";
// the card shows the line's name. sourceRef: supabase/migrations (the seeded cables' names).
const OSM_WAY_SUFFIX = / \(way\/\d+\)$/u;
// ITU's longest administration names, shortened for a one-line row (src/lib/globe/maritime-identification-digits.ts).
const FLAG_SHORT_NAMES: Readonly<Record<string, string>> = {
  "United Kingdom of Great Britain and Northern Ireland": "United Kingdom",
  "United States of America": "United States",
};

function formatUtcTime(moment: Date): string {
  return `${moment.toISOString().slice(11, 16)} UTC`;
}

function describeHealth(health: RecorderHealth): string {
  switch (health.kind) {
    case "recording":
      return "Recording";
    case "failing":
      return "Last run failed";
    case "stale":
      return `Behind by ${health.minutesSinceLastRun} min`;
    case "never-ran":
      return "Not started";
    default: {
      const unhandledHealth: never = health;
      return unhandledHealth;
    }
  }
}

/** "Finland flag, 10.7 kn, 106 m away": the flag the MMSI implies, never the ship's name (style board, choice 4). */
function describeCrossing(crossing: CloseCrossing): string {
  const flag = readFlagFromMmsi(crossing.mmsi);
  // ITU writes some administrations with a qualifier, "Panama (Republic of)"; the card keeps the country.
  const country = flag.kind === "flag" ? (FLAG_SHORT_NAMES[flag.administration] ?? flag.administration.split(" (")[0]) : null;
  const flagText = country === null ? "Flag unknown" : `${country} flag`;
  const speedText = crossing.speedKnots === null ? "speed not reported" : `${crossing.speedKnots.toFixed(1)} kn`;
  return `${flagText}, ${speedText}, ${Math.round(crossing.distanceMetres)} m away`;
}

/**
 * A 6 px dot, `live` when heard and `faint` when quiet. Only the recorder's own status pulses (`isPulsing`): one ambient
 * loop on the page, on the one thing that is live this minute. The regions stay still. Reduced motion drops the ring.
 */
function LiveDot({ isLive, isPulsing = false }: { isLive: boolean; isPulsing?: boolean }) {
  if (!isLive) return <span className="size-2 flex-none rounded-full bg-faint" aria-hidden="true" />;
  if (!isPulsing) return <span className="size-2 flex-none rounded-full bg-live" aria-hidden="true" />;
  return (
    <span className="relative flex size-2 flex-none" aria-hidden="true" data-testid="live-pulse">
      <span className="absolute inset-0 rounded-full bg-live opacity-60 motion-safe:animate-ping motion-reduce:hidden" />
      <span className="relative size-2 rounded-full bg-live" />
    </span>
  );
}

type LedgerFigure = { value: string; caption: string; testId?: string };

/** The ledger's rows: what the recorder counted in the last hour, then what it watches. */
function buildLedgerFigures(live: LandingLive): LedgerFigure[] {
  const regionFigure: LedgerFigure = { value: String(REGIONS.length), caption: "regions, each read once a minute" };
  if (!live.recorder.ok) return [regionFigure];
  const { summary } = live.recorder.value;
  return [
    { value: summary.shipsLastHour.toLocaleString("en-US"), caption: SHIPS_LAST_HOUR_PHRASE, testId: "recorder-ships" },
    { value: summary.positionsLastHour.toLocaleString("en-US"), caption: "positions recorded in the last hour" },
    { value: summary.cablesWatched.toLocaleString("en-US"), caption: "cables and pipelines watched" },
    regionFigure,
  ];
}

type LiveWatchProps = {
  live: LandingLive;
  /** The live globe's still, beside the statement (src/lib/landing/replay-footage.ts). */
  globe: ReactNode;
  contentClassName: string;
};

/**
 * The landing's live section: the recorder's own figures set as a ledger, the regions heard in the last 15 minutes,
 * and the three latest close passes as the console's list. Every figure comes from the recorder, read at most once a
 * minute; it says when. The positions' credit is on /credits, linked from the footer.
 */
export function LiveWatch({ live, globe, contentClassName }: LiveWatchProps) {
  const { recorder, crossings, heardRegionIds, readAt } = live;
  const heardIds = new Set(heardRegionIds.ok ? heardRegionIds.value : []);
  const state = recorder.ok ? recorder.value.health.kind : "unreachable";
  const figures = buildLedgerFigures(live);
  return (
    <section className={`${contentClassName} grid gap-14 lg:grid-cols-12 lg:gap-x-6`} data-testid="recorder-status" data-state={state} aria-labelledby="live-watch-title">
      <div className="flex flex-col gap-8 lg:col-span-5">
        <div className="flex flex-col gap-4">
          <h2 id="live-watch-title" className="text-title sm:text-display" data-rise="ready">
            <span className="text-muted">Right now,</span> ships near the cables.
          </h2>
          <p className="text-lead text-ink" data-rise="ready" style={readRiseOrderStyle(1)}>
            A recorder reads every ship within {NEAR_CABLE_KILOMETRES} km of a watched cable or pipeline, once a minute, in {REGIONS.length} regions.
          </p>
          <p className="flex items-center gap-2 text-label text-ink" data-testid="recorder-state">
            <LiveDot isLive={state === "recording"} isPulsing />
            {recorder.ok ? describeHealth(recorder.value.health) : "Unavailable"}, as of {formatUtcTime(readAt)}
          </p>
        </div>
        <ul className="grid grid-cols-2 gap-x-6 gap-y-2" aria-label="Watched regions" data-testid="live-regions">
          {REGIONS.map((region) => {
            const isHeard = heardIds.has(region.id);
            return (
              <li key={region.id} className={`flex items-center gap-2 text-small ${isHeard ? "text-ink" : "text-muted"}`} data-state={isHeard ? "heard" : "quiet"}>
                <LiveDot isLive={isHeard} />
                {REGION_SHORT_NAMES[region.id] ?? region.name}
                {!isHeard && <span className="sr-only">, quiet in the last 15 minutes</span>}
              </li>
            );
          })}
        </ul>
        <div className="overflow-hidden rounded-inner" data-rise="ready" style={readRiseOrderStyle(2)}>
          {globe}
        </div>
      </div>

      <div className="flex flex-col gap-12 lg:col-span-6 lg:col-start-7 lg:pt-4">
        {!recorder.ok && <p className="text-lead text-ink">The recorder could not be read just now. The next read is within a minute.</p>}
        <dl className="flex flex-col gap-5" data-testid="landing-numbers">
          {figures.map((figure, index) => (
            <div key={figure.caption} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] items-baseline gap-x-6" data-rise="ready" style={readRiseOrderStyle(index)}>
              <dt className="order-2 text-body text-ink">{figure.caption}</dt>
              <dd className="order-1 text-right text-hero tabular-nums" data-testid={figure.testId}>
                {figure.value}
              </dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-col gap-1 rounded-row bg-card p-3 shadow-card" data-testid="live-crossings" data-ui>
          <h3 className="px-3 pt-2 pb-1 text-label text-muted">Closest passes, within {CLOSE_PASS_METRES} m of a cable</h3>
          {!crossings.ok && <p className="px-3 py-2 text-small text-muted">The latest passes could not be read just now.</p>}
          {crossings.ok && crossings.value.length === 0 && <p className="px-3 py-2 text-small text-muted">No ship came this close in the last hour.</p>}
          {crossings.ok && crossings.value.length > 0 && (
            <ol className="flex flex-col gap-0.5">
              {crossings.value.map((crossing, index) => (
                <li key={`${crossing.mmsi}-${crossing.cableName}`} className={`flex items-baseline justify-between gap-4 rounded-field px-3 py-2.5 ${index === 0 ? "bg-page" : ""}`}>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-label">{crossing.cableName.replace(OSM_WAY_SUFFIX, "")}</span>
                    <span className="text-caption font-normal text-muted">{describeCrossing(crossing)}</span>
                  </span>
                  <time dateTime={crossing.observedAt.toISOString()} className="flex-none text-caption text-muted tabular-nums">
                    {formatUtcTime(crossing.observedAt)}
                  </time>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </section>
  );
}
