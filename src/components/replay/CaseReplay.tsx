"use client";

import { useEffect, useState, type ReactNode } from "react";
import { CaseEventList } from "@/components/replay/CaseEventList";
import { ReplayStage } from "@/components/replay/ReplayStage";
import type { TimelineEvent } from "@/lib/cases/case-view";
import { createReplayClock } from "@/lib/replay/replay-clock";
import type { ReplaySceneInput } from "@/lib/replay/replay-scene";

// A full replay takes this long to play, whatever span of time the case window covers.
const REPLAY_DURATION_SECONDS = 40;

type CaseReplayProps = {
  input: ReplaySceneInput;
  events: readonly TimelineEvent[];
  localTime: { place: string; timeZone: string };
  /** Server-rendered cards beside the replay (the ship), above the event list. */
  aside: ReactNode;
  /** Server-rendered cards under the replay (placement, aftermath, sources). */
  below: ReactNode;
};

/**
 * Owns the one replay clock and lays out the case page around it: the stage and the cards below it on the
 * left, the ship and the minute-by-minute list on the right. On a phone the list follows the stage.
 */
export function CaseReplay({ input, events, localTime, aside, below }: CaseReplayProps) {
  const [clock] = useState(() =>
    createReplayClock({
      durationSeconds: REPLAY_DURATION_SECONDS,
      scheduler: { request: (callback) => window.requestAnimationFrame(callback), cancel: (handle) => window.cancelAnimationFrame(handle) },
    }),
  );
  // The clock schedules animation frames, a browser system React does not own; stop them when the page goes.
  useEffect(() => () => clock.dispose(), [clock]);

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
      <div className="min-w-0 lg:col-start-1 lg:row-start-1">
        <ReplayStage input={input} events={events} clock={clock} localTime={localTime} />
      </div>
      <div className="flex min-w-0 flex-col gap-6 lg:col-start-2 lg:row-span-2 lg:row-start-1">
        {aside}
        <CaseEventList input={input} events={events} clock={clock} />
      </div>
      <div className="flex min-w-0 flex-col gap-6 lg:col-start-1 lg:row-start-2">{below}</div>
    </div>
  );
}
