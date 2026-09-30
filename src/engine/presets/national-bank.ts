import type { Preset } from "./types";

/** Stub. No verified sample export yet, so no column names are assumed. */
export const nationalBankPreset: Preset = {
  id: "national-bank",
  issuer_id: "national-bank",
  label: "National Bank",
  verified: false,
  mapping: null,
  format: null,
  notes: "No verified National Bank export format yet. Map the columns yourself.",
};
