"use client";

import Link from "next/link";
import { useId, useState } from "react";

// The console's views, with the names its view switcher shows. sourceRef: src/lib/console/console-state.ts (VIEWS)
// and the switcher's labels in the console (Overview, From above, Vessel, At the cut).
const VIEW_CHOICES = [
  { view: "overview", label: "Overview" },
  { view: "top", label: "From above" },
  { view: "vessel", label: "Vessel" },
  { view: "closeup", label: "At the cut" },
] as const;

type ViewChoice = (typeof VIEW_CHOICES)[number]["view"];

type OpenReplayDialogProps = {
  /** Every case on file, newest first: its slug and the name the switcher shows. */
  cases: readonly { slug: string; title: string; dateLabel: string }[];
};

/** The console link for a case and a view; the overview is the console's default, which hands the camera to the director. */
function buildReplayHref(slug: string, view: ViewChoice): string {
  return view === "overview" ? `/cases/${slug}` : `/cases/${slug}?view=${view}`;
}

/**
 * The console's first step, already open at the end of the page: pick a case and the view to open it in, and the
 * button opens that replay (after sign-in, which returns there). The button is a plain link, so it works before the
 * script loads, on the newest case.
 */
export function OpenReplayDialog({ cases }: OpenReplayDialogProps) {
  const [slug, setSlug] = useState(cases[0]?.slug ?? "");
  const [view, setView] = useState<ViewChoice>("overview");
  const caseFieldId = useId();
  return (
    <div role="group" aria-labelledby={`${caseFieldId}-title`} className="flex w-full max-w-[440px] flex-col gap-5 rounded-card bg-card p-6 text-ink shadow-popover" data-ui data-testid="open-replay">
      <div className="flex flex-col gap-1">
        <h3 id={`${caseFieldId}-title`} className="text-heading">
          Open a replay
        </h3>
        <p className="text-small text-muted">The console opens on the case and the view you pick.</p>
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor={caseFieldId} className="text-label">
          Case
        </label>
        <select
          id={caseFieldId}
          value={slug}
          onChange={(event) => setSlug(event.currentTarget.value)}
          className="h-12 w-full cursor-pointer rounded-field bg-page px-3 text-body text-ink"
          data-testid="open-replay-case"
        >
          {cases.map((cableCase) => (
            <option key={cableCase.slug} value={cableCase.slug}>
              {cableCase.title}, {cableCase.dateLabel}
            </option>
          ))}
        </select>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="pb-2 text-label">View</legend>
        <div className="grid grid-cols-2 gap-1 rounded-row bg-page p-1">
          {VIEW_CHOICES.map((choice) => (
            <label
              key={choice.view}
              className={`flex h-10 cursor-pointer items-center justify-center rounded-full px-2 text-label transition-colors duration-140 ease-standard has-focus-visible:shadow-[0_0_0_2px_var(--color-card),0_0_0_4px_var(--color-ink)] ${view === choice.view ? "bg-card shadow-selected" : "text-muted hover:text-ink"}`}
            >
              <input type="radio" name={`${caseFieldId}-view`} value={choice.view} checked={view === choice.view} onChange={() => setView(choice.view)} className="sr-only" />
              {choice.label}
            </label>
          ))}
        </div>
      </fieldset>
      <Link
        href={buildReplayHref(slug, view)}
        className="flex h-12 items-center justify-center rounded-full bg-ink px-6 text-label text-card transition-colors duration-140 ease-standard hover:bg-ink-hover active:scale-[0.98]"
        data-testid="open-replay-go"
      >
        Open the replay
      </Link>
    </div>
  );
}
