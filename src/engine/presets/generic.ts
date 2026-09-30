import type { Preset } from "./types";

/** Any bank: the user picks which column is which in the UI. */
export const genericPreset: Preset = {
  id: "generic",
  issuer_id: null,
  label: "Other / map columns myself",
  verified: false,
  mapping: null,
  format: null,
  notes: "Choose which column holds the date, description and amount.",
};
