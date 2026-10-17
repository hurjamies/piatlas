import { describe, expect, it } from 'vitest';
import { verifyHit } from '../src/core/matrix/hits';
import { fmtInt } from '../src/core/matrix/ops369';
import { t9Code } from '../src/core/matrix/refs';
import { createSeedStory } from '../src/core/matrix/seed';
import type { StoryModel } from '../src/core/matrix/types';
import {
  BLIND_DEFINITION,
  blindItemsFromEvents,
  blindItemsFromStory,
  blindRandomSeed,
  blindRandomSource,
  compareBlindCost,
  dayToIso,
  decoyDateRange,
  decoyDates,
  isoDatePart,
  isoToDay,
  planBlindFolds,
  rankCandidates,
  rankSumPValue,
  runBlindTest,
  validateBlindParams,
} from '../src/core/path/blind';
import type { BlindRunOptions, BlindRunResult } from '../src/core/path/blind';
import { DECOY_NAMES, DECOY_NAMES_SOURCE, decoyNameCapacity, decoyNameCodes, decoyNamePool } from '../src/core/path/decoy-names';
import type { IdentifierContext } from '../src/core/path/identifiers';
import { piSource, randomStringSource } from '../src/core/path/source';
import type { BlindItem, BlindParams, HitSource, PathCost, PathParams } from '../src/core/path/types';
import { BLIND_VERSION, DEFAULT_PATH_PARAMS } from '../src/core/path/types';
import { handleRequest } from '../src/engine/handlers';
import { FULL, HAS_FULL } from './helpers';

// ------------------------------------------------------------------ apuvälineet

/** Synteettinen aineisto: taustanumeroa, johon koodit istutetaan 1-pohjaisiin kohtiin. */
function plant(N: number, items: [number, string][], bg = '0'): string {
  const a = new Array<string>(N).fill(bg);
  for (const [n, code] of items) for (let i = 0; i < code.length; i++) a[n - 1 + i] = code[i];
  return a.join('');
}

const P = (over: Partial<PathParams> = {}): PathParams => ({ ...DEFAULT_PATH_PARAMS, ...over });

const BP = (over: Partial<BlindParams> = {}): BlindParams => ({
  kind: 'polun-askel',
  decoys: 9,
  seed: 20261017,
  randomStrings: 0,
  dateFormat: 'DDMMYYYY',
  path: P({ maxRoutes: 1 }),
  ...over,
});

/** Polun askel -kohde nimestä (koodi = T9). */
function step(id: string, name: string, group: string, personId: string | null = null): BlindItem {
  const code = t9Code(name)!;
  const leakKeys = [`nimi:${name}`, `koodi:${code}`];
  if (personId) leakKeys.push(`henkilö:${personId}`);
  return { id, kind: 'polun-askel', label: name, code, group, leakKeys, date: null };
}

const EMPTY_STORY: StoryModel = { version: 1, seedVersion: 'testi', identifiers: [], persons: [], relations: [], glosses: [], paths: [] };
const CTX0: IdentifierContext = { story: EMPTY_STORY, events: [] };

/** Keinotekoinen osumalähde (ei numeroita): jokaisella koodilla samat osumat. */
function fixedSource(N: number, hits: number[], label = 'kiinteä'): HitSource {
  const h = Int32Array.from(hits);
  return { kind: 'tasajakauma', N, hitsOf: (c) => (/^\d+$/.test(c) ? h : new Int32Array(0)), digits: null, label };
}

/** χ² tasajakaumaa vastaan. */
function chiSquare(counts: number[]): number {
  const n = counts.reduce((a, b) => a + b, 0);
  const e = n / counts.length;
  return counts.reduce((a, c) => a + ((c - e) * (c - e)) / e, 0);
}
/** χ²:n kriittiset arvot, p = 0,001 (vapausasteet 1…9). */
const CHI2_999 = [0, 10.83, 13.82, 16.27, 18.47, 20.52, 22.46, 24.32, 26.12, 27.88];

const costKey = (c: PathCost | null): string => (c ? `${c.edges}/${c.transforms}/${c.span}` : '-');

/** Reitin avaimen "koodi@n>koodi@n" jokainen solmu tarkistetaan lähdeaineistosta. */
function expectKeyVerified(key: string, digits: string): void {
  for (const part of key.split('>')) {
    const [code, n] = part.split('@');
    expect(verifyHit(digits, code, Number(n))).toBe(true);
  }
}

/** Tuloksen vertailukelpoinen muoto (ilman aikoja). */
const stable = (r: BlindRunResult) => ({ ...r, durationMs: 0 });

// ------------------------------------------------------------------ nimiharhauttimet

describe('nimiharhauttimet: kiinteä lista', () => {
  it('noin 300 yleistä suomalaista etunimeä, ei toistoja, isot kirjaimet, kaikki koodautuvat T9:llä', () => {
    expect(DECOY_NAMES_SOURCE).toBe('yleisiä suomalaisia etunimiä, kiinteä lista');
    expect(DECOY_NAMES.length).toBeGreaterThanOrEqual(250);
    expect(DECOY_NAMES.length).toBeLessThanOrEqual(400);
    expect(new Set(DECOY_NAMES).size).toBe(DECOY_NAMES.length);
    for (const n of DECOY_NAMES) {
      expect(n).toMatch(/^[A-ZÄÖÅ]+$/);
      expect(t9Code(n)).toMatch(/^[2-9]+$/);
    }
    const pool = decoyNamePool();
    expect(pool).toHaveLength(DECOY_NAMES.length);
    // translitterointi: Ä → A, Ö → O (sama kuin tarinan nimillä)
    expect(pool.find((x) => x.label === 'VÄINÖ')!.code).toBe(t9Code('VAINO'));
    // riittävästi eri koodeja seed-tarinan pituuksille (3 ja 5) D = 9 harhauttimelle
    expect(decoyNameCapacity(3)).toBeGreaterThanOrEqual(20);
    expect(decoyNameCapacity(5)).toBeGreaterThanOrEqual(50);
  });

  it('decoyNameCodes: sama koodin pituus, eri koodit, ei oikeaa eikä poissuljettuja, siemenellinen', () => {
    const exclude = new Set(['62884', '72552', '432', '629']);
    const a = decoyNameCodes('42662', 9, 1, exclude);
    expect(a).toHaveLength(9);
    expect(new Set(a.map((x) => x.code)).size).toBe(9);
    for (const x of a) {
      expect(x.code).toHaveLength(5);
      expect(x.code).not.toBe('42662');
      expect(exclude.has(x.code)).toBe(false);
      expect(t9Code(x.label)).toBe(x.code);
    }
    expect(decoyNameCodes('42662', 9, 1, exclude)).toEqual(a);
    expect(decoyNameCodes('42662', 9, 2, exclude)).not.toEqual(a);
    // 3 numeroa: IDA ja MAX eivät koskaan ole harhauttimia, kun ne on suljettu pois
    for (let seed = 0; seed < 50; seed++) {
      const b = decoyNameCodes('432', 9, seed, exclude);
      expect(b).toHaveLength(9);
      expect(b.some((x) => x.code === '432' || x.code === '629')).toBe(false);
    }
  });

  it('liian vähän samanpituisia nimiä: palautetaan vähemmän (vaje näkyy pituudesta)', () => {
    const cap9 = decoyNameCapacity(9);
    expect(cap9).toBeGreaterThan(0);
    expect(cap9).toBeLessThan(9);
    expect(decoyNameCodes('123456789', 9, 7, new Set())).toHaveLength(cap9);
    expect(decoyNameCodes('123456789012', 9, 7, new Set())).toEqual([]);
    expect(decoyNameCodes('42662', 0, 7, new Set())).toEqual([]);
  });
});

// ------------------------------------------------------------------ päivämääräharhauttimet

describe('päivämääräharhauttimet', () => {
  it('päivien järjestysnumerot: sama kuin UTC-kalenteri (karkausvuodet mukaan lukien)', () => {
    for (let day = isoToDay('1899-12-25'); day <= isoToDay('2101-01-05'); day += 37) {
      const iso = dayToIso(day);
      expect(isoToDay(iso)).toBe(day);
      expect(new Date(day * 86400000).toISOString().slice(0, 10)).toBe(iso);
    }
    expect(isoToDay('1970-01-01')).toBe(0);
    expect(dayToIso(isoToDay('2016-02-28') + 1)).toBe('2016-02-29');
    expect(dayToIso(isoToDay('2015-02-28') + 1)).toBe('2015-03-01');
    expect(isoDatePart('2015-06-01T10:30')).toBe('2015-06-01');
    expect(isoDatePart('2015-02-30')).toBeNull();
    expect(isoDatePart('')).toBeNull();
  });

  it('aikaväli = ryhmän päivämäärät ± 365 päivää', () => {
    expect(decoyDateRange(['2016-09-12', '2014-03-23', null, 'x'])).toEqual({ from: '2013-03-23', to: '2017-09-12' });
    expect(decoyDateRange([])).toBeNull();
  });

  it('tasajakautuneet, samanpituiset, eri koodit, ei oikeaa eikä todellisia päiviä, siemenellinen', () => {
    const real = ['2014-03-23', '2015-06-01', '2016-09-12'];
    const range = decoyDateRange(real)!;
    const exclude = new Set(real.map((d) => d.slice(8, 10) + d.slice(5, 7) + d.slice(0, 4)));
    const a = decoyDates('2015-06-01', 9, 11, range.from, range.to, 'DDMMYYYY', exclude);
    expect(a).toHaveLength(9);
    expect(new Set(a.map((x) => x.code)).size).toBe(9);
    for (const x of a) {
      expect(x.code).toHaveLength(8);
      expect(x.date >= range.from && x.date <= range.to).toBe(true);
      expect(real).not.toContain(x.date);
      expect(exclude.has(x.code)).toBe(false);
      expect(x.code).toBe(x.date.slice(8, 10) + x.date.slice(5, 7) + x.date.slice(0, 4));
    }
    expect(decoyDates('2015-06-01', 9, 11, range.from, range.to, 'DDMMYYYY', exclude)).toEqual(a);
    expect(decoyDates('2015-06-01', 9, 12, range.from, range.to, 'DDMMYYYY', exclude)).not.toEqual(a);
    for (const [fmt, len] of [['YYYYMMDD', 8], ['DDMMYY', 6], ['MMDD', 4], ['DDMM', 4]] as const) {
      for (const x of decoyDates('2015-06-01', 9, 3, range.from, range.to, fmt, new Set())) expect(x.code).toHaveLength(len);
    }
    // tasajakauma: 10 yhtä pitkää lohkoa, 500 päivää 1 000 päivän väliltä (ilman palautusta)
    const from = '2000-01-01';
    const to = dayToIso(isoToDay(from) + 999);
    const big = decoyDates('1999-06-01', 500, 5, from, to, 'YYYYMMDD', new Set());
    expect(big).toHaveLength(500);
    const bins = new Array<number>(10).fill(0);
    for (const x of big) bins[Math.floor((isoToDay(x.date) - isoToDay(from)) / 100)]++;
    expect(chiSquare(bins)).toBeLessThan(CHI2_999[9]);
  });

  it('lyhyt muoto ja pitkä väli: koodeja on rajallisesti, palautetaan vähemmän', () => {
    const got = decoyDates('2015-06-01', 500, 1, '2013-01-01', '2016-12-31', 'DDMM', new Set());
    expect(got.length).toBe(365); // 366 eri DDMM-koodia, oikea pois
    expect(new Set(got.map((x) => x.code)).size).toBe(got.length);
    expect(decoyDates('2015-06-01', 5, 1, '2016-01-01', '2015-01-01', 'DDMM', new Set())).toEqual([]);
    expect(decoyDates('2015-02-30', 5, 1, '2013-01-01', '2016-12-31', 'DDMM', new Set())).toEqual([]);
  });
});

// ------------------------------------------------------------------ kohteet

describe('sokkotestin kohteet', () => {
  it('tarinan polkujen askeleet: yksi kohde askelta kohden, ryhmä = polku, koodi = T9, vuotoavaimet', () => {
    const items = blindItemsFromStory(createSeedStory());
    expect(items.map((i) => `${i.id} ${i.label} ${i.code} ${i.group}`)).toEqual([
      'polku-a#1 MATTI 62884 polku-a',
      'polku-a#2 HANNA 42662 polku-a',
      'polku-a#3 MAX 629 polku-a',
      'polku-b#1 HANNA 42662 polku-b',
      'polku-b#2 SALLA 72552 polku-b',
      'polku-b#3 IDA 432 polku-b',
    ]);
    for (const i of items) expect(i.kind).toBe('polun-askel');
    expect(items[1].leakKeys).toEqual(['nimi:HANNA', 'koodi:42662', 'henkilö:hanna-3']);
  });

  it('tapahtumat: vain kelvolliset ISO-päivät, koodi valitussa muodossa, linkitetyt kohdat vuotoavaimina', () => {
    const items = blindItemsFromEvents(
      [
        { id: 'e1', title: 'Muutto', date: '2014-03-23', linkedHits: ['t1@1031', 'huono', 't2@0'] },
        { id: 'e2', title: 'Ei päivää', date: '' },
        { id: 'e3', title: 'Kellonaika', date: '2015-06-01T10:30' },
        { id: 'e4', title: 'Virheellinen', date: '2015-02-30' },
      ],
      'DDMMYYYY',
    );
    expect(items.map((i) => `${i.id}|${i.label}|${i.code}|${i.group}|${i.date}`)).toEqual([
      'tapahtuma:e1|Muutto (2014-03-23)|23032014|tapahtumat|2014-03-23',
      'tapahtuma:e3|Kellonaika (2015-06-01)|01062015|tapahtumat|2015-06-01',
    ]);
    expect(items[0].leakKeys).toEqual(['tapahtuma:e1', 'päivä:2014-03-23', 'koodi:23032014', 'kohta:1031']);
    expect(blindItemsFromEvents([{ id: 'e1', title: 'Muutto', date: '2014-03-23' }], 'YYYYMMDD')[0].code).toBe('20140323');
  });
});

// ------------------------------------------------------------------ vuotojen esto

describe('vuotojen esto', () => {
  it('(a) piilotetun koodi ja yhteiset tunnisteet poistetaan kontekstista; harhautin ei ole kohteen eikä tarinan koodi', () => {
    const story = createSeedStory();
    const items = blindItemsFromStory(story);
    const plan = planBlindFolds(items, BP(), { story, events: [] });
    expect(plan.plans).toHaveLength(6);
    expect(plan.skipped).toEqual([]);
    const forbidden = new Set(['62884', '42662', '629', '72552', '432', '6464']); // kohteet + tarinan tunnisteet (MINI)
    for (const f of plan.plans) {
      expect(f.contextCodes).not.toContain(f.item.code);
      expect(f.context.every((c) => c.group === f.item.group && c.id !== f.item.id)).toBe(true);
      expect(f.candidates.filter((c) => c.isTrue)).toHaveLength(1);
      expect(f.candidates.find((c) => c.isTrue)!.code).toBe(f.item.code);
      expect(f.candidates).toHaveLength(10);
      const decoys = f.candidates.filter((c) => !c.isTrue);
      // (b) sama koodin pituus, eri koodit, ei kohteiden eikä tarinan koodeja
      expect(new Set(decoys.map((d) => d.code)).size).toBe(9);
      for (const d of decoys) {
        expect(d.code).toHaveLength(f.item.code.length);
        expect(forbidden.has(d.code)).toBe(false);
      }
    }
    // Sama koodi tai yhteinen vuotoavain samassa ryhmässä → pois kontekstista syineen
    const g = [
      step('p#1', 'HANNA', 'p', 'hanna-1'),
      step('p#2', 'SALLA', 'p', 'salla'),
      step('p#3', 'HANNA', 'p', 'hanna-3'),
      step('p#4', 'MATTI', 'p', 'salla'), // sama henkilötunnus kuin SALLA (vuotoavain)
    ];
    const p2 = planBlindFolds(g, BP(), CTX0);
    const h1 = p2.plans.find((f) => f.item.id === 'p#1')!;
    expect(h1.contextCodes).toEqual(['62884', '72552']);
    expect(h1.removedContext).toEqual([{ id: 'p#3', label: 'HANNA', reason: 'sama koodi 42662 kuin piilotetulla kohteella' }]);
    const s2 = p2.plans.find((f) => f.item.id === 'p#2')!;
    expect(s2.contextCodes).toEqual(['42662']);
    expect(s2.removedContext).toEqual([{ id: 'p#4', label: 'MATTI', reason: 'yhteinen tunniste henkilö:salla piilotetun kohteen kanssa' }]);
  });

  it('(a) jokaisessa haussa sanasto = kontekstin koodit (lähtö) + ehdokas (tavoite); piilotettu koodi ei koskaan lähtönä', async () => {
    const story = createSeedStory();
    const items = blindItemsFromStory(story);
    const params = BP({ decoys: 4, randomStrings: 1, path: P({ maxRoutes: 1, maxEdges: 3 }) });
    const plan = planBlindFolds(items, params, { story, events: [] });
    const digits = randomStringSource(20000, 99, 'x').digits!;
    const seen: Parameters<NonNullable<BlindRunOptions['onSearch']>>[0][] = [];
    await runBlindTest(items, params, () => piSource(digits, 'testi'), (i) => blindRandomSource(20000, params.seed, i), { story, events: [] }, {}, {
      onSearch: (e) => seen.push(e),
    });
    expect(seen).toHaveLength(6 * 5 * 2);
    for (const e of seen) {
      const f = plan.plans[e.fold];
      const cand = f.candidates[e.candidate];
      const vocab = e.outcome.vocabulary;
      expect(vocab.map((v) => v.code).sort()).toEqual([...new Set([...f.contextCodes, cand.code])].sort());
      const starts = vocab.filter((v) => v.roles.includes('lähtö')).map((v) => v.code);
      expect(starts.sort()).toEqual(f.contextCodes);
      expect(starts).not.toContain(f.item.code);
      expect(vocab.filter((v) => v.roles.includes('tavoite')).map((v) => v.code)).toEqual([cand.code]);
      if (!cand.isTrue) expect(vocab.some((v) => v.code === f.item.code)).toBe(false);
      expect(vocab.some((v) => v.roles.includes('tunnettu'))).toBe(false);
      expect(e.outcome.mode).toBe('kaksisuuntainen');
      expect(e.outcome.params).toEqual(params.path);
    }
  });

  it('(a) piilotetun tapahtuman linkitetyt kohdat poistetaan kierroksen osumista', async () => {
    // A @1 001 ja @1 061, B @1 031 ja @3 001; A on linkitetty B:n osumaan 1 031.
    const digits = plant(5000, [
      [1001, '23032014'],
      [1031, '01062015'],
      [1061, '23032014'],
      [3001, '01062015'],
    ], '5');
    const events = [
      { id: 'A', title: 'A', date: '2014-03-23', linkedHits: ['termi@1031'] },
      { id: 'B', title: 'B', date: '2015-06-01' },
    ];
    const items = blindItemsFromEvents(events, 'DDMMYYYY');
    const params = BP({ kind: 'tapahtuma', decoys: 3, path: P({ maxRoutes: 1, rules: ['indeksi-seuraava'], indexWindow: 50 }) });
    const seen: { fold: number; hits: Record<string, number> }[] = [];
    const r = await runBlindTest(items, params, () => piSource(digits, 'testi'), () => piSource(digits, 'x'), null, {}, {
      onSearch: (e) => seen.push({ fold: e.fold, hits: Object.fromEntries(e.outcome.vocabulary.map((v) => [v.code, v.hits])) }),
    });
    expect(r.folds.map((f) => f.hiddenId)).toEqual(['tapahtuma:A', 'tapahtuma:B']);
    expect(r.folds[0].removedPositions).toEqual([1031]);
    for (const s of seen.filter((x) => x.fold === 0)) expect(s.hits['01062015']).toBe(1);
    for (const s of seen.filter((x) => x.fold === 1)) expect(s.hits['23032014']).toBe(2);
    // A:n kierroksella B @1 031 on poistettu: B @3 001 ei yllä A:han → ei reittiä
    expect(r.folds[0].candidates.find((c) => c.isTrue)!.cost).toBeNull();
    // ilman linkkiä: B @1 031 → A @1 061 (Δn 30)
    const unlinked = blindItemsFromEvents([{ ...events[0], linkedHits: [] }, events[1]], 'DDMMYYYY');
    const r0 = await runBlindTest(unlinked, params, () => piSource(digits, 'testi'), () => piSource(digits, 'x'), null);
    expect(r0.folds[0].removedPositions).toEqual([]);
    expect(costKey(r0.folds[0].candidates.find((c) => c.isTrue)!.cost)).toBe('1/0/30');
    // B:n kierroksella mitään ei poisteta: A @1 001 → B @1 031 (Δn 30)
    expect(costKey(r.folds[1].candidates.find((c) => c.isTrue)!.cost)).toBe('1/0/30');
    expect(r.folds[1].rankPi).toBe(1);
  });

  it('(c) tasapelit: kun jokainen ehdokas saa saman kustannuksen, oikean sijoitus on tasajakautunut siemenittäin', async () => {
    const items = [step('g#1', 'MATTI', 'g'), step('g#2', 'SALLA', 'g')];
    const D = 4;
    const ranks = new Array<number>(D + 1).fill(0);
    const ranksRandom = new Array<number>(D + 1).fill(0);
    const positions = new Array<number>(D + 1).fill(0);
    for (let seed = 1; seed <= 250; seed++) {
      const params = BP({ decoys: D, seed, randomStrings: 1, path: P({ maxRoutes: 1, rules: ['indeksi-seuraava'] }) });
      for (const f of planBlindFolds(items, params, CTX0).plans) positions[f.candidates.findIndex((c) => c.isTrue)]++;
      // π: jokaisella koodilla osumat 1 000 ja 1 500 → jokaisella ehdokkaalla sama paras reitti (1 askel, Δn 500)
      // satunnaisjono: ei osumia → kaikilla "ei reittiä"
      const r = await runBlindTest(items, params, () => fixedSource(5000, [1000, 1500]), () => fixedSource(5000, []), CTX0);
      for (const f of r.folds) {
        expect(new Set(f.candidates.map((c) => costKey(c.cost)))).toEqual(new Set(['1/0/500']));
        ranks[f.rankPi - 1]++;
        ranksRandom[f.rankRandomStrings[0] - 1]++;
      }
    }
    expect(ranks.reduce((a, b) => a + b, 0)).toBe(500);
    expect(chiSquare(ranks)).toBeLessThan(CHI2_999[D]);
    expect(chiSquare(ranksRandom)).toBeLessThan(CHI2_999[D]);
    expect(chiSquare(positions)).toBeLessThan(CHI2_999[D]);
    for (const c of [...ranks, ...ranksRandom, ...positions]) expect(c).toBeGreaterThan(50);
  });

  it('(c) rankCandidates: kustannus ensin, tasapelit vain arvotun tie-järjestyksen mukaan', () => {
    const c = (edges: number, span: number, transforms = 0): PathCost => ({ edges, transforms, span });
    expect(compareBlindCost(c(1, 900), c(2, 10))).toBeLessThan(0);
    // sama hinta (askeleet + muunnokset = 3): vähemmän muunnoksia ensin, sitten pienempi Σ|Δn|
    expect(compareBlindCost(c(2, 10, 1), c(3, 10))).toBeGreaterThan(0);
    expect(compareBlindCost(c(3, 10), c(3, 11))).toBeLessThan(0);
    expect(compareBlindCost(c(3, 10), c(3, 10))).toBe(0);
    expect(compareBlindCost(null, c(6, 99999))).toBeGreaterThan(0);
    expect(compareBlindCost(null, null)).toBe(0);
    const costs = [null, c(1, 50), c(1, 50), null, c(1, 20)];
    expect(rankCandidates(costs, [0, 1, 2, 3, 4])).toEqual([4, 2, 3, 5, 1]);
    expect(rankCandidates(costs, [4, 3, 2, 1, 0])).toEqual([5, 3, 2, 4, 1]);
    // kaikki tasan: sijoitus = tie-järjestys, riippumatta siitä, missä oikea vastaus on
    expect(rankCandidates([null, null, null], [2, 0, 1])).toEqual([3, 1, 2]);
  });
});

// ------------------------------------------------------------------ testi voi onnistua (istutettu aineisto)

/**
 * Istutettu aineisto: MATTI, HANNA, SALLA ja MATTI peräkkäin 20 numeron välein (jokaisella kohteella on kontekstin
 * osuma ennen itseään W = 50 sisällä); jokainen 5-numeroinen harhautinkoodi yksin kaukana (100 numeron välein).
 */
function plantedNames() {
  const trueCodes = ['62884', '42662', '72552'];
  const decoyCodes = [...new Set(decoyNamePool().map((x) => x.code))].filter((c) => c.length === 5 && !trueCodes.includes(c));
  const base = 2001 + 100 * decoyCodes.length;
  const plants: [number, string][] = decoyCodes.map((c, k) => [1001 + 100 * k, c]);
  plants.push([base, '62884'], [base + 20, '42662'], [base + 40, '72552'], [base + 60, '62884']);
  const digits = plant(base + 2000, plants);
  const items = [step('p#1', 'MATTI', 'p'), step('p#2', 'HANNA', 'p'), step('p#3', 'SALLA', 'p')];
  const params = BP({ randomStrings: 3, path: P({ maxRoutes: 1, rules: ['indeksi-seuraava'], indexWindow: 50, maxEdges: 2 }) });
  return { digits, items, params, base };
}

describe('(d) istutettu aineisto: oikea vastaus yhdistyy, harhauttimet eivät → sijoitus 1', () => {
  it('nimet: kaikki kierrokset oikein, p = 10⁻³, sattumaa parempi tässä sokkotestissä', async () => {
    const { digits, items, params, base } = plantedNames();
    const N = digits.length;
    const r = await runBlindTest(items, params, () => piSource(digits, 'istutettu'), (i) => blindRandomSource(N, params.seed, i), CTX0);
    expect(r.version).toBe(BLIND_VERSION);
    expect(r.folds.map((f) => [f.hiddenLabel, f.rankPi, f.correct])).toEqual([
      ['MATTI', 1, true],
      ['HANNA', 1, true],
      ['SALLA', 1, true],
    ]);
    for (const f of r.folds) {
      expect(f.candidates).toHaveLength(10);
      expect(f.candidates[0].isTrue).toBe(true);
      expect(costKey(f.candidates[0].cost)).toBe('1/0/20');
      expect(f.topLabel).toBe(f.hiddenLabel);
      expect(f.candidates[0].verified).toBe(true);
      expectKeyVerified(f.candidates[0].routeKey!, digits);
      for (const c of f.candidates.slice(1)) {
        expect(c.cost).toBeNull();
        expect(c.code).toHaveLength(5);
      }
    }
    expect(r.folds.map((f) => f.candidates[0].routeKey)).toEqual([
      `72552@${base + 40}>62884@${base + 60}`,
      `62884@${base}>42662@${base + 20}`,
      `42662@${base + 20}>72552@${base + 40}`,
    ]);
    expect(r.summary).toMatchObject({ folds: 3, hitsAt1: 3, meanRank: 1 });
    expect(r.summary.expectedHitsAt1).toBeCloseTo(0.3, 12);
    expect(r.summary.expectedMeanRank).toBeCloseTo(5.5, 12);
    expect(r.summary.pVsRandom).toBeCloseTo(0.001, 12);
    expect(r.pMethod).toBe('tarkka');
    expect(r.randomStringRuns).toHaveLength(3);
    expect(r.summary.randomStrings!.meanRank).toBeGreaterThan(1);
    expect(r.piBeatsRandomStrings).toBe(true);
    expect(r.summary.verdict).toMatch(/^Sattumaa parempi tässä sokkotestissä \(3 kierrosta\)/);
    expect(r.summary.verdict).toContain('ei ole ennuste');
    expect(r.definition).toBe(BLIND_DEFINITION);
    // determinismi: sama syöte → sama tulos ja sormenjälki
    const again = await runBlindTest(items, params, () => piSource(digits, 'istutettu'), (i) => blindRandomSource(N, params.seed, i), CTX0);
    expect(stable(again)).toEqual(stable(r));
  });

  it('ilman piitöntä vertailua tai kun satunnaisjonot pärjäävät yhtä hyvin: ei väitettä ennustuskyvystä', async () => {
    const { digits, items, params } = plantedNames();
    const src = () => piSource(digits, 'istutettu');
    const none = await runBlindTest(items, { ...params, randomStrings: 0 }, src, src, CTX0);
    expect(none.summary.pVsRandom).toBeLessThanOrEqual(0.05);
    expect(none.summary.randomStrings).toBeNull();
    expect(none.piBeatsRandomStrings).toBeNull();
    expect(none.summary.verdict).toMatch(/^Ei näyttöä piin osuudesta/);
    expect(none.summary.verdict).toContain('satunnaisjonot) ei ajettu');
    const same = await runBlindTest(items, { ...params, randomStrings: 2 }, src, src, CTX0);
    expect(same.summary.randomStrings).toEqual({ hitsAt1: 3, meanRank: 1 });
    expect(same.piBeatsRandomStrings).toBe(false);
    expect(same.summary.verdict).toMatch(/^Ei näyttöä piin osuudesta/);
    expect(same.summary.verdict).not.toMatch(/attumaa parempi tässä sokkotestissä/);
  });

  it('päivämäärät: oikea päivä yhdistyy, arvotut harhautinpäivät eivät', async () => {
    const digits = plant(5000, [
      [1001, '23032014'],
      [1031, '01062015'],
      [1061, '12092016'],
      [1091, '23032014'],
    ], '5');
    const events = [
      { id: 'e1', title: 'Muutto', date: '2014-03-23' },
      { id: 'e2', title: 'Häät', date: '2015-06-01' },
      { id: 'e3', title: 'Syntymä', date: '2016-09-12' },
    ];
    const items = blindItemsFromEvents(events, 'DDMMYYYY');
    const params = BP({ kind: 'tapahtuma', path: P({ maxRoutes: 1, rules: ['indeksi-seuraava'], indexWindow: 50, maxEdges: 2 }) });
    const plan = planBlindFolds(items, params, { story: EMPTY_STORY, events });
    for (const f of plan.plans) {
      for (const c of f.candidates.filter((x) => !x.isTrue)) {
        expect(c.code).toHaveLength(8);
        expect(c.label >= '2013-03-23' && c.label <= '2017-09-12').toBe(true);
        expect(events.map((e) => e.date)).not.toContain(c.label);
      }
    }
    const r = await runBlindTest(items, params, () => piSource(digits, 'istutettu'), () => piSource(digits, 'x'), { story: EMPTY_STORY, events });
    expect(r.folds.map((f) => f.rankPi)).toEqual([1, 1, 1]);
    expect(r.summary.hitsAt1).toBe(3);
    for (const f of r.folds) expectKeyVerified(f.candidates[0].routeKey!, digits);
  });
});

// ------------------------------------------------------------------ satunnaisaineisto: sattuman taso

describe('(e) satunnaisjono π:n tilalla: osumatarkkuus sattuman tasolla', () => {
  it('30 kierrosta × 12 siementä: osumat ja keskisijoitus lähellä odotusta, ei yleistä väitettä', async () => {
    // 10 ryhmää × 3 nimeä, joiden koodi on 4 numeroa (noin 10 osumaa 100 000 numerossa)
    const seen = new Set<string>();
    const names = decoyNamePool().filter((x) => x.code.length === 4 && !seen.has(x.code) && (seen.add(x.code), true)).slice(0, 30);
    const items: BlindItem[] = names.map((x, i) => ({
      id: `g${Math.floor(i / 3)}#${i % 3}`,
      kind: 'polun-askel',
      label: x.label,
      code: x.code,
      group: `g${Math.floor(i / 3)}`,
      leakKeys: [`nimi:${x.label}`],
      date: null,
    }));
    const N = 100_000;
    const seeds = Array.from({ length: 12 }, (_, i) => i + 1);
    let hits = 0;
    let expected = 0;
    let variance = 0;
    let rankSum = 0;
    let rsRankSum = 0;
    let folds = 0;
    let positive = 0;
    for (const s of seeds) {
      const params = BP({ decoys: 4, seed: s, randomStrings: 1, path: P({ maxRoutes: 1, maxEdges: 3 }) });
      const r = await runBlindTest(items, params, () => randomStringSource(N, 7000 + s, 'satunnainen'), (i) => blindRandomSource(N, s, i), CTX0);
      expect(r.summary.folds).toBe(30);
      hits += r.summary.hitsAt1;
      expected += r.summary.expectedHitsAt1;
      variance += r.folds.reduce((a, f) => a + (1 / f.candidates.length) * (1 - 1 / f.candidates.length), 0);
      rankSum += r.folds.reduce((a, f) => a + f.rankPi, 0);
      rsRankSum += r.folds.reduce((a, f) => a + f.rankRandomStrings[0], 0);
      folds += 30;
      if (r.summary.pVsRandom <= 0.05 && r.piBeatsRandomStrings) positive++;
      else expect(r.summary.verdict).toMatch(/^Ei näyttöä/);
      // reitit tarkistettu satunnaisjonosta
      for (const f of r.folds) for (const c of f.candidates) if (c.routeKey) expect(c.verified).toBe(true);
    }
    expect(expected).toBeCloseTo(72, 10);
    expect(Math.abs(hits - expected)).toBeLessThan(3.5 * Math.sqrt(variance));
    // sijoitus tasajakautunut 1…5: odotus 3, hajonta √2
    const se = Math.sqrt(2 / folds);
    expect(Math.abs(rankSum / folds - 3)).toBeLessThan(3.5 * se);
    expect(Math.abs(rsRankSum / folds - 3)).toBeLessThan(3.5 * se);
    // väärä "sattumaa parempi" -tulos on harvinainen (p ≤ 0,05 ja π parempi kuin satunnaisjono: noin 2,5 % ajoista)
    expect(positive).toBeLessThanOrEqual(2);
    console.info(
      `[sokkotesti, satunnaisjono π:n tilalla] ${folds} kierrosta: top-1 ${hits} (odotus ${expected.toFixed(1)}), ` +
        `keskisijoitus ${(rankSum / folds).toFixed(3)} (odotus 3, satunnaisjonot ${(rsRankSum / folds).toFixed(3)}), väärät myönteiset ${positive}/12`,
    );
  }, 20_000);
});

// ------------------------------------------------------------------ p-arvo

describe('p-arvo satunnaista valintaa vastaan', () => {
  it('tarkka konvoluutio = täydellinen luettelointi', () => {
    const sizes = [3, 4, 2, 5];
    const sums: number[] = [];
    for (let a = 1; a <= 3; a++) for (let b = 1; b <= 4; b++) for (let c = 1; c <= 2; c++) for (let d = 1; d <= 5; d++) sums.push(a + b + c + d);
    for (let obs = 3; obs <= 15; obs++) {
      const brute = sums.filter((s) => s <= obs).length / sums.length;
      const r = rankSumPValue(obs, sizes, 1);
      expect(r.method).toBe('tarkka');
      expect(r.p).toBeCloseTo(brute, 12);
    }
    expect(rankSumPValue(6, Array(6).fill(10), 1).p).toBeCloseTo(1e-6, 15);
    expect(rankSumPValue(60, Array(6).fill(10), 1).p).toBeCloseTo(1, 12);
    expect(rankSumPValue(0, [], 1)).toEqual({ p: 1, method: 'tarkka', draws: 0 });
  });

  it('Monte Carlo (vähintään 20 000 arvontaa, siemenellinen) ≈ tarkka', () => {
    const sizes = [10, 10, 10, 10, 10, 10, 8, 5];
    for (const obs of [20, 30, 38, 45]) {
      const exact = rankSumPValue(obs, sizes, 3).p;
      const mc = rankSumPValue(obs, sizes, 3, 1000, 0);
      expect(mc.method).toBe('monte-carlo');
      expect(mc.draws).toBe(20_000);
      expect(Math.abs(mc.p - exact)).toBeLessThan(0.012);
      expect(rankSumPValue(obs, sizes, 3, 1000, 0)).toEqual(mc);
    }
  });
});

// ------------------------------------------------------------------ ohitukset ja virheet

describe('ohitukset syineen ja parametrien tarkistus', () => {
  it('ei kontekstia, liian lyhyt koodi, väärä tyyppi, toistuva tunnus ja päivämäärä väärässä muodossa', async () => {
    const items: BlindItem[] = [
      step('yksin#1', 'MATTI', 'yksin'),
      step('lyhyt#1', 'AL', 'lyhyt'),
      step('lyhyt#2', 'SALLA', 'lyhyt'),
      step('lyhyt#2', 'HANNA', 'lyhyt'),
      { id: 't#1', kind: 'tapahtuma', label: 'x', code: '23032014', group: 'tapahtumat', leakKeys: [], date: '2014-03-23' },
      { id: 'tyhjä', kind: 'polun-askel', label: 'Ö?', code: '', group: 'lyhyt', leakKeys: [] },
    ];
    const plan = planBlindFolds(items, BP(), CTX0);
    const reasons = Object.fromEntries(plan.skipped.map((s) => [`${s.id}:${s.label}`, s.reason]));
    expect(reasons['yksin#1:MATTI']).toContain('ei ole muita kohteita');
    expect(reasons['lyhyt#1:AL']).toContain('liian lyhyt: 2 < minCodeLength = 3');
    expect(reasons['lyhyt#2:HANNA']).toContain('on jo käytössä');
    expect(reasons['t#1:x']).toContain('testi tyyppiä "polun-askel"');
    expect(reasons['tyhjä:Ö?']).toContain('ei voi koodata');
    // SALLA: konteksti on vain AL (2 numeroa < minCodeLength)
    expect(reasons['lyhyt#2:SALLA']).toContain('lyhyempiä kuin minCodeLength');
    expect(plan.plans).toEqual([]);

    const ev = planBlindFolds(
      [
        { id: 'a', kind: 'tapahtuma', label: 'a', code: '20140323', group: 'tapahtumat', leakKeys: [], date: '2014-03-23' },
        { id: 'b', kind: 'tapahtuma', label: 'b', code: '01062015', group: 'tapahtumat', leakKeys: [], date: '2015-06-01' },
      ],
      BP({ kind: 'tapahtuma' }),
      null,
    );
    expect(ev.skipped[0].reason).toContain('ei vastaa päivämäärää 2014-03-23 muodossa DDMMYYYY (23032014)');

    const r = await runBlindTest(items, BP(), () => fixedSource(5000, [1000]), () => fixedSource(5000, []), CTX0);
    expect(r.summary.folds).toBe(0);
    expect(r.summary.pVsRandom).toBe(1);
    expect(r.summary.verdict).toMatch(/^Ei näyttöä: yhtään sokkotestin kierrosta ei voitu ajaa/);
    expect(r.skipped).toHaveLength(6);
  });

  it('virheelliset parametrit → poikkeus; tyhjä aineisto → kaikki kohteet ohitetaan', async () => {
    expect(validateBlindParams(BP())).toEqual([]);
    expect(validateBlindParams(BP({ decoys: 0, randomStrings: -1, seed: NaN })).length).toBe(3);
    expect(validateBlindParams(BP({ path: P({ maxEdges: 0 }) })).join(' ')).toContain('maxEdges');
    const items = [step('p#1', 'MATTI', 'p'), step('p#2', 'SALLA', 'p')];
    await expect(runBlindTest(items, BP({ decoys: 0 }), () => fixedSource(5000, []), () => fixedSource(5000, []), CTX0)).rejects.toThrow(
      'Harhauttimien määrän D',
    );
    const r = await runBlindTest(items, BP(), () => piSource('', 'tyhjä'), () => fixedSource(5000, []), CTX0);
    expect(r.summary.folds).toBe(0);
    expect(r.skipped.map((s) => s.reason)).toEqual([expect.stringContaining('Aineisto on tyhjä'), expect.stringContaining('Aineisto on tyhjä')]);
  });

  it('edistyminen: onProgress (tehdyt, kaikki) ja yieldFn', async () => {
    const items = [step('p#1', 'MATTI', 'p'), step('p#2', 'SALLA', 'p')];
    const calls: [number, number][] = [];
    let yields = 0;
    await runBlindTest(items, BP({ decoys: 4, randomStrings: 2 }), () => fixedSource(5000, [1000, 1500]), () => fixedSource(5000, []), CTX0, {
      onProgress: (d, t) => calls.push([d, t]),
      yieldFn: () => {
        yields++;
      },
      yieldEvery: 5,
    });
    const total = 2 * 5 * 3;
    expect(calls[calls.length - 1]).toEqual([total, total]);
    expect(calls.every(([, t]) => t === total)).toBe(true);
    expect(yields).toBe(total / 5);
  });

  it('seed-tarinan polut on muodostettu löydön jälkeen: varaus huomautuksissa', () => {
    const story = createSeedStory();
    const plan = planBlindFolds(blindItemsFromStory(story), BP(), { story, events: [] });
    expect(plan.caveat).toContain('Polku A, Polku B');
    expect(plan.notes).toContain(plan.caveat);
  });
});

// ------------------------------------------------------------------ moottori

describe('moottori: blindTest', () => {
  it('handleRequest = runBlindTest moottorin π-aineistosta ja johdetuista satunnaisjonoista', async () => {
    const { digits, items, params } = plantedNames();
    const N = digits.length;
    const out = (await handleRequest({ digits }, { type: 'blindTest', items, params, ctx: null })) as BlindRunResult;
    expect(out.sourceLabel).toBe(`π-desimaalit (N = ${fmtInt(N)})`);
    const direct = await runBlindTest(items, params, () => piSource(digits, out.sourceLabel), (i) => blindRandomSource(N, params.seed, i), null);
    expect(stable(out)).toEqual(stable(direct));
    expect(out.randomStringRuns[0].label).toBe(`satunnaisjono 1 (siemen ${blindRandomSeed(params.seed, 0)})`);
    const empty = (await handleRequest({ digits: '' }, { type: 'blindTest', items, params, ctx: null })) as BlindRunResult;
    expect(empty.summary.folds).toBe(0);
    expect(empty.skipped).toHaveLength(3);
  });
});

// ------------------------------------------------------------------ täysi aineisto

describe.skipIf(!HAS_FULL)('täysi 1M-aineisto: seed-tarinan polut', () => {
  it('6 kierrosta, D = 9, 2 satunnaisjonoa, siemen 20261017: tarkistetut reitit ja raportoitu tulos', async () => {
    const digits = FULL!;
    const story = createSeedStory();
    const items = blindItemsFromStory(story);
    // Oletusparametrit, paitsi maxRoutes = 1: sijoitukseen tarvitaan vain paras reitti (sama paras reitti kuin maxRoutes = 5).
    const params = BP({ decoys: 9, seed: 20261017, randomStrings: 2, path: P({ maxRoutes: 1 }) });
    const t0 = performance.now();
    const r = await runBlindTest(items, params, () => piSource(digits, 'pi_digits_1m.txt'), (i) => blindRandomSource(digits.length, params.seed, i), {
      story,
      events: [],
    });
    const ms = performance.now() - t0;
    expect(r.summary.folds).toBe(6);
    expect(r.skipped).toEqual([]);
    for (const f of r.folds) {
      expect(f.candidates).toHaveLength(10);
      expect(f.contextCodes).not.toContain(f.candidates.find((c) => c.isTrue)!.code);
      const len = f.candidates.find((c) => c.isTrue)!.code.length;
      for (const c of f.candidates) {
        expect(c.code).toHaveLength(len);
        if (c.routeKey) {
          expect(c.verified).toBe(true);
          expectKeyVerified(c.routeKey, digits);
        }
      }
      expect(f.rankRandomStrings).toHaveLength(2);
    }
    // Havaittu tulos (2026-10-17): ei näyttöä. Jokaisella ehdokkaalla on yhden askeleen reitti (MAX ja IDA ~1 000
    // osumaa, W = 2 000), joten järjestys ratkeaa Σ|Δn|:llä ja on sattuman tasolla.
    expect(r.folds.map((f) => `${f.hiddenLabel}:${f.rankPi}`)).toEqual(['MATTI:2', 'HANNA:6', 'MAX:10', 'HANNA:6', 'SALLA:4', 'IDA:6']);
    expect(r.summary.hitsAt1).toBe(0);
    expect(r.summary.meanRank).toBeCloseTo(34 / 6, 12);
    expect(r.summary.expectedMeanRank).toBe(5.5);
    expect(r.summary.pVsRandom).toBeGreaterThan(0.5);
    expect(r.summary.verdict).toMatch(/^Ei näyttöä: menetelmä ei tunnistanut piilotettuja kohteita sattumaa paremmin\./);
    expect(r.notes.join(' ')).toContain('hypoteesia ei ole lukittu ennen löydöstä');
    console.info(
      `[sokkotesti, täysi aineisto] kierroksia ${r.summary.folds}, top-1 ${r.summary.hitsAt1}/${r.summary.folds} ` +
        `(odotus ${r.summary.expectedHitsAt1.toFixed(2)}), keskisijoitus ${r.summary.meanRank.toFixed(3)} ` +
        `(odotus ${r.summary.expectedMeanRank}), p = ${r.summary.pVsRandom.toFixed(4)}, satunnaisjonot ` +
        `${JSON.stringify(r.summary.randomStrings)}, ${ms.toFixed(0)} ms`,
    );
    expect(ms).toBeLessThan(10_000);
  }, 20_000);
});
