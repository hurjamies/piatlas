// Tilastollinen kontrolli: Monte Carlo -nollamalli, satunnaisaineistokontrolli ja monivertailu.
// Kaikki satunnaisuus tulee näkyvästä siemenestä → sama siemen antaa saman tuloksen.

import { coordsFor, Metric, nearestDistances, pointDistance } from './geometry-index';
import { createRng, randomDigits, Rng } from './random';
import { expectedCount, findAll, startPositions } from './search';
import { STATS_VERSION } from './version';

export type Statistic = 'anchorNearest' | 'setMin' | 'meanNearest';

export const STATISTIC_LABELS: Record<Statistic, string> = {
  anchorNearest: 'S1 · Ankkurin lähin B-osuma',
  setMin: 'S2 · Lähin A–B-pari (valintakorjattu)',
  meanNearest: 'S3 · B-osumien keskimääräinen etäisyys lähimpään A:han',
};

export const STATISTIC_HELP: Record<Statistic, string> = {
  anchorNearest:
    'Etäisyys lukitusta ankkurista lähimpään B-osumaan. Ankkuri pysyy paikallaan, B:n osumat arvotaan uudelleen. Ehdollinen ankkurin valinnalle: jos ankkuri valittiin, koska B oli lähellä, tulos on vinoutunut.',
  setMin:
    'Pienin etäisyys minkä tahansa A-osuman ja B-osuman välillä. Molempien joukkojen osumat arvotaan uudelleen samoilla osumamäärillä. Korjaa sen, että ankkuri valittiin jälkikäteen kaikkien A-osumien joukosta.',
  meanNearest:
    'Kunkin B-osuman etäisyys lähimpään A-osumaan, keskiarvona. Kertoo, ovatko B:t yleisesti lähellä A:ita, eikä vain yksi pari.',
};

export interface MCParams {
  metric: Metric;
  statistic: Statistic;
  /** Termin A todelliset osumat (alkukohdat, 1-pohjaiset). */
  hitsA: number[];
  lenA: number;
  hitsB: number[];
  lenB: number;
  /** A ja B ovat sama hakutermi (esim. IDA–IDA). */
  sameTerm: boolean;
  anchorN: number | null;
  /** Aineiston pituus. */
  N: number;
  R: number;
  seed: number;
  alpha: number;
}

export interface MCResult {
  version: string;
  params: Omit<MCParams, 'hitsA' | 'hitsB'> & { kA: number; kB: number };
  observed: number;
  nullValues: Float64Array;
  /** Nollamallien määrä, joissa etäisyys ≤ havaittu. */
  countLE: number;
  pValue: number;
  /** 95 %:n Wilson-väli osuudelle countLE / R (Monte Carlo -epävarmuus). */
  pLow: number;
  pHigh: number;
  /** Osuus nollamalleista, joissa etäisyys on suurempi kuin havaittu (”lähempänä kuin X % nollamalleista”). */
  shareGreater: number;
  nullMean: number;
  nullMedian: number;
  nullQ05: number;
  nullQ95: number;
  expectedA: number;
  expectedB: number;
  durationMs: number;
}

export interface RunHooks {
  onProgress?: (done: number, total: number) => void;
  /** Kutsutaan joka `yieldEvery` kierroksen välein; inline-tilassa antaa käyttöliittymän hengittää. */
  yieldFn?: () => Promise<void> | void;
  yieldEvery?: number;
}

function sampleDistinct(rng: Rng, k: number, lo: number, hi: number, out: number[]): number[] {
  out.length = 0;
  const range = hi - lo + 1;
  if (k > range) throw new Error('Liian monta osumaa välille.');
  if (k * 4 > range) {
    // tiheä otos: osittainen Fisher–Yates (harvinainen tässä sovelluksessa)
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

/** Testisuure annetuille osumajoukoille. */
export function statisticValue(
  statistic: Statistic,
  metric: Metric,
  A: ArrayLike<number>,
  B: ArrayLike<number>,
  sameTerm: boolean,
  anchorN: number | null,
  N: number,
): number {
  if (statistic === 'anchorNearest') {
    if (anchorN == null) throw new Error('S1 vaatii ankkurin.');
    const ca = coordsFor([anchorN], metric);
    const cb = coordsFor(B, metric);
    let best = Number.POSITIVE_INFINITY;
    for (let j = 0; j < B.length; j++) {
      if (B[j] === anchorN) continue; // ankkuri ei ole oma naapurinsa
      const d = pointDistance(metric, ca, 0, cb, j);
      if (d < best) best = d;
    }
    return best;
  }
  const nd = nearestDistances(metric, A, sameTerm ? A : B, sameTerm, N);
  if (statistic === 'setMin') {
    let m = Number.POSITIVE_INFINITY;
    for (let i = 0; i < nd.length; i++) if (nd[i] < m) m = nd[i];
    return m;
  }
  let s = 0;
  for (let i = 0; i < nd.length; i++) s += nd[i];
  return nd.length ? s / nd.length : Number.POSITIVE_INFINITY;
}

export function wilson(x: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const p = x / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const r = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - r) / d), Math.min(1, (c + r) / d)];
}

function quantile(sorted: Float64Array, q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Monte Carlo: verrataan havaittua testisuuretta nollamalliin, jossa samat osumamäärät (kA, kB)
 * sijoitetaan tasajakautuneesti satunnaisiin alkukohtiin 1…N−L+1. Kartoitus (1D/2D/3D) on sama kuin
 * todellisilla osumilla, joten kartoituksen omat epätasaisuudet ovat mukana myös nollamallissa.
 */
export async function runMonteCarlo(p: MCParams, hooks: RunHooks = {}): Promise<MCResult> {
  const t0 = Date.now();
  const kA = p.hitsA.length;
  const kB = p.hitsB.length;
  if (p.statistic === 'anchorNearest' && p.anchorN == null) throw new Error('S1 vaatii ankkurin.');
  if (!kB || (!kA && p.statistic !== 'anchorNearest')) throw new Error('Testi vaatii osumia molemmille termeille.');
  if (p.sameTerm && p.statistic !== 'anchorNearest' && kA < 2) throw new Error('Saman termin testi vaatii vähintään 2 osumaa.');
  const observed = statisticValue(p.statistic, p.metric, p.hitsA, p.hitsB, p.sameTerm, p.anchorN, p.N);

  const rng = createRng(p.seed);
  const hiA = startPositions(p.N, p.lenA);
  const hiB = startPositions(p.N, p.lenB);
  const nullValues = new Float64Array(p.R);
  const bufA: number[] = [];
  const bufB: number[] = [];
  const every = hooks.yieldEvery ?? 50;
  // S1: ankkuri pysyy, B:stä arvotaan yhtä monta MUUTA osumaa kuin todellisuudessa.
  const kBnull = p.statistic === 'anchorNearest' && p.hitsB.includes(p.anchorN!) ? kB - 1 : kB;
  for (let r = 0; r < p.R; r++) {
    let v: number;
    if (p.statistic === 'anchorNearest') {
      sampleDistinct(rng, kBnull, 1, hiB, bufB);
      v = statisticValue('anchorNearest', p.metric, [], bufB, false, p.anchorN, p.N);
    } else if (p.sameTerm) {
      sampleDistinct(rng, kA, 1, hiA, bufA);
      v = statisticValue(p.statistic, p.metric, bufA, bufA, true, null, p.N);
    } else {
      sampleDistinct(rng, kA, 1, hiA, bufA);
      sampleDistinct(rng, kB, 1, hiB, bufB);
      v = statisticValue(p.statistic, p.metric, bufA, bufB, false, null, p.N);
    }
    nullValues[r] = v;
    if ((r + 1) % every === 0) {
      hooks.onProgress?.(r + 1, p.R);
      if (hooks.yieldFn) await hooks.yieldFn();
    }
  }
  hooks.onProgress?.(p.R, p.R);
  let countLE = 0;
  let greater = 0;
  let sum = 0;
  for (let i = 0; i < p.R; i++) {
    if (nullValues[i] <= observed) countLE++;
    if (nullValues[i] > observed) greater++;
    sum += nullValues[i];
  }
  const sorted = Float64Array.from(nullValues).sort();
  const [pLow, pHigh] = wilson(countLE, p.R);
  const { hitsA: _a, hitsB: _b, ...rest } = p;
  void _a;
  void _b;
  return {
    version: STATS_VERSION,
    params: { ...rest, kA, kB },
    observed,
    nullValues,
    countLE,
    pValue: (countLE + 1) / (p.R + 1),
    pLow,
    pHigh,
    shareGreater: greater / p.R,
    nullMean: sum / p.R,
    nullMedian: quantile(sorted, 0.5),
    nullQ05: quantile(sorted, 0.05),
    nullQ95: quantile(sorted, 0.95),
    expectedA: expectedCount(p.N, p.lenA),
    expectedB: expectedCount(p.N, p.lenB),
    durationMs: Date.now() - t0,
  };
}

// ---------------------------------------------------------------- satunnaisaineistokontrolli

export interface RandomControlParams {
  codeA: string;
  codeB: string;
  metric: Metric;
  statistic: Exclude<Statistic, 'anchorNearest'>;
  N: number;
  strings: number;
  seed: number;
}

export interface RandomControlRow {
  seed: number;
  countA: number;
  countB: number;
  value: number;
}

export interface RandomControlResult {
  version: string;
  params: RandomControlParams;
  rows: RandomControlRow[];
  pi: { countA: number; countB: number; value: number };
  /** Osuus satunnaisjonoista, joissa testisuure ≤ piin arvo. */
  shareLE: number;
  meanCountA: number;
  meanCountB: number;
  expectedA: number;
  expectedB: number;
  durationMs: number;
}

/**
 * Lisäkontrolli: luodaan siemenellisiä satunnaisia 0–9-jonoja, joiden pituus on sama kuin aineiston,
 * ja haetaan niistä täsmälleen samat koodit. Verrataan osumamääriä ja samaa testisuuretta.
 */
export async function runRandomControl(
  p: RandomControlParams,
  piDigits: string,
  hooks: RunHooks = {},
): Promise<RandomControlResult> {
  const t0 = Date.now();
  const same = p.codeA === p.codeB;
  const piA = findAll(p.codeA, piDigits);
  const piB = same ? piA : findAll(p.codeB, piDigits);
  const piValue = statisticValue(p.statistic, p.metric, piA, piB, same, null, p.N);
  const rows: RandomControlRow[] = [];
  const base = createRng(p.seed);
  for (let s = 0; s < p.strings; s++) {
    const seed = base.nextU32();
    const digits = randomDigits(p.N, seed);
    const A = findAll(p.codeA, digits);
    const B = same ? A : findAll(p.codeB, digits);
    let value = Number.POSITIVE_INFINITY;
    if (A.length && B.length && (!same || A.length > 1)) value = statisticValue(p.statistic, p.metric, A, B, same, null, p.N);
    rows.push({ seed, countA: A.length, countB: B.length, value });
    hooks.onProgress?.(s + 1, p.strings);
    if (hooks.yieldFn) await hooks.yieldFn();
  }
  const le = rows.filter((r) => r.value <= piValue).length;
  return {
    version: STATS_VERSION,
    params: p,
    rows,
    pi: { countA: piA.length, countB: piB.length, value: piValue },
    shareLE: rows.length ? le / rows.length : NaN,
    meanCountA: rows.reduce((a, r) => a + r.countA, 0) / Math.max(1, rows.length),
    meanCountB: rows.reduce((a, r) => a + r.countB, 0) / Math.max(1, rows.length),
    expectedA: expectedCount(p.N, p.codeA.length),
    expectedB: expectedCount(p.N, p.codeB.length),
    durationMs: Date.now() - t0,
  };
}

// ---------------------------------------------------------------- tulkinta ja monivertailu

export type Verdict = 'ei-poikkeamaa' | 'eksploratiivinen' | 'lukittu-alle-alfa';

export interface VerdictInfo {
  verdict: Verdict;
  title: string;
  text: string;
}

/**
 * Luokittelu. Sanaa "merkityksellinen" ei käytetä koskaan: matala p kertoo vain poikkeamasta
 * valitussa nollamallissa, ei suunnitelmallisuudesta. Vahvistavaksi voi tulla vain ennalta lukittu testi.
 */
export function classify(pValue: number, alpha: number, preregistered: boolean): VerdictInfo {
  if (!(pValue <= alpha)) {
    return {
      verdict: 'ei-poikkeamaa',
      title: 'Ei poikkeamaa',
      text: `p = ${fmtP(pValue)} > α = ${alpha}. Havaittu läheisyys on tavallinen satunnaisesti sijoitettujen osumien joukossa.`,
    };
  }
  if (!preregistered) {
    return {
      verdict: 'eksploratiivinen',
      title: 'Eksploratiivinen havainto',
      text: `p = ${fmtP(pValue)} ≤ α = ${alpha}, mutta hypoteesia ei lukittu ennen ajoa. Tulos on vihje jatkotutkimukselle, ei vahvistus.`,
    };
  }
  return {
    verdict: 'lukittu-alle-alfa',
    title: 'Ennalta lukittu: p ≤ α',
    text: `p = ${fmtP(pValue)} ≤ α = ${alpha} tässä nollamallissa ja kartoituksessa. Tämä ei todista tarkoituksellista viestiä; tarkista monivertailukorjaus.`,
  };
}

export function fmtP(p: number): string {
  if (!Number.isFinite(p)) return '–';
  if (p < 0.001) return p.toExponential(1);
  return p.toFixed(p < 0.01 ? 4 : 3);
}

/** Benjamini–Hochberg q-arvot (FDR). Palauttaa samassa järjestyksessä kuin syöte. */
export function benjaminiHochberg(ps: number[]): number[] {
  const m = ps.length;
  const order = ps.map((p, i) => [p, i] as const).sort((a, b) => a[0] - b[0]);
  const q = new Array<number>(m);
  let prev = 1;
  for (let r = m - 1; r >= 0; r--) {
    const [p, i] = order[r];
    const v = Math.min(prev, (p * m) / (r + 1));
    q[i] = Math.min(1, v);
    prev = v;
  }
  return q;
}

export function bonferroni(ps: number[]): number[] {
  return ps.map((p) => Math.min(1, p * ps.length));
}

/** Histogrammi kontrollijakaumalle. */
export function histogram(values: ArrayLike<number>, bins: number, min?: number, max?: number) {
  let lo = min ?? Number.POSITIVE_INFINITY;
  let hi = max ?? Number.NEGATIVE_INFINITY;
  if (min == null || max == null) {
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (!Number.isFinite(v)) continue;
      if (min == null && v < lo) lo = v;
      if (max == null && v > hi) hi = v;
    }
  }
  if (!(hi > lo)) hi = lo + 1;
  const counts = new Array<number>(bins).fill(0);
  const w = (hi - lo) / bins;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    let b = Math.floor((v - lo) / w);
    if (b >= bins) b = bins - 1;
    if (b < 0) b = 0;
    counts[b]++;
  }
  return { lo, hi, w, counts };
}

