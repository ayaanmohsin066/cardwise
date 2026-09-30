import type { Preset } from "./types";

/** Stub. No verified sample export yet, so no column names are assumed. */
export const cibcPreset: Preset = {
  id: "cibc",
  issuer_id: "cibc",
  label: "CIBC",
  verified: false,
  mapping: null,
  format: null,
  notes: "No verified CIBC export format yet. Map the columns yourself.",
};
