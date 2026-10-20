// The 3D stage while it loads: a card in the middle of the stage with one progress line in two parts, the seabed (the
// area's depth grid, downloaded and decoded) and the ship (its model and the scene around it, built). Each part fills
// when its step is done; nothing loops. The console's skeleton (ConsoleSkeleton) draws the same card at the first step,
// so nothing moves when the console takes over. Server-safe: no client code.

/** The step the 3D view is on: the seabed is loading, or it is in and the ship and scene are being built. */
export type StageLoadStep = "seabed" | "ship";

const PARTS: readonly { step: StageLoadStep; label: string }[] = [
  { step: "seabed", label: "Seabed" },
  { step: "ship", label: "Ship" },
];
const HEADINGS: Record<StageLoadStep, string> = { seabed: "Loading the seabed", ship: "Building the ship and the scene" };

export function StageLoading({ step }: { step: StageLoadStep }) {
  const stepIndex = PARTS.findIndex((part) => part.step === step);
  return (
    <div className="absolute inset-0 grid place-items-center p-6">
      <div className="flex w-full max-w-xs flex-col gap-3 rounded-inner bg-card p-5 shadow-card" data-testid="stage-loading" data-state={step}>
        <p className="text-label" aria-live="polite">
          {HEADINGS[step]}
        </p>
        <div
          role="progressbar"
          aria-label="3D view"
          aria-valuemin={0}
          aria-valuemax={PARTS.length}
          aria-valuenow={stepIndex}
          aria-valuetext={`${stepIndex} of ${PARTS.length} parts loaded`}
          className="grid grid-cols-2 gap-1"
        >
          {PARTS.map((part, partIndex) => (
            <span key={part.step} className="h-1.5 overflow-hidden rounded-full bg-soft">
              <span
                className={`block h-full origin-left rounded-full bg-ink transition-transform duration-220 ease-enter ${partIndex < stepIndex ? "scale-x-100" : "scale-x-0"}`}
              />
            </span>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-1 text-caption font-normal">
          {PARTS.map((part, partIndex) => (
            <span key={part.step} className={partIndex <= stepIndex ? "text-ink" : "text-muted"}>
              {part.label}
              {partIndex < stepIndex ? ", done" : ""}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
