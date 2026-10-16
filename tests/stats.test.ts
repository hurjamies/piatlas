import { describe, expect, it } from 'vitest';
import { nearestDistances, coordsFor, pointDistance, Metric } from '../src/core/geometry-index';
import { createRng, randomDigits, seedFrom } from '../src/core/random';
import { findAll } from '../src/core/search';
import {
  benjaminiHochberg,
  bonferroni,
  classify,
  MCParams,
  runMonteCarlo,
  runRandomControl,
  statisticValue,
} from '../src/core/stats';
import { fibIndexOf, nearestFib, fibNeighbors, FIB } from '../src/core/fibonacci';
import { full, HAS_FULL } from './helpers';

function bruteNearest(metric: Metric, A: number[], B: number[], same: boolean): number[] {
  const ca = coordsFor(A, metric), cb = coordsFor(B, metric);
  return B.map((_, j) => {
    let best = Infinity;
    for (let i = 0; i < A.length; i++) {
      if (same && i === j) continue;
      best = Math.min(best, pointDistance(metric, ca, i, cb, j));
    }
    return best;
  });
}

describe('satunnaisluvut', () => {
  it('sama siemen → sama jono', () => {
    const a = createRng(42), b = createRng(42), c = createRng(43);
    const xa = Array.from({ length: 100 }, () => a.nextU32());
    const xb = Array.from({ length: 100 }, () => b.nextU32());
    const xc = Array.from({ length: 100 }, () => c.nextU32());
    expect(xa).toEqual(xb);
    expect(xa).not.toEqual(xc);
    expect(seedFrom('IDA')).toBe(seedFrom('IDA'));
    expect(seedFrom('123')).toBe(123);
  });

  it('int on tasajakautunut eikä ylitä rajoja', () => {
    const r = createRng(7);
    const counts = new Array(10).fill(0);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < 100_000; i++) {
      const v = r.int(1, 10);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
      counts[v - 1]++;
    }
    expect(lo).toBe(1);
    expect(hi).toBe(10);
    for (const c of counts) expect(Math.abs(c - 10_000)).toBeLessThan(500);
  });

  it('satunnaiset numerojonot ovat toistettavia ja tasaisia', () => {
    const d = randomDigits(200_000, 99);
    expect(d).toBe(randomDigits(200_000, 99));
    expect(d).toMatch(/^[0-9]+$/);
    const c = new Array(10).fill(0);
    for (let i = 0; i < d.length; i++) c[d.charCodeAt(i) - 48]++;
    for (const x of c) expect(Math.abs(x - 20_000)).toBeLessThan(700);
  });
});

describe('lähimmän naapurin haku', () => {
  const rng = createRng(5);
  const A = Array.from({ length: 900 }, () => rng.int(1, 1_000_000));
  const B = Array.from({ length: 120 }, () => rng.int(1, 1_000_000));
  for (const metric of ['1d', '2d', '3d'] as Metric[]) {
    it(`${metric}: ruudukko = raaka laskenta`, () => {
      const g = Array.from(nearestDistances(metric, A, B, false, 1_000_000));
      const b = bruteNearest(metric, A, B, false);
      for (let i = 0; i < b.length; i++) expect(g[i]).toBeCloseTo(b[i], 12);
      const gs = Array.from(nearestDistances(metric, A, A, true, 1_000_000));
      const bs = bruteNearest(metric, A, A, true);
      for (let i = 0; i < bs.length; i++) expect(gs[i]).toBeCloseTo(bs[i], 12);
    });
  }
});

describe('Monte Carlo', () => {
  const rng = createRng(11);
  const base: MCParams = {
    metric: '3d',
    statistic: 'setMin',
    hitsA: Array.from({ length: 200 }, () => rng.int(1, 1_000_000)),
    lenA: 3,
    hitsB: Array.from({ length: 9 }, () => rng.int(1, 1_000_000)),
    lenB: 5,
    sameTerm: false,
    anchorN: null,
    N: 1_000_000,
    R: 300,
    seed: 2024,
    alpha: 0.05,
  };

  it('on samalla siemenellä deterministinen', async () => {
    const a = await runMonteCarlo(base);
    const b = await runMonteCarlo(base);
    expect(Array.from(a.nullValues)).toEqual(Array.from(b.nullValues));
    expect(a.pValue).toBe(b.pValue);
    const c = await runMonteCarlo({ ...base, seed: 2025 });
    expect(Array.from(c.nullValues)).not.toEqual(Array.from(a.nullValues));
  });

  it('pääsäikeen paloittelu ei muuta tulosta', async () => {
    const a = await runMonteCarlo(base);
    const b = await runMonteCarlo(base, { yieldEvery: 7, yieldFn: () => Promise.resolve() });
    expect(Array.from(b.nullValues)).toEqual(Array.from(a.nullValues));
  });

  it('p-arvo ja epävarmuusväli ovat järkeviä', async () => {
    const r = await runMonteCarlo(base);
    expect(r.pValue).toBeGreaterThan(0);
    expect(r.pValue).toBeLessThanOrEqual(1);
    expect(r.pLow).toBeLessThanOrEqual(r.countLE / r.params.R);
    expect(r.pHigh).toBeGreaterThanOrEqual(r.countLE / r.params.R);
    expect(r.params.kA).toBe(200);
    expect(r.params.kB).toBe(9);
  });

  it('kalibrointi: satunnaiset "havainnot" eivät tuota poikkeamia yli odotuksen', async () => {
    // Havaitut joukot arvotaan itse nollamallista → p-arvojen pitäisi olla tasajakautuneita.
    const rr = createRng(77);
    let low = 0;
    const trials = 120;
    for (let t = 0; t < trials; t++) {
      const res = await runMonteCarlo({
        ...base,
        metric: '1d',
        statistic: 'setMin',
        hitsA: Array.from({ length: 40 }, () => rr.int(1, 1_000_000)),
        hitsB: Array.from({ length: 5 }, () => rr.int(1, 1_000_000)),
        R: 199,
        seed: 1000 + t,
      });
      if (res.pValue <= 0.05) low++;
    }
    expect(low / trials).toBeLessThan(0.13); // odotus 5 %, väljä raja satunnaisvaihtelulle
  });

  it('luokittelu ei koskaan väitä merkityksellisyyttä', () => {
    const texts = [classify(0.5, 0.05, false), classify(0.5, 0.05, true), classify(0.01, 0.05, false), classify(0.01, 0.05, true)];
    expect(texts[0].verdict).toBe('ei-poikkeamaa');
    expect(texts[1].verdict).toBe('ei-poikkeamaa');
    expect(texts[2].verdict).toBe('eksploratiivinen'); // ilman esirekisteröintiä ei vahvistusta
    expect(texts[3].verdict).toBe('lukittu-alle-alfa');
    for (const t of texts) expect(`${t.title} ${t.text}`).not.toMatch(/merkitykselli|merkitsevä|todistaa/i);
  });

  it('monivertailu: BH ja Bonferroni', () => {
    const ps = [0.01, 0.04, 0.03, 0.2];
    const q = benjaminiHochberg(ps);
    expect(q[0]).toBeCloseTo(0.04, 12);
    expect(q[1]).toBeCloseTo(0.04 * 4 / 3, 12);
    expect(q[2]).toBeCloseTo(0.04 * 4 / 3, 12);
    expect(q[3]).toBeCloseTo(0.2, 12);
    const b = bonferroni(ps);
    [0.04, 0.16, 0.12, 0.8].forEach((v, i) => expect(b[i]).toBeCloseTo(v, 12));
  });
});

describe.skipIf(!HAS_FULL)('ensimmäinen kontrolloitu läheisyystesti oikealla aineistolla', () => {
  const d = full();
  const ida = findAll('432', d);
  const matti = findAll('62884', d);
  const common = { lenA: 3, lenB: 5, hitsA: ida, hitsB: matti, sameTerm: false, N: d.length, R: 1000, seed: 1, alpha: 0.05 };

  it('S2 (valintakorjattu, 1D): lähin IDA–MATTI-pari on tavallinen', async () => {
    const obs = statisticValue('setMin', '1d', ida, matti, false, null, d.length);
    expect(obs).toBeLessThanOrEqual(251);
    const r = await runMonteCarlo({ ...common, metric: '1d', statistic: 'setMin', anchorN: null });
    expect(r.pValue).toBeGreaterThan(0.05);
    expect(classify(r.pValue, 0.05, false).verdict).toBe('ei-poikkeamaa');
  });

  it('S1 (ankkuriehdollinen, 1D): jälkikäteen valittu ankkuri antaa matalan p:n, mutta vain eksploratiivisena', async () => {
    const obs = statisticValue('anchorNearest', '1d', [], matti, false, 858511, d.length);
    expect(obs).toBe(251);
    const r = await runMonteCarlo({ ...common, metric: '1d', statistic: 'anchorNearest', anchorN: 858511 });
    // P(min ≤ 251) ≈ 1 − (1 − 503/1e6)^9 ≈ 0.0045
    expect(r.pValue).toBeLessThan(0.05);
    expect(classify(r.pValue, 0.05, false).verdict).toBe('eksploratiivinen');
  });

  it('S1 3D on toistettava', async () => {
    const a = await runMonteCarlo({ ...common, metric: '3d', statistic: 'anchorNearest', anchorN: 858511, R: 500 });
    const b = await runMonteCarlo({ ...common, metric: '3d', statistic: 'anchorNearest', anchorN: 858511, R: 500 });
    expect(a.observed).toBe(b.observed);
    expect(a.pValue).toBe(b.pValue);
  });

  it('satunnaisaineistokontrolli on deterministinen ja osumamäärät ovat odotetun suuruisia', async () => {
    const p = { codeA: '432', codeB: '62884', metric: '1d' as const, statistic: 'setMin' as const, N: 1_000_000, strings: 6, seed: 3 };
    const a = await runRandomControl(p, d);
    const b = await runRandomControl(p, d);
    expect(a.rows).toEqual(b.rows);
    expect(a.pi.countA).toBe(1054);
    expect(a.pi.countB).toBe(9);
    for (const row of a.rows) {
      expect(Math.abs(row.countA - 1000)).toBeLessThan(150);
      expect(row.countB).toBeLessThan(30);
    }
  });
});

describe('Fibonacci', () => {
  it('perusluvut', () => {
    expect(FIB.slice(1, 12)).toEqual([1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89]);
    expect(fibIndexOf(233)).toBe(13);
    expect(fibIndexOf(251)).toBeNull();
    const nf = nearestFib(251);
    expect(nf.F).toBe(233);
    expect(nf.delta).toBe(18);
    const nb = fibNeighbors(858511, 1_000_000, 2, 40);
    expect(nb[0]).toEqual({ k: 2, F: 1, minus: 858510, plus: 858512 });
    expect(nb.find((x) => x.F === 832040)!.plus).toBeNull();
  });
});

describe('esirekisteröinnin kysymysidentiteetti', () => {
  it('siemenen vaihto ei tee samasta kysymyksestä uutta', async () => {
    const { sameQuestion } = await import('../src/core/types');
    const base = {
      termA: 'ida', termB: 'matti', labelA: 'IDA', labelB: 'MATTI', codeA: '432', codeB: '62884',
      metric: '3d' as const, statistic: 'anchorNearest' as const, anchorN: 858511, R: 1000, seed: 1, alpha: 0.05,
      datasetSha: 'x', datasetLength: 1_000_000,
    };
    expect(sameQuestion(base, { ...base, seed: 2, R: 10000, alpha: 0.01 })).toBe(true);
    expect(sameQuestion(base, { ...base, metric: '1d' })).toBe(false);
    expect(sameQuestion(base, { ...base, statistic: 'setMin', anchorN: null })).toBe(false);
  });
});
