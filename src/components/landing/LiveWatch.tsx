import { REGIONS } from "@/data/regions";
import { readFlagFromMmsi } from "@/lib/globe/ship-identity";
import type { LandingLive } from "@/lib/landing/landing-live";
import { CLOSE_PASS_METRES, type CloseCrossing } from "@/lib/landing/live-watch";
import type { RecorderHealth } from "@/lib/recorder/recorder-summary";

// The recorder keeps positions within 3 km of a cable.
// sourceRef: supabase/migrations/20261017020000_live_recorder.sql (ingest_vessel_positions, near_cable_metres default 3000).
const NEAR_CABLE_KILOMETRES = 3;
/** What the big figure counts; the sticky bar repeats it once the hero has scrolled away (LandingStickyBar.tsx). */
export const SHIPS_LAST_HOUR_PHRASE = `ships within ${NEAR_CABLE_KILOMETRES} km of a cable in the last hour`;

// Short names for the card's region list, so the eight fit on three lines (board 13); the full names are in
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
  if (!isLive) return <span className="size-1.5 flex-none rounded-full bg-faint" aria-hidden="true" />;
  if (!isPulsing) return <span className="size-1.5 flex-none rounded-full bg-live" aria-hidden="true" />;
  return (
    <span className="relative flex size-1.5 flex-none" aria-hidden="true" data-testid="live-pulse">
      <span className="absolute inset-0 rounded-full bg-live opacity-60 motion-safe:animate-ping motion-reduce:hidden" />
      <span className="relative size-1.5 rounded-full bg-live" />
    </span>
  );
}

/**
 * The landing's live watch, set straight into the sky of the first engraving like the type on a print (no card):
 * ships near cables in the last hour, the regions heard in the last 15 minutes, and the three latest close passes.
 * Every figure comes from the recorder, read at most once a minute; it says when. The positions' credit sits in the
 * footer of the same page (src/components/landing/LandingFooter.tsx).
 */
export function LiveWatch({ live }: { live: LandingLive }) {
  const { recorder, crossings, heardRegionIds, readAt } = live;
  const heardIds = new Set(heardRegionIds.ok ? heardRegionIds.value : []);
  const state = recorder.ok ? recorder.value.health.kind : "unreachable";
  return (
    <section className="paper-halo flex flex-col gap-4 text-ink" data-testid="recorder-status" data-state={state} aria-labelledby="live-watch-title">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-ink/20 pb-2">
        <h2 id="live-watch-title" className="text-label">Live watch</h2>
        <span className="flex items-center gap-2 text-caption text-muted" data-testid="recorder-state">
          <LiveDot isLive={state === "recording"} isPulsing />
          {recorder.ok ? describeHealth(recorder.value.health) : "Unavailable"}, as of {formatUtcTime(readAt)}
        </span>
      </div>
      {recorder.ok ? (
        <div className="flex items-end gap-4">
          <p className="text-display tabular-nums" data-testid="recorder-ships">{recorder.value.summary.shipsLastHour.toLocaleString("en-US")}</p>
          <p className="max-w-[200px] pb-1 text-small text-muted">{SHIPS_LAST_HOUR_PHRASE}</p>
        </div>
      ) : (
        <p className="text-body text-muted">The recorder could not be read just now. The next read is within a minute.</p>
      )}
      <ul className="grid grid-cols-2 gap-x-6 gap-y-1" aria-label="Watched regions" data-testid="live-regions">
        {REGIONS.map((region) => {
          const isHeard = heardIds.has(region.id);
          return (
            <li key={region.id} className={`flex items-center gap-2 text-caption ${isHeard ? "text-ink" : "text-muted"}`} data-state={isHeard ? "heard" : "quiet"}>
              <LiveDot isLive={isHeard} />
              {REGION_SHORT_NAMES[region.id] ?? region.name}
              {!isHeard && <span className="sr-only">, quiet in the last 15 minutes</span>}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-col" data-testid="live-crossings">
        <h3 className="border-b border-ink/20 pb-2 text-caption text-muted">Closest passes, within {CLOSE_PASS_METRES} m of a cable</h3>
        {!crossings.ok && <p className="mt-2 text-small text-muted">The latest passes could not be read just now.</p>}
        {crossings.ok && crossings.value.length === 0 && <p className="mt-2 text-small text-muted">No ship came this close in the last hour.</p>}
        {crossings.ok && crossings.value.length > 0 && (
          <ol className="flex flex-col">
            {crossings.value.map((crossing) => (
              <li key={`${crossing.mmsi}-${crossing.cableName}`} className="flex items-baseline justify-between gap-4 border-b border-ink/10 py-2">
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
    </section>
  );
}
