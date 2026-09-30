import type { Category, TransactionKind } from "@/engine";

const cad = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" });
export const formatCad = (x: number) => cad.format(x);

export const CATEGORY_LABELS: Record<Category, string> = {
  groceries: "Groceries",
  dining: "Dining",
  gas: "Gas",
  transit: "Transit",
  travel: "Travel",
  streaming: "Streaming",
  drugstore: "Drugstore",
  recurring_bills: "Recurring bills",
  entertainment: "Entertainment",
  home_improvement: "Home improvement",
  online_shopping: "Online shopping",
  other: "Other",
};

export const KIND_LABELS: Record<TransactionKind, string> = {
  purchase: "Purchase",
  refund: "Refund",
  payment: "Payment",
  fee: "Card fee",
  interest: "Interest",
};
