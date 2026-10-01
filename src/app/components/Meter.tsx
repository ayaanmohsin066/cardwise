interface Props {
  label: string;
  used: number;
  limit: number;
  /** Shown under the bar, e.g. "Reached on 2026-01-12". */
  note?: string;
  format: (n: number) => string;
}

/** A single ratio against a limit: same-hue track, accent fill, value always in text. */
export function Meter({ label, used, limit, note, format }: Props) {
  const pct = limit > 0 ? Math.min(100, Math.max(0, (used / limit) * 100)) : 0;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-background px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums">
          <span className="font-semibold">{format(used)}</span>
          <span className="text-muted"> of {format(limit)}</span>
        </span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={used}
        aria-valuetext={`${format(used)} of ${format(limit)}`}
        className="h-1.5 w-full overflow-hidden rounded-full bg-meter-track"
      >
        <div className="h-full rounded-full bg-meter-fill" style={{ width: `${pct}%` }} />
      </div>
      {note && <span className="text-xs leading-relaxed text-muted">{note}</span>}
    </div>
  );
}
