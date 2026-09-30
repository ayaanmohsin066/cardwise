import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const ROOT = join(__dirname, "..", "..");
export const DATA_DIR = join(ROOT, "src", "data");
export const FIXTURES_DIR = join(ROOT, "tests", "fixtures");

export interface JsonFile {
  /** Path relative to its root, e.g. "td/some-card.json". */
  label: string;
  /** Directory the file sits in (the issuer, for cards). */
  dir: string;
  file: string;
  json: unknown;
}

const readJson = (p: string): unknown => JSON.parse(readFileSync(p, "utf8"));

/** <cardsDir>/<issuer>/<card-id>.json */
export function loadCardFiles(cardsDir: string): JsonFile[] {
  if (!existsSync(cardsDir)) return [];
  return readdirSync(cardsDir)
    .filter((d) => statSync(join(cardsDir, d)).isDirectory())
    .flatMap((dir) =>
      readdirSync(join(cardsDir, dir))
        .filter((f) => f.endsWith(".json"))
        .map((file) => ({ label: `${dir}/${file}`, dir, file, json: readJson(join(cardsDir, dir, file)) })),
    );
}

/** <programsDir>/<program-id>.json */
export function loadProgramFiles(programsDir: string): JsonFile[] {
  if (!existsSync(programsDir)) return [];
  return readdirSync(programsDir)
    .filter((f) => f.endsWith(".json"))
    .map((file) => ({ label: file, dir: "", file, json: readJson(join(programsDir, file)) }));
}

export const loadJson = (p: string) => readJson(p);
