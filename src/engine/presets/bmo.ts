import type { Preset } from "./types";

/** Stub. No verified sample export yet, so no column names are assumed. */
export const bmoPreset: Preset = {
  id: "bmo",
  issuer_id: "bmo",
  label: "BMO",
  verified: false,
  mapping: null,
  format: null,
  notes: "No verified BMO export format yet. Map the columns yourself.",
};
