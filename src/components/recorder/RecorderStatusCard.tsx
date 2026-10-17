import { connection } from "next/server";
import { fetchRecorderSummary, judgeRecorderHealth, type RecorderHealth, type RecorderSummary } from "@/lib/recorder/recorder-summary";

// The recorder keeps positions within 3 km of a cable.
// sourceRef: supabase/migrations/20261017020000_live_recorder.sql (ingest_vessel_positions, near_cable_metres default 3000).
const NEAR_CABLE_KILOMETRES = 3;

type CardState = { kind: "unreachable" } | { kind: "measured"; summary: RecorderSummary; health: RecorderHealth };

const CARD_CLASS = "flex flex-col gap-5 rounded-card bg-card p-6 shadow-card sm:p-7";

function describeMinutesAgo(minutes: number): string {
  if (minutes === 0) return "less than a minute ago";
  return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
}

function describeHealth(health: RecorderHealth): { label: string; detail: string } {
  switch (health.kind) {
    case "recording":
      return { label: "Recording", detail: `Last run ${describeMinutesAgo(health.minutesSinceLastRun)}.` };
    case "failing":
      return { label: "Run failed", detail: `The last run, ${describeMinutesAgo(health.minutesSinceLastRun)}, could not store positions.` };
    case "stale":
      return { label: "Stopped", detail: `No run for ${health.minutesSinceLastRun} minutes.` };
    case "never-ran":
      return { label: "Not started", detail: "The recorder has not run yet." };
    default: {
      const unhandledHealth: never = health;
      return unhandledHealth;
    }
  }
}

function StatusDot({ isLive }: { isLive: boolean }) {
  if (!isLive) return <span className="size-2 rounded-full bg-alarm" aria-hidden="true" />;
  return (
    <span className="relative flex size-2" aria-hidden="true">
      <span className="absolute inset-0 animate-ping rounded-full bg-live opacity-60" />
      <span className="relative size-2 rounded-full bg-live" />
    </span>
  );
}

function SourceCredit() {
  return <p className="text-micro text-faint">Ship positions: Fintraffic, digitraffic.fi (CC BY 4.0)</p>;
}

/** Live status of the ship recorder, read from Supabase on every request. */
export async function RecorderStatusCard() {
  // Request-time data: stop prerendering here instead of starting a fetch the build would abort.
  await connection();
  const summary = await fetchRecorderSummary();
  if (!summary.ok) console.error(`[RecorderStatusCard] ${summary.reason}`);
  const cardState: CardState = summary.ok
    ? { kind: "measured", summary: summary.value, health: judgeRecorderHealth(summary.value) }
    : { kind: "unreachable" };

  if (cardState.kind === "unreachable") {
    return (
      <section className={CARD_CLASS} data-testid="recorder-status" data-state="unreachable" aria-labelledby="recorder-status-title">
        <div className="flex items-center justify-between gap-4">
          <h2 id="recorder-status-title" className="text-small text-muted">Live recorder</h2>
          <span className="flex items-center gap-2 text-caption text-ink">
            <StatusDot isLive={false} />
            Unavailable
          </span>
        </div>
        <p className="text-body text-muted">The recorder status could not be read right now. Try again in a minute.</p>
        <SourceCredit />
      </section>
    );
  }

  const { summary: recorded, health } = cardState;
  const { label, detail } = describeHealth(health);
  return (
    <section className={CARD_CLASS} data-testid="recorder-status" data-state={health.kind} aria-labelledby="recorder-status-title">
      <div className="flex items-center justify-between gap-4">
        <h2 id="recorder-status-title" className="text-small text-muted">Live recorder</h2>
        <span className="flex items-center gap-2 text-caption text-ink" data-testid="recorder-state">
          <StatusDot isLive={health.kind === "recording"} />
          {label}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-display tabular-nums" data-testid="recorder-ships">{recorded.shipsLastHour.toLocaleString("en-US")}</p>
        <p className="text-small text-muted">ships within {NEAR_CABLE_KILOMETRES} km of a cable in the last hour</p>
      </div>
      <p className="text-small text-ink">
        <span className="tabular-nums">{recorded.positionsLastHour.toLocaleString("en-US")}</span> positions near{" "}
        <span className="tabular-nums">{recorded.cablesWatched}</span> cables and pipelines in the Gulf of Finland. {detail}
      </p>
      <SourceCredit />
    </section>
  );
}

/** Same footprint as the card while the status streams in. */
export function RecorderStatusCardPlaceholder() {
  return (
    <section className={CARD_CLASS} aria-busy="true" aria-label="Live recorder">
      <div className="h-5 w-28 rounded-chip bg-soft" />
      <div className="flex flex-col gap-2">
        <div className="h-12 w-24 rounded-field bg-soft" />
        <div className="h-5 w-64 max-w-full rounded-chip bg-soft" />
      </div>
      <div className="h-5 w-80 max-w-full rounded-chip bg-soft" />
      <div className="h-4 w-56 max-w-full rounded-chip bg-soft" />
    </section>
  );
}
