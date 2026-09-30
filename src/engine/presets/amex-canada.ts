import type { Preset } from "./types";

/** Stub. No verified sample export yet, so no column names are assumed. */
export const amexCanadaPreset: Preset = {
  id: "amex-canada",
  issuer_id: "amex-canada",
  label: "American Express Canada",
  verified: false,
  mapping: null,
  format: null,
  notes: "No verified American Express Canada export format yet. Map the columns yourself.",
};
