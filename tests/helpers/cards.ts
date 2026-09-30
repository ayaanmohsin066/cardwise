import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  validateCard,
  validateProgram,
  type Card,
  type CategorizedTransaction,
  type Category,
  type Program,
  type Transaction,
} from "@/engine";
import { DATA_DIR, FIXTURES_DIR, loadJson } from "./data-files";

export function fixtureCard(id: string): Card {
  const r = validateCard(loadJson(join(FIXTURES_DIR, "cards", "fake-bank", `${id}.json`)));
  if (!r.ok) throw new Error(r.errors.join("\n"));
  return r.card;
}

/** A built-in program (src/data/programs) or a fixture program. */
export function program(id: string): Program {
  const builtIn = join(DATA_DIR, "programs", `${id}.json`);
  const p = existsSync(builtIn) ? builtIn : join(FIXTURES_DIR, "programs", `${id}.json`);
  const r = validateProgram(loadJson(p));
  if (!r.ok) throw new Error(r.errors.join("\n"));
  return r.program;
}

let line = 0;
/** A categorized transaction for tests. Statement lines increase in call order unless given. */
export function item(
  date: string,
  category: Category | null,
  amount_cad: number,
  over: Partial<Transaction> & { confidence?: "high" | "low" } = {},
): CategorizedTransaction {
  const { confidence = "high", ...tx } = over;
  line += 1;
  const kind = tx.kind ?? (amount_cad < 0 ? "refund" : "purchase");
  return {
    transaction: {
      id: `t${line}`,
      statement_line: line,
      date,
      description: `LINE ${line}`,
      amount_cad,
      kind,
      is_foreign: false,
      is_foreign_confidence: "high",
      raw: {},
      ...tx,
    },
    category: kind === "purchase" || kind === "refund" ? category : null,
    confidence,
    source: "rule",
    rule_id: null,
    keyword: null,
  };
}
