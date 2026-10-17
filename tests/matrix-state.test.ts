import { describe, expect, it } from 'vitest';
import { expand, GROUPS } from '../src/core/matrix/expand';
import { runRouteTest } from '../src/core/matrix/route-test';
import { createSeedStory, SEED_VERSION } from '../src/core/matrix/seed';
import { upsertPerson } from '../src/core/matrix/story';
import { firstTestRoute, rootTrail } from '../src/core/matrix/trail';
import type { MatrixEnv, MatrixLogEntry, TrailStep } from '../src/core/matrix/types';
import { MAX_DEPTH as SEL_MAX_DEPTH, nodeKey, type MatrixEvent as SelEvent } from '../src/core/matrix/types';
import { sha256Hex } from '../src/core/sha256';
import { benjaminiHochberg } from '../src/core/stats';
import {
  addRunToIndex,
  buildRunIndex,
  canonicalQuestion,
  canonicalRouteLock,
  classifyRouteRun,
  deserializeMatrix,
  deserializeTrail,
  editedPathMeta,
  emptyRunIndex,
  evaluateRouteTiming,
  familyExposure,
  firstLogTouch,
  firstRouteCodes,
  hitFact,
  initialMatrixState,
  lockFitsRoute,
  lockForQuestion,
  MatrixState,
  matrixEnvOf,
  mergeRunIndex,
  namedCode,
  OPENED_FROM_HIT_GROUP,
  RouteLock,
  routeBH,
  RouteRunSummary,
  routeCodesFromTrail,
  routeMathFacts,
  routeQuestionKey,
  sanitizeStory,
  savedRouteHypothesis,
  serializeMatrix,
  summarizeRouteRun,
  taskDerivedReason,
  trailToHit,
} from '../src/state/matrix';
import {
  appendHitStep,
  appendSelected,
  danglingEventPersons,
  personLinkLabel,
  SELECTED_BY_USER_GROUP,
  selectionEdge,
} from '../src/state/matrix-select';
import {
  directionDomains,
  directionExplanation,
  fmtMetricValue,
  groupEdges,
  minAngleGap,
  pickGraphTargets,
  realmRuns,
  ringAngles,
  ringLayout,
  stepsText,
} from '../src/ui/matrix/labels';
import { pickCandidates } from '../src/ui/matrix/picker';
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
    const story = viaJson(createSeedStory()) as { paths: { hypothesis: unknown; source: string }[] };
    story.paths[0].source = 'käyttäjä';
    story.paths[0].hypothesis = { timing: 'ennen-löydöstä', statedAt: null, lockHash: null, note: '' };
    const { state } = deserializeMatrix({ story });
    expect(state.story.paths[0].hypothesis.timing).toBe('ei-tiedossa');
  });

  it('siemenen polut: tehtävänannon polku on aina ”löydön jälkeen” perusteluineen', () => {
    for (const p of createSeedStory().paths) {
      expect(p.source).toBe('tehtävänanto');
      expect(p.hypothesis.timing).toBe('löydön-jälkeen');
      expect(p.hypothesis.lockHash).toBeNull();
      expect(p.hypothesis.note).toMatch(/IDA @858 511/);
      expect(p.hypothesis.note).toMatch(/HANNA @858 610, Δn \+99/);
    }
    // Vanha tallennus ('ei-tiedossa') ja väite 'ennen-löydöstä' muuttuvat; jälkimmäisestä varoitus.
    const story = viaJson(createSeedStory()) as { paths: { hypothesis: unknown }[] };
    story.paths[0].hypothesis = { timing: 'ei-tiedossa', statedAt: null, lockHash: null, note: 'vanha' };
    story.paths[1].hypothesis = { timing: 'ennen-löydöstä', statedAt: null, lockHash: 'a'.repeat(64), note: '' };
    const r = sanitizeStory(story, [lock({ codes: ['42662', '72552', '432'] })]);
    expect(r.story!.paths.map((p) => p.hypothesis.timing)).toEqual(['löydön-jälkeen', 'löydön-jälkeen']);
    expect(r.dropped).toHaveLength(1);
    expect(r.dropped[0]).toMatch(/Polku B.*tehtävänannon polku ei voi olla/);
  });

  it('tuotu polku: ”ennen löydöstä” vain tämän laitteen samojen koodien lukituksella, muuten ei tiedossa + varoitus', () => {
    const userPath = (lockHash: string) => ({
      id: 'p-oma',
      title: 'Oma polku',
      steps: [
        { name: 'MINI', personId: null, symbol: '1', stage: '' },
        { name: 'MATTI', personId: null, symbol: '2', stage: '' },
      ],
      source: 'käyttäjä',
      hypothesis: { timing: 'ennen-löydöstä', statedAt: null, lockHash, note: '' },
    });
    const raw = { version: 1, paths: [userPath('deadbeef')] };
    const forged = sanitizeStory(raw);
    expect(forged.story!.paths[0].hypothesis).toMatchObject({ timing: 'ei-tiedossa', lockHash: null });
    expect(forged.dropped.join(' ')).toMatch(/Oma polku.*muutettiin muotoon ”Ajoitus ei tiedossa”.*deadbeef/);
    const h = 'b'.repeat(64);
    // Väärien koodien lukitus ei kelpaa, samojen koodien (missä tahansa järjestyksessä) kelpaa.
    expect(sanitizeStory({ version: 1, paths: [userPath(h)] }, [lock({ hash: h })]).story!.paths[0].hypothesis.timing).toBe('ei-tiedossa');
    const ok = sanitizeStory({ version: 1, paths: [userPath(h)] }, [lock({ hash: h, codes: ['62884', '6464'] })]);
    expect(ok.story!.paths[0].hypothesis).toMatchObject({ timing: 'ennen-löydöstä', lockHash: h });
    expect(ok.dropped).toEqual([]);
    // Ladattaessa sama tarkistus tallennettuja lukituksia vasten.
    const { state, warnings } = deserializeMatrix({ story: raw, locks: [] });
    expect(state.story.paths[0].hypothesis.timing).toBe('ei-tiedossa');
    expect(warnings.join(' ')).toMatch(/Tallennettu tarina: Polku ”Oma polku”/);
  });

  it('polun askelten muokkaus: lähde käyttäjä ja ”löydön jälkeen” (muokattu); muu muutos säilyttää', () => {
    const b = createSeedStory().paths[1];
    const now = '2026-10-17T10:00:00.000Z';
    expect(editedPathMeta(b, b.steps.map((s) => ({ ...s })), now)).toEqual({ source: 'tehtävänanto', hypothesis: b.hypothesis });
    const swapped = [b.steps[2], b.steps[1], b.steps[0]];
    const e = editedPathMeta(b, swapped, now);
    expect(e.source).toBe('käyttäjä');
    expect(e.hypothesis).toMatchObject({ timing: 'löydön-jälkeen', lockHash: null, statedAt: now });
    expect(e.hypothesis.note).toMatch(/^Muokattu 2026-10-17 10:00:00 UTC: askeleita muutettiin \(alkuperäinen lähde tehtävänanto/);
    expect(editedPathMeta(b, [...b.steps.slice(0, 2), { ...b.steps[2], stage: 'uusi' }], now).hypothesis.timing).toBe('löydön-jälkeen');
    const fresh = editedPathMeta(null, b.steps, now);
    expect(fresh).toMatchObject({ source: 'käyttäjä', hypothesis: { timing: 'ei-tiedossa', lockHash: null } });
  });

  it('lukitus ladattaessa: tiivisteen on oltava SHA-256-muotoa; muuten ohitetaan ja ilmoitetaan', () => {
    const { state, warnings } = deserializeMatrix({ locks: [lock({ hash: 'NOT-A-HASH', createdAt: '2000-01-01T00:00:00.000Z' }), lock({ id: 'l2' })] });
    expect(state.locks.map((l) => l.id)).toEqual(['l2']);
    expect(warnings.join(' ')).toMatch(/Reittihypoteesien lukitukset: 1 virheellistä/);
  });

  it('tallennettu ajo: ”ennen löydöstä” ilman vastaavaa lukitusta → ei tiedossa, luokitus lasketaan uudelleen', () => {
    const forged = run({ timing: 'ennen-löydöstä', lockHash: 'zzz', lockId: 'x', verdict: 'lukittu-alle-alfa', pValue: 0.01, pHigh: 0.02 });
    const { state, warnings } = deserializeMatrix({ routeRuns: [forged], locks: [] });
    expect(state.routeRuns[0]).toMatchObject({ timing: 'ei-tiedossa', lockHash: null, lockId: null, verdict: 'eksploratiivinen' });
    expect(state.routeRuns[0].timingReason).toMatch(/hylättiin ladattaessa/);
    expect(warnings.join(' ')).toMatch(/Reittitestit: 1 ajon ajoitus/);
  });

  it('tallennettu ajo: lukituksen jälkeinen toinen ajo ei voi olla ”ennen löydöstä” (vanha data korjataan)', () => {
    // MAX + MINI (ei tehtävänannon koodijoukko).
    const l = lock({ createdAt: '2026-10-16T09:00:00.000Z', codes: ['629', '6464'] });
    const pre = { timing: 'ennen-löydöstä' as const, lockHash: l.hash, lockId: l.id, pValue: 0.01, pHigh: 0.02, verdict: 'lukittu-alle-alfa' as const };
    const first = run({ id: 'a', ts: '2026-10-16T11:00:00.000Z', codes: ['629', '6464'], ...pre });
    const second = run({ id: 'b', ts: '2026-10-16T12:00:00.000Z', seed: 33, codes: ['6464', '629'], ...pre });
    const { state } = deserializeMatrix(viaJson({ routeRuns: [first, second], locks: [l] }));
    expect(state.routeRuns[0]).toMatchObject({ timing: 'ennen-löydöstä', verdict: 'lukittu-alle-alfa' });
    expect(state.routeRuns[1]).toMatchObject({ timing: 'löydön-jälkeen', verdict: 'eksploratiivinen', lockHash: null });
    expect(state.routeRuns[1].timingReason).toMatch(/ei ollut koodijoukon ensimmäinen/);
  });

  it('tallennettu reitti: ”ennen löydöstä” vain samojen koodien lukituksella (lataus)', () => {
    const e = env();
    const { trail } = trailToHit(e, '926', 5, 'testi');
    const route = {
      id: 'r',
      title: 'R',
      createdAt: 't',
      trail: viaJson(trail),
      direction: '234',
      interpretation: '',
      hypothesis: { timing: 'ennen-löydöstä', statedAt: null, lockHash: 'a'.repeat(64), note: '' },
      mathFacts: [],
      crossings: [],
      matrixVersion: 'v',
    };
    const persistedTrail = serializeMatrix({ ...initialMatrixState(), saved: [{ ...route, trail } as never] }).saved[0].trail;
    const bad = deserializeMatrix({ saved: [{ ...route, trail: persistedTrail }], locks: [lock({})] });
    expect(bad.state.saved[0].hypothesis).toMatchObject({ timing: 'ei-tiedossa', lockHash: null });
    expect(bad.warnings.join(' ')).toMatch(/Tallennetut reitit: 1 reitin ajoitus/);
    const good = deserializeMatrix({ saved: [{ ...route, trail: persistedTrail }], locks: [lock({ codes: ['926'] })] });
    expect(good.state.saved[0].hypothesis.timing).toBe('ennen-löydöstä');
    expect(good.warnings).toEqual([]);
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

describe('hypoteesin ajoitus (sama sääntö kuin esirekisteröinnissä, tiukennettuna)', () => {
  const codes = ['629', '42662'];
  it('lukitus ennen yhtäkään saman koodijoukon ajoa → ennen löydöstä (tällä laitteella)', () => {
    const v = evaluateRouteTiming(lock({}), [], codes, 'mikä-tahansa', 'sha');
    expect(v.timing).toBe('ennen-löydöstä');
    expect(v.preregistered).toBe(true);
    expect(v.reason).toMatch(/lukittiin tällä laitteella/);
  });

  it('lukitus kattaa vain ensimmäisen ajon: siemenen tai R:n vaihto ei tee uudesta ajosta vahvistavaa', () => {
    const l = lock({ createdAt: '2026-10-16T09:00:00.000Z' });
    const runs = [11, 12, 13, 14, 15].map((h, i) => run({ id: `r${i}`, ts: `2026-10-16T${h}:00:00.000Z`, seed: 33 + i, R: 200 }));
    for (let k = 1; k <= runs.length; k++) {
      const v = evaluateRouteTiming(l, runs.slice(0, k), codes, 'mikä-tahansa', 'sha');
      expect(v.timing).toBe('löydön-jälkeen');
      expect(v.preregistered).toBe(false);
      expect(v.reason).toMatch(/kattaa vain ensimmäisen ajon/);
    }
  });

  it('sama kysymys ajettu ennen lukitusta → löydön jälkeen ja syy kerrotaan', () => {
    const v = evaluateRouteTiming(lock({}), [run({ ts: '2026-10-16T10:00:00.000Z' })], codes, 'mikä-tahansa', 'sha');
    expect(v.timing).toBe('löydön-jälkeen');
    expect(v.preregistered).toBe(false);
    expect(v.reason).toMatch(/ennen lukitusta/);
  });

  it('kanoninen kysymys: mikä tahansa → lajitellut koodit, 432 → käänteiset koodit 234:nä, aineisto mukana', () => {
    const A = ['629', '42662', '72552', '432'];
    const B = ['432', '72552', '42662', '629'];
    expect(routeQuestionKey(A, 'mikä-tahansa', 's')).toBe(routeQuestionKey(B, 'mikä-tahansa', 's'));
    expect(routeQuestionKey(['42662', '629', '432', '72552'], 'mikä-tahansa', 's')).toBe(routeQuestionKey(A, 'mikä-tahansa', 's'));
    expect(routeQuestionKey(A, '432', 's')).toBe(routeQuestionKey(B, '234', 's'));
    expect(routeQuestionKey(A, '234', 's')).not.toBe(routeQuestionKey(B, '234', 's'));
    expect(routeQuestionKey(A, '234', 's')).not.toBe(routeQuestionKey(A, 'mikä-tahansa', 's'));
    expect(routeQuestionKey(A, '234', 's')).not.toBe(routeQuestionKey(A, '234', 't'));
    expect(canonicalQuestion(A, '432')).toEqual({ codes: B, order: '234' });
    // Sama kanoninen kysymys → sama lukituksen kanoninen sisältö.
    expect(canonicalRouteLock('h', A, '432', 's', 't')).toBe(canonicalRouteLock('h', B, '234', 's', 't'));
    expect(lockForQuestion([lock({ id: 'myöh', createdAt: '2026-10-16T12:00:00.000Z' }), lock({ id: 'aik', codes: ['42662', '629'] })], codes, 'mikä-tahansa', 'sha')?.id).toBe('aik');
  });

  it('saman koodijoukon mikä tahansa järjestysvariantti on aiempi altistus (htiming A ja B)', () => {
    const A = ['629', '42662', '72552', '432'];
    const B = ['432', '72552', '42662', '629'];
    const any = run({ ts: '2026-10-16T10:00:00.000Z', codes: A, order: 'mikä-tahansa' });
    const later = lock({ createdAt: '2026-10-16T11:00:00.000Z', codes: B, order: 'mikä-tahansa' });
    expect(evaluateRouteTiming(later, [any], B, 'mikä-tahansa', 'sha').timing).toBe('löydön-jälkeen');
    // 234-ajo ja käänteinen 432-lukitus ovat sama kysymys.
    const fwd = run({ ts: '2026-10-16T10:00:00.000Z', codes: A, order: '234' });
    expect(evaluateRouteTiming(lock({ codes: B, order: '432' }), [fwd], B, '432', 'sha').timing).toBe('löydön-jälkeen');
    // Eri järjestysehto samalle koodijoukolle: tulos kertoo myös muista, joten altistus.
    const v = evaluateRouteTiming(lock({ codes: A, order: '234' }), [any], A, '234', 'sha');
    expect(v.timing).toBe('löydön-jälkeen');
    expect(v.reason).toMatch(/muulla järjestysehdolla/);
    // Ilman lukitusta permutoitu koodilista on jo nähty (ei 'ei-tiedossa').
    expect(evaluateRouteTiming(null, [any], ['42662', '629', '432', '72552'], 'mikä-tahansa', 'sha').timing).toBe('löydön-jälkeen');
  });

  it('R, siemen ja satunnaisjonot eivät muuta kysymystä; aineisto ja koodijoukko muuttavat', () => {
    const early = run({ ts: '2026-10-16T10:00:00.000Z', R: 5000, seed: 99, randomStrings: 20 });
    expect(evaluateRouteTiming(lock({}), [early], codes, 'mikä-tahansa', 'sha').timing).toBe('löydön-jälkeen');
    expect(evaluateRouteTiming(lock({ order: '234' }), [early], codes, '234', 'sha').timing).toBe('löydön-jälkeen');
    expect(evaluateRouteTiming(lock({ codes: ['42662', '629'] }), [early], ['42662', '629'], 'mikä-tahansa', 'sha').timing).toBe('löydön-jälkeen');
    expect(evaluateRouteTiming(lock({ datasetSha: 'muu' }), [early], codes, 'mikä-tahansa', 'muu').timing).toBe('ennen-löydöstä');
    const other = ['629', '6464'];
    expect(evaluateRouteTiming(lock({ codes: other }), [early], other, 'mikä-tahansa', 'sha').timing).toBe('ennen-löydöstä');
  });

  it('tehtävänannon reitti ei voi olla ”ennen löydöstä”, vaikka lukitus olisi ennen ajoa', () => {
    const story = createSeedStory();
    const first = firstRouteCodes().map((c) => c.code);
    const reason = taskDerivedReason([...first].reverse(), story);
    expect(reason).toMatch(/tehtävänannosta \(ensimmäinen reittitesti MAX → HANNA → SALLA → IDA\)/);
    expect(reason).toMatch(/IDA @858 511/);
    expect(taskDerivedReason(['42662', '72552', '432'], story)).toMatch(/Polku B/);
    expect(taskDerivedReason(['629', '42662'], story)).toMatch(/testireitti MAX/);
    expect(taskDerivedReason(['629', '6464'], story)).toBeNull();
    expect(taskDerivedReason(['629', '6464'], story, 'Polku X')).toMatch(/Polku X/);
    const v = evaluateRouteTiming(lock({ codes: first, order: '432' }), [], first, '432', 'sha', reason);
    expect(v).toMatchObject({ timing: 'löydön-jälkeen', preregistered: false });
    expect(v.reason).toMatch(/Lukitus ei muuta tätä/);
  });

  it('luokitus: lukittu p ≤ α vain, jos Wilsonin yläraja ≤ α; muuten Monte Carlo ei ratkaise', () => {
    const base = { alpha: 0.05, timing: 'ennen-löydöstä' as const, lockHash: 'h' };
    const unsure = classifyRouteRun({ ...base, pValue: 0.0448, pHigh: 0.077 });
    expect(unsure).toMatchObject({ verdict: 'eksploratiivinen', inconclusive: true, title: 'Ennalta lukittu, Monte Carlo ei ratkaise' });
    expect(unsure.text).toMatch(/Wilsonin 95 %:n välin yläraja 0\.077 ylittää α:n/);
    expect(classifyRouteRun({ ...base, pValue: 0.01, pHigh: 0.03 })).toMatchObject({ verdict: 'lukittu-alle-alfa', inconclusive: false });
    expect(classifyRouteRun({ ...base, pValue: 0.01, pHigh: NaN }).verdict).toBe('eksploratiivinen');
    expect(classifyRouteRun({ ...base, pValue: 0.2, pHigh: 0.25 }).verdict).toBe('ei-poikkeamaa');
    const late = classifyRouteRun({ alpha: 0.05, timing: 'löydön-jälkeen', lockHash: null, pValue: 0.01, pHigh: 0.03 });
    expect(late.verdict).toBe('eksploratiivinen');
    expect(late.text).toMatch(/muodostettu löydön jälkeen/);
    expect(classifyRouteRun({ alpha: 0.05, timing: 'ei-tiedossa', lockHash: null, pValue: 0.01, pHigh: 0.03 }).text).toMatch(/ei lukittu ennen ajoa/);
  });

  it('ei lukitusta: ei tiedossa, tai löydön jälkeen, jos kysymys on jo ajettu', () => {
    expect(evaluateRouteTiming(null, [], codes, 'mikä-tahansa', 'sha').timing).toBe('ei-tiedossa');
    expect(evaluateRouteTiming(null, [run({})], codes, 'mikä-tahansa', 'sha').timing).toBe('löydön-jälkeen');
    const other = evaluateRouteTiming(lock({ order: '432' }), [], codes, 'mikä-tahansa', 'sha');
    expect(other.timing).toBe('ei-tiedossa');
    expect(other.reason).toMatch(/eri kysymystä/);
  });

  describe('tallennettu reitti', () => {
    const via = { relation: 'r', layer: 'matemaattinen' as const, crossesRealm: false, trace: '', group: '' };
    const story = createSeedStory();
    // Reitti juuri → koodi 1415 → koodi 9265 (ei tehtävänannon koodijoukko).
    const trail: TrailStep[] = [
      { ref: { kind: 'root' }, via: null },
      { ref: { kind: 'code', code: '1415' }, via },
      { ref: { kind: 'code', code: '9265' }, via },
    ];
    const log: MatrixLogEntry[] = [
      { ts: '2026-10-16T12:00:00.000Z', kind: 'avaus', text: 'Avattiin code:1415 · r (Matemaattinen)', ref: 'code:1415' },
      { ts: '2026-10-16T12:01:00.000Z', kind: 'avaus', text: 'Avattiin code:9265 · r (Matemaattinen)', ref: 'code:9265' },
    ];
    const ctx = { trail, story, log };
    const now = '2026-10-16T13:00:00.000Z';
    const good = lock({ codes: ['1415', '9265'], names: ['1415', '9265'], order: '234' });

    it('”ennen löydöstä” vain tämän reitin koodien lukituksella, joka edeltää π-solmujen avaamista', () => {
      const ok = savedRouteHypothesis('ennen-löydöstä', good, [], now, ctx);
      expect(ok.downgraded).toBeNull();
      expect(ok.meta).toMatchObject({ timing: 'ennen-löydöstä', lockHash: 'a'.repeat(64), statedAt: '2026-10-16T11:00:00.000Z' });
      expect(ok.meta.note).toMatch(/tällä laitteella/);
      // Sama kysymys toisin kirjoitettuna: käänteiset koodit järjestyksellä 432 ja mikä tahansa järjestys.
      expect(lockFitsRoute(lock({ codes: ['9265', '1415'], order: '432' }), [], ctx).ok).toBe(true);
      expect(lockFitsRoute(lock({ codes: ['9265', '1415'], order: 'mikä-tahansa' }), [], ctx).ok).toBe(true);
      // Ajo lukituksen jälkeen ei kumoa reitin ennakkolukitusta.
      expect(lockFitsRoute(good, [run({ codes: ['1415', '9265'], ts: '2026-10-16T12:30:00.000Z' })], ctx).ok).toBe(true);
    });

    it('eri koodien lukitus, myöhäinen lukitus, puuttuva loki tai aiempi ajo → löydön jälkeen ja syy', () => {
      const unrelated = savedRouteHypothesis('ennen-löydöstä', lock({ codes: ['62884', '6464'], names: ['MATTI', 'MINI'] }), [], now, ctx);
      expect(unrelated.meta).toMatchObject({ timing: 'löydön-jälkeen', lockHash: null });
      expect(unrelated.downgraded).toMatch(/eri kysymystä \(MATTI → MINI/);
      expect(lockFitsRoute(lock({ codes: ['1415', '9265', '432'] }), [], ctx).ok).toBe(false);
      const late = lockFitsRoute({ ...good, createdAt: '2026-10-16T12:00:30.000Z' }, [], ctx);
      expect(late.ok).toBe(false);
      expect(late.reason).toMatch(/Solmu code:1415 avattiin 2026-10-16 12:00:00 UTC, ennen lukitusta/);
      const noLog = lockFitsRoute(good, [], { ...ctx, log: log.slice(0, 1) });
      expect(noLog.reason).toMatch(/code:9265 ensimmäistä avausta ei löydy lokista/);
      const ranBefore = lockFitsRoute(good, [run({ codes: ['9265', '1415'], ts: '2026-10-16T10:00:00.000Z' })], ctx);
      expect(ranBefore.reason).toMatch(/ennen lukitusta/);
      const none = savedRouteHypothesis('ennen-löydöstä', null, [], now, ctx);
      expect(none.meta).toMatchObject({ timing: 'löydön-jälkeen', lockHash: null });
      expect(none.downgraded).toMatch(/SHA-256/);
      expect(savedRouteHypothesis('ei-tiedossa', null, [], now, ctx).meta).toEqual({ timing: 'ei-tiedossa', statedAt: now, lockHash: null, note: '' });
    });

    it('tehtävänannon testireitti on aina ”löydön jälkeen”, myös ”ei tiedossa” -valinnalla', () => {
      const e = env();
      const t = firstTestRoute(e).trail;
      const tlog: MatrixLogEntry[] = [{ ts: '2026-10-16T12:00:00.000Z', kind: 'avaus', text: `Ensimmäinen testireitti: ${t.map((s) => nodeKey(s.ref)).join(' → ')}` }];
      const tctx = { trail: t, story: e.story, log: tlog };
      const l = lock({ codes: ['629', '42662'], order: '234' });
      const v = savedRouteHypothesis('ennen-löydöstä', l, [], now, tctx);
      expect(v.meta.timing).toBe('löydön-jälkeen');
      expect(v.downgraded).toMatch(/tehtävänannosta \(testireitti MAX/);
      const u = savedRouteHypothesis('ei-tiedossa', null, [], now, tctx);
      expect(u.meta.timing).toBe('löydön-jälkeen');
      expect(u.meta.note).toMatch(/IDA @858 511/);
    });

    it('lokimaininta: avain tunnistetaan kokonaisena (code:62 ≠ code:629)', () => {
      const l2: MatrixLogEntry[] = [
        { ts: '2026-10-16T10:00:00.000Z', kind: 'avaus', text: 'Avattiin code:629 · r' },
        { ts: '2026-10-16T11:00:00.000Z', kind: 'avaus', text: 'Ensimmäinen testireitti: root → code:62 → digit:62#1' },
      ];
      expect(firstLogTouch(l2, 'code:62')).toBe('2026-10-16T11:00:00.000Z');
      expect(firstLogTouch(l2, 'code:629')).toBe('2026-10-16T10:00:00.000Z');
      expect(firstLogTouch(l2, 'code:6')).toBeNull();
    });
  });

  it('lukituksen kanoninen sisältö on deterministinen ja tiiviste 64 heksamerkkiä', async () => {
    const a = canonicalRouteLock('h', ['629', '432'], '234', 'sha', 't');
    expect(a).toBe(canonicalRouteLock('h', ['629', '432'], '234', 'sha', 't'));
    expect(a).not.toBe(canonicalRouteLock('h', ['629', '432'], '432', 'sha', 't'));
    expect(a).toBe(canonicalRouteLock('h', ['432', '629'], '432', 'sha', 't'));
    expect(a.endsWith('\nt')).toBe(true);
    expect(await sha256Hex(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('reittitestien rajaamaton hakemisto ja monivertailu', () => {
  it('yli 300 ajoa: vanhin ajo säilyy hakemistossa, joten sen kysymys on edelleen nähty ja m on todellinen', () => {
    const q = ['629', '42662'];
    const runs = [run({ id: 'q', ts: '2026-10-16T08:00:00.000Z', codes: q })];
    for (let i = 0; i < 300; i++) runs.push(run({ id: `o${i}`, ts: `2026-10-16T09:${String(i % 60).padStart(2, '0')}:00.000Z`, codes: ['14', String(100 + i)] }));
    const m: MatrixState = { ...initialMatrixState(), routeRuns: runs, runIndex: buildRunIndex(runs) };
    const p = serializeMatrix(m);
    expect(p.routeRuns).toHaveLength(300);
    expect(p.routeRuns.some((r) => r.id === 'q')).toBe(false);
    const { state, warnings } = deserializeMatrix(viaJson(p));
    expect(warnings).toEqual([]);
    expect(state.routeRuns).toHaveLength(300);
    expect(state.runIndex.total).toBe(301);
    const l = lock({ codes: ['42662', '629'], createdAt: '2026-10-16T12:00:00.000Z' });
    expect(evaluateRouteTiming(l, state.runIndex, ['42662', '629'], 'mikä-tahansa', 'sha').timing).toBe('löydön-jälkeen');
    // Vanha tallennus ilman hakemistoa: rakennetaan tallennetuista ajoista.
    const legacy = deserializeMatrix(viaJson({ ...p, runIndex: undefined })).state.runIndex;
    expect(legacy.total).toBe(300);
    expect(Object.values(legacy.questions).reduce((a, v) => a + v.count, 0)).toBe(300);
  });

  it('hakemisto: avaimet kanonisiksi, lisäys kasvattaa määrää ja säilyttää ensimmäisen ajon', () => {
    let ix = emptyRunIndex();
    ix = addRunToIndex(ix, run({ ts: '2026-10-16T10:00:00.000Z', codes: ['42662', '629'] }));
    ix = addRunToIndex(ix, run({ ts: '2026-10-16T09:00:00.000Z', codes: ['629', '42662'] }));
    expect(ix.total).toBe(2);
    expect(Object.values(ix.questions)).toEqual([{ first: '2026-10-16T09:00:00.000Z', count: 2 }]);
    // Tallennettu ei-kanoninen avain ja virheelliset rivit.
    const raw = {
      runIndex: {
        questions: {
          [JSON.stringify([['42662', '629'], 'mikä-tahansa', 'sha'])]: { first: '2026-10-16T07:00:00.000Z', count: 3 },
          [JSON.stringify([['629', '42662'], 'mikä-tahansa', 'sha'])]: { first: '2026-10-16T08:00:00.000Z', count: 1 },
          roska: { first: 'x', count: 1 },
          ['__proto__']: { first: 'x', count: 1 },
        },
        total: 4,
      },
    };
    const st = deserializeMatrix(viaJson(raw)).state.runIndex;
    expect(st.total).toBe(4);
    expect(Object.entries(st.questions)).toEqual([[routeQuestionKey(['629', '42662'], 'mikä-tahansa', 'sha'), { first: '2026-10-16T07:00:00.000Z', count: 4 }]]);
    const fx = familyExposure(st, ['42662', '629'], 'sha', '234');
    expect(fx).toEqual({ count: 4, same: 0, first: '2026-10-16T07:00:00.000Z' });
    expect(mergeRunIndex(emptyRunIndex(), [run({})]).total).toBe(1);
  });

  it('BH: m = kaikki ajot; puuttuvat vanhat p-arvot oletetaan ykkösiksi (q ei aliarvioidu)', () => {
    const ps = [0.01, 0.04, 0.2];
    expect(routeBH(ps, 3)).toEqual(benjaminiHochberg(ps));
    expect(routeBH([0.01], 10)[0]).toBeCloseTo(0.1, 12);
    const padded = routeBH(ps, 50);
    padded.forEach((q, i) => expect(q).toBeGreaterThanOrEqual(benjaminiHochberg(ps)[i]));
    expect(routeBH(ps, 1)).toEqual(benjaminiHochberg(ps));
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
    // Lukittu ensimmäinen ajo: tiiviste mukaan ja luokitus classifyRouteRun-säännöllä (Wilsonin yläraja).
    const l = lock({ codes, order: '234', datasetSha: null });
    const pre = evaluateRouteTiming(l, [], codes, '234', null);
    expect(pre.preregistered).toBe(true);
    const sp = summarizeRouteRun(res, { id: 'z', ts: 't', names: codes, seedText: '7', datasetSha: null, digits, timing: pre, lock: l });
    expect(sp).toMatchObject({ timing: 'ennen-löydöstä', lockHash: l.hash, lockId: l.id });
    expect(sp.verdict).toBe(classifyRouteRun(sp).verdict);
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

  it('verkkokuvan kehä: solmut eivät osu keskilapun vaakakaistaan, järjestys säilyy myötäpäivään', () => {
    const clearance = 22.5;
    for (const r of [52, 63, 90]) {
      for (let n = 1; n <= 24; n++) {
        const a = ringAngles(n, r, clearance);
        expect(a.length).toBe(n);
        // Jokainen solmu on vähintään `clearance` vaakaakselin ylä- tai alapuolella.
        for (const t of a) expect(Math.abs(r * Math.sin(t))).toBeGreaterThanOrEqual(clearance - 1e-6);
        // Kulmat kasvavat (myötäpäivään) ja mahtuvat yhdelle kierrokselle.
        for (let i = 1; i < n; i++) expect(a[i]).toBeGreaterThan(a[i - 1]);
        expect(a[n - 1] - a[0]).toBeLessThan(2 * Math.PI);
        if (n >= 2) expect(minAngleGap(a)).toBeGreaterThan(0.15);
      }
    }
    // Yksi kohde ylhäällä; neljä kohdetta vinottain (ei vasemmalla eikä oikealla keskilapun kohdalla).
    expect(ringAngles(1, 52, clearance)).toEqual([-Math.PI / 2]);
    expect(ringAngles(4, 52, clearance).map((t) => Math.round((t * 180) / Math.PI))).toEqual([-45, 45, 135, 225]);
  });

  it('verkkokuvan asettelu: keskilappu ei peitä solmuja, eivätkä solmut ahtaudu päällekkäin kaarilla', () => {
    const h2 = 13;
    const nodeR = 6.5;
    for (const r of [52, 63, 90]) {
      for (const wantHalf of [30, 60, 110, 145]) {
        for (let n = 1; n <= 24; n++) {
          const { angles, pillHalf } = ringLayout(n, r, wantHalf, h2, nodeR);
          expect(angles.length).toBe(n);
          expect(pillHalf).toBeLessThanOrEqual(wantHalf);
          for (const t of angles) {
            const x = Math.abs(r * Math.cos(t));
            const y = Math.abs(r * Math.sin(t));
            // Solmun ympyrä ei leikkaa lapun suorakulmiota.
            expect(y >= h2 + nodeR || x >= pillHalf + nodeR).toBe(true);
          }
          const step = (2 * Math.PI) / n;
          const uniform = n < 2 || Math.abs(minAngleGap(angles) - step) < 1e-9;
          // Kaariasettelua käytetään vain, jos vierekkäiset solmut eivät mene päällekkäin.
          if (!uniform) expect(r * minAngleGap(angles)).toBeGreaterThanOrEqual(2 * nodeR + 3);
        }
      }
    }
    // Lyhyt otsikko ja 24 kohdetta: tasavälinen kehä säilyy, lappu täysleveänä.
    expect(ringLayout(24, 63, 33, h2, nodeR).pillHalf).toBe(33);
    // Pitkä otsikko ja 24 kohdetta ahtaalla kehällä: lappu kapenee solmujen väliin.
    expect(ringLayout(24, 63, 110, h2, nodeR).pillHalf).toBeLessThan(63 - nodeR);
    // Pitkä otsikko ja vähän kohteita: solmut kaarille, lappu täysleveänä.
    expect(ringLayout(13, 63, 110, h2, nodeR).pillHalf).toBe(110);
  });

  it('murupolun kerrokset ryhminä: kerrosvaihto on ryhmien raja', () => {
    expect(realmRuns(['pi', 'pi', 'pi', 'tarina', 'tarina', 'tarina'])).toEqual([
      { realm: 'pi', count: 3 },
      { realm: 'tarina', count: 3 },
    ]);
    expect(realmRuns(['pi', 'tarina', 'pi'])).toEqual([
      { realm: 'pi', count: 1 },
      { realm: 'tarina', count: 1 },
      { realm: 'pi', count: 1 },
    ]);
    expect(realmRuns([])).toEqual([]);
  });
});

// ------------------------------------------------------------------ solmuvalitsin ja polun säilyttävät avaukset
// (src/state/matrix-select.ts, src/ui/matrix/picker.ts).

const SEL_EVENTS: SelEvent[] = [
  { id: 'e1', title: 'Ainon syntymä', date: '1950-01-01', note: '', linkedHits: [], personIds: ['aino', 'hanna-3'] },
  { id: 'e2', title: 'Muutto', date: '1960-05-01', note: '', linkedHits: [] },
];

describe('valittu solmu polun loppuun: näkyvä askel, ei laskettu yhteys', () => {
  it('juuresta tulkintaan 23: ryhmä, taso kohteen kerroksesta, kerrosvaihto laskettu, jäljitys kertoo ettei yhteyttä laskettu', () => {
    const r = appendSelected(rootTrail(), { kind: 'gloss', glossId: 'g-23' }, '23 = hälytys', 'solmuvalitsin');
    expect(r.result).toBe('lisätty');
    expect(r.trail.map((s) => nodeKey(s.ref))).toEqual(['root', 'gloss:g-23']);
    const via = r.trail[1].via!;
    expect(via.group).toBe(SELECTED_BY_USER_GROUP);
    expect(via.layer).toBe('symbolinen');
    expect(via.crossesRealm).toBe(true);
    expect(via.relation).toMatch(/^valittu käyttäjän toimesta \(solmuvalitsin\)/);
    expect(via.trace).toMatch(/ei ole laskettu eikä tarinamallista johdettu yhteys edelliseen solmuun root/);
  });

  it('π-solmusta π-solmuun: matemaattinen, ei kerrosvaihtoa; tarinasta π-dataan: kerrosvaihto', () => {
    const a = selectionEdge({ kind: 'code', code: '629' }, { kind: 'position', n: 5 }, '@5', 'solmuvalitsin');
    expect(a.layer).toBe('matemaattinen');
    expect(a.crossesRealm).toBe(false);
    const b = selectionEdge({ kind: 'person', personId: 'max' }, { kind: 'code', code: '23' }, 'koodi 23', 'solmuvalitsin');
    expect(b.layer).toBe('matemaattinen');
    expect(b.crossesRealm).toBe(true);
    const c = selectionEdge({ kind: 'person', personId: 'max' }, { kind: 'event', eventId: 'e1' }, 'Ainon syntymä', 'tapahtumapaneeli');
    expect(c.layer).toBe('symbolinen');
    expect(c.crossesRealm).toBe(false);
  });

  it('nykyinen polku säilyy: testireitin perään tulkinta 43; polulla oleva solmu katkaisee polun siihen', () => {
    const { trail } = firstTestRoute(env());
    const r = appendSelected(trail, { kind: 'gloss', glossId: 'g-43' }, '43', 'Tarina-sivu');
    expect(r.result).toBe('lisätty');
    expect(r.trail.slice(0, trail.length)).toEqual(trail);
    expect(r.trail).toHaveLength(trail.length + 1);
    expect(nodeKey(r.trail[trail.length].ref)).toBe('gloss:g-43');
    expect(r.trail[trail.length].via!.crossesRealm).toBe(false); // henkilö → tulkinta: molemmat tarinaverkkoa
    const back = appendSelected(trail, { kind: 'code', code: '629' }, 'MAX 629', 'solmuvalitsin');
    expect(back.result).toBe('palattu');
    expect(back.trail.map((s) => nodeKey(s.ref))).toEqual(['root', 'code:629']);
  });

  it('syvyysraja estää lisäyksen, ja polku pysyy ennallaan', () => {
    const via = { relation: 'r', layer: 'matemaattinen' as const, crossesRealm: false, trace: '', group: '' };
    const long: TrailStep[] = [
      { ref: { kind: 'root' }, via: null },
      ...Array.from({ length: SEL_MAX_DEPTH - 1 }, (_, i) => ({ ref: { kind: 'position' as const, n: i + 1 }, via })),
    ];
    const r = appendSelected(long, { kind: 'gloss', glossId: 'g-23' }, '23', 'solmuvalitsin');
    expect(r.result).toBe('syvyysraja');
    expect(r.trail).toBe(long);
  });

  it('valittu askel säilyy tallennuksessa ja latauksessa', () => {
    const r = appendSelected(rootTrail(), { kind: 'gloss', glossId: 'g-23' }, '23', 'solmuvalitsin');
    const { state, warnings } = deserializeMatrix(viaJson(serializeMatrix({ ...initialMatrixState(), trail: r.trail })));
    expect(warnings).toEqual([]);
    expect(state.trail).toEqual(r.trail);
  });
});

describe('osuma toisesta näkymästä: nykyinen polku säilyy', () => {
  it('osuma lisätään polun loppuun askeleena "avattu osumasta"; π-fakta tarkistetaan lähdeaineistosta', () => {
    const { trail } = firstTestRoute(env());
    const r = appendHitStep(trail, FIXTURE_DIGITS, '926', 5, 'testi');
    expect(r.result).toBe('lisätty');
    expect(r.trail.slice(0, trail.length)).toEqual(trail);
    const st = r.trail[r.trail.length - 1];
    expect(nodeKey(st.ref)).toBe('hit:926@5');
    expect(st.via!.group).toBe(OPENED_FROM_HIT_GROUP);
    expect(st.via!.layer).toBe('matemaattinen');
    expect(st.via!.crossesRealm).toBe(true); // henkilö (tarinaverkko) → osuma (π-data)
    expect(st.via!.trace).toContain('926 @5 ✓ digits 5–7 = 926');
    expect(st.via!.trace).toMatch(/ei ole laskettu yhteys/);
  });

  it('polulla jo oleva osuma: palataan siihen; täsmäämätön osuma merkitään jäljitykseen', () => {
    const base = appendHitStep(rootTrail(), FIXTURE_DIGITS, '926', 5, 'testi').trail;
    const more = appendSelected(base, { kind: 'gloss', glossId: 'g-23' }, '23', 'solmuvalitsin').trail;
    const back = appendHitStep(more, FIXTURE_DIGITS, '926', 5, 'testi');
    expect(back.result).toBe('palattu');
    expect(back.trail.map((s) => nodeKey(s.ref))).toEqual(['root', 'hit:926@5']);
    const bad = appendHitStep(rootTrail(), FIXTURE_DIGITS, '926', 6, 'testi');
    expect(bad.trail[1].via!.trace).toMatch(/ei täsmää lähdeaineistoon/);
    expect(bad.trail[1].via!.crossesRealm).toBe(false);
  });
});

describe('solmuvalitsimen haku', () => {
  const story = createSeedStory();
  const N = FIXTURE_DIGITS.length;
  const keys = (q: string) => pickCandidates(q, story, SEL_EVENTS, N).items.map((c) => c.key);

  it('numerojono: koodi, saman symbolin tulkinnat ja π-indeksi (tulkinnat 23 ja 43 saavutettavissa)', () => {
    expect(keys('23')).toEqual(['code:23', 'gloss:g-23', 'pos:23']);
    expect(keys('43')).toEqual(['code:43', 'gloss:g-43', 'pos:43']);
    expect(keys(' 6 2 9 ')).toEqual(['code:629', 'gloss:g-629-6', 'gloss:g-629-2', 'gloss:g-629-9', 'pos:629']);
  });

  it('yksi numero: koodi ja numeron tulkinnat kaikissa konteksteissa', () => {
    const k = keys('2');
    expect(k[0]).toBe('code:2');
    expect(k).toEqual(expect.arrayContaining(['gloss:g-2-tarina', 'gloss:g-629-2', 'gloss:g-b-2', 'pos:2']));
  });

  it('@n ja n=…: vain π-indeksi aineiston rajoissa; etunolla ei ole indeksi', () => {
    expect(keys('@858 511')).toEqual([]); // fixture: 2000 numeroa
    expect(keys('@1 500')).toEqual(['pos:1500']);
    expect(keys('n=7')).toEqual(['pos:7']);
    expect(keys('@0')).toEqual([]);
    expect(keys('0123')).toEqual(['code:0123']);
  });

  it('teksti: nimi, henkilöt, tulkinnat, polut ja tapahtumat', () => {
    const k = keys('hanna');
    expect(k[0]).toBe('name:HANNA');
    expect(k).toEqual(expect.arrayContaining(['person:hanna-1', 'person:hanna-2', 'person:hanna-3', 'gloss:g-629-2', 'gloss:g-b-2']));
    expect(keys('polku b')).toContain('path:polku-b');
    expect(keys('ainon')).toEqual(['name:AINON', 'event:e1']);
    expect(keys('hälytys')).toContain('gloss:g-23');
    expect(pickCandidates('hanna', story, SEL_EVENTS, N).items.find((c) => c.key === 'name:HANNA')?.hint).toBe('nimi · T9 42662');
  });

  it('tyhjä haku: tarinan henkilöt, tulkinnat, polut ja tapahtumat; raja ja kokonaismäärä', () => {
    const all = pickCandidates('', story, SEL_EVENTS, N, 1000);
    expect(all.total).toBe(story.persons.length + story.glosses.length + story.paths.length + SEL_EVENTS.length);
    expect(all.items.every((c) => c.ref.kind !== 'root')).toBe(true);
    const few = pickCandidates('', story, SEL_EVENTS, N, 5);
    expect(few.items).toHaveLength(5);
    expect(few.total).toBe(all.total);
  });
});

describe('tarinan korvaus: tapahtumien henkilölinkit', () => {
  it('listaa vain uudesta tarinasta puuttuvat henkilöt; nimi nykyisestä tarinasta', () => {
    const seed = createSeedStory();
    expect(danglingEventPersons(SEL_EVENTS, seed)).toEqual([{ eventId: 'e1', title: 'Ainon syntymä', personIds: ['aino'] }]);
    expect(danglingEventPersons([], seed)).toEqual([]);
    const withAino = upsertPerson(seed, {
      id: 'aino',
      name: 'AINO',
      homonymOrdinal: null,
      description: '',
      roles: [],
      period: null,
      source: 'käyttäjä',
      createdAt: '2026-10-16T12:00:00.000Z',
    });
    expect(danglingEventPersons(SEL_EVENTS, withAino)).toEqual([]);
    expect(personLinkLabel(withAino, 'aino')).toBe('AINO (aino)');
    expect(personLinkLabel(seed, 'aino')).toBe('aino');
  });
});
