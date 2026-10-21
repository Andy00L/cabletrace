import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { RemoveWatchButton } from "@/components/watchlist/RemoveWatchButton";
import { CABLE_CASES } from "@/data/cases";
import { signOut } from "@/lib/auth/account-actions";
import { buildSignInPath } from "@/lib/auth/next-path";
import { readSignedInReader } from "@/lib/auth/session";
import { fetchRecentDetections, type DetectionSummary } from "@/lib/globe/live-api";
import { formatUtcClock, formatUtcDay } from "@/lib/replay/format-utc";
import type { WatchItem, WatchKind } from "@/lib/watchlist/watch-items";
import { listWatchItems } from "@/lib/watchlist/watch-store";

export const metadata: Metadata = { title: "Watchlist", description: "The cases, cables and ships you follow, and the detector's findings on them." };

const WATCHLIST_PATH = "/watchlist";
const CARD_CLASS = "flex flex-col gap-3 rounded-row bg-card px-5 py-4.5 shadow-card";
const KIND_LABELS: Record<WatchKind, string> = { case: "Case", cable: "Cable", ship: "Ship" };

type WatchedDetection = { detection: DetectionSummary; reasons: string[] };

/**
 * The detector's findings of the last day that touch something the reader watches: a watched ship (by MMSI), a
 * watched cable, or a cable cut in a watched case (matched by name, as the detector and the cases spell them).
 */
function findWatchedDetections(items: readonly WatchItem[], detections: readonly DetectionSummary[]): WatchedDetection[] {
  const watchedShips = new Map(items.filter((item) => item.kind === "ship").map((item) => [Number(item.ref), item.label]));
  const watchedCables = new Map<string, string>();
  for (const item of items) {
    if (item.kind === "cable") watchedCables.set(item.ref.toLowerCase(), item.label);
    if (item.kind === "case") {
      const watchedCase = CABLE_CASES.find((cableCase) => cableCase.slug === item.ref);
      watchedCase?.cuts.forEach((cut) => watchedCables.set(cut.cableName.toLowerCase(), `${cut.cableName} (${watchedCase.vessel.name} case)`));
    }
  }
  return detections.flatMap((detection) => {
    const shipLabel = watchedShips.get(detection.mmsi);
    const cableReasons = detection.cableNames.flatMap((cableName) => {
      const watchedLabel = watchedCables.get(cableName.toLowerCase());
      return watchedLabel ? [`crossed ${watchedLabel}, which you watch`] : [];
    });
    const reasons = [...(shipLabel ? [`${shipLabel} is on your watchlist`] : []), ...cableReasons];
    return reasons.length > 0 ? [{ detection, reasons }] : [];
  });
}

function WatchedItemRow({ item }: { item: WatchItem }) {
  const watchedCase = item.kind === "case" ? CABLE_CASES.find((cableCase) => cableCase.slug === item.ref) : undefined;
  return (
    <li className="flex items-center gap-3 rounded-field px-2 py-2">
      <span className="w-12 flex-none text-caption font-normal text-muted">{KIND_LABELS[item.kind]}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        {watchedCase ? (
          <Link href={`/cases/${watchedCase.slug}`} className="truncate text-label text-ink underline decoration-faint underline-offset-4 hover:decoration-ink">
            {item.label}
          </Link>
        ) : (
          <span className="truncate text-label">{item.label}</span>
        )}
        <span className="text-micro text-muted tabular-nums">{item.kind === "ship" ? `MMSI ${item.ref}, ` : ""}since {formatUtcDay(item.createdAtMs)}</span>
      </span>
      <RemoveWatchButton itemId={item.id} label={item.label} />
    </li>
  );
}

function AlertRow({ watched }: { watched: WatchedDetection }) {
  const { detection, reasons } = watched;
  return (
    <li className="flex flex-col gap-1 rounded-field bg-page px-3.5 py-3">
      <span className="flex items-baseline gap-2">
        <span className={`text-label ${detection.level === "alert" ? "text-alarm" : "text-ink"}`}>{detection.level === "alert" ? "Alert" : "Watch"}</span>
        <span className="truncate text-label">{detection.name ?? `MMSI ${detection.mmsi}`}</span>
        <span className="ml-auto text-caption font-normal text-muted tabular-nums">
          {formatUtcClock(detection.startMs)} to {formatUtcClock(detection.endMs)} UTC
        </span>
      </span>
      <span className="text-caption font-normal text-muted">{reasons.join("; ")}.</span>
      {detection.sentences[0] && <span className="text-small">{detection.sentences[0]}</span>}
    </li>
  );
}

/** The reader's items and the alerts on them; reads the session, so it renders per request behind a skeleton. */
async function WatchlistContent() {
  const reader = await readSignedInReader();
  // The proxy lets only signed-in readers through; a session that ended since then goes back to the form.
  if (reader === null) redirect(buildSignInPath(WATCHLIST_PATH));
  const [listed, detections] = await Promise.all([listWatchItems(reader.id), fetchRecentDetections()]);
  if (!listed.ok) console.error(`[WatchlistContent] ${listed.reason}`);
  if (!detections.ok) console.error(`[WatchlistContent] ${detections.reason}`);
  const items = listed.ok ? listed.value : [];
  const alerts = listed.ok && detections.ok ? findWatchedDetections(items, detections.value) : [];

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section className={CARD_CLASS} aria-label="Alerts" data-testid="watchlist-alerts">
        <h2 className="text-card-title">Alerts, last 24 hours</h2>
        {!detections.ok ? (
          <p className="text-small text-muted">The detector&apos;s results could not be read just now. Reload in a minute.</p>
        ) : alerts.length === 0 ? (
          <p className="text-small text-muted">
            Nothing on what you watch. The anchor-drag detector checks every ship recorded near a cable every 30 minutes; a finding on a watched ship or cable shows here.
          </p>
        ) : (
          <ol className="flex flex-col gap-2">
            {alerts.map((watched) => (
              <AlertRow key={watched.detection.id} watched={watched} />
            ))}
          </ol>
        )}
      </section>
      <section className={CARD_CLASS} aria-label="Watching" data-testid="watchlist-items">
        <h2 className="text-card-title">Watching{listed.ok ? ` (${items.length})` : ""}</h2>
        {!listed.ok ? (
          <p className="text-small text-muted">Your watchlist could not be read just now. Reload in a minute.</p>
        ) : items.length === 0 ? (
          <p className="text-small text-muted">
            Nothing yet. Open a <Link href="/cases" className="text-ink underline decoration-faint underline-offset-4 hover:decoration-ink">case</Link> and press Watch, or watch a cable from its cut card or a ship from its card.
          </p>
        ) : (
          <ul className="-mx-2 flex flex-col">
            {items.map((item) => (
              <WatchedItemRow key={item.id} item={item} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Who is signed in, and the way out: ends this browser's session and returns to the landing. */
async function AccountControls() {
  const reader = await readSignedInReader();
  return (
    <form action={signOut} className="flex items-center gap-1">
      {reader?.email && <span className="hidden max-w-[240px] truncate text-caption font-normal text-muted sm:block">{reader.email}</span>}
      <button type="submit" className="flex h-11 items-center rounded-full px-4 text-label text-ink transition-colors duration-140 ease-standard hover:bg-ink/5" data-testid="sign-out">
        Sign out
      </button>
    </form>
  );
}

function WatchlistSkeleton() {
  return (
    <div className="grid gap-5 lg:grid-cols-2" aria-busy="true">
      <div className="h-40 rounded-row bg-card shadow-card" />
      <div className="h-40 rounded-row bg-card shadow-card" />
    </div>
  );
}

/** The signed-in reader's watchlist (src/proxy.ts sends a signed-out reader to sign in first). */
export default function WatchlistPage() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[1440px] flex-col px-4 pb-6 sm:px-6">
      <SiteHeader current="watchlist" />
      <main className="flex flex-col gap-5 pt-4">
        <div className="flex items-center gap-4">
          <div className="flex min-w-0 flex-col gap-1 lg:flex-row lg:items-baseline lg:gap-5">
            <h1 className="text-title">Watchlist</h1>
            <p className="text-body text-muted">The cases, cables and ships you follow, and the detector&apos;s findings on them.</p>
          </div>
          <span className="ml-auto flex-none">
            <Suspense fallback={<span className="block h-11 w-24" />}>
              <AccountControls />
            </Suspense>
          </span>
        </div>
        <Suspense fallback={<WatchlistSkeleton />}>
          <WatchlistContent />
        </Suspense>
      </main>
    </div>
  );
}
