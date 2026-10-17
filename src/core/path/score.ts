// Path Score ja satunnaisvertailu (PIATLAS-PATHSCORE-1.0.0). Määrittely: docs/POLKUHAKU.md §6.
//
// Nollamallit ajavat TÄSMÄLLEEN saman searchPaths-haun samalla kyselyllä, samoilla parametreilla ja samalla
// hakutilalla; vain osumalähde vaihtuu:
//  - tasajakauma: jokaisen sanastokoodin todellinen osumamäärä π-aineistossa säilyy, paikat arvotaan
//    tasajakautuneesti alkukohtiin 1 … N − L + 1 (uniformSource). Replikaatti r käyttää siementä seed + r.
//  - satunnaisjono: siemenellinen 0–9-jono, jonka pituus on N (randomStringSource), samat koodit findAll-haulla.
//    Jono s käyttää siementä seed + 10 000 + s. Osumamäärät vaihtelevat kuten satunnaisaineistossa.
// Replikaatin tulos on sen paras reitti. Vertailu (compareCost): (askeleet + muunnokset, muunnokset, Σ|Δn|)
// leksikografisesti, ja reitin puuttuminen on huonoin. countAsGood = replikaatit, joiden paras reitti on yhtä hyvä
// tai parempi kuin havaittu (compareCost ≤ 0). Jos π-aineistosta ei löytynyt reittiä (havaittu = null), jokainen
// replikaatti on "yhtä hyvä tai parempi" (myös ne, joissa reittiä ei löytynyt), joten p = 1; noRoute kertoo
// erikseen, monessako replikaatissa reittiä ei löytynyt. p = (1 + countAsGood) / (R + 1) mallia kohden, ja
// Wilsonin 95 %:n väli osuudelle countAsGood / R (Monte Carlo -epävarmuus, kuten stats.ts ja route-test.ts).
//
// Kaikki on deterministististä siemenen perusteella; vain durationMs mitataan (performance.now).
// Path Score ei ole todennäköisyys sille, että mikään tapahtuu (ks. PATHSCORE_DISCLAIMER).

import { fmtInt } from '../matrix/ops369';
import { findAll } from '../search';
import type { RunHooks } from '../stats';
import { fmtP, wilson } from '../stats';
import type { IdentifierContext } from './identifiers';
import { searchPaths, validatePathParams } from './search';
import { piSource, randomStringSource, uniformSource } from './source';
import type {
  HitSource,
  NullComparison,
  PathCost,
  PathParams,
  PathQuery,
  PathRoute,
  PathScore,
  SearchMode,
  SearchOutcome,
} from './types';
import { PATHSCORE_VERSION } from './types';

export type NullModel = NullComparison['model'];

/** Nollamallien kiinteä järjestys (tulosten järjestys). */
export const NULL_MODELS: readonly NullModel[] = ['tasajakauma', 'satunnaisjono'];

/** Satunnaisjonojen siemenet alkavat kohdasta seed + 10 000, jotta ne eivät osu tasajakauman siemeniin. */
export const RANDOM_STRING_SEED_OFFSET = 10_000;

/** Kokonaispistemäärän painot (docs/POLKUHAKU.md §6). */
export const SCORE_WEIGHTS = { rarity: 0.6, length: 0.15, branching: 0.15, transforms: 0.1 } as const;

export const PATHSCORE_DISCLAIMER =
  'Path Score ei ole todennäköisyys sille, että mikään tapahtuu. Se ei ennusta tulevaisuutta eikä kerro, onko ' +
  'reitin symbolinen tulkinta totta. Se kuvaa vain laskettua π-rakennetta: reitin muotoa ja sitä, kuinka usein yhtä ' +
  'hyvä reitti syntyy satunnaisaineistossa samoilla lukituilla parametreilla. Pelkkä reitin löytyminen ei ole näyttöä; ' +
  'vain sokkotesti voi tukea väitettä, että menetelmä tunnistaa todellisia tapahtumia.';

export const PATHSCORE_DEFINITION =
  `Path Score (${PATHSCORE_VERSION}) kuvaa reitin rakennetta ja harvinaisuutta tässä aineistossa verrattuna ` +
  'satunnaisaineistoon samoilla lukituilla parametreilla (docs/POLKUHAKU.md §6). ' +
  'Harvinaisuus: jokaiselle nollamallille p = (1 + #{replikaatit, joissa paras reitti on yhtä hyvä tai parempi kuin ' +
  'havaittu}) / (R + 1). Reittejä verrataan järjestyksessä (askeleet + muunnokset, muunnokset, Σ|Δn|), ja reitin ' +
  'puuttuminen on huonoin. Nollamallit: tasajakauma (jokaisen koodin osumamäärä säilyy, paikat arvotaan; replikaatti r ' +
  'siemenellä s + r) ja siemenelliset satunnaiset 0–9-jonot (jono j siemenellä s + 10 000 + j). Pistemäärä ' +
  'min(1, −log10 p / log10(R + 1)), jossa p on suurin ajettujen mallien p-arvoista ja R suurin replikaattimäärä, joten ' +
  'harvinaisuus on enintään kunkin mallin oma pistemäärä. Harvinaisuus koskee kyselyn parasta reittiä, koska ' +
  'nollamallit vertaavat parasta reittiä; se on sama kaikille saman haun reittiehdokkaille. Pituus = 1 / askeleet. ' +
  'Haarautuminen = 1 / (1 + log2 b), b = askelten keskimääräinen naapurimäärä (laajennetun solmun ehdokkaat). ' +
  'Muunnokset = 1 / (1 + 369-askeleet). Rakenne: geometristen ja matemaattisten askelten osuudet (kuvaileva, ei ' +
  'pisteytetä). Toistettavuus: sama haku samoilla parametreilla tuottaa saman tulostiivisteen. Kokonaispistemäärä = ' +
  'round(100 · (0,6 · harvinaisuus + 0,15 · pituus + 0,15 · haarautuminen + 0,1 · muunnokset)). Sitä ei anneta ' +
  'ilman satunnaisvertailua eikä, jos toistettavuutta ei ole todettu.';

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : 0);
const fmtPfi = (p: number): string => fmtP(p).replace('.', ',');

// ------------------------------------------------------------------ vertailu

/**
 * Reittien kustannusten vertailu: negatiivinen, jos a on parempi, 0, jos yhtä hyvä, positiivinen, jos huonompi.
 * Järjestys (askeleet + muunnokset, muunnokset, Σ|Δn|) leksikografisesti, sama kuin haun reittijärjestys.
 * null (ei reittiä) on huonoin; kaksi null-arvoa ovat yhtä hyviä.
 */
export function compareCost(a: PathCost | null, b: PathCost | null): number {
  if (a == null || b == null) return a == null && b == null ? 0 : a == null ? 1 : -1;
  const ca = a.edges + a.transforms;
  const cb = b.edges + b.transforms;
  if (ca !== cb) return ca < cb ? -1 : 1;
  if (a.transforms !== b.transforms) return a.transforms < b.transforms ? -1 : 1;
  if (a.span !== b.span) return a.span < b.span ? -1 : 1;
  return 0;
}

/** Haun paras reitti kustannuksena (routes[0]), tai null, jos reittiä ei löytynyt. Havaittu arvo pathNull-ajolle. */
export function bestRouteCost(outcome: SearchOutcome): PathCost | null {
  if (!outcome.routes.length) return null;
  const { edges, transforms, span } = outcome.routes[0].cost;
  return { edges, transforms, span };
}

/** Kustannus selkokielellä, esim. "1 askel, 0 muunnosta, Σ|Δn| = 251" tai "ei reittiä". */
export function fmtCost(c: PathCost | null): string {
  if (c == null) return 'ei reittiä';
  return `${c.edges} ${c.edges === 1 ? 'askel' : 'askelta'}, ${c.transforms} ${c.transforms === 1 ? 'muunnos' : 'muunnosta'}, Σ|Δn| = ${fmtInt(c.span)}`;
}

// ------------------------------------------------------------------ nollamallit

/** Replikaatin siemen: tasajakauma seed + i, satunnaisjono seed + 10 000 + i (32-bittinen, kuten createRng). */
export function replicateSeed(model: NullModel, seed: number, index: number): number {
  return (seed + (model === 'satunnaisjono' ? RANDOM_STRING_SEED_OFFSET : 0) + index) >>> 0;
}

/**
 * Nollamallin osumalähde yhdelle replikaatille. counts = koodien todelliset osumamäärät (tasajakauma säilyttää ne;
 * satunnaisjono ei käytä niitä, koska jonon osumat haetaan jonosta).
 */
export function nullSource(model: NullModel, counts: readonly { code: string; count: number }[], N: number, seed: number): HitSource {
  return model === 'tasajakauma'
    ? uniformSource([...counts], N, seed, `tasajakauma (siemen ${seed})`)
    : randomStringSource(N, seed, `satunnaisjono (siemen ${seed})`);
}

/**
 * Yhden nollamallin yhteenveto replikaattien parhaista reiteistä. countAsGood = #{compareCost(paras, havaittu) ≤ 0},
 * noRoute = #{ei reittiä}, p = (1 + countAsGood) / (R + 1), [pLow, pHigh] = Wilson(countAsGood, R).
 * Havaittu = null → jokainen replikaatti on yhtä hyvä tai parempi, joten p = 1.
 */
export function nullComparison(
  model: NullModel,
  seed: number,
  bests: readonly (PathCost | null)[],
  observed: PathCost | null,
): NullComparison {
  const R = bests.length;
  let countAsGood = 0;
  let noRoute = 0;
  for (const b of bests) {
    if (b == null) noRoute++;
    if (compareCost(b, observed) <= 0) countAsGood++;
  }
  const [pLow, pHigh] = wilson(countAsGood, R);
  return { model, replicates: R, seed, countAsGood, noRoute, pValue: (1 + countAsGood) / (R + 1), pLow, pHigh };
}

/** Yhden replikaatin tulos. */
export interface NullReplicate {
  model: NullModel;
  seed: number;
  status: SearchOutcome['status'];
  /** Replikaatin paras reitti, tai null. */
  best: PathCost | null;
  /** Paras reitti yhtä hyvä tai parempi kuin havaittu (compareCost ≤ 0). */
  asGood: boolean;
}

/** Nollamallien ajo mille tahansa "havaitulle" aineistolle (π tai kalibroinnissa nollareplikaatti). */
export interface NullRunSpec {
  query: PathQuery;
  params: PathParams;
  mode: SearchMode;
  ctx: IdentifierContext | null;
  /** Havaitun aineiston paras reitti (null = ei reittiä). */
  observed: PathCost | null;
  /** Sanaston koodien todelliset osumamäärät havaitussa aineistossa (tasajakauma säilyttää ne). */
  counts: { code: string; count: number }[];
  /** Aineiston pituus. */
  N: number;
  /** Tasajakauman replikaatit R (0 = mallia ei ajeta). */
  replicates: number;
  /** Satunnaisjonot S (0 = mallia ei ajeta). */
  randomStrings: number;
  seed: number;
}

export interface NullRunResult {
  /** Ajetut mallit järjestyksessä tasajakauma, satunnaisjono (malli puuttuu, jos sen määrä on 0). */
  nulls: NullComparison[];
  replicates: NullReplicate[];
}

function checkCounts(replicates: unknown, randomStrings: unknown, seed: unknown): void {
  const errors: string[] = [];
  if (typeof replicates !== 'number' || !Number.isInteger(replicates) || replicates < 0) {
    errors.push(`Tasajakauman replikaattien määrän on oltava kokonaisluku ≥ 0 (nyt ${String(replicates)}).`);
  }
  if (typeof randomStrings !== 'number' || !Number.isInteger(randomStrings) || randomStrings < 0) {
    errors.push(`Satunnaisjonojen määrän on oltava kokonaisluku ≥ 0 (nyt ${String(randomStrings)}).`);
  }
  if (typeof seed !== 'number' || !Number.isInteger(seed)) errors.push(`Siemenen on oltava kokonaisluku (nyt ${String(seed)}).`);
  if (errors.length) throw new Error(`Satunnaisvertailua ei voi ajaa: ${errors.join(' ')}`);
}

function checkSearch(params: PathParams, mode: SearchMode, N: number): void {
  const errors: string[] = [];
  if (mode !== '234' && mode !== '432' && mode !== 'kaksisuuntainen') errors.push(`Tuntematon hakutila "${String(mode)}".`);
  errors.push(...validatePathParams(params));
  if (!(N >= 1)) errors.push('Aineisto on tyhjä (N = 0): lataa piin desimaalit ennen satunnaisvertailua.');
  if (errors.length) throw new Error(`Satunnaisvertailua ei voi ajaa: ${errors.join(' ')}`);
}

/** Ajaa replikaatit järjestyksessä: tasajakauma 0 … R − 1, sitten satunnaisjonot 0 … S − 1. */
async function runReplicates(spec: NullRunSpec, tick: () => Promise<void>): Promise<NullReplicate[]> {
  const out: NullReplicate[] = [];
  const plan: [NullModel, number][] = [
    ['tasajakauma', spec.replicates],
    ['satunnaisjono', spec.randomStrings],
  ];
  for (const [model, count] of plan) {
    for (let i = 0; i < count; i++) {
      const seed = replicateSeed(model, spec.seed, i);
      const o = searchPaths(spec.query, spec.params, spec.mode, nullSource(model, spec.counts, spec.N, seed), spec.ctx);
      const best = bestRouteCost(o);
      out.push({ model, seed, status: o.status, best, asGood: compareCost(best, spec.observed) <= 0 });
      await tick();
    }
  }
  return out;
}

function summarize(spec: Pick<NullRunSpec, 'seed' | 'observed'>, reps: readonly NullReplicate[]): NullComparison[] {
  const out: NullComparison[] = [];
  for (const model of NULL_MODELS) {
    const rs = reps.filter((r) => r.model === model);
    if (rs.length) out.push(nullComparison(model, replicateSeed(model, spec.seed, 0), rs.map((r) => r.best), spec.observed));
  }
  return out;
}

/** Edistyminen ja välitauko: jokainen replikaatti on kokonainen haku, joten välitauko annetaan joka replikaatin jälkeen. */
function ticker(hooks: RunHooks, total: number): () => Promise<void> {
  let done = 0;
  return async () => {
    hooks.onProgress?.(++done, total);
    if (hooks.yieldFn) await hooks.yieldFn();
  };
}

/**
 * Nollamallit annetulle havainnolle ja osumamäärille. Ei tarvitse π-aineistoa: kalibroinnissa "havaittu" voi olla
 * itse nollareplikaatti. Deterministinen siemenellä.
 */
export async function runNullModels(spec: NullRunSpec, hooks: RunHooks = {}): Promise<NullRunResult> {
  checkCounts(spec.replicates, spec.randomStrings, spec.seed);
  checkSearch(spec.params, spec.mode, spec.N);
  const reps = await runReplicates(spec, ticker(hooks, spec.replicates + spec.randomStrings));
  return { nulls: summarize(spec, reps), replicates: reps };
}

// ------------------------------------------------------------------ π-aineiston satunnaisvertailu

/** pathNull-pyynnön syöte. */
export interface PathNullArgs {
  query: PathQuery;
  params: PathParams;
  mode: SearchMode;
  ctx: IdentifierContext | null;
  /** π-haun paras reitti (bestRouteCost), null = reittiä ei löytynyt. */
  observed: PathCost | null;
  /** Tasajakauman replikaatit R. */
  replicates: number;
  /** Satunnaisjonot S. */
  randomStrings: number;
  seed: number;
  /**
   * Valinnainen: havaitun haun SearchOutcome.resultFingerprint. Jos annettu, toistettavuus vaatii, että uusi π-haku
   * tuottaa saman tulostiivisteen.
   */
  observedFingerprint?: string | null;
}

export interface PathNullResult {
  nulls: NullComparison[];
  /** π-haku toistui: sama tulostiiviste kahdesti, ja havaittu kustannus (ja annettu tiiviste) täsmäsi. */
  reproducible: boolean;
  durationMs: number;
  /** Replikaattikohtaiset tulokset (siemen, tila, paras reitti). */
  replicates: NullReplicate[];
  /** π-haun tulostiiviste. */
  fingerprint: string;
  /** Selitykset suomeksi: toistettavuus ja nollamallien siemenet. */
  notes: string[];
}

/** π-lähde ilman codeHits-välimuistia (findAll suoraan): toistettavuuden toinen, erillinen instanssi. */
function separatePiSource(digits: string, label: string): HitSource {
  const memo = new Map<string, Int32Array>();
  const empty = new Int32Array(0);
  return {
    kind: 'pii',
    N: digits.length,
    hitsOf: (code: string) => {
      let h = memo.get(code);
      if (!h) {
        h = /^\d+$/.test(code) ? Int32Array.from(findAll(code, digits)) : empty;
        memo.set(code, h);
      }
      return h;
    },
    digits,
    label,
  };
}

const seedRange = (model: NullModel, seed: number, count: number): string =>
  count === 1 ? `${replicateSeed(model, seed, 0)}` : `${replicateSeed(model, seed, 0)} … ${replicateSeed(model, seed, count - 1)}`;

/**
 * Satunnaisvertailu π-aineistolle (docs/POLKUHAKU.md §6):
 *  1. Toistettavuus: sama π-haku ajetaan kahdesti, ensin codeHits-välimuistin kautta (piSource) ja sitten erillisellä
 *     findAll-instanssilla. Toistuu, jos tulostiivisteet ovat samat, havaittu kustannus (args.observed) on sama kuin
 *     uuden haun paras reitti ja annettu observedFingerprint (jos on) täsmää.
 *  2. Nollamallit: R tasajakaumareplikaattia (π-aineiston todelliset osumamäärät koodeittain, siemen seed + r) ja
 *     S satunnaisjonoa (siemen seed + 10 000 + s), sama searchPaths samoilla parametreilla ja hakutilalla.
 *     Vertailukohta on args.observed.
 * Edistyminen: hooks.onProgress(tehty, 2 + R + S). Virheelliset syötteet → poikkeus suomeksi.
 */
export async function runPathNull(args: PathNullArgs, digitsForRepro: string, hooks: RunHooks = {}): Promise<PathNullResult> {
  const t0 = now();
  checkCounts(args.replicates, args.randomStrings, args.seed);
  const digits = digitsForRepro ?? '';
  checkSearch(args.params, args.mode, digits.length);
  const observed = args.observed ?? null;
  const tick = ticker(hooks, 2 + args.replicates + args.randomStrings);
  const notes: string[] = [];

  // 1. π-haku kahdesti
  const label = `π-desimaalit (N = ${fmtInt(digits.length)})`;
  const first = searchPaths(args.query, args.params, args.mode, piSource(digits, label), args.ctx);
  if (first.status === 'virhe') throw new Error(`Satunnaisvertailua ei voi ajaa: ${first.reasons.join(' ')}`);
  await tick();
  const second = searchPaths(args.query, args.params, args.mode, separatePiSource(digits, label), args.ctx);
  await tick();
  const fp = first.resultFingerprint;
  const piBest = bestRouteCost(first);
  const sameRuns = second.resultFingerprint === fp;
  const sameObserved = compareCost(observed, piBest) === 0;
  const sameGiven = args.observedFingerprint == null || args.observedFingerprint === fp;
  const reproducible = sameRuns && sameObserved && sameGiven;
  notes.push(
    sameRuns
      ? `Toistettavuus: π-haku ajettiin kahdesti (codeHits-välimuisti ja erillinen findAll-instanssi), tulostiiviste ${fp} molemmilla.`
      : `Toistettavuus epäonnistui: π-haun tulostiivisteet erosivat (${fp} ≠ ${second.resultFingerprint}).`,
  );
  if (!sameObserved) {
    notes.push(
      `Toistettavuus epäonnistui: annettu havaittu tulos (${fmtCost(observed)}) ei vastaa π-haun parasta reittiä ` +
        `(${fmtCost(piBest)}) samoilla parametreilla. Nollamallit verrataan annettuun havaittuun tulokseen.`,
    );
  }
  if (!sameGiven) {
    notes.push(`Toistettavuus epäonnistui: annettu tulostiiviste ${args.observedFingerprint} ei vastaa π-haun tulostiivistettä ${fp}.`);
  }

  // 2. Nollamallit π-aineiston osumamäärillä
  const counts = first.vocabulary.map((v) => ({ code: v.code, count: v.hits }));
  const spec: NullRunSpec = { ...args, observed, counts, N: digits.length };
  if (args.replicates > 0) {
    notes.push(
      `Tasajakauma: R = ${args.replicates}, siemenet ${seedRange('tasajakauma', args.seed, args.replicates)}; ` +
        `osumamäärät säilyvät (${counts.map((c) => `${c.code}: ${fmtInt(c.count)}`).join(', ') || '–'}).`,
    );
  }
  if (args.randomStrings > 0) {
    notes.push(
      `Satunnaisjono: S = ${args.randomStrings}, siemenet ${seedRange('satunnaisjono', args.seed, args.randomStrings)}, ` +
        `pituus N = ${fmtInt(digits.length)}.`,
    );
  }
  if (observed == null) {
    notes.push('π-aineistosta ei löytynyt reittiä: jokainen replikaatti on yhtä hyvä tai parempi, joten p = 1.');
  }
  const reps = await runReplicates(spec, tick);
  return {
    nulls: summarize(spec, reps),
    reproducible,
    durationMs: Math.round(now() - t0),
    replicates: reps,
    fingerprint: fp,
    notes,
  };
}

// ------------------------------------------------------------------ Path Score

/**
 * Harvinaisuuden pistemäärä min(1, −log10 p / log10(R + 1)) väliltä [0, 1]. null, jos R < 1 tai p ei ole
 * välillä (0, 1].
 */
export function rarityScore(p: number, R: number): number | null {
  if (!(R >= 1) || !(p > 0) || !(p <= 1)) return null;
  return Math.min(1, Math.max(0, -Math.log10(p) / Math.log10(R + 1)));
}

function scoreDetails(run: readonly NullComparison[], pMax: number, rMax: number, reproducible: boolean | null): string {
  const parts: string[] = [];
  if (run.length) {
    const models = run.map((n) => `${n.model} R = ${fmtInt(n.replicates)}, p = ${fmtPfi(n.pValue)}`).join('; ');
    parts.push(`Tässä: ${models} → p = ${fmtPfi(pMax)}, R = ${fmtInt(rMax)}.`);
  } else {
    parts.push('Satunnaisvertailua ei ole ajettu: harvinaisuutta ja kokonaispistemäärää ei anneta.');
  }
  if (reproducible === false) parts.push('Toistettavuus epäonnistui: kokonaispistemäärää ei anneta.');
  else if (reproducible == null) parts.push('Toistettavuutta ei ole tarkistettu: kokonaispistemäärää ei anneta.');
  return parts.join(' ');
}

/**
 * Path Score yhdelle reitille (docs/POLKUHAKU.md §6). Harvinaisuus lasketaan nollamalleista (ajetut mallit =
 * replicates ≥ 1): p = suurin mallien p-arvoista ja R = suurin replikaattimäärä, joten tulos on varovainen
 * (enintään kunkin mallin oma pistemäärä). Pituus 1 / askeleet, haarautuminen 1 / (1 + log2 b) (b = askelten
 * keskimääräinen naapurimäärä), muunnokset 1 / (1 + 369-askeleet), rakenne = geometristen ja matemaattisten
 * askelten osuudet (ei pisteytetä). route = null (ei reittiä) → reittikohtaiset osat 0.
 * Kokonaispistemäärä annetaan vain, kun vähintään yksi nollamalli on ajettu ja reproducible === true.
 */
export function pathScore(route: PathRoute | null, nulls: readonly NullComparison[], reproducible: boolean | null): PathScore {
  const run = nulls.filter((n) => n.replicates >= 1);
  let rarity: number | null = null;
  let pMax = Number.NaN;
  let rMax = 0;
  if (run.length) {
    pMax = Math.max(...run.map((n) => n.pValue));
    rMax = Math.max(...run.map((n) => n.replicates));
    rarity = rarityScore(pMax, rMax);
  }
  const steps = route?.steps ?? [];
  const k = steps.length;
  let length = 0;
  let branching = 0;
  let transforms = 0;
  let structure = { geometric: 0, numeric: 0 };
  if (k) {
    length = 1 / k;
    let b = 0;
    for (const s of steps) b += s.branching;
    branching = 1 / (1 + Math.log2(Math.max(1, b / k)));
    transforms = 1 / (1 + steps.filter((s) => s.transform).length);
    structure = {
      geometric: steps.filter((s) => s.layer === 'geometrinen').length / k,
      numeric: steps.filter((s) => s.layer === 'matemaattinen').length / k,
    };
  }
  const W = SCORE_WEIGHTS;
  const total =
    rarity != null && reproducible === true
      ? Math.round(100 * (W.rarity * rarity + W.length * length + W.branching * branching + W.transforms * transforms))
      : null;
  return {
    version: PATHSCORE_VERSION,
    total,
    rarity,
    length,
    branching,
    transforms,
    structure,
    reproducible,
    nulls: nulls.map((n) => ({ ...n })),
    definition: `${PATHSCORE_DEFINITION} ${scoreDetails(run, pMax, rMax, reproducible)}`,
    disclaimer: PATHSCORE_DISCLAIMER,
  };
}

/**
 * Path Score jokaiselle haun reitille (outcome.routes-järjestyksessä). Harvinaisuus koskee kyselyn parasta reittiä
 * (nollamallit vertaavat parasta reittiä), joten se on sama kaikille reiteille; pituus, haarautuminen, muunnokset ja
 * rakenne lasketaan reittikohtaisesti. Ei reittejä → tyhjä lista.
 */
export function scoreRoutes(outcome: SearchOutcome, nulls: readonly NullComparison[], reproducible: boolean | null): PathScore[] {
  return outcome.routes.map((r) => pathScore(r, nulls, reproducible));
}
