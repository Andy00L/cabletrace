"use client";

/** `isDisabled` greys a segment that does not apply yet (the globe's Ship tier before a ship is picked). */
export type SegmentOption<TValue extends string> = { value: TValue; label: string; isDisabled?: boolean };

type SegmentedControlProps<TValue extends string> = {
  /** Read by screen readers as the group's name. */
  label: string;
  options: readonly SegmentOption<TValue>[];
  value: TValue;
  onChange: (value: TValue) => void;
  testId?: string;
};

/**
 * The approved segmented control (docs/UI_DESIGN_SYSTEM.md, Components): a soft pill track; the selected
 * segment is a white pill with the selected shadow and 600 text, the others muted 500.
 */
export function SegmentedControl<TValue extends string>({ label, options, value, onChange, testId }: SegmentedControlProps<TValue>) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-0.5 rounded-full bg-soft p-1" data-testid={testId}>
      {options.map((option) => {
        const isSelected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isSelected}
            disabled={option.isDisabled}
            onClick={() => onChange(option.value)}
            className={`h-9 rounded-full px-4 text-small transition-[background-color,color,box-shadow] duration-140 ease-standard active:scale-[0.97] disabled:text-faint disabled:active:scale-100 ${
              isSelected ? "bg-card font-semibold text-ink shadow-selected" : "font-medium text-muted enabled:hover:text-ink"
            }`}
            data-value={option.value}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
