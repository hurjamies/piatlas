import { describe, expect, it } from 'vitest';
import { verifyHit } from '../src/core/matrix/hits';
import { RouteOrder, RouteTestParams, RouteTestResult, routeWindow, runRouteTest } from '../src/core/matrix/route-test';
import { ROUTE_TEST_VERSION } from '../src/core/matrix/types';
import { createRng, Rng } from '../src/core/random';
import { findAll, lowerBound } from '../src/core/search';
import { handleRequest } from '../src/engine/handlers';
import { FULL, HAS_FULL } from './helpers';

/** Raaka laskenta: kaikki yhdistelmät. Sama taulukko-olio useasti → eri osumat (mikä tahansa järjestys). */
function bruteSpan(hits: number[][], order: RouteOrder): number | null {
  let best = Number.POSITIVE_INFINITY;
  const picks: number[] = [];
  const rec = (i: number): void => {
    if (i === hits.length) {
      for (let a = 0; a < picks.length; a++) {
        for (let b = a + 1; b < picks.length; b++) {
          if (order === 'mikä-tahansa' && hits[a] === hits[b] && picks[a] === picks[b]) return;
        }
      }
      for (let a = 1; a < picks.length; a++) {
        if (order === '234' && !(picks[a] > picks[a - 1])) return;
        if (order === '432' && !(picks[a] < picks[a - 1])) return;
      }
      best = Math.min(best, Math.max(...picks) - Math.min(...picks));
      return;
    }
    for (const h of hits[i]) {
      picks[i] = h;
      rec(i + 1);
    }
  };
  rec(0);
  return Number.isFinite(best) ? best : null;
}

/** Palautettu valinta on kelvollinen ja sen leveys on ilmoitettu span. */
function expectValidPicks(hits: ArrayLike<number>[], order: RouteOrder, picks: number[], span: number): void {
  expect(picks).toHaveLength(hits.length);
  for (let i = 0; i < hits.length; i++) expect(Array.from(hits[i])).toContain(picks[i]);
  for (let a = 1; a < picks.length; a++) {
    if (order === '234') expect(picks[a]).toBeGreaterThan(picks[a - 1]);
    if (order === '432') expect(picks[a]).toBeLessThan(picks[a - 1]);
  }
  if (order === 'mikä-tahansa') {
    for (let a = 0; a < picks.length; a++)
      for (let b = a + 1; b < picks.length; b++) if (hits[a] === hits[b]) expect(picks[a]).not.toBe(picks[b]);
  }
  expect(Math.max(...picks) - Math.min(...picks)).toBe(span);
}

function randomSet(rng: Rng, size: number, max: number): number[] {
  const s = new Set<number>();
  while (s.size < size) s.add(rng.int(1, max));
  return [...s];
}

describe('lyhin ikkuna: käsin tehdyt tapaukset', () => {
  const A = [1, 10];
  const B = [5];
  const C = [12];

  it('mikä tahansa järjestys', () => {
    expect(routeWindow([A, B, C], 'mikä-tahansa')).toEqual({ span: 7, picks: [10, 5, 12] });
    expect(routeWindow([[10, 1], [5]], 'mikä-tahansa')).toEqual({ span: 4, picks: [1, 5] }); // järjestämätön syöte
    // eri koodien osumat saavat olla samassa kohdassa
    expect(routeWindow([[5], [5]], 'mikä-tahansa')).toEqual({ span: 0, picks: [5, 5] });
  });

  it('234: tiukasti kasvava, 432: tiukasti pienenevä', () => {
    expect(routeWindow([A, B, C], '234')).toEqual({ span: 11, picks: [1, 5, 12] });
    expect(routeWindow([A, B, C], '432')).toBeNull(); // 12 ei voi olla pienin
    expect(routeWindow([C, B, A], '432')).toEqual({ span: 11, picks: [12, 5, 1] });
    expect(routeWindow([[9, 20], [5, 15], [1]], '432')).toEqual({ span: 8, picks: [9, 5, 1] });
    expect(routeWindow([[10], [5]], '234')).toBeNull();
    expect(routeWindow([[5], [5]], '234')).toBeNull(); // sama kohta ei ole tiukasti kasvava
    expect(routeWindow([[5], [5]], '432')).toBeNull();
  });

  it('tasatilanteet ratkaistaan deterministisesti', () => {
    expect(routeWindow([[1, 3], [2]], 'mikä-tahansa')).toEqual({ span: 1, picks: [1, 2] });
    expect(routeWindow([[1, 3], [2]], '432')).toEqual({ span: 1, picks: [3, 2] });
    const w = routeWindow([[1, 3, 5], [2, 4]], '234')!;
    expect(w.span).toBe(1);
    expectValidPicks([[1, 3, 5], [2, 4]], '234', w.picks, 1);
  });

  it('sama koodi useasti: eri osumat', () => {
    const S = [1, 4, 9];
    expect(routeWindow([S, S], 'mikä-tahansa')).toEqual({ span: 3, picks: [1, 4] });
    expect(routeWindow([S, [5], S], 'mikä-tahansa')).toEqual({ span: 4, picks: [1, 5, 4] });
    expect(routeWindow([S, S], '234')).toEqual({ span: 3, picks: [1, 4] });
    expect(routeWindow([S, [3]], 'mikä-tahansa')).toEqual({ span: 1, picks: [4, 3] });
    // sisällöltään samat mutta eri taulukot = eri koodit: saavat valita saman kohdan
    expect(routeWindow([[1, 4, 9], [1, 4, 9]], 'mikä-tahansa')).toEqual({ span: 0, picks: [1, 1] });
    const one = [6];
    expect(routeWindow([one, one], 'mikä-tahansa')).toBeNull(); // yksi osuma ei riitä kahdelle
  });

  it('rajatapaukset', () => {
    expect(routeWindow([], 'mikä-tahansa')).toBeNull();
    expect(routeWindow([[1, 2], []], 'mikä-tahansa')).toBeNull();
    expect(routeWindow([[], [1]], '234')).toBeNull();
    expect(routeWindow([[7, 3]], '234')).toEqual({ span: 0, picks: [3] });
    expect(routeWindow([[7, 3]], 'mikä-tahansa')).toEqual({ span: 0, picks: [3] });
    expect(routeWindow([Int32Array.from([2, 8]), Float64Array.from([5])], 'mikä-tahansa')).toEqual({ span: 3, picks: [2, 5] });
  });
});

describe('lyhin ikkuna = raaka laskenta (200 satunnaista tapausta)', () => {
  for (const order of ['mikä-tahansa', '234', '432'] as RouteOrder[]) {
    it(order, () => {
      const rng = createRng(order === 'mikä-tahansa' ? 101 : order === '234' ? 202 : 303);
      let impossible = 0;
      for (let t = 0; t < 200; t++) {
        const k = rng.int(1, 4);
        const hits: number[][] = [];
        for (let i = 0; i < k; i++) {
          if (i > 0 && rng.int(0, 5) === 0) hits.push(hits[rng.int(0, i - 1)]); // sama koodi uudelleen
          else hits.push(randomSet(rng, rng.int(0, 5), 30));
        }
        const want = bruteSpan(hits, order);
        const got = routeWindow(hits, order);
        if (want == null) {
          impossible++;
          expect(got).toBeNull();
        } else {
          expect(got).not.toBeNull();
          expect(got!.span).toBe(want);
          expectValidPicks(hits, order, got!.picks, want);
        }
      }
      expect(impossible).toBeGreaterThan(0);
      expect(impossible).toBeLessThan(200);
    });
  }
});

function nullHits(rng: Rng, k: number, L: number, N: number): number[] {
  return randomSet(rng, k, N - L + 1).sort((a, b) => a - b);
}

describe('reittitesti', () => {
  const rng = createRng(9);
  const N = 100_000;
  const base: RouteTestParams = {
    codes: ['629', '42662', '72552', '432'],
    hits: [nullHits(rng, 100, 3, N), nullHits(rng, 4, 5, N), nullHits(rng, 3, 5, N), nullHits(rng, 90, 3, N)],
    lens: [3, 5, 5, 3],
    N,
    R: 300,
    seed: 2024,
    order: 'mikä-tahansa',
  };

  it('on samalla siemenellä deterministinen ja p ∈ (0, 1]', async () => {
    const a = await runRouteTest(base);
    const b = await runRouteTest(base, { yieldEvery: 7, yieldFn: () => Promise.resolve() });
    const c = await runRouteTest({ ...base, seed: 2025 });
    expect(Array.from(b.nullValues)).toEqual(Array.from(a.nullValues));
    const strip = (r: RouteTestResult) => ({ ...r, durationMs: 0 });
    expect(strip(b)).toEqual(strip(a));
    expect(Array.from(c.nullValues)).not.toEqual(Array.from(a.nullValues));
    for (const r of [a, c]) {
      expect(r.version).toBe(ROUTE_TEST_VERSION);
      expect(r.pValue).toBeGreaterThan(0);
      expect(r.pValue).toBeLessThanOrEqual(1);
      expect(r.pValue).toBe((r.countLE + 1) / (r.params.R + 1));
      expect(r.pLow).toBeLessThanOrEqual(r.countLE / r.params.R);
      expect(r.pHigh).toBeGreaterThanOrEqual(r.countLE / r.params.R);
      expect(r.shareGreater).toBeCloseTo(1 - r.countLE / r.params.R, 12);
      expect(r.nullQ05).toBeLessThanOrEqual(r.nullMedian);
      expect(r.nullMedian).toBeLessThanOrEqual(r.nullQ95);
      expect(r.impossibleNull).toBe(0);
      expect(r.nullValues).toHaveLength(300);
    }
    expect(a.params.counts).toEqual([100, 4, 3, 90]);
    expect('hits' in a.params).toBe(false);
    expect(a.observed!.span).toBe(routeWindow(base.hits, 'mikä-tahansa')!.span);
    expect(a.definition).toMatch(/lyhin ikkuna/);
    expect(a.definition).toMatch(/ankkuria ei käytetä/);
    expect(a.definition).toMatch(/Nollamalli/);
    expect(a.definition).toMatch(/mikä tahansa järjestys/);
    expect(a.definition).not.toMatch(/merkitykselli/i);
  });

  it('edistyminen raportoidaan', async () => {
    const seen: [number, number][] = [];
    await runRouteTest({ ...base, R: 120, randomStrings: 2, N: 20_000, hits: [[5, 900], [40], [77], [1000]] }, {
      onProgress: (d, t) => seen.push([d, t]),
    });
    expect(seen[seen.length - 1]).toEqual([122, 122]);
    expect(seen.some(([d]) => d === 50)).toBe(true);
  });

  it('kalibrointi: nollamallista arvotut "havainnot" antavat harvoin p ≤ 0,05', async () => {
    const rr = createRng(4242);
    for (const order of ['mikä-tahansa', '234'] as RouteOrder[]) {
      let low = 0;
      const trials = 60;
      for (let t = 0; t < trials; t++) {
        const res = await runRouteTest({
          codes: ['a', 'b', 'c'],
          hits: [nullHits(rr, 40, 3, 50_000), nullHits(rr, 6, 4, 50_000), nullHits(rr, 3, 5, 50_000)],
          lens: [3, 4, 5],
          N: 50_000,
          R: 200,
          seed: 7000 + t,
          order,
        });
        if (res.pValue <= 0.05) low++;
      }
      expect(low / trials).toBeLessThan(0.15); // odotus 5 %, väljä raja satunnaisvaihtelulle
    }
  });

  it('mahdottomat nollamallit lasketaan +∞:ksi', async () => {
    const r = await runRouteTest({ codes: ['1', '2'], hits: [[10], [60]], lens: [1, 1], N: 100, R: 400, seed: 3, order: '432' });
    expect(r.observed).toBeNull(); // 10 > 60 ei toteudu
    expect(r.pValue).toBe(1);
    expect(r.impossibleNull).toBeGreaterThan(100);
    expect(r.impossibleNull).toBeLessThan(300);
    expect(Array.from(r.nullValues).filter((v) => v === Number.POSITIVE_INFINITY)).toHaveLength(r.impossibleNull);
    expect(Number.isFinite(r.nullQ05)).toBe(true);
    const r2 = await runRouteTest({ codes: ['1', '2'], hits: [[10], [60]], lens: [1, 1], N: 100, R: 400, seed: 3, order: '234' });
    expect(r2.observed).toEqual({ span: 50, picks: [10, 60] });
    expect(r2.pValue).toBeGreaterThan(0);
  });

  it('sama koodi useasti: yksi osumajoukko myös nollamallissa', async () => {
    const r = await runRouteTest({
      codes: ['432', '629', '432'],
      hits: [[10, 500, 900], [480], [10, 500, 900]],
      lens: [3, 3, 3],
      N: 1000,
      R: 200,
      seed: 1,
      order: 'mikä-tahansa',
    });
    // ikkunassa on oltava kaksi eri 432-osumaa ja 629: [480, 900] → 420 (ei [10, 500] → 490)
    expect(r.observed).toEqual({ span: 420, picks: [500, 480, 900] });
    expect(r.definition).toMatch(/Sama koodi useasti \(432\)/);
    expect(r.params.counts).toEqual([3, 1, 3]);
  });

  it('satunnaisjonokontrolli on deterministinen', async () => {
    const p: RouteTestParams = { ...base, N: 30_000, R: 50, randomStrings: 3, hits: [[100, 2000], [15000], [16000], [15500]], codes: ['629', '42', '72', '432'], lens: [3, 2, 2, 3] };
    const a = await runRouteTest(p);
    const b = await runRouteTest(p);
    expect(a.randomStrings).toEqual(b.randomStrings);
    expect(a.randomStrings!.count).toBe(3);
    expect(a.randomStrings!.values).toHaveLength(3);
    expect(a.randomStrings!.shareLE).toBeGreaterThanOrEqual(0);
    expect(a.randomStrings!.shareLE).toBeLessThanOrEqual(1);
    for (const v of a.randomStrings!.values) expect(v).toBeGreaterThanOrEqual(0);
  });

  it('virheelliset parametrit hylätään', async () => {
    await expect(runRouteTest({ ...base, lens: [3] })).rejects.toThrow();
    await expect(runRouteTest({ ...base, R: 0 })).rejects.toThrow();
    await expect(runRouteTest({ ...base, codes: [], hits: [], lens: [] })).rejects.toThrow();
  });

  it('moottorin käsittelijä ajaa reittitestin', async () => {
    const params: RouteTestParams = { ...base, R: 100 };
    const viaEngine = (await handleRequest({ digits: '' }, { type: 'routeTest', params })) as RouteTestResult;
    const direct = await runRouteTest(params);
    expect(viaEngine.version).toBe(ROUTE_TEST_VERSION);
    expect(viaEngine.nullValues).toBeInstanceOf(Float64Array);
    expect(Array.from(viaEngine.nullValues)).toEqual(Array.from(direct.nullValues));
    expect(viaEngine.pValue).toBe(direct.pValue);
  });
});

describe.skipIf(!HAS_FULL)('reittitesti oikealla aineistolla: MAX → HANNA → SALLA → IDA', () => {
  const D = FULL!;
  const codes = ['629', '42662', '72552', '432'];
  const hits = codes.map((c) => findAll(c, D));

  /** Riippumaton tarkistus: jokaiselle vasemmalle reunalle pienin oikea reuna = max_i(ensimmäinen osuma ≥ reuna). */
  function independentAnySpan(lists: number[][]): number {
    let best = Number.POSITIVE_INFINITY;
    for (const l of lists.flat()) {
      let right = l;
      for (const h of lists) {
        const i = lowerBound(h, l);
        if (i >= h.length) {
          right = Number.POSITIVE_INFINITY;
          break;
        }
        right = Math.max(right, h[i]);
      }
      best = Math.min(best, right - l);
    }
    return best;
  }

  it('osumamäärät ovat tunnetut', () => {
    expect(hits.map((h) => h.length)).toEqual([1040, 7, 6, 1054]);
  });

  it("mikä tahansa järjestys: äärellinen ikkuna, valinnat tarkistuvat aineistosta, R = 1000 alle 3 s", async () => {
    const t0 = performance.now();
    const r = await runRouteTest({ codes, hits, lens: codes.map((c) => c.length), N: D.length, R: 1000, seed: 1, order: 'mikä-tahansa' });
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(3000);
    expect(r.observed).not.toBeNull();
    const { span, picks } = r.observed!;
    expect(Number.isFinite(span)).toBe(true);
    expect(span).toBe(independentAnySpan(hits));
    expect(span).toBe(1898);
    expect(picks).toEqual([856807, 858610, 856712, 857042]);
    picks.forEach((n, i) => expect(verifyHit(D, codes[i], n)).toBe(true));
    expect(Math.max(...picks) - Math.min(...picks)).toBe(span);
    expect(r.pValue).toBeGreaterThan(0);
    expect(r.pValue).toBeLessThanOrEqual(1);
    expect(r.impossibleNull).toBe(0);
    expect(r.params.counts).toEqual([1040, 7, 6, 1054]);
    // Ankkuria ei käytetä: tulos ei riipu siitä, missä IDA-ankkuri on.
    expect(r.definition).toMatch(/ankkuria ei käytetä/);
  });

  it('järjestetyt reitit 234 ja 432 ovat toteutettavissa ja tarkistuvat', async () => {
    for (const order of ['234', '432'] as RouteOrder[]) {
      const w = routeWindow(hits, order)!;
      expect(w).not.toBeNull();
      expectValidPicks(hits, order, w.picks, w.span);
      w.picks.forEach((n, i) => expect(verifyHit(D, codes[i], n)).toBe(true));
      expect(w.span).toBeGreaterThanOrEqual(routeWindow(hits, 'mikä-tahansa')!.span);
    }
    expect(routeWindow(hits, '432')).toEqual({ span: 3708, picks: [859001, 858610, 856712, 855293] });
  });
});
