// Koodien osumat matriisia varten. Lasketaan suoraan lähdeaineistosta (sama findAll kuin hakutermeillä),
// joten matriisi ei riipu siitä, mitkä hakutermit käyttäjällä on näkyvissä.

import { digitsAt } from '../digits';
import { expectedCount, findAll } from '../search';

let cacheDigits = '';
const cache = new Map<string, Int32Array>();

/** Kaikki 1-pohjaiset alkukohdat, nousevassa järjestyksessä, myös päällekkäiset. */
export function codeHits(digits: string, code: string): Int32Array {
  if (digits !== cacheDigits) {
    cache.clear();
    cacheDigits = digits;
  }
  let h = cache.get(code);
  if (!h) {
    h = Int32Array.from(findAll(code, digits));
    cache.set(code, h);
  }
  return h;
}

/** Odotettu osumamäärä tasajakautuneessa satunnaisjonossa: (N − L + 1) / 10^L. */
export function expectedHits(N: number, L: number): number {
  return expectedCount(N, L);
}

/** Tarkistus lähdeaineistosta: digits[n − 1 … n + L − 2] === code. */
export function verifyHit(digits: string, code: string, n: number): boolean {
  return Number.isInteger(n) && n >= 1 && code.length > 0 && digitsAt(digits, n, code.length) === code;
}
