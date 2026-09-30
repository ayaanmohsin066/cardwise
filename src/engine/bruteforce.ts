/**
 * Exhaustive check for small cases: try every split of each spend cell across
 * the cards on a grid (steps of 1/grid), filling each card's capped bonus tier
 * before its after-cap tier. Every such routing is feasible for the LP, so the
 * LP optimum must never be lower than the best value found here.
 */
import { periodKey } from "./dates";
import { earnOptions, monthsSpanned, resolveCard, type CardSetEntry, type RoutingMode, type SpendCell } from "./optimize";

/** All ways to split `grid` units across `k` cards. */
function compositions(grid: number, k: number): number[][] {
  if (k === 1) return [[grid]];
  const out: number[][] = [];
  for (let first = 0; first <= grid; first++) {
    for (const rest of compositions(grid - first, k - 1)) out.push([first, ...rest]);
  }
  return out;
}

/**
 * Best value on the grid, comparable to RoutingCase.upper_bound for "ongoing"
 * (earned value − prorated fees). Throws if the case is too large to enumerate
 * (more than `maxRoutings` combinations) or a card can't be resolved.
 */
export function bruteForceBest(
  cardSet: readonly CardSetEntry[],
  cells: readonly SpendCell[],
  grid = 4,
  mode: RoutingMode = "ongoing",
  maxRoutings = 200_000,
): number {
  const resolved = cardSet.map((e) => resolveCard(e, cells, mode));
  const usable = resolved.map((r) => {
    if (!r.ok) throw new Error(`Card ${r.card_id} is not usable: ${r.reasons.join(", ")}`);
    return r;
  });
  const demand = cells.filter((c) => c.net > 1e-7);
  const splits = compositions(grid, usable.length);
  if (splits.length ** demand.length > maxRoutings) throw new Error("Too many routings to enumerate");
  const months = monthsSpanned(cells);
  const fees = usable.reduce((s, r) => s + (r.fee * months.length) / 12, 0);

  let best = -Infinity;
  const walk = (i: number, room: Map<string, number>, value: number) => {
    if (i === demand.length) {
      best = Math.max(best, value);
      return;
    }
    const cell = demand[i];
    for (const split of splits) {
      const r2 = new Map(room);
      let v = value;
      split.forEach((units, k) => {
        let x = (cell.net * units) / grid;
        if (x <= 0) return;
        for (const o of earnOptions(usable[k], cell.category, cell.foreign)) {
          if (x <= 0) break;
          if (o.tier === "bonus" && o.cap) {
            const key = `${o.card_id}|${o.cap.id}|${periodKey(`${cell.month}-01`, o.cap.period)}`;
            const left = r2.get(key) ?? o.cap.amount;
            const use = Math.min(x, left);
            r2.set(key, left - use);
            v += use * o.value;
            x -= use;
          } else {
            v += x * o.value;
            x = 0;
          }
        }
      });
      walk(i + 1, r2, v);
    }
  };
  walk(0, new Map(), 0);
  return best - fees;
}
