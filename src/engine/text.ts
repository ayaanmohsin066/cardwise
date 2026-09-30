/**
 * Text normalization and word-boundary matching shared by ingest and
 * categorize.
 *
 * normalizeText lowercases, strips accents (é -> e), and turns every run of
 * non-alphanumeric characters into a single space. So "Petro-Canada #123",
 * "PETRO CANADA 123" and "petro canada 123" all become "petro canada 123".
 */
export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * True when `phrase` appears in `text` as whole words, after normalizing both.
 * "shell" matches "SHELL C12345" but not "SHELLFISH MARKET".
 * An empty phrase never matches.
 */
export function containsPhrase(text: string, phrase: string): boolean {
  const p = normalizeText(phrase);
  if (!p) return false;
  return ` ${normalizeText(text)} `.includes(` ${p} `);
}
