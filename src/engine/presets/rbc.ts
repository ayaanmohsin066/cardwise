import type { Preset } from "./types";

/** Stub. No verified sample export yet, so no column names are assumed. */
export const rbcPreset: Preset = {
  id: "rbc",
  issuer_id: "rbc",
  label: "RBC",
  verified: false,
  mapping: null,
  format: null,
  notes: "No verified RBC export format yet. Map the columns yourself.",
};
