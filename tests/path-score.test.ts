import { describe, expect, it } from 'vitest';
import { codeHits, verifyHit } from '../src/core/matrix/hits';
import { createSeedStory } from '../src/core/matrix/seed';
import type { StoryModel } from '../src/core/matrix/types';
import { randomDigits } from '../src/core/random';
import { wilson } from '../src/core/stats';
import type { IdentifierContext } from '../src/core/path/identifiers';
import { PATH_RULES } from '../src/core/path/rules';
import {
  bestRouteCost,
  compareCost,
  fmtCost,
  NULL_MODELS,
  nullComparison,
  nullSource,
  PATHSCORE_DEFINITION,
  PATHSCORE_DISCLAIMER,
  pathScore,
  PathNullArgs,
  PathNullResult,
  RANDOM_STRING_SEED_OFFSET,
  rarityScore,
  replicateSeed,
  runNullModels,
  runPathNull,
  SCORE_WEIGHTS,
  scoreRoutes,
} from '../src/core/path/score';
import { searchPaths } from '../src/core/path/search';
import { piSource, uniformSource } from '../src/core/path/source';
import {
  DEFAULT_PATH_PARAMS,
  IdentifierRole,
  NullComparison,
  PATHSCORE_VERSION,
  PathCost,
  PathIdentifier,
  PathParams,
  PathQuery,
  PathRoute,
  PathStep,
  SearchMode,
  SearchOutcome,
} from '../src/core/path/types';
import { handleRequest } from '../src/engine/handlers';
import { FIXTURE_DIGITS, FULL, HAS_FULL } from './helpers';

// ------------------------------------------------------------------ apuvälineet

/** Synteettinen aineisto: nollia, joihin koodit istutetaan 1-pohjaisiin kohtiin. */
function plant(N: number, items: [number, string][]): string {
  const a = new Array<string>(N).fill('0');
  for (const [n, code] of items) for (let i = 0; i < code.length; i++) a[n - 1 + i] = code[i];
  return a.join('');
}

/** Kapea sitova väli (U+202F), jota fmtInt käyttää tuhaterottimena. */
const T = '\u202f';

const P = (over: Partial<PathParams> = {}): PathParams => ({ ...DEFAULT_PATH_PARAMS, ...over });

function num(role: IdentifierRole, value: string, label = value): PathIdentifier {
  return { id: `${role}:${value}`, role, kind: 'numerojono', label, value, origin: 'käyttäjä' };
}

function name(role: IdentifierRole, n: string): PathIdentifier {
  return { id: `${role}:${n}`, role, kind: 'nimi', label: n, value: n, origin: 'käyttäjä' };
}

function query(ids: PathIdentifier[]): PathQuery {
  return { startText: '', goalText: '', identifiers: ids, timeRange: null };
}

const EMPTY_STORY: StoryModel = { version: 1, seedVersion: 'testi', identifiers: [], persons: [], relations: [], glosses: [], paths: [] };
const CTX: IdentifierContext = { story: EMPTY_STORY, events: [] };

const cost = (edges: number, transforms: number, span: number): PathCost => ({ edges, transforms, span });

/** Tulos ilman aikaa (durationMs). */
const stable = (r: PathNullResult): Omit<PathNullResult, 'durationMs'> => {
  const { durationMs: _ms, ...rest } = r;
  void _ms;
  return rest;
};

/** Askel Path Scoren laskentaan: kerros, haarautuminen ja muunnos ratkaisevat. */
function step(layer: 'geometrinen' | 'matemaattinen', branching: number, transform: boolean, i: number): PathStep {
  const rule = transform ? (layer === 'geometrinen' ? '369-fib3k' : '369-siirtymä') : layer === 'geometrinen' ? 'fib-naapuri' : 'indeksi-seuraava';
  const node = (n: number) => ({ code: '432', n, labels: ['IDA'], roles: ['tunnettu' as const] });
  return {
    from: node(100 + i),
    to: node(101 + i),
    rule,
    side: '234',
    layer,
    domain: PATH_RULES[rule].domain,
    formula: '',
    delta: 1,
    metrics: { 'Δn': 1 },
    branching,
    transform,
    verified: null,
    digitsFrom: null,
    digitsTo: null,
  };
}

function route(steps: PathStep[]): PathRoute {
  return {
    key: steps.map((s) => `${s.from.code}@${s.from.n}`).join('>'),
    nodes: [steps[0].from, ...steps.map((s) => s.to)],
    steps,
    cost: { edges: steps.length, transforms: steps.filter((s) => s.transform).length, span: steps.length },
    meetIndex: null,
  };
}

/** R replikaattia, joista x on yhtä hyviä tai parempia kuin havaittu {1, 0, 100}. */
function nullsWith(model: NullComparison['model'], R: number, x: number, seed = 1): NullComparison {
  const bests = Array.from({ length: R }, (_, i) => (i < x ? cost(1, 0, 50) : cost(1, 0, 150)));
  return nullComparison(model, seed, bests, cost(1, 0, 100));
}

// Satunnaisjonoaineisto "π:n" sijaan: luonnolliset osumat, IDA = 432, MAX = 629, MINI = 6464.
const DATA = randomDigits(50_000, 4242);
const DATA_Q = query([num('lähtö', '432', 'IDA'), num('tavoite', '629', 'MAX'), num('tunnettu', '6464', 'MINI')]);

function args(over: Partial<PathNullArgs> = {}, digits = DATA, q = DATA_Q, params = P(), mode: SearchMode = 'kaksisuuntainen'): PathNullArgs {
  const o = searchPaths(q, params, mode, piSource(digits, 'testi'), CTX);
  return {
    query: q,
    params,
    mode,
    ctx: CTX,
    observed: bestRouteCost(o),
    replicates: 12,
    randomStrings: 3,
    seed: 777,
    observedFingerprint: o.resultFingerprint,
    ...over,
  };
}

// ------------------------------------------------------------------ vertailu

describe('compareCost ja bestRouteCost', () => {
  it('järjestys: (askeleet + muunnokset, muunnokset, Σ|Δn|), ei reittiä huonoin', () => {
    const costs: (PathCost | null)[] = [null, cost(2, 0, 10), cost(1, 1, 5), cost(1, 0, 900), cost(1, 0, 3), cost(3, 0, 1), null, cost(1, 0, 3)];
    const sorted = [...costs].sort(compareCost);
    expect(sorted).toEqual([cost(1, 0, 3), cost(1, 0, 3), cost(1, 0, 900), cost(2, 0, 10), cost(1, 1, 5), cost(3, 0, 1), null, null]);
    // tasatilanne hinnassa 2: vähemmän muunnoksia ensin, vaikka Σ|Δn| olisi suurempi
    expect(compareCost(cost(2, 0, 100), cost(1, 1, 5))).toBeLessThan(0);
    expect(compareCost(cost(1, 0, 5), cost(1, 0, 5))).toBe(0);
    expect(compareCost(null, null)).toBe(0);
    expect(compareCost(null, cost(6, 6, 1e6))).toBeGreaterThan(0);
    expect(compareCost(cost(6, 6, 1e6), null)).toBeLessThan(0);
    for (const a of costs) for (const b of costs) expect(Math.sign(compareCost(a, b)) + Math.sign(compareCost(b, a))).toBe(0);
  });

  it('bestRouteCost = paras reitti (routes[0]) tai null; fmtCost suomeksi', () => {
    const d = plant(3000, [
      [1000, '111'],
      [1144, '222'],
    ]);
    const o = searchPaths(query([num('lähtö', '111'), num('tavoite', '222')]), P({ rules: ['fib-naapuri'] }), '234', piSource(d, 's'), CTX);
    expect(bestRouteCost(o)).toEqual({ edges: 1, transforms: 0, span: 144 });
    expect(bestRouteCost({ ...o, routes: [] } as SearchOutcome)).toBeNull();
    expect(fmtCost(cost(1, 0, 251))).toBe('1 askel, 0 muunnosta, Σ|Δn| = 251');
    expect(fmtCost(cost(3, 1, 2000))).toBe(`3 askelta, 1 muunnos, Σ|Δn| = 2${T}000`);
    expect(fmtCost(null)).toBe('ei reittiä');
  });
});

// ------------------------------------------------------------------ p-arvo

describe('nullComparison: p = (1 + #yhtä hyvä) / (R + 1) ja Wilsonin väli', () => {
  it('yhtä hyvä tai parempi lasketaan, huonompi ja ei reittiä eivät', () => {
    const observed = cost(1, 0, 100);
    const bests = [cost(1, 0, 50), cost(1, 0, 100), cost(1, 0, 150), null, cost(2, 0, 10), cost(1, 1, 1), cost(1, 0, 99)];
    const c = nullComparison('tasajakauma', 42, bests, observed);
    expect(c).toMatchObject({ model: 'tasajakauma', seed: 42, replicates: 7, countAsGood: 3, noRoute: 1 });
    expect(c.pValue).toBe(4 / 8);
    const [lo, hi] = wilson(3, 7);
    expect(c.pLow).toBe(lo);
    expect(c.pHigh).toBe(hi);
    expect(c.pLow).toBeLessThan(3 / 7);
    expect(c.pHigh).toBeGreaterThan(3 / 7);
  });

  it('ääritapaukset: ei yhtään yhtä hyvää → 1/(R + 1); havaittu = null → kaikki yhtä hyviä, p = 1', () => {
    const none = nullComparison('satunnaisjono', 1, [cost(2, 0, 1), null, cost(3, 0, 1)], cost(1, 0, 999));
    expect(none).toMatchObject({ countAsGood: 0, noRoute: 1, pValue: 1 / 4 });
    expect(none.pLow).toBeCloseTo(0, 12);
    const noObs = nullComparison('tasajakauma', 1, [cost(1, 0, 1), null, null, cost(6, 0, 1e5)], null);
    expect(noObs).toMatchObject({ countAsGood: 4, noRoute: 2, pValue: 1 });
    expect(noObs.pHigh).toBeCloseTo(1, 12);
    expect(nullComparison('tasajakauma', 1, [], null)).toMatchObject({ replicates: 0, countAsGood: 0, pValue: 1, pLow: 0, pHigh: 1 });
  });

  it('replikaattien siemenet: tasajakauma seed + r, satunnaisjono seed + 10 000 + s (32 bittiä)', () => {
    expect(RANDOM_STRING_SEED_OFFSET).toBe(10_000);
    expect(replicateSeed('tasajakauma', 100, 0)).toBe(100);
    expect(replicateSeed('tasajakauma', 100, 7)).toBe(107);
    expect(replicateSeed('satunnaisjono', 100, 2)).toBe(10_102);
    expect(replicateSeed('tasajakauma', 0xffffffff, 1)).toBe(0);
    expect(replicateSeed('tasajakauma', -1, 0)).toBe(0xffffffff);
  });
});

// ------------------------------------------------------------------ nollamallit

describe('nollamallit: tasajakauma ja satunnaisjono', () => {
  const pi = searchPaths(DATA_Q, P(), 'kaksisuuntainen', piSource(DATA, 'testi'), CTX);
  const counts = pi.vocabulary.map((v) => ({ code: v.code, count: v.hits }));

  it('tasajakauma säilyttää jokaisen koodin osumamäärän; paikat 1 … N − L + 1, eri kuin aineistossa', () => {
    expect(Object.fromEntries(counts.map((c) => [c.code, c.count]))).toEqual({
      '432': codeHits(DATA, '432').length,
      '629': codeHits(DATA, '629').length,
      '6464': codeHits(DATA, '6464').length,
    });
    const seen = new Set<string>();
    for (let r = 0; r < 5; r++) {
      const seed = replicateSeed('tasajakauma', 777, r);
      const src = nullSource('tasajakauma', counts, DATA.length, seed);
      expect(src).toMatchObject({ kind: 'tasajakauma', N: DATA.length, digits: null, label: `tasajakauma (siemen ${seed})` });
      for (const { code, count } of counts) {
        const h = Array.from(src.hitsOf(code));
        expect(h).toHaveLength(count);
        for (let i = 1; i < h.length; i++) expect(h[i]).toBeGreaterThan(h[i - 1]);
        expect(h[0]).toBeGreaterThanOrEqual(1);
        expect(h[h.length - 1]).toBeLessThanOrEqual(DATA.length - code.length + 1);
        expect(h).not.toEqual(Array.from(codeHits(DATA, code)));
        seen.add(h.join(','));
      }
      // sama haku nollamallissa: sanaston osumamäärät samat kuin aineistossa, solmuja ei voi tarkistaa
      const o = searchPaths(DATA_Q, P(), 'kaksisuuntainen', src, CTX);
      expect(o.vocabulary.map((v) => [v.code, v.hits])).toEqual(pi.vocabulary.map((v) => [v.code, v.hits]));
      for (const rt of o.routes) for (const s of rt.steps) expect(s.verified).toBeNull();
    }
    expect(seen.size).toBe(5 * counts.length); // jokainen replikaatti on oma arvontansa
  });

  it('satunnaisjono on eri jono kuin π: eri numerot ja eri osumat, tarkistettavissa jonosta', () => {
    const fixtureCounts = [{ code: '592', count: codeHits(FIXTURE_DIGITS, '592').length }];
    const a = nullSource('satunnaisjono', fixtureCounts, FIXTURE_DIGITS.length, replicateSeed('satunnaisjono', 5, 0));
    const b = nullSource('satunnaisjono', fixtureCounts, FIXTURE_DIGITS.length, replicateSeed('satunnaisjono', 5, 1));
    expect(a.kind).toBe('satunnaisjono');
    expect(a.digits).toHaveLength(FIXTURE_DIGITS.length);
    expect(a.digits).toMatch(/^[0-9]+$/);
    expect(a.digits).not.toBe(FIXTURE_DIGITS);
    expect(b.digits).not.toBe(a.digits);
    let same = 0;
    for (let i = 0; i < FIXTURE_DIGITS.length; i++) if (a.digits![i] === FIXTURE_DIGITS[i]) same++;
    expect(same / FIXTURE_DIGITS.length).toBeLessThan(0.15); // ≈ 1/10 sattumalta
    expect(Array.from(a.hitsOf('592'))).not.toEqual(Array.from(codeHits(FIXTURE_DIGITS, '592')));
    // samat koodit haetaan jonosta: reitit tarkistetaan satunnaisjonosta
    const r = nullSource('satunnaisjono', counts, DATA.length, replicateSeed('satunnaisjono', 777, 0));
    expect(r.digits).not.toBe(DATA);
    const o = searchPaths(DATA_Q, P(), 'kaksisuuntainen', r, CTX);
    expect(o.status).toBe('löytyi');
    for (const rt of o.routes) {
      for (const s of rt.steps) {
        expect(s.verified).toBe(true);
        expect(verifyHit(r.digits!, s.from.code, s.from.n)).toBe(true);
        expect(verifyHit(r.digits!, s.to.code, s.to.n)).toBe(true);
      }
    }
  });

  it('runPathNull: siemenet, yhteenveto replikaateista ja toistettavuus', async () => {
    const a = args();
    const res = await runPathNull(a, DATA);
    expect(res.reproducible).toBe(true);
    expect(res.fingerprint).toBe(a.observedFingerprint);
    expect(res.replicates.map((r) => [r.model, r.seed])).toEqual([
      ...Array.from({ length: 12 }, (_, r) => ['tasajakauma', 777 + r]),
      ...Array.from({ length: 3 }, (_, s) => ['satunnaisjono', 10_777 + s]),
    ]);
    expect(res.nulls.map((n) => n.model)).toEqual([...NULL_MODELS]);
    for (const n of res.nulls) {
      const reps = res.replicates.filter((r) => r.model === n.model);
      expect(n).toEqual(nullComparison(n.model, reps[0].seed, reps.map((r) => r.best), a.observed));
      expect(n.countAsGood).toBe(reps.filter((r) => r.asGood).length);
      expect(n.pValue).toBe((1 + n.countAsGood) / (n.replicates + 1));
      expect([n.pLow, n.pHigh]).toEqual(wilson(n.countAsGood, n.replicates));
    }
    for (const r of res.replicates) expect(r.asGood).toBe(compareCost(r.best, a.observed) <= 0);
    expect(res.notes[0]).toContain(`tulostiiviste ${res.fingerprint} molemmilla`);
    expect(res.notes.join('\n')).toContain('Tasajakauma: R = 12, siemenet 777 … 788');
    expect(res.notes.join('\n')).toContain('Satunnaisjono: S = 3, siemenet 10777 … 10779');
    expect(res.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('determinismi: sama siemen → sama tulos; eri siemen → eri replikaatit', async () => {
    const a = args();
    const r1 = await runPathNull(a, DATA);
    const r2 = await runPathNull(a, DATA);
    expect(stable(r2)).toEqual(stable(r1));
    const r3 = await runPathNull({ ...a, seed: 778 }, DATA);
    expect(r3.replicates.map((r) => r.best)).not.toEqual(r1.replicates.map((r) => r.best));
    // siemenen 778 tasajakaumareplikaatit 0 … 10 ovat siemenen 777 replikaatit 1 … 11
    const u1 = r1.replicates.filter((r) => r.model === 'tasajakauma');
    const u3 = r3.replicates.filter((r) => r.model === 'tasajakauma');
    expect(u3.slice(0, 11)).toEqual(u1.slice(1));
    // runNullModels samoilla osumamäärillä = runPathNull:n nollamallit
    const pi = searchPaths(a.query, a.params, a.mode, piSource(DATA, 'testi'), CTX);
    const direct = await runNullModels({
      ...a,
      counts: pi.vocabulary.map((v) => ({ code: v.code, count: v.hits })),
      N: DATA.length,
    });
    expect(direct.nulls).toEqual(r1.nulls);
    expect(direct.replicates).toEqual(r1.replicates);
  });

  it('π-aineistosta ei reittiä (havaittu = null): jokainen replikaatti yhtä hyvä tai parempi, p = 1', async () => {
    const params = P({ rules: ['fib-naapuri'], fibKMax: 6, maxEdges: 1 });
    const a = args({ replicates: 10, randomStrings: 2 }, DATA, DATA_Q, params);
    expect(a.observed).toBeNull();
    const res = await runPathNull(a, DATA);
    expect(res.reproducible).toBe(true);
    for (const n of res.nulls) {
      expect(n.countAsGood).toBe(n.replicates);
      expect(n.pValue).toBe(1);
      expect(n.noRoute).toBe(res.replicates.filter((r) => r.model === n.model && r.best === null).length);
    }
    expect(res.notes.join('\n')).toContain('π-aineistosta ei löytynyt reittiä');
    expect(pathScore(null, res.nulls, res.reproducible)).toMatchObject({ total: 0, rarity: 0, length: 0, branching: 0, transforms: 0 });
  });

  it('toistettavuus epäonnistuu, jos havaittu kustannus tai tulostiiviste ei vastaa uutta π-hakua', async () => {
    const a = args({ replicates: 2, randomStrings: 0 });
    const wrongCost = await runPathNull({ ...a, observed: cost(1, 0, (a.observed?.span ?? 0) + 1) }, DATA);
    expect(wrongCost.reproducible).toBe(false);
    expect(wrongCost.notes.join('\n')).toContain('ei vastaa π-haun parasta reittiä');
    const wrongFp = await runPathNull({ ...a, observedFingerprint: '00000000' }, DATA);
    expect(wrongFp.reproducible).toBe(false);
    expect(wrongFp.notes.join('\n')).toContain('annettu tulostiiviste 00000000 ei vastaa');
    const noFp = await runPathNull({ ...a, observedFingerprint: undefined }, DATA);
    expect(noFp.reproducible).toBe(true);
    expect(noFp.nulls).toHaveLength(1);
    expect(noFp.nulls[0].model).toBe('tasajakauma');
  });

  it('edistyminen 2 + R + S askeleessa ja välitauko joka replikaatin jälkeen', async () => {
    const progress: [number, number][] = [];
    let yields = 0;
    await runPathNull(args({ replicates: 4, randomStrings: 2 }), DATA, {
      onProgress: (d, t) => progress.push([d, t]),
      yieldFn: () => {
        yields++;
      },
    });
    expect(progress).toEqual(Array.from({ length: 8 }, (_, i) => [i + 1, 8]));
    expect(yields).toBe(8);
  });

  it('virheelliset syötteet → poikkeus suomeksi', async () => {
    await expect(runPathNull(args({ replicates: -1 }), DATA)).rejects.toThrow('replikaattien määrän on oltava kokonaisluku ≥ 0');
    await expect(runPathNull(args({ randomStrings: 1.5 }), DATA)).rejects.toThrow('Satunnaisjonojen määrän');
    await expect(runPathNull(args({ seed: Number.NaN }), DATA)).rejects.toThrow('Siemenen on oltava kokonaisluku');
    await expect(runPathNull(args(), '')).rejects.toThrow('Aineisto on tyhjä');
    await expect(runPathNull({ ...args(), params: P({ maxEdges: 0 }) }, DATA)).rejects.toThrow('maxEdges');
    await expect(runPathNull({ ...args(), mode: 'outo' as SearchMode }, DATA)).rejects.toThrow('Tuntematon hakutila');
  });
});

// ------------------------------------------------------------------ kalibrointi

describe('kalibrointi: kun "havaittu" on itse nollareplikaatti, p-arvot eivät ole järjestelmällisesti pieniä', () => {
  // Siemenkyselyn rakenne: harvinaiset lähtökoodit, yleinen ja harvinainen tavoitekoodi (N = 100 000).
  const N = 100_000;
  const counts = [
    { code: '62884', count: 9 },
    { code: '42662', count: 7 },
    { code: '72552', count: 6 },
    { code: '432', count: 105 },
  ];
  const q = query([name('lähtö', 'MATTI'), name('lähtö', 'HANNA'), name('tavoite', 'SALLA'), name('tavoite', 'IDA')]);

  it('tasajakauma: 30 kokeilua, R = 20 → osuus p ≤ 0,05 < 25 %', async () => {
    const ps: number[] = [];
    for (let t = 0; t < 30; t++) {
      const data = uniformSource(counts, N, 5_000_000 + t, 'havaittu');
      const observed = bestRouteCost(searchPaths(q, P(), 'kaksisuuntainen', data, CTX));
      const { nulls } = await runNullModels({ query: q, params: P(), mode: 'kaksisuuntainen', ctx: CTX, observed, counts, N, replicates: 20, randomStrings: 0, seed: 1000 * t });
      expect(nulls).toHaveLength(1);
      ps.push(nulls[0].pValue);
    }
    const small = ps.filter((p) => p <= 0.05).length / ps.length;
    const mean = ps.reduce((a, b) => a + b, 0) / ps.length;
    expect(small).toBeLessThan(0.25);
    expect(mean).toBeGreaterThan(0.35);
    // p-arvot vaihtelevat (testisuure ei ole vakio)
    expect(new Set(ps).size).toBeGreaterThan(5);
  });

  it('satunnaisjono: 15 kokeilua, S = 10 → osuus p ≤ 0,1 < 30 %', async () => {
    const q3 = query([num('lähtö', '432'), num('tavoite', '629'), num('tunnettu', '111')]);
    const N3 = 20_000;
    const ps: number[] = [];
    for (let t = 0; t < 15; t++) {
      const data = randomDigits(N3, 9_000_000 + t);
      const pi = searchPaths(q3, P(), 'kaksisuuntainen', piSource(data, 'havaittu'), CTX);
      const { nulls } = await runNullModels({
        query: q3,
        params: P(),
        mode: 'kaksisuuntainen',
        ctx: CTX,
        observed: bestRouteCost(pi),
        counts: pi.vocabulary.map((v) => ({ code: v.code, count: v.hits })),
        N: N3,
        replicates: 0,
        randomStrings: 10,
        seed: 100 * t,
      });
      expect(nulls.map((n) => n.model)).toEqual(['satunnaisjono']);
      ps.push(nulls[0].pValue);
    }
    expect(ps.filter((p) => p <= 0.1).length / ps.length).toBeLessThan(0.3);
    expect(ps.reduce((a, b) => a + b, 0) / ps.length).toBeGreaterThan(0.3);
  });

  it('testillä on voimaa: istutettu poikkeuksellisen lyhyt reitti → p = 1/(R + 1), harvinaisuus 1', async () => {
    // MATTI @50 000 ja SALLA @50 006: Δn = 6, kun satunnaisesti sijoitetut harvinaiset koodit ovat kaukana toisistaan.
    const d = plant(N, [
      [50_000, '62884'],
      [50_006, '72552'],
    ]);
    const q2 = query([name('lähtö', 'MATTI'), name('tavoite', 'SALLA')]);
    const pi = searchPaths(q2, P(), 'kaksisuuntainen', piSource(d, 'istutettu'), CTX);
    expect(bestRouteCost(pi)).toEqual({ edges: 1, transforms: 0, span: 6 });
    const res = await runPathNull(
      { query: q2, params: P(), mode: 'kaksisuuntainen', ctx: CTX, observed: bestRouteCost(pi), replicates: 20, randomStrings: 0, seed: 1 },
      d,
    );
    expect(res.reproducible).toBe(true);
    expect(res.nulls[0]).toMatchObject({ countAsGood: 0, pValue: 1 / 21 });
    const s = pathScore(pi.routes[0], res.nulls, res.reproducible);
    expect(s.rarity).toBe(1);
    expect(s.total).not.toBeNull();
    expect(s.total!).toBeGreaterThanOrEqual(60);
  });
});

// ------------------------------------------------------------------ Path Score

describe('Path Score: osat ja kokonaispistemäärä (docs §6)', () => {
  const r2 = route([step('geometrinen', 4, false, 0), step('matemaattinen', 2, true, 1)]);

  it('osat: pituus, haarautuminen, muunnokset, rakenne ja varovainen harvinaisuus', () => {
    const nulls = [nullsWith('tasajakauma', 50, 0), nullsWith('satunnaisjono', 5, 0)];
    expect(nulls.map((n) => n.pValue)).toEqual([1 / 51, 1 / 6]);
    const s = pathScore(r2, nulls, true);
    expect(s.version).toBe(PATHSCORE_VERSION);
    expect(s.length).toBe(1 / 2);
    expect(s.branching).toBeCloseTo(1 / (1 + Math.log2(3)), 12);
    expect(s.transforms).toBe(1 / 2);
    expect(s.structure).toEqual({ geometric: 0.5, numeric: 0.5 });
    // p = suurin p (1/6), R = suurin R (50)
    expect(s.rarity).toBeCloseTo(Math.log10(6) / Math.log10(51), 12);
    // varovainen: enintään kunkin mallin oma pistemäärä
    for (const n of nulls) expect(s.rarity!).toBeLessThanOrEqual(rarityScore(n.pValue, n.replicates)! + 1e-12);
    const expected = Math.round(
      100 * (SCORE_WEIGHTS.rarity * s.rarity! + SCORE_WEIGHTS.length * 0.5 + SCORE_WEIGHTS.branching * s.branching + SCORE_WEIGHTS.transforms * 0.5),
    );
    expect(s.total).toBe(expected);
    expect(s.total).toBe(46);
    expect(s.reproducible).toBe(true);
    expect(s.nulls).toEqual(nulls);
    // yksi malli: p = 1/51 → harvinaisuus 1
    const one = pathScore(r2, [nulls[0]], true);
    expect(one.rarity).toBe(1);
    expect(one.total).toBe(Math.round(100 * (0.6 + 0.075 + 0.15 / (1 + Math.log2(3)) + 0.05)));
    expect(one.total).toBe(78);
  });

  it('painot ja harvinaisuuden asteikko', () => {
    expect(SCORE_WEIGHTS).toEqual({ rarity: 0.6, length: 0.15, branching: 0.15, transforms: 0.1 });
    expect(rarityScore(1, 50)).toBe(0);
    expect(rarityScore(1 / 51, 50)).toBe(1);
    expect(rarityScore(1 / 1000, 50)).toBe(1); // min(1, …)
    expect(rarityScore(0.1, 99)).toBeCloseTo(0.5, 12);
    expect(rarityScore(0.5, 0)).toBeNull();
    expect(rarityScore(0, 10)).toBeNull();
    // yksi askel, haarautuminen 1, ei muunnoksia: reittikohtaiset osat 1
    const best = pathScore(route([step('matemaattinen', 1, false, 0)]), [nullsWith('tasajakauma', 9, 9)], true);
    expect(best).toMatchObject({ length: 1, branching: 1, transforms: 1, rarity: 0, total: 40, structure: { geometric: 0, numeric: 1 } });
  });

  it('kokonaispistemäärää ei anneta ilman satunnaisvertailua tai ilman todettua toistettavuutta', () => {
    const nulls = [nullsWith('tasajakauma', 20, 3)];
    expect(pathScore(r2, [], true)).toMatchObject({ total: null, rarity: null, length: 0.5, transforms: 0.5 });
    expect(pathScore(r2, [nullComparison('tasajakauma', 1, [], null)], true)).toMatchObject({ total: null, rarity: null });
    expect(pathScore(r2, nulls, null)).toMatchObject({ total: null, reproducible: null });
    expect(pathScore(r2, nulls, null).rarity).not.toBeNull();
    expect(pathScore(r2, nulls, false)).toMatchObject({ total: null, reproducible: false });
    expect(pathScore(r2, nulls, true).total).not.toBeNull();
    expect(pathScore(r2, [], true).definition).toContain('Satunnaisvertailua ei ole ajettu');
    expect(pathScore(r2, nulls, false).definition).toContain('Toistettavuus epäonnistui');
    expect(pathScore(r2, nulls, null).definition).toContain('Toistettavuutta ei ole tarkistettu');
  });

  it('ei reittiä: reittikohtaiset osat 0', () => {
    const s = pathScore(null, [nullsWith('tasajakauma', 10, 10)], true);
    expect(s).toMatchObject({ length: 0, branching: 0, transforms: 0, structure: { geometric: 0, numeric: 0 }, rarity: 0, total: 0 });
  });

  it('määritelmä ja vastuuvapauslauseke suomeksi', () => {
    const s = pathScore(r2, [nullsWith('tasajakauma', 50, 0), nullsWith('satunnaisjono', 5, 0)], true);
    expect(s.disclaimer).toBe(PATHSCORE_DISCLAIMER);
    expect(s.disclaimer.startsWith('Path Score ei ole todennäköisyys sille, että mikään tapahtuu.')).toBe(true);
    expect(s.disclaimer).toContain('vain sokkotesti');
    expect(s.definition.startsWith(PATHSCORE_DEFINITION)).toBe(true);
    for (const part of [
      PATHSCORE_VERSION,
      'p = (1 + #{replikaatit, joissa paras reitti on yhtä hyvä tai parempi',
      'min(1, −log10 p / log10(R + 1))',
      'suurin ajettujen mallien p-arvoista',
      'Pituus = 1 / askeleet',
      '1 / (1 + log2 b)',
      '1 / (1 + 369-askeleet)',
      'round(100 · (0,6 · harvinaisuus + 0,15 · pituus + 0,15 · haarautuminen + 0,1 · muunnokset))',
      'Harvinaisuus koskee kyselyn parasta reittiä',
    ]) {
      expect(s.definition).toContain(part);
    }
    expect(s.definition).toContain('Tässä: tasajakauma R = 50, p = 0,020; satunnaisjono R = 5, p = 0,167 → p = 0,167, R = 50.');
  });

  it('scoreRoutes: yksi Path Score reittiä kohden; harvinaisuus sama (kyselyn paras reitti), muut osat reittikohtaisia', async () => {
    const o = searchPaths(DATA_Q, P(), 'kaksisuuntainen', piSource(DATA, 'testi'), CTX);
    expect(o.routes.length).toBeGreaterThan(1);
    const res = await runPathNull(args({ replicates: 10, randomStrings: 0 }), DATA);
    const scores = scoreRoutes(o, res.nulls, res.reproducible);
    expect(scores).toHaveLength(o.routes.length);
    for (let i = 0; i < scores.length; i++) {
      expect(scores[i].rarity).toBe(scores[0].rarity);
      expect(scores[i]).toEqual(pathScore(o.routes[i], res.nulls, res.reproducible));
      expect(scores[i].length).toBe(1 / o.routes[i].steps.length);
    }
    expect(scoreRoutes({ ...o, routes: [] }, res.nulls, true)).toEqual([]);
  });
});

// ------------------------------------------------------------------ moottori

describe('moottori: pathNull', () => {
  const q = query([num('lähtö', '592'), num('tavoite', '653')]);

  it('handleRequest = runPathNull π-aineistosta; edistyminen välittyy; tyhjä aineisto → virhe', async () => {
    const a = args({ replicates: 8, randomStrings: 2, seed: 99 }, FIXTURE_DIGITS, q);
    const progress: number[] = [];
    const out = (await handleRequest(
      { digits: FIXTURE_DIGITS },
      { type: 'pathNull', ...a },
      { onProgress: (d) => progress.push(d) },
    )) as PathNullResult;
    const direct = await runPathNull(a, FIXTURE_DIGITS);
    expect(stable(out)).toEqual(stable(direct));
    expect(out.reproducible).toBe(true);
    expect(out.nulls.map((n) => [n.model, n.replicates, n.seed])).toEqual([
      ['tasajakauma', 8, 99],
      ['satunnaisjono', 2, 10_099],
    ]);
    expect(progress).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    // pyyntö ilman valinnaista tulostiivistettä (pyynnön perusmuoto)
    const { observedFingerprint: _fp, ...basic } = a;
    void _fp;
    const plain = (await handleRequest({ digits: FIXTURE_DIGITS }, { type: 'pathNull', ...basic })) as PathNullResult;
    expect(plain.nulls).toEqual(out.nulls);
    await expect(handleRequest({ digits: '' }, { type: 'pathNull', ...a })).rejects.toThrow('Aineisto on tyhjä');
  });
});

// ------------------------------------------------------------------ täysi aineisto

describe.skipIf(!HAS_FULL)('täysi 1M-aineisto', () => {
  const digits = FULL!;
  const ctx: IdentifierContext = { story: createSeedStory(), events: [] };
  const q = query([name('lähtö', 'MATTI'), name('lähtö', 'HANNA'), name('tavoite', 'SALLA'), name('tavoite', 'IDA')]);
  const pi = searchPaths(q, P(), 'kaksisuuntainen', piSource(digits, 'pi_digits_1m.txt'), ctx);
  const counts = pi.vocabulary.map((v) => ({ code: v.code, count: v.hits }));

  it('siemenkysely, R = 50 + S = 5: toistuu, osumamäärät säilyvät, Path Score lasketaan', async () => {
    expect(bestRouteCost(pi)).toEqual({ edges: 1, transforms: 0, span: 251 });
    const res = await runPathNull(
      { query: q, params: P(), mode: 'kaksisuuntainen', ctx, observed: bestRouteCost(pi), replicates: 50, randomStrings: 5, seed: 20261017, observedFingerprint: pi.resultFingerprint },
      digits,
    );
    expect(res.reproducible).toBe(true);
    expect(res.fingerprint).toBe(pi.resultFingerprint);
    expect(res.nulls.map((n) => [n.model, n.replicates])).toEqual([
      ['tasajakauma', 50],
      ['satunnaisjono', 5],
    ]);
    for (const n of res.nulls) {
      expect(n.pValue).toBe((1 + n.countAsGood) / (n.replicates + 1));
      expect(n.pValue).toBeGreaterThan(0);
      expect(n.pValue).toBeLessThanOrEqual(1);
    }
    expect(res.durationMs).toBeLessThan(15_000);
    const scores = scoreRoutes(pi, res.nulls, res.reproducible);
    expect(scores).toHaveLength(pi.routes.length);
    for (const s of scores) {
      expect(s.total).not.toBeNull();
      expect(s.total!).toBeGreaterThanOrEqual(0);
      expect(s.total!).toBeLessThanOrEqual(100);
      expect(s.disclaimer).toContain('Path Score ei ole todennäköisyys');
    }
  });

  it('tasajakaumareplikaatti säilyttää todelliset osumamäärät; satunnaisjono eroaa π:stä', () => {
    expect(Object.fromEntries(counts.map((c) => [c.code, c.count]))).toEqual({ '62884': 9, '42662': 7, '72552': 6, '432': 1054 });
    const u = nullSource('tasajakauma', counts, digits.length, replicateSeed('tasajakauma', 20261017, 0));
    const ou = searchPaths(q, P(), 'kaksisuuntainen', u, ctx);
    expect(Object.fromEntries(ou.vocabulary.map((v) => [v.labels[0], v.hits]))).toEqual({ MATTI: 9, HANNA: 7, SALLA: 6, IDA: 1054 });
    expect(Array.from(u.hitsOf('432'))).not.toContain(858511);
    const r = nullSource('satunnaisjono', counts, digits.length, replicateSeed('satunnaisjono', 20261017, 0));
    expect(r.digits).toHaveLength(digits.length);
    expect(r.digits!.slice(0, 1000)).not.toBe(digits.slice(0, 1000));
    expect(Array.from(r.hitsOf('432'))).not.toEqual(Array.from(codeHits(digits, '432')));
    const or = searchPaths(q, P(), 'kaksisuuntainen', r, ctx);
    for (const rt of or.routes) for (const s of rt.steps) expect(s.verified).toBe(true);
  });

  it('kalibrointi todellisilla osumamäärillä: 15 kokeilua, R = 19 → osuus p ≤ 0,05 < 25 %', async () => {
    const ps: number[] = [];
    for (let t = 0; t < 15; t++) {
      const data = uniformSource(counts, digits.length, 7_000_000 + t, 'havaittu');
      const observed = bestRouteCost(searchPaths(q, P(), 'kaksisuuntainen', data, ctx));
      const { nulls } = await runNullModels({
        query: q,
        params: P(),
        mode: 'kaksisuuntainen',
        ctx,
        observed,
        counts,
        N: digits.length,
        replicates: 19,
        randomStrings: 0,
        seed: 1000 * t,
      });
      ps.push(nulls[0].pValue);
    }
    expect(ps.filter((p) => p <= 0.05).length / ps.length).toBeLessThan(0.25);
    expect(ps.reduce((a, b) => a + b, 0) / ps.length).toBeGreaterThan(0.3);
  });
});
