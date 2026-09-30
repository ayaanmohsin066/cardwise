import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateIssuers } from "@/engine";
import { DATA_DIR, loadJson } from "../helpers/data-files";

describe("issuers.json contents", () => {
  const r = validateIssuers(loadJson(join(DATA_DIR, "issuers.json")));
  if (!r.ok) throw new Error(r.errors.join("\n"));
  const byTier = (t: number) => r.issuers.filter((i) => i.tier === t).map((i) => i.name);

  it("lists the agreed tiers", () => {
    expect(byTier(1)).toEqual([
      "RBC", "TD", "Scotiabank", "BMO", "CIBC", "National Bank",
      "American Express Canada", "Desjardins",
    ]);
    expect(byTier(2)).toEqual([
      "Capital One Canada", "MBNA", "PC Financial", "Canadian Tire (Triangle)",
      "Rogers Bank", "Tangerine", "Simplii Financial", "Walmart Rewards (Fairstone)",
    ]);
    expect(byTier(3)).toEqual([
      "Neo Financial", "Brim Financial", "Laurentian Bank", "ATB Financial",
      "Vancity", "Meridian",
    ]);
  });
});
