// Merkkijonohaku piin desimaaleista. Indeksit ovat käyttäjälle 1-pohjaisia:
// n = 1 tarkoittaa ensimmäistä desimaalia "1" (3.1415…).

export interface FindResult {
  hits: number[];
  truncated: boolean;
}

/**
 * Kaikki täsmäosumat vierekkäisistä desimaaleista, myös päällekkäiset
 * (esim. "4444" löytyy kahdesti jonosta "44444").
 */
export function findAll(pattern: string, digits: string, limit = Number.POSITIVE_INFINITY): number[] {
  return findAllDetailed(pattern, digits, limit).hits;
}

export function findAllDetailed(pattern: string, digits: string, limit = Number.POSITIVE_INFINITY): FindResult {
  const hits: number[] = [];
  if (!pattern) return { hits, truncated: false };
  let i = digits.indexOf(pattern);
  while (i !== -1) {
    if (hits.length >= limit) return { hits, truncated: true };
    hits.push(i + 1);
    i = digits.indexOf(pattern, i + 1);
  }
  return { hits, truncated: false };
}

/** Mahdollisten alkukohtien määrä: N − L + 1. */
export function startPositions(N: number, L: number): number {
  return Math.max(0, N - L + 1);
}

/** Odotettu osumamäärä satunnaisessa, tasajakautuneessa 0–9-jonossa: (N − L + 1) / 10^L. */
export function expectedCount(N: number, L: number): number {
  return startPositions(N, L) / Math.pow(10, L);
}

/**
 * KOKEELLINEN hyppypolku: numerot kohdista n, n+s, n+2s, … muodostavat koodin.
 * Tällaiset polut EIVÄT ole piin peräkkäisiä merkkijono-osumia.
 */
export function findSkip(pattern: string, digits: string, step: number, limit = Number.POSITIVE_INFINITY): FindResult {
  const hits: number[] = [];
  const L = pattern.length;
  if (!L || step < 1) return { hits, truncated: false };
  const span = (L - 1) * step;
  const last = digits.length - 1 - span;
  const p = Array.from(pattern, (c) => c.charCodeAt(0));
  const c0 = p[0];
  for (let i = 0; i <= last; i++) {
    if (digits.charCodeAt(i) !== c0) continue;
    let ok = true;
    for (let j = 1; j < L; j++) {
      if (digits.charCodeAt(i + j * step) !== p[j]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      if (hits.length >= limit) return { hits, truncated: true };
      hits.push(i + 1);
    }
  }
  return { hits, truncated: false };
}

/** Binäärihaku: lähin arvo järjestetystä taulukosta. Palauttaa indeksin tai -1. */
export function nearestIndex(sorted: ArrayLike<number>, v: number): number {
  const n = sorted.length;
  if (!n) return -1;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(sorted[lo - 1] - v) <= Math.abs(sorted[lo] - v)) return lo - 1;
  return lo;
}

/** Ensimmäinen indeksi i, jolla sorted[i] >= v. */
export function lowerBound(sorted: ArrayLike<number>, v: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
