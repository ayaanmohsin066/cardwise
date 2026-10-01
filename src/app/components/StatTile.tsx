interface Props {
  label: string;
  value: string;
  sub?: string;
  /** Large headline figure (one per view). */
  hero?: boolean;
}

export function StatTile({ label, value, sub, hero = false }: Props) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-border bg-background px-4 py-3.5">
      <span className="eyebrow">{label}</span>
      <span
        className={`tabular-nums tracking-tight ${hero ? "text-4xl font-semibold sm:text-5xl" : "text-xl font-semibold"}`}
      >
        {value}
      </span>
      {sub && <span className="text-xs leading-relaxed text-muted">{sub}</span>}
    </div>
  );
}
