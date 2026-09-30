import type { Preset } from "./types";

/** Stub. No verified sample export yet, so no column names are assumed. */
export const tdPreset: Preset = {
  id: "td",
  issuer_id: "td",
  label: "TD",
  verified: false,
  mapping: null,
  format: null,
  notes: "No verified TD export format yet. Map the columns yourself.",
};
