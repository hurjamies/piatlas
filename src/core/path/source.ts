// Path Discovery: osumalähteet. Todellinen pii ja kaksi nollamallia (docs/POLKUHAKU.md §6):
//  - tasajakauma: jokaisen koodin todellinen osumamäärä k sijoitetaan tasajakautuneesti ilman toistoja
//    alkukohtiin 1 … N − L + 1 (sama nollamalli kuin reittitestissä, route-test.ts)
//  - satunnaisjono: siemenellinen satunnainen 0–9-jono (randomDigits) ja samat koodit findAll-haulla.
// Kaikki on deterministististä siemenen perusteella.

import { codeHits } from '../matrix/hits';
import { createRng, randomDigits, Rng } from '../random';
import { findAll, startPositions } from '../search';
import type { HitSource } from './types';

const EMPTY = new Int32Array(0);

/** Todellinen pii: osumat codeHits-funktiolla (välimuisti aineistoa kohden). Osumat voidaan tarkistaa (digits). */
export function piSource(digits: string, label: string): HitSource {
  return {
    kind: 'pii',
    N: digits.length,
    hitsOf: (code: string) => (/^\d+$/.test(code) ? codeHits(digits, code) : EMPTY),
    digits,
    label,
  };
}

/**
 * k eri kokonaislukua väliltä [lo, hi]. Sama menetelmä kuin route-test.ts:n ja stats.ts:n otannassa
 * (harva: hylkäysotanta, tiheä: osittainen Fisher–Yates), joten satunnaislukujen kulutus on sama.
 */
function sampleDistinct(rng: Rng, k: number, lo: number, hi: number): number[] {
  const out: number[] = [];
  const range = hi - lo + 1;
  if (k <= 0 || range <= 0) return out;
  if (k * 4 > range) {
    const all = Array.from({ length: range }, (_, i) => lo + i);
    for (let i = 0; i < k; i++) {
      const j = i + rng.int(0, range - 1 - i);
      const t = all[i];
      all[i] = all[j];
      all[j] = t;
      out.push(all[i]);
    }
    return out;
  }
  const seen = new Set<number>();
  while (out.length < k) {
    const v = rng.int(lo, hi);
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/**
 * Tasajakauma-nollamalli. Jokaisen koodin osumamäärä k sijoitetaan tasajakautuneesti ilman toistoja alkukohtiin
 * 1 … N − L + 1 (nouseva Int32Array). Koodit käsitellään merkkijonojärjestyksessä (syötteen järjestys ei vaikuta),
 * yksi siemenellinen generaattori (xoshiro128**) kaikille koodeille. Sama koodi useasti → ensimmäinen määrä.
 * k rajataan alkukohtien määrään. Lähteessä ei ole numeroita, joten osumia ei voi tarkistaa (digits = null).
 * Tuntemattomalla koodilla ei ole osumia.
 */
export function uniformSource(codesAndCounts: { code: string; count: number }[], N: number, seed: number, label: string): HitSource {
  const counts = new Map<string, number>();
  for (const { code, count } of codesAndCounts) if (!counts.has(code)) counts.set(code, Math.max(0, Math.floor(count)));
  const codes = [...counts.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const rng = createRng(seed >>> 0);
  const placed = new Map<string, Int32Array>();
  for (const code of codes) {
    const hi = startPositions(N, code.length);
    const k = Math.min(counts.get(code)!, hi);
    placed.set(code, Int32Array.from(sampleDistinct(rng, k, 1, hi)).sort());
  }
  return {
    kind: 'tasajakauma',
    N,
    hitsOf: (code: string) => placed.get(code) ?? EMPTY,
    digits: null,
    label,
  };
}

/**
 * Satunnaisjono-nollamalli: siemenellinen satunnainen 0–9-jono, jonka pituus on N, ja samat koodit findAll-haulla
 * (välimuisti koodia kohden). Osumat voidaan tarkistaa satunnaisjonosta (digits).
 */
export function randomStringSource(N: number, seed: number, label: string): HitSource {
  const digits = randomDigits(N, seed >>> 0);
  const memo = new Map<string, Int32Array>();
  return {
    kind: 'satunnaisjono',
    N,
    hitsOf: (code: string) => {
      let h = memo.get(code);
      if (!h) {
        h = /^\d+$/.test(code) ? Int32Array.from(findAll(code, digits)) : EMPTY;
        memo.set(code, h);
      }
      return h;
    },
    digits,
    label,
  };
}
