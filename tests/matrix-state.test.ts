import { describe, expect, it } from 'vitest';
import { expand, GROUPS } from '../src/core/matrix/expand';
import { runRouteTest } from '../src/core/matrix/route-test';
import { createSeedStory, SEED_VERSION } from '../src/core/matrix/seed';
import { upsertPerson } from '../src/core/matrix/story';
import { firstTestRoute, rootTrail } from '../src/core/matrix/trail';
import type { MatrixEnv, TrailStep } from '../src/core/matrix/types';
import { nodeKey } from '../src/core/matrix/types';
import { sha256Hex } from '../src/core/sha256';
import {
  canonicalRouteLock,
  deserializeMatrix,
  deserializeTrail,
  evaluateRouteTiming,
  firstRouteCodes,
  hitFact,
  initialMatrixState,
  MatrixState,
  matrixEnvOf,
  namedCode,
  OPENED_FROM_HIT_GROUP,
  RouteLock,
  RouteRunSummary,
  routeCodesFromTrail,
  routeMathFacts,
  sanitizeStory,
  savedRouteHypothesis,
  serializeMatrix,
  summarizeRouteRun,
  trailToHit,
} from '../src/state/matrix';
import { directionDomains, directionExplanation, fmtMetricValue, groupEdges, pickGraphTargets, stepsText } from '../src/ui/matrix/labels';
import { FIXTURE_DIGITS, FULL, HAS_FULL } from './helpers';

const ANCHOR = { code: '432', n: 858511, label: 'IDA' };

function env(digits = FIXTURE_DIGITS, story = createSeedStory()): MatrixEnv {
  return matrixEnvOf({ digits, anchor: ANCHOR, events: [] }, { story, direction: '234' });
}

/** JSON-kierros kuten localStorage. */
const viaJson = (x: unknown): unknown => JSON.parse(JSON.stringify(x));

function run(over: Partial<RouteRunSummary>): RouteRunSummary {
  return {
    id: 'r1',
    ts: '2026-10-16T10:00:00.000Z',
    version: 'PIATLAS-ROUTE-1.0.0',
    codes: ['629', '42662'],
    names: ['MAX', 'HANNA'],
    order: 'mikä-tahansa',
    R: 200,
    seed: 1,
    seedText: '1',
    randomStrings: 0,
    N: 2000,
    datasetSha: 'sha',
    counts: [1, 1],
    expected: [2, 0.02],
    lens: [3, 5],
    span: 10,
    picks: [1, 11],
    picksVerified: [true, true],
    pValue: 0.5,
    pLow: 0.4,
    pHigh: 0.6,
    shareGreater: 0.5,
    nullMedian: 100,
    nullQ05: 5,
    nullQ95: null,
    impossibleNull: 0,
    randomShareLE: null,
    alpha: 0.05,
    verdict: 'ei-poikkeamaa',
    timing: 'ei-tiedossa',
    timingReason: '',
    lockId: null,
    lockHash: null,
    definition: '',
    durationMs: 1,
    ...over,
  };
}

function lock(over: Partial<RouteLock>): RouteLock {
  return {
    id: 'l1',
    createdAt: '2026-10-16T11:00:00.000Z',
    text: 'hypoteesi',
    codes: ['629', '42662'],
    names: ['MAX', 'HANNA'],
    order: 'mikä-tahansa',
    datasetSha: 'sha',
    hash: 'a'.repeat(64),
    timing: 'ennen-löydöstä',
    reason: '',
    ...over,
  };
}

describe('matriisin tila: tallennus ja lataus', () => {
  it('alkutila: testitapauksen siemendata, juuri ja suunta 234', () => {
    const m = initialMatrixState();
    expect(m.story.seedVersion).toBe(SEED_VERSION);
    expect(m.trail).toEqual(rootTrail());
    expect(m.direction).toBe('234');
    expect(m.view).toBe('verkko');
    expect(m.sub).toBeNull();
  });

  it('JSON-kierros säilyttää tarinan, reitin (avaimet + via), tallennetut reitit, lokin ja ajot', () => {
    const e = env();
    const { trail, errors } = firstTestRoute(e);
    expect(errors).toEqual([]);
    const m: MatrixState = {
      ...initialMatrixState(),
      trail,
      direction: '432',
      view: 'lista',
      saved: [
        {
          id: 'reitti-1',
          title: 'Testi',
          createdAt: '2026-10-16T12:00:00.000Z',
          trail,
          direction: '234',
          interpretation: 'oma tulkinta',
          hypothesis: { timing: 'ei-tiedossa', statedAt: null, lockHash: null, note: '' },
          mathFacts: ['koodi 629 ✓'],
          crossings: [3],
          matrixVersion: 'PIATLAS-MATRIX-1.0.0',
        },
      ],
      log: [{ ts: '2026-10-16T12:00:00.000Z', kind: 'avaus', text: 'avattiin', ref: 'root' }],
      visited: trail.map((s) => nodeKey(s.ref)),
      routeRuns: [run({})],
      locks: [lock({})],
    };
    const p = serializeMatrix(m);
    expect(p.trail[0]).toEqual({ key: 'root', via: null });
    expect(p.trail.map((s) => s.key)).toEqual(trail.map((s) => nodeKey(s.ref)));
    const { state, warnings } = deserializeMatrix(viaJson(p));
    expect(warnings).toEqual([]);
    expect(state.trail).toEqual(trail);
    expect(state.saved[0].trail).toEqual(trail);
    expect(state.story).toEqual(m.story);
    expect(state.direction).toBe('432');
    expect(state.view).toBe('lista');
    expect(state.log).toEqual(m.log);
    expect(state.visited).toEqual(m.visited);
    expect(state.routeRuns).toEqual(m.routeRuns);
    expect(state.locks).toEqual(m.locks);
    expect(state.last369).toBeNull();
    expect(state.sub).toBeNull();
  });

  it('loki ja vierailut rajataan tallennettaessa (500 / 2000 uusinta)', () => {
    const m = initialMatrixState();
    m.log = Array.from({ length: 700 }, (_, i) => ({ ts: 't', kind: 'avaus' as const, text: String(i) }));
    m.visited = Array.from({ length: 2500 }, (_, i) => `pos:${i + 1}`);
    const p = serializeMatrix(m);
    expect(p.log).toHaveLength(500);
    expect(p.log[0].text).toBe('200');
    expect(p.visited).toHaveLength(2000);
    expect(p.visited[1999]).toBe('pos:2500');
  });

  it('käyttäjän muokkaamaa tarinaa ei korvata siemenellä', () => {
    const m = initialMatrixState();
    const story = {
      ...upsertPerson(m.story, {
        id: 'oma',
        name: 'AINO',
        homonymOrdinal: null,
        description: 'oma kuvaus',
        roles: [],
        period: { start: '1950-01-01', end: null },
        source: 'käyttäjä',
        createdAt: '2026-10-16T12:00:00.000Z',
      }),
      seedVersion: 'vanha-siemen',
    };
    const { state } = deserializeMatrix(viaJson(serializeMatrix({ ...m, story })));
    expect(state.story).toEqual(story);
    expect(state.story.persons.find((p) => p.id === 'oma')?.description).toBe('oma kuvaus');
  });

  it('virheellinen syöte ei kaada: oletukset ja siemendata', () => {
    const seed = createSeedStory();
    for (const raw of [undefined, null, 'roska', 42, [], { story: 'x' }, { story: { version: 2 } }, { trail: 'x', saved: 5, log: {} }]) {
      const { state } = deserializeMatrix(raw);
      expect(state.story).toEqual(seed);
      expect(state.trail).toEqual(rootTrail());
      expect(state.direction).toBe('234');
    }
    const r = deserializeMatrix({ story: { version: 2 } });
    expect(r.warnings.join(' ')).toMatch(/siemendataa/);
  });

  it('rikkinäiset kohteet ohitetaan yksitellen ja ilmoitetaan; muu tarina säilyy', () => {
    const story = viaJson(createSeedStory()) as Record<string, unknown[]>;
    story.persons.push({ id: 5 }, { name: 'NIMETÖN' });
    story.glosses.push({ id: 'g-x', symbol: '1', context: { kind: 'tuntematon' } });
    story.paths.push({ id: 'p-x', steps: 'ei lista' });
    const { state, warnings } = deserializeMatrix({ story });
    expect(state.story.persons).toHaveLength(7);
    expect(state.story.glosses).toHaveLength(11);
    expect(state.story.paths).toHaveLength(2);
    expect(warnings.join(' ')).toMatch(/Henkilöt: 2 virheellistä/);
    expect(warnings.join(' ')).toMatch(/Tulkinnat: 1 virheellistä/);
    expect(warnings.join(' ')).toMatch(/Polut: 1 virheellistä/);
  });

  it('reitti katkaistaan ensimmäiseen virheelliseen askeleeseen; ensimmäisen on oltava juuri', () => {
    const via = { relation: 'r', layer: 'matemaattinen', crossesRealm: false, trace: 't', group: 'g' };
    const a = deserializeTrail([{ key: 'root', via: null }, { key: 'code:629', via }, { key: 'roska', via }, { key: 'code:432', via }]);
    expect(a.cut).toBe(true);
    expect(a.trail.map((s) => nodeKey(s.ref))).toEqual(['root', 'code:629']);
    const b = deserializeTrail([{ key: 'code:629', via }]);
    expect(b.trail).toEqual(rootTrail());
    const c = deserializeTrail([{ key: 'root', via: null }, { key: 'code:629', via: { layer: 'väärä' } }]);
    expect(c.trail).toEqual(rootTrail());
    const d = deserializeTrail([{ key: 'root', via: null }, { key: 'code:629', via }, { key: 'code:629', via }]);
    expect(d.trail).toHaveLength(2); // sama solmu kahdesti → silmukka katkaistaan
  });

  it('”ennen löydöstä” ilman tiivistettä ei kelpaa ladattaessa', () => {
    const story = viaJson(createSeedStory()) as { paths: { hypothesis: unknown }[] };
    story.paths[0].hypothesis = { timing: 'ennen-löydöstä', statedAt: null, lockHash: null, note: '' };
    const { state } = deserializeMatrix({ story });
    expect(state.story.paths[0].hypothesis.timing).toBe('ei-tiedossa');
  });

  it('sanitizeStory hylkää muun kuin tarinamallin', () => {
    expect(sanitizeStory(null).story).toBeNull();
    expect(sanitizeStory({ version: 3 }).story).toBeNull();
    expect(sanitizeStory({ version: 1 }).story?.persons).toEqual([]);
  });
});

describe('reitin π-faktat tarkistetaan lähdeaineistosta', () => {
  // Fixture: 1415926535… → n = 5 alkaa "926".
  it('osuma: ✓ ja numerot, ristiriita ✗', () => {
    expect(hitFact(FIXTURE_DIGITS, '926', 5)).toBe('926 @5 ✓ digits 5–7 = 926');
    expect(hitFact(FIXTURE_DIGITS, '926', 6)).toBe('926 @6 ✗ digits 6–8 = 265 ≠ 926');
  });

  it('reitin solmut: juuri, koodi, numero, osuma, kohta, nimi ja henkilö; tarinasolmuista ei matemaattisia faktoja', () => {
    const story = createSeedStory();
    const via = { relation: 'r', layer: 'matemaattinen' as const, crossesRealm: false, trace: '', group: '' };
    const trail: TrailStep[] = [
      { ref: { kind: 'root' }, via: null },
      { ref: { kind: 'code', code: '926' }, via },
      { ref: { kind: 'digit', code: '926', index: 1 }, via },
      { ref: { kind: 'hit', code: '926', n: 5 }, via },
      { ref: { kind: 'position', n: 3000 }, via },
      { ref: { kind: 'gloss', glossId: 'g-629-2' }, via },
      { ref: { kind: 'name', name: 'HANNA' }, via },
      { ref: { kind: 'person', personId: 'hanna-3' }, via },
    ];
    const f = routeMathFacts(trail, FIXTURE_DIGITS, ANCHOR, story);
    expect(f[0]).toMatch(/^Lähtöankkuri IDA: 432 @858 511 ✗/); // fixture on vain 2000 numeroa
    expect(f).toContain('926 @5 ✓ digits 5–7 = 926');
    expect(f.some((x) => /^koodi 926: \d+ osumaa aineistossa/.test(x))).toBe(true);
    expect(f).toContain('numero 2 = koodin 926 paikka 2/3 ✓');
    expect(f.some((x) => x.startsWith('π-indeksi @3 000 ✗'))).toBe(true);
    expect(f).toContain('T9(HANNA) = 42662 ✓ (koodi on nimen ominaisuus)');
    expect(f.some((x) => x.startsWith('T9(HANNA) = 42662 ✓ (henkilön HANNA III'))).toBe(true);
    expect(f.some((x) => x.includes('g-629-2') || x.includes('siirtymä'))).toBe(false);
  });

  it.skipIf(!HAS_FULL)('täysi aineisto: HANNA 42662 @858 610 ja ankkuri', () => {
    const story = createSeedStory();
    const via = { relation: 'r', layer: 'matemaattinen' as const, crossesRealm: false, trace: '', group: '' };
    const trail: TrailStep[] = [
      { ref: { kind: 'root' }, via: null },
      { ref: { kind: 'code', code: '42662' }, via },
      { ref: { kind: 'hit', code: '42662', n: 858610 }, via },
    ];
    const f = routeMathFacts(trail, FULL!, ANCHOR, story);
    expect(f).toContain('Lähtöankkuri IDA: 432 @858 511 ✓ digits 858 511–858 513 = 432');
    expect(f).toContain('42662 @858 610 ✓ digits 858 610–858 614 = 42662');
    expect(f).toContain('koodi 42662: 7 osumaa aineistossa (N = 1 000 000, odotus 10,0) ✓ laskettu');
  });
});

describe('hypoteesin ajoitus (sama sääntö kuin esirekisteröinnissä)', () => {
  const codes = ['629', '42662'];
  it('lukitus ennen yhtäkään saman kysymyksen ajoa → ennen löydöstä', () => {
    const v = evaluateRouteTiming(lock({}), [], codes, 'mikä-tahansa', 'sha');
    expect(v.timing).toBe('ennen-löydöstä');
    expect(v.preregistered).toBe(true);
    // ajo lukituksen jälkeen ei kumoa lukitusta (sama kuin Testit-välilehdellä)
    const after = evaluateRouteTiming(lock({}), [run({ ts: '2026-10-16T12:00:00.000Z' })], codes, 'mikä-tahansa', 'sha');
    expect(after.timing).toBe('ennen-löydöstä');
  });

  it('sama kysymys ajettu ennen lukitusta → löydön jälkeen ja syy kerrotaan', () => {
    const v = evaluateRouteTiming(lock({}), [run({ ts: '2026-10-16T10:00:00.000Z' })], codes, 'mikä-tahansa', 'sha');
    expect(v.timing).toBe('löydön-jälkeen');
    expect(v.preregistered).toBe(false);
    expect(v.reason).toMatch(/ennen lukitusta/);
  });

  it('R, siemen ja satunnaisjonot eivät muuta kysymystä; koodit, järjestys ja aineisto muuttavat', () => {
    const early = run({ ts: '2026-10-16T10:00:00.000Z', R: 5000, seed: 99, randomStrings: 20 });
    expect(evaluateRouteTiming(lock({}), [early], codes, 'mikä-tahansa', 'sha').timing).toBe('löydön-jälkeen');
    expect(evaluateRouteTiming(lock({ order: '234' }), [early], codes, '234', 'sha').timing).toBe('ennen-löydöstä');
    expect(evaluateRouteTiming(lock({ datasetSha: 'muu' }), [early], codes, 'mikä-tahansa', 'muu').timing).toBe('ennen-löydöstä');
    expect(evaluateRouteTiming(lock({ codes: ['42662', '629'] }), [early], ['42662', '629'], 'mikä-tahansa', 'sha').timing).toBe('ennen-löydöstä');
  });

  it('ei lukitusta: ei tiedossa, tai löydön jälkeen, jos kysymys on jo ajettu', () => {
    expect(evaluateRouteTiming(null, [], codes, 'mikä-tahansa', 'sha').timing).toBe('ei-tiedossa');
    expect(evaluateRouteTiming(null, [run({})], codes, 'mikä-tahansa', 'sha').timing).toBe('löydön-jälkeen');
    const other = evaluateRouteTiming(lock({ order: '432' }), [], codes, 'mikä-tahansa', 'sha');
    expect(other.timing).toBe('ei-tiedossa');
    expect(other.reason).toMatch(/eri kysymystä/);
  });

  it('tallennettu reitti: ”ennen löydöstä” vain voimassa olevalla lukituksella, muuten löydön jälkeen', () => {
    const now = '2026-10-16T13:00:00.000Z';
    const ok = savedRouteHypothesis('ennen-löydöstä', lock({}), [], now);
    expect(ok.downgraded).toBeNull();
    expect(ok.meta).toMatchObject({ timing: 'ennen-löydöstä', lockHash: 'a'.repeat(64), statedAt: '2026-10-16T11:00:00.000Z' });
    const none = savedRouteHypothesis('ennen-löydöstä', null, [], now);
    expect(none.meta.timing).toBe('löydön-jälkeen');
    expect(none.meta.lockHash).toBeNull();
    expect(none.downgraded).toMatch(/SHA-256/);
    const late = savedRouteHypothesis('ennen-löydöstä', lock({}), [run({ ts: '2026-10-16T10:00:00.000Z' })], now);
    expect(late.meta.timing).toBe('löydön-jälkeen');
    expect(savedRouteHypothesis('ei-tiedossa', null, [], now).meta).toEqual({ timing: 'ei-tiedossa', statedAt: now, lockHash: null, note: '' });
  });

  it('lukituksen kanoninen sisältö on deterministinen ja tiiviste 64 heksamerkkiä', async () => {
    const a = canonicalRouteLock('h', ['629'], '234', 'sha', 't');
    expect(a).toBe(canonicalRouteLock('h', ['629'], '234', 'sha', 't'));
    expect(a).not.toBe(canonicalRouteLock('h', ['629'], '432', 'sha', 't'));
    expect(a.endsWith('\nt')).toBe(true);
    expect(await sha256Hex(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('reitin koodit ja osumasta matriisiin', () => {
  it('ensimmäinen reittitesti: MAX, HANNA, SALLA, IDA', () => {
    expect(firstRouteCodes()).toEqual([
      { name: 'MAX', code: '629' },
      { name: 'HANNA', code: '42662' },
      { name: 'SALLA', code: '72552' },
      { name: 'IDA', code: '432' },
    ]);
  });

  it('testireitin murupolusta koodit 629 ja 42662 (sama koodi kerran)', () => {
    const e = env();
    const { trail } = firstTestRoute(e);
    expect(routeCodesFromTrail(trail, e.story)).toEqual([
      { name: 'MAX', code: '629' },
      { name: 'HANNA', code: '42662' },
    ]);
  });

  it('nimi T9:llä, numerojono sellaisenaan', () => {
    expect(namedCode('äiti')).toEqual({ name: 'ÄITI', code: '2484' });
    expect(namedCode(' 1414 ')).toEqual({ name: '1414', code: '1414' });
    expect(namedCode('  ')).toBeNull();
  });

  it('koodi, jolle juuresta ei ole särmää: askel merkitään avatuksi osumasta, osuma todellisella särmällä', () => {
    const e = env();
    const { trail, direct } = trailToHit(e, '926', 5, 'testi');
    expect(direct).toBe(false);
    expect(trail.map((s) => nodeKey(s.ref))).toEqual(['root', 'code:926', 'hit:926@5']);
    expect(trail[1].via?.group).toBe(OPENED_FROM_HIT_GROUP);
    expect(trail[2].via?.group).toMatch(/^Kaikki osumat/);
  });

  it.skipIf(!HAS_FULL)('lähtötunnisteen osuma: juuri → koodi → osuma todellisia särmiä pitkin', () => {
    const e = env(FULL!);
    const { trail, direct } = trailToHit(e, '432', 858511, 'IDA');
    expect(direct).toBe(true);
    expect(trail.map((s) => nodeKey(s.ref))).toEqual(['root', 'code:432', 'hit:432@858511']);
    expect(trail[1].via?.group).toBe(GROUPS.identifierCodes);
    expect(trail[2].via?.layer).toBe('matemaattinen');
  });
});

describe('reittitestin tiivistelmä', () => {
  it('ääretön tallennetaan nullina, ja tiivistelmä kestää JSON-kierroksen', async () => {
    const digits = FIXTURE_DIGITS;
    const codes = ['14', '92'];
    const hits = codes.map((c) => {
      const out: number[] = [];
      for (let i = digits.indexOf(c); i >= 0; i = digits.indexOf(c, i + 1)) out.push(i + 1);
      return out;
    });
    const res = await runRouteTest({ codes, hits, lens: [2, 2], N: digits.length, R: 50, seed: 7, order: '234' });
    const timing = evaluateRouteTiming(null, [], codes, '234', null);
    const s = summarizeRouteRun(res, { id: 'x', ts: 't', names: codes, seedText: '7', datasetSha: null, digits, timing, lock: null });
    expect(s.picks).toEqual(res.observed?.picks);
    expect(s.picksVerified).toEqual([true, true]);
    expect(s.timing).toBe('ei-tiedossa');
    expect(s.lockHash).toBeNull();
    expect(s.verdict).not.toBe('lukittu-alle-alfa');
    const m = { ...initialMatrixState(), routeRuns: [s, run({ id: 'y', span: null, nullMedian: null })] };
    const back = deserializeMatrix(viaJson(serializeMatrix(m))).state.routeRuns;
    expect(back[0]).toEqual(viaJson(s));
    expect(back[1].span).toBeNull();
  });
});

describe('käyttöliittymän apufunktiot', () => {
  it('verkkokuva: enintään 24 eri kohdetta, jokainen ryhmä mukana, ryhmät vierekkäin', () => {
    const e = env();
    const exp = expand({ kind: 'code', code: '5' }, e); // ~200 osumaa fixturessa
    const { targets, totalTargets } = pickGraphTargets(exp.edges, 24);
    expect(targets.length).toBeLessThanOrEqual(24);
    expect(new Set(targets.map((t) => t.key)).size).toBe(targets.length);
    expect(totalTargets).toBeGreaterThan(24);
    const groups = groupEdges(exp.edges).map((g) => g.group);
    for (const g of groups.slice(0, 24)) expect(targets.some((t) => t.edge.group === g)).toBe(true);
    const idx = targets.map((t) => t.groupIndex);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });

  it('suunnan selitys alueittain; 234/432 ovat lukusuuntia', () => {
    const e = env();
    const exp = expand({ kind: 'code', code: '14' }, e);
    const d = directionDomains(exp.edges, 'pi');
    expect(d).toEqual(['koodi', 'pi-indeksi']);
    expect(directionExplanation('234', d)).toBe('234 · koodi: numerot vasemmalta oikealle · π-indeksi: kasvava n');
    expect(directionExplanation('432', directionDomains([], 'tarina'))).toBe('432 · tarina: polkua takaperin');
  });

  it('mittarit ja askelmäärä', () => {
    expect(fmtMetricValue('n', 858610)).toBe('858 610');
    expect(fmtMetricValue('Δn', -251)).toBe('−251');
    expect(fmtMetricValue('chord', 0.0391331)).toBe('0,0391331');
    expect(stepsText(1)).toBe('1 askel');
    expect(stepsText(5)).toBe('5 askelta');
  });
});
