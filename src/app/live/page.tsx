import type { Metadata } from "next";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { LiveConsole } from "@/components/live/LiveConsole";
import { loadWatchedLines } from "@/lib/globe/load-watched-lines";

export const metadata: Metadata = {
  title: "Live",
  description: "A recorded day of the world's ships on a 3D globe, every 10 minutes, with the cables the replays watch and the anchor-drag watch.",
};

/** The /live globe: the page frame and the watched lines are static; the day itself loads in the browser. */
export default async function LivePage() {
  const watchedLines = await loadWatchedLines();
  return (
    <div className="flex h-dvh flex-col">
      <h1 className="sr-only">A recorded day of ships</h1>
      <div className="w-full px-4 sm:px-6">
        <SiteHeader current="live" />
      </div>
      <LiveConsole watchedLines={watchedLines} />
    </div>
  );
}
