import type { Metadata } from "next";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { LiveConsole } from "@/components/live/LiveConsole";
import { CABLE_CASES } from "@/data/cases";
import { REGIONS } from "@/data/regions";
import { toGlobeIncidents } from "@/lib/globe/incidents";
import { loadWatchedLines } from "@/lib/globe/load-watched-lines";

export const metadata: Metadata = {
  title: "Live",
  description: "A recorded day of the world's ships on a 3D globe, every 10 minutes, with the cables the replays watch and the anchor-drag watch.",
};

/**
 * The /live globe: the page frame, the watched lines and the incidents (one per published case, derived here so the
 * page never ships the case files) are static; the day itself loads in the browser.
 */
export default async function LivePage() {
  const watchedLines = await loadWatchedLines();
  const incidents = toGlobeIncidents(CABLE_CASES);
  // Names only, so the registry's boxes and notes stay out of the browser bundle.
  const regionNames = Object.fromEntries(REGIONS.map((region) => [region.id, region.name]));
  return (
    <div className="flex h-dvh flex-col">
      <h1 className="sr-only">A recorded day of ships</h1>
      <div className="w-full px-4 sm:px-6">
        <SiteHeader current="live" />
      </div>
      <LiveConsole watchedLines={watchedLines} incidents={incidents} regionNames={regionNames} />
    </div>
  );
}
