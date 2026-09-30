import type { Preset } from "./types";

/** Stub. No verified sample export yet, so no column names are assumed. */
export const scotiabankPreset: Preset = {
  id: "scotiabank",
  issuer_id: "scotiabank",
  label: "Scotiabank",
  verified: false,
  mapping: null,
  format: null,
  notes: "No verified Scotiabank export format yet. Map the columns yourself.",
};
