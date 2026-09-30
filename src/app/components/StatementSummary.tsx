import { CATEGORIES, type StatementSummary as Summary } from "@/engine";
import { CATEGORY_LABELS, formatCad } from "../lib/format";

export function StatementSummary({ summary }: { summary: Summary }) {
  const spent = CATEGORIES.filter((c) => summary.spend_by_category[c] > 0);
  const other = [
    ["Refunds", summary.refunds],
    ["Foreign-currency spending", summary.foreign_spend],
    ["Card fees", summary.fees],
    ["Interest", summary.interest],
    ["Payments and credits", summary.payments],
  ] as const;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <h3 className="mb-2 text-sm font-semibold">Spending by category (after refunds)</h3>
        {spent.length === 0 ? (
          <p className="text-sm text-muted">No spending found.</p>
        ) : (
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
            {spent.map((c) => (
              <div key={c} className="contents">
                <dt>{CATEGORY_LABELS[c]}</dt>
                <dd className="text-right tabular-nums">{formatCad(summary.spend_by_category[c])}</dd>
              </div>
            ))}
          </dl>
        )}
        {summary.over_refunded.length > 0 && (
          <p className="mt-2 text-xs text-muted">
            Refunds were larger than purchases in{" "}
            {summary.over_refunded.map((c) => CATEGORY_LABELS[c]).join(", ")}, probably for purchases on an
            earlier statement. Shown as $0.
          </p>
        )}
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold">Other totals</h3>
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
          {other.map(([label, value]) => (
            <div key={label} className="contents">
              <dt>{label}</dt>
              <dd className="text-right tabular-nums">{formatCad(value)}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-xs text-muted">
          Fees, interest and payments aren&apos;t category spending. Foreign-currency spending is already
          included on the left; it&apos;s shown here because it matters for foreign transaction fees.
        </p>
      </div>
    </div>
  );
}
