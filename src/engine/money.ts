/**
 * Integer cents for a CAD amount. Absorbs binary floating-point error, so
 * 1.005 becomes 101 (not 100) and 0.1 + 0.2 sums cleanly.
 */
export function toCents(x: number): number {
  return Math.round(Number((x * 100).toPrecision(12)));
}

/** Round a CAD amount to the cent. */
export function roundCents(x: number): number {
  return toCents(x) / 100;
}
