// Reittitesti satunnaisvertailulla (PIATLAS-ROUTE-1.0.0). Määrittely: docs/MATRIISI.md §7.
//
// Testisuure on lyhin ikkuna: jokaiselle reitin koodille valitaan yksi osuma ja minimoidaan max(n) − min(n).
// Kaikki osumat ovat mukana, joten ankkuria ei käytetä (korjaa ankkurin jälkikäteisvalinnan). Nollamalli on sama
// kuin stats.ts:n runMonteCarlo: jokaisen koodin todellinen osumamäärä k_i sijoitetaan tasajakautuneesti ilman
// toistoja alkukohtiin 1 … N − L_i + 1, R kertaa, näkyvällä siemenellä (xoshiro128**).

import { createRng, randomDigits, Rng } from '../random';
import { findAll, lowerBound, startPositions } from '../search';
import type { RunHooks } from '../stats';
import { wilson } from '../stats';
import { ROUTE_TEST_VERSION } from './types';

export type RouteOrder = 'mikä-tahansa' | '234' | '432';

export const ROUTE_ORDER_LABELS: Record<RouteOrder, string> = {
  'mikä-tahansa': 'mikä tahansa järjestys: osumien järjestyksellä ei ole väliä',
  '234': '234: n₁ < n₂ < … < n_k (reitin järjestyksessä kasvava n)',
  '432': '432: n₁ > n₂ > … > n_k (reitin järjestyksessä pienenevä n)',
};

export interface RouteWindow {
  span: number;
  /** picks[i] = koodille i valittu osuma (1-pohjainen alkukohta). */
  picks: number[];
}

// ---------------------------------------------------------------- lyhin ikkuna

/** Nouseva, toistoton kopio (tai sama taulukko, jos se on jo sellainen). */
function strictAscending(a: ArrayLike<number>): ArrayLike<number> {
  let ok = true;
  for (let i = 1; i < a.length; i++) {
    if (!(a[i] > a[i - 1])) {
      ok = false;
      break;
    }
  }
  if (ok) return a;
  const s = Float64Array.from(a).sort();
  let w = 0;
  for (let i = 0; i < s.length; i++) if (i === 0 || s[i] !== s[w - 1]) s[w++] = s[i];
  return s.subarray(0, w);
}

/**
 * Mikä tahansa järjestys: pienin ikkuna, joka sisältää jokaisen koodin osuman. Sama osumalista (sama koodi,
 * sama taulukko-olio) useaan kertaan → ikkunassa on oltava yhtä monta ERI osumaa kyseisestä listasta.
 * Yhdistetty lista + liukuva ikkuna, O(M · G). Tasatilanteessa ensimmäinen (pienin alku).
 */
function anyOrderWindow(hits: ArrayLike<number>[]): RouteWindow | null {
  const k = hits.length;
  const sources: ArrayLike<number>[] = [];
  const members: number[][] = [];
  for (let i = 0; i < k; i++) {
    let g = sources.indexOf(hits[i]);
    if (g < 0) {
      g = sources.length;
      sources.push(hits[i]);
      members.push([]);
    }
    members[g].push(i);
  }
  const groups = sources.map(strictAscending);
  const G = groups.length;
  const need = members.map((m) => m.length);
  let M = 0;
  for (let g = 0; g < G; g++) {
    if (groups[g].length < need[g]) return null;
    M += groups[g].length;
  }
  // k-tie-yhdistäminen: pos nousevassa järjestyksessä, tasatilanteessa pienempi ryhmä ensin
  const pos = new Float64Array(M);
  const grp = new Int32Array(M);
  const head = new Int32Array(G);
  for (let t = 0; t < M; t++) {
    let bg = -1;
    let bv = Number.POSITIVE_INFINITY;
    for (let g = 0; g < G; g++) {
      if (head[g] < groups[g].length) {
        const v = groups[g][head[g]];
        if (v < bv) {
          bv = v;
          bg = g;
        }
      }
    }
    pos[t] = bv;
    grp[t] = bg;
    head[bg]++;
  }
  const cnt = new Int32Array(G);
  let sat = 0;
  let best = Number.POSITIVE_INFINITY;
  let bestL = -1;
  let bestR = -1;
  let l = 0;
  for (let r = 0; r < M; r++) {
    const g = grp[r];
    if (++cnt[g] === need[g]) sat++;
    while (sat === G) {
      const span = pos[r] - pos[l];
      if (span < best) {
        best = span;
        bestL = l;
        bestR = r;
      }
      const gl = grp[l];
      if (cnt[gl]-- === need[gl]) sat--;
      l++;
    }
  }
  if (bestL < 0) return null;
  // Mikä tahansa valinta ikkunan sisältä on optimaalinen: otetaan kunkin ryhmän ensimmäiset need[g] osumaa.
  const picks = new Array<number>(k);
  const used = new Int32Array(G);
  for (let t = bestL; t <= bestR; t++) {
    const g = grp[t];
    if (used[g] < need[g]) picks[members[g][used[g]++]] = pos[t];
  }
  return { span: best, picks };
}

/**
 * Tiukasti kasvava järjestys n₁ < n₂ < … < n_k, minimoi n_k − n₁. Dynaaminen ohjelmointi:
 * S_i(h) = suurin mahdollinen n₁ ketjulle, joka päättyy koodin i osumaan h. S_1(h) = h,
 * S_i(h) = max{ S_{i−1}(h′) : h′ < h } (etuliitemaksimi + binäärihaku). O(M log M).
 */
function increasingWindow(lists: ArrayLike<number>[]): RouteWindow | null {
  const k = lists.length;
  const S: Float64Array[] = [Float64Array.from(lists[0])];
  const pred: Int32Array[] = [new Int32Array(lists[0].length).fill(-1)];
  for (let i = 1; i < k; i++) {
    const prev = lists[i - 1];
    const Sp = S[i - 1];
    const pm = new Float64Array(prev.length);
    const pa = new Int32Array(prev.length);
    for (let j = 0; j < prev.length; j++) {
      if (j === 0 || Sp[j] >= pm[j - 1]) {
        pm[j] = Sp[j];
        pa[j] = j;
      } else {
        pm[j] = pm[j - 1];
        pa[j] = pa[j - 1];
      }
    }
    const cur = lists[i];
    const Si = new Float64Array(cur.length);
    const Pi = new Int32Array(cur.length);
    for (let t = 0; t < cur.length; t++) {
      const idx = lowerBound(prev, cur[t]) - 1; // suurin h′ < h
      if (idx < 0) {
        Si[t] = Number.NEGATIVE_INFINITY;
        Pi[t] = -1;
      } else {
        Si[t] = pm[idx];
        Pi[t] = pm[idx] === Number.NEGATIVE_INFINITY ? -1 : pa[idx];
      }
    }
    S.push(Si);
    pred.push(Pi);
  }
  const last = lists[k - 1];
  const SL = S[k - 1];
  let best = Number.POSITIVE_INFINITY;
  let bestT = -1;
  for (let t = 0; t < last.length; t++) {
    if (SL[t] === Number.NEGATIVE_INFINITY) continue;
    const span = last[t] - SL[t];
    if (span < best) {
      best = span;
      bestT = t;
    }
  }
  if (bestT < 0) return null;
  const picks = new Array<number>(k);
  let idx = bestT;
  for (let i = k - 1; i >= 0; i--) {
    picks[i] = lists[i][idx];
    idx = pred[i][idx];
  }
  return { span: best, picks };
}

/**
 * Lyhin ikkuna: valitaan jokaiselle koodille i yksi osuma hits[i]:stä ja minimoidaan max − min.
 *  - 'mikä-tahansa': järjestyksellä ei väliä. Jos SAMA taulukko-olio (sama koodi) esiintyy listassa useasti,
 *    valitaan eri osumat. Eri koodien osumat saavat olla samassa kohdassa.
 *  - '234': n₁ < n₂ < … < n_k (tiukasti, joten samankin koodin osumat ovat eri). '432': n₁ > n₂ > … > n_k.
 * Palauttaa null, jos valinta on mahdoton (tyhjä lista, liian vähän osumia tai järjestys ei toteudu).
 * Syötteen ei tarvitse olla järjestetty; toistot samassa listassa poistetaan.
 */
export function routeWindow(hits: ArrayLike<number>[], order: RouteOrder): RouteWindow | null {
  if (!hits.length || hits.some((l) => l.length === 0)) return null;
  if (order === 'mikä-tahansa') return anyOrderWindow(hits);
  const lists = hits.map(strictAscending);
  if (order === '234') return increasingWindow(lists);
  const w = increasingWindow([...lists].reverse());
  return w ? { span: w.span, picks: w.picks.reverse() } : null;
}

// ---------------------------------------------------------------- testi

export interface RouteTestParams {
  codes: string[];
  hits: number[][];
  lens: number[];
  N: number;
  R: number;
  seed: number;
  order: RouteOrder;
  randomStrings?: number;
}

export interface RouteTestResult {
  version: string;
  params: Omit<RouteTestParams, 'hits'> & { counts: number[] };
  observed: RouteWindow | null;
  nullValues: Float64Array;
  countLE: number;
  pValue: number;
  pLow: number;
  pHigh: number;
  shareGreater: number;
  nullMedian: number;
  nullQ05: number;
  nullQ95: number;
  impossibleNull: number;
  randomStrings: null | { count: number; shareLE: number; values: number[] };
  definition: string;
  durationMs: number;
}

/**
 * Sama otanta kuin stats.ts:ssä (ei viety sieltä): k eri kokonaislukua väliltä [lo, hi]. Satunnaislukuja
 * kulutetaan täsmälleen samoin; Set on korvattu uudelleenkäytettävällä merkintätaulukolla (mark[v] = 1),
 * joka tyhjennetään otoksen jälkeen.
 */
function sampleDistinct(rng: Rng, k: number, lo: number, hi: number, out: number[], mark: Uint8Array): number[] {
  out.length = 0;
  const range = hi - lo + 1;
  if (k > range) throw new Error('Liian monta osumaa välille.');
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
  while (out.length < k) {
    const v = rng.int(lo, hi);
    if (mark[v]) continue;
    mark[v] = 1;
    out.push(v);
  }
  for (let i = 0; i < out.length; i++) mark[out[i]] = 0;
  return out;
}

/** Kvantiili järjestetystä taulukosta; +∞-arvot (mahdoton ikkuna) säilyvät. */
function quantile(sorted: Float64Array, q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo];
  const b = sorted[hi];
  if (a === b || pos === lo) return a;
  if (!Number.isFinite(b)) return Number.POSITIVE_INFINITY;
  return a + (b - a) * (pos - lo);
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : 0);

export function routeTestDefinition(p: Omit<RouteTestParams, 'hits'>, duplicates: string[]): string {
  const codes = p.codes.join(' → ');
  let s =
    `Testisuure: lyhin ikkuna reitille ${codes}. Jokaiselle koodille valitaan yksi osuma ja minimoidaan ` +
    `max(n) − min(n). Järjestys: ${ROUTE_ORDER_LABELS[p.order]}. Kaikki osumat ovat mukana; ankkuria ei käytetä, ` +
    'joten ankkurin jälkikäteisvalinta ei vaikuta testiin. Nollamalli: jokaisen koodin todellinen osumamäärä k_i ' +
    `sijoitetaan tasajakautuneesti ilman toistoja alkukohtiin 1 … N − L_i + 1 (N = ${p.N}), R = ${p.R} kertaa, ` +
    `siemen ${p.seed} (xoshiro128**). p = (1 + #{null ≤ havaittu}) / (R + 1), Wilsonin 95 %:n väli. ` +
    'Nollamallin toistot, joissa ikkuna on mahdoton, lasketaan arvoksi +∞.';
  if (duplicates.length) {
    s +=
      ` Sama koodi useasti (${duplicates.join(', ')}): koodilla on yksi osumajoukko, ja ` +
      (p.order === 'mikä-tahansa' ? 'ikkunaan valitaan eri osumat.' : 'tiukka järjestys valitsee eri osumat.');
  }
  if (p.randomStrings) {
    s += ` Satunnaisjonokontrolli: ${p.randomStrings} siemenellistä 0–9-jonoa (siemenet ${p.seed + 1} …), samat koodit.`;
  }
  s += ' Matala p kertoo vain poikkeamasta tässä nollamallissa, ei tarkoituksellisuudesta.';
  return s;
}

/**
 * Reittitesti. Deterministinen siemenellä (paitsi durationMs). Havaitut osumat annetaan (p.hits), joten
 * testi ei riipu siitä, miten osumat haettiin; satunnaisjonokontrolli hakee samat koodit findAll-haulla.
 */
export async function runRouteTest(p: RouteTestParams, hooks: RunHooks = {}): Promise<RouteTestResult> {
  const t0 = now();
  const k = p.codes.length;
  if (!k) throw new Error('Reitillä ei ole koodeja.');
  if (p.hits.length !== k || p.lens.length !== k) throw new Error('codes, hits ja lens on annettava jokaiselle koodille.');
  if (!Number.isInteger(p.R) || p.R < 1) throw new Error('R:n on oltava positiivinen kokonaisluku.');
  if (!Number.isInteger(p.N) || p.N < 1) throw new Error('N:n on oltava positiivinen kokonaisluku.');

  // Sama koodi → yksi osumajoukko (myös nollamallissa).
  const uniq: string[] = [];
  const uOf: number[] = [];
  const uHits: ArrayLike<number>[] = [];
  const uLen: number[] = [];
  const duplicates: string[] = [];
  for (let i = 0; i < k; i++) {
    let u = uniq.indexOf(p.codes[i]);
    if (u < 0) {
      u = uniq.length;
      uniq.push(p.codes[i]);
      uHits.push(strictAscending(p.hits[i]));
      uLen.push(p.lens[i]);
    } else if (!duplicates.includes(p.codes[i])) duplicates.push(p.codes[i]);
    uOf.push(u);
  }
  const counts = uOf.map((u) => uHits[u].length);
  const observed = routeWindow(
    uOf.map((u) => uHits[u]),
    p.order,
  );
  const obs = observed ? observed.span : Number.POSITIVE_INFINITY;

  const strings = Math.max(0, Math.floor(p.randomStrings ?? 0));
  const total = p.R + strings;
  const every = hooks.yieldEvery ?? 50;
  const rng = createRng(p.seed);
  const nullValues = new Float64Array(p.R);
  const bufs = uniq.map(() => [] as number[]);
  const his = uLen.map((L) => startPositions(p.N, L));
  const mark = new Uint8Array(Math.max(0, ...his) + 1);
  let impossibleNull = 0;
  for (let r = 0; r < p.R; r++) {
    const sampled = uniq.map((_, u) => Float64Array.from(sampleDistinct(rng, uHits[u].length, 1, his[u], bufs[u], mark)).sort());
    const w = routeWindow(
      uOf.map((u) => sampled[u]),
      p.order,
    );
    if (w) nullValues[r] = w.span;
    else {
      nullValues[r] = Number.POSITIVE_INFINITY;
      impossibleNull++;
    }
    if ((r + 1) % every === 0) {
      hooks.onProgress?.(r + 1, total);
      if (hooks.yieldFn) await hooks.yieldFn();
    }
  }
  hooks.onProgress?.(p.R, total);

  let countLE = 0;
  let greater = 0;
  for (let i = 0; i < p.R; i++) {
    if (nullValues[i] <= obs) countLE++;
    else greater++;
  }
  const sorted = Float64Array.from(nullValues).sort();
  const [pLow, pHigh] = wilson(countLE, p.R);

  let randomStrings: RouteTestResult['randomStrings'] = null;
  if (strings > 0) {
    const values: number[] = [];
    for (let s = 0; s < strings; s++) {
      const digits = randomDigits(p.N, (p.seed + 1 + s) >>> 0);
      const found = uniq.map((c) => findAll(c, digits));
      const w = routeWindow(
        uOf.map((u) => found[u]),
        p.order,
      );
      values.push(w ? w.span : Number.POSITIVE_INFINITY);
      hooks.onProgress?.(p.R + s + 1, total);
      if (hooks.yieldFn) await hooks.yieldFn();
    }
    randomStrings = { count: strings, shareLE: values.filter((v) => v <= obs).length / strings, values };
  }

  const { hits: _h, ...rest } = p;
  void _h;
  return {
    version: ROUTE_TEST_VERSION,
    params: { ...rest, codes: [...p.codes], lens: [...p.lens], counts },
    observed,
    nullValues,
    countLE,
    pValue: (countLE + 1) / (p.R + 1),
    pLow,
    pHigh,
    shareGreater: greater / p.R,
    nullMedian: quantile(sorted, 0.5),
    nullQ05: quantile(sorted, 0.05),
    nullQ95: quantile(sorted, 0.95),
    impossibleNull,
    randomStrings,
    definition: routeTestDefinition(rest, duplicates),
    durationMs: Math.round(now() - t0),
  };
}
