"use client";

import { Icon } from "@/components/icons/Icon";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { GLOBE_TIERS, TIER_LABELS, type GlobeTier } from "@/lib/globe/globe-tier";
import type { GlobeIncident } from "@/lib/globe/incidents";
import type { SeaCount } from "@/lib/globe/sea-areas";

// The tier controls of the /live globe (src/lib/globe/globe-tier.ts): the zoom ladder in the stage controls, the
// breadcrumb that names where the camera is, and the rail cards of the Planet and Sea tiers.

const CARD_CLASS = "flex flex-col gap-3 rounded-row bg-card px-5 py-4.5 shadow-card";
const ROW_CLASS = "flex w-full items-center gap-3 rounded-field px-2 py-2.5 text-left transition-colors duration-140 ease-standard hover:bg-page";
// The busiest seas the Planet rail lists; the globe names more, where they fit.
const BUSIEST_SEA_ROWS = 8;

/**
 * Planet, Sea, Strait, Ship: one press flies the camera to that tier. Ship always takes the press, so a reader with no
 * ship picked hears why it did not fly (the stage's note) instead of finding a dead button.
 */
export function TierLadder({ tier, onSelect }: { tier: GlobeTier; onSelect: (tier: GlobeTier) => void }) {
  const options = GLOBE_TIERS.map((value) => ({ value, label: TIER_LABELS[value] }));
  return <SegmentedControl label="Zoom to" options={options} value={tier} onChange={onSelect} testId="live-tier-ladder" />;
}

export type Crumb = { tier: GlobeTier; label: string };

/** "World > Baltic Sea > Gulf of Finland > EAGLE S": each step but the last flies back up to it. */
export function TierBreadcrumb({ crumbs, onSelect }: { crumbs: readonly Crumb[]; onSelect: (tier: GlobeTier) => void }) {
  return (
    <nav aria-label="Where the globe is" className="pointer-events-auto rounded-full bg-card px-2 py-1 shadow-row" data-testid="live-breadcrumb">
      <ol className="flex flex-wrap items-center">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            <li key={crumb.tier} className="flex items-center">
              {index > 0 && <Icon name="chevronRight" className="text-faint" />}
              {isLast ? (
                <span aria-current="location" className="px-2 py-1 text-label">
                  {crumb.label}
                </span>
              ) : (
                <button type="button" onClick={() => onSelect(crumb.tier)} className="rounded-full px-2 py-1 text-small text-muted transition-colors duration-140 ease-standard hover:bg-page hover:text-ink">
                  {crumb.label}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** A row's share of the busiest row, as a bar under its name (FireTrace's fleet list, kept to one tone). */
function CountBar({ share }: { share: number }) {
  return (
    <span className="block h-1 w-full overflow-hidden rounded-full bg-soft" aria-hidden="true">
      <span className="block h-full rounded-full bg-ink/70" style={{ width: `${Math.max(2, Math.round(share * 100))}%` }} />
    </span>
  );
}

/** The Planet tier's rail: where the frame's ships are, sea by sea, each row flying down to its sea. */
export function BusiestSeasCard({ ranking, onSelect }: { ranking: readonly SeaCount[]; onSelect: (entry: SeaCount) => void }) {
  const rows = ranking.slice(0, BUSIEST_SEA_ROWS);
  const busiestCount = rows[0]?.shipCount ?? 1;
  return (
    <section className={CARD_CLASS} aria-label="Busiest seas" data-testid="live-busiest-seas">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-card-title">Busiest seas in this frame</h2>
        <p className="text-caption font-normal text-muted">Ships the coastal feeds heard, counted by Natural Earth&apos;s named seas.</p>
      </div>
      {rows.length === 0 ? (
        <p className="text-small text-muted">Counting ships by sea once the frame and the sea map load.</p>
      ) : (
        <ol className="-mx-2 flex flex-col gap-0.5">
          {rows.map((entry) => (
            <li key={entry.sea.name}>
              <button type="button" onClick={() => onSelect(entry)} className={ROW_CLASS} data-testid="live-busiest-sea">
                <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-label">{entry.sea.name}</span>
                    <span className="flex-none text-small text-muted tabular-nums">{entry.shipCount.toLocaleString("en-US")}</span>
                  </span>
                  <CountBar share={entry.shipCount / busiestCount} />
                </span>
                <Icon name="chevronRight" className="flex-none text-muted" />
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export type RegionCount = { id: string; name: string; shipCount: number };

type SeaCardProps = {
  seaName: string;
  shipCount: number;
  /** The watched regions inside this sea and the ships in each now. */
  regions: readonly RegionCount[];
  /** Cuts on file in this sea. */
  incidents: readonly GlobeIncident[];
  onSelectRegion: (regionId: string) => void;
  onSelectIncident: (slug: string) => void;
};

/** The Sea tier's rail: the sea's ships now, the regions recorded in it, and the cuts on file there. */
export function SeaCard({ seaName, shipCount, regions, incidents, onSelectRegion, onSelectIncident }: SeaCardProps) {
  return (
    <section className={CARD_CLASS} aria-label={seaName} data-testid="live-sea-card">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-card-title">{seaName}</h2>
        <p className="text-display tabular-nums" data-testid="live-sea-ship-count">
          {shipCount.toLocaleString("en-US")}
        </p>
        <p className="text-small text-muted">ships heard in this sea in this frame</p>
      </div>
      {regions.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="text-label">Recorded every minute here</h3>
          <ul className="-mx-2 flex flex-col gap-0.5">
            {regions.map((region) => (
              <li key={region.id}>
                <button type="button" onClick={() => onSelectRegion(region.id)} className={ROW_CLASS} data-testid={`live-sea-region-${region.id}`}>
                  <span className="min-w-0 flex-1 truncate text-small">{region.name}</span>
                  <span className="flex-none text-small text-muted tabular-nums">{region.shipCount.toLocaleString("en-US")} ships</span>
                  <Icon name="chevronRight" className="flex-none text-muted" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {incidents.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="text-label">Cuts on file in this sea</h3>
          <ul className="-mx-2 flex flex-col gap-0.5">
            {incidents.map((incident) => (
              <li key={incident.slug}>
                <button type="button" onClick={() => onSelectIncident(incident.slug)} className={ROW_CLASS}>
                  <span className="min-w-0 flex-1 truncate text-small">
                    {incident.vesselName}, {incident.cutLabel}
                  </span>
                  <span className="flex-none text-caption font-normal text-muted tabular-nums">{incident.dateLabel}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {regions.length === 0 && <p className="text-caption font-normal text-muted">No region of this sea is recorded every minute; the frame shows what the feeds heard.</p>}
    </section>
  );
}
