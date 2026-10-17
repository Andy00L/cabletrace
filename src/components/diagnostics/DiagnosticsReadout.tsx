export type ReadoutRow = {
  label: string;
  value: string;
  testId: string;
  isAlarm?: boolean;
};

// Label and value pairs under a diagnostics probe; every value carries a data-testid for the end-to-end tests.
export function DiagnosticsReadout({ rows }: { rows: ReadoutRow[] }) {
  return (
    <dl className="flex flex-col gap-3">
      {rows.map((row) => (
        <div key={row.testId} className="flex items-baseline justify-between gap-6">
          <dt className="shrink-0 text-small text-muted">{row.label}</dt>
          <dd
            className={`min-w-0 text-right text-small break-words tabular-nums ${row.isAlarm ? "text-alarm" : "text-ink"}`}
            data-testid={row.testId}
          >
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
