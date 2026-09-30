interface Props {
  label: string;
  value: string;
  sub?: string;
  /** Large headline figure (one per view). */
  hero?: boolean;
}

export function StatTile({ label, value, sub, hero = false }: Props) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-md border border-border bg-background p-3">
      <span className="text-xs text-muted">{label}</span>
      <span className={hero ? "text-4xl font-semibold tracking-tight sm:text-5xl" : "text-xl font-semibold"}>{value}</span>
      {sub && <span className="text-xs text-muted">{sub}</span>}
    </div>
  );
}
