// Polkuhaun tila (src/state/path.ts) ja toiminnot storea vasten (src/state/path-actions.ts): tallennusmuodon
// kiertokulku ja virheellinen syöte, eksploratiivisuuden sääntö, lukitus ennen ajoa (SHA-256 ennen moottorikutsua),
// yksi moottorityö kerrallaan ja reitin näyttö muissa näkymissä. Moottori korvataan samalla käsittelijällä
// (handleRequest) pienellä aineistolla, jotta testi ei tarvitse Web Workeria.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSeedStory } from '../src/core/matrix/seed';
import type { BlindRunResult } from '../src/core/path/blind';
import { canonicalQuery } from '../src/core/path/canonical';
import { scoreRoutes } from '../src/core/path/score';
import { searchPaths } from '../src/core/path/search';
import { piSource } from '../src/core/path/source';
import type { BlindParams, PathIdentifier, PathParams, PathQuery } from '../src/core/path/types';
import { DEFAULT_PATH_PARAMS } from '../src/core/path/types';
import { sha256Hex } from '../src/core/sha256';
import { EngineRequest, EngineState, handleRequest } from '../src/engine/handlers';
import { deserializeMatrix, initialMatrixState, serializeMatrix } from '../src/state/matrix';
import { runRouteTest } from '../src/state/matrix-actions';
import {
  beginBlindRun,
  beginSearchRun,
  blindConfigKey,
  blindItemsFor,
  blindItemStats,
  blindQueryKey,
  codesByRole,
  describeConfigChange,
  deserializePath,
  EXPLORATORY_LABEL,
  ExploreIndex,
  exploreSeen,
  exploreStart,
  exploreVerdict,
  failRun,
  finishBlindRun,
  finishSearchRun,
  initialPathState,
  latestBlindFor,
  makeIdentifier,
  matrixJobBusy,
  mergeIdentifiers,
  outcomeFromSaved,
  pathBH,
  pathConfigKey,
  pathOverlayFromRoute,
  pathQueryKey,
  PathCurrent,
  PathState,
  rebuildIndex,
  sanitizePathParams,
  savedFromCurrent,
  serializePath,
  storyKnownIdentifiers,
} from '../src/state/path';
import {
  addPathIdentifier,
  addStoryNamesAsKnown,
  clearPathOverlay,
  extractPathIdentifiers,
  runBlindTest,
  runPathNullComparison,
  runPathSearch,
  savePathResult,
  setPathForm,
  setPathParams,
  showPathRoute,
} from '../src/state/path-actions';
import { store } from '../src/state/store';
import { FIXTURE_DIGITS } from './helpers';

// ------------------------------------------------------------------ moottori: sama käsittelijä, pieni aineisto

const engineState: EngineState = { digits: FIXTURE_DIGITS };
/** Moottorikutsun hetkellä tallennetut havainnot (lukitus ennen tulosta). */
const seenAtCall: { type: string; runs: PathState['runs']; blindRuns: PathState['blindRuns'] }[] = [];
let gate: Promise<void> = Promise.resolve();

vi.mock('../src/engine/client', () => ({
  getEngine: () => ({
    call: async (req: EngineRequest, onProgress?: (d: number, t: number) => void) => {
      const p = store.get().matrix.path;
      seenAtCall.push({ type: req.type, runs: p.runs.map((r) => ({ ...r })), blindRuns: p.blindRuns.map((r) => ({ ...r })) });
      await gate;
      return handleRequest(engineState, req, { onProgress });
    },
    cancel: async () => {},
    onModeChange: () => () => {},
    mode: 'inline',
  }),
}));

const P = (over: Partial<PathParams> = {}): PathParams => ({ ...DEFAULT_PATH_PARAMS, rules: [...DEFAULT_PATH_PARAMS.rules], ...over });

/** Numerojonotunniste: pii alkaa 1415926535 8979…, joten 415 @2 ja 535 @8 ovat osumia aineistossa. */
const num = (role: PathIdentifier['role'], value: string): PathIdentifier => makeIdentifier(role, 'numerojono', value);

const QUERY: PathQuery = {
  startText: 'Lähtö: oma kuvaus',
  goalText: 'Tavoite: oma kuvaus',
  identifiers: [num('lähtö', '415'), num('tavoite', '535')],
  timeRange: null,
};

const viaJson = <T>(x: T): unknown => JSON.parse(JSON.stringify(x));

function currentFor(query: PathQuery, params: PathParams, hash = 'a'.repeat(64)): PathCurrent {
  const outcome = searchPaths(query, params, 'kaksisuuntainen', piSource(FIXTURE_DIGITS, 'fixture'), null);
  return {
    runId: 'polkuhaku-1',
    source: 'ajo',
    savedId: null,
    ts: '2026-10-18T10:00:00.000Z',
    query,
    params,
    mode: 'kaksisuuntainen',
    hash,
    hashMatches: true,
    exploratory: false,
    exploratoryReason: null,
    outcome,
    scores: scoreRoutes(outcome, [], null),
    null: null,
  };
}

const BP = (over: Partial<BlindParams> = {}): BlindParams => ({
  kind: 'polun-askel',
  decoys: 3,
  seed: 7,
  randomStrings: 1,
  dateFormat: 'DDMMYYYY',
  path: P(),
  ...over,
});

async function blindResult(params: BlindParams): Promise<BlindRunResult> {
  const story = createSeedStory();
  const items = blindItemsFor('polun-askel', story, [], params.dateFormat);
  return (await handleRequest(engineState, { type: 'blindTest', items, params, ctx: { story, events: [] } })) as BlindRunResult;
}

beforeEach(() => {
  store.set({ digits: FIXTURE_DIGITS, matrix: initialMatrixState(), audit: [], pathOverlay: null, events: [] });
  seenAtCall.length = 0;
  gate = Promise.resolve();
});

// ------------------------------------------------------------------ tallennusmuoto

describe('polkuhaun tallennusmuoto', () => {
  it('kiertokulku: lomake, ajot, laskurit, hakemistot, tallennetut tulokset ja sokkotestit säilyvät; muistiosat eivät tallennu', async () => {
    const p = initialPathState();
    const cur = currentFor(QUERY, P());
    expect(cur.outcome.status).toBe('löytyi');
    const res = await blindResult(BP());
    const blind = finishBlindRun(
      beginBlindRun({
        id: 'sokko-1',
        ts: '2026-10-18T11:00:00.000Z',
        hash: 'b'.repeat(64),
        queryKey: 'q',
        configKey: blindConfigKey(BP()),
        verdict: { exploratory: false, reason: null },
        params: BP(),
        seedText: '7',
        items: 6,
        datasetSha: null,
      }),
      res,
      '2026-10-18T11:00:01.000Z',
    );
    const run = finishSearchRun(
      beginSearchRun({ id: 'polkuhaku-1', ts: cur.ts, query: QUERY, params: P(), mode: 'kaksisuuntainen', hash: 'a'.repeat(64), datasetSha: null, verdict: { exploratory: false, reason: null } }),
      cur.outcome,
      '2026-10-18T10:00:01.000Z',
    );
    const state: PathState = {
      ...p,
      form: { ...p.form, startText: 'x', goalText: 'y', identifiers: QUERY.identifiers, timeRange: { from: '2020-01-01', to: null }, params: P({ maxEdges: 4, use369: true }), mode: '432' },
      nullForm: { R: 200, randomStrings: 5, seedText: 'abc' },
      blindForm: { kind: 'tapahtuma', decoys: 5, seedText: 's', randomStrings: 10, dateFormat: 'YYYYMMDD' },
      runs: [run],
      counts: { searches: 3, nulls: 1, blinds: 1 },
      index: {
        searches: exploreSeen(exploreStart({}, run.queryKey, run.configKey), run.queryKey, run.configKey, run.ts),
        nulls: {},
        blinds: exploreSeen(exploreStart({}, 'q', blind.configKey), 'q', blind.configKey, blind.ts),
      },
      saved: [savedFromCurrent(cur, { id: 'tulos-1', title: 'T', createdAt: '2026-10-18T12:00:00.000Z', datasetSha: null, blind })],
      blindRuns: [blind],
      current: cur,
      running: { kind: 'haku', runId: 'r', label: 'l', done: 1, total: 2, startedAt: 't', cancelRequested: false },
      error: 'virhe',
    };
    const persisted = serializePath(state);
    expect('current' in persisted).toBe(false);
    expect('running' in persisted).toBe(false);
    const { state: back, warnings } = deserializePath(viaJson(persisted));
    expect(warnings).toEqual([]);
    expect(back.form).toEqual(state.form);
    expect(back.nullForm).toEqual(state.nullForm);
    expect(back.blindForm).toEqual(state.blindForm);
    expect(back.runs).toEqual(state.runs);
    expect(back.counts).toEqual(state.counts);
    expect(back.index).toEqual(state.index);
    expect(back.saved).toEqual(viaJson(state.saved));
    expect(back.blindRuns).toEqual(viaJson(state.blindRuns));
    expect(back.current).toBeNull();
    expect(back.running).toBeNull();
    expect(back.error).toBeNull();
    // Tallennettu tulos takaisin näytettäväksi: reitit askelineen säilyvät.
    const o = outcomeFromSaved(back.saved[0]);
    expect(o.routes).toEqual(viaJson(cur.outcome.routes));
    expect(back.saved[0].blindRef?.id).toBe('sokko-1');

    // Koko matriisin kautta: polkuhaku kulkee mukana ilman varoituksia.
    const m = { ...initialMatrixState(), path: state };
    const { state: mb, warnings: mw } = deserializeMatrix(viaJson(serializeMatrix(m)));
    expect(mw).toEqual([]);
    expect(mb.path.saved).toHaveLength(1);
    expect(mb.path.current).toBeNull();
  });

  it('vanha tallennus ilman polkuhakua: oletukset ilman varoituksia', () => {
    const { state, warnings } = deserializeMatrix(viaJson({ ...serializeMatrix(initialMatrixState()), path: undefined }));
    expect(warnings).toEqual([]);
    expect(state.path).toEqual(initialPathState());
  });

  it('virheellinen syöte: kentät tarkistetaan yksitellen, keskeneräiset ajot kirjataan keskeytetyiksi, laskurit eivät pienene', () => {
    expect(deserializePath('rikki').warnings[0]).toMatch(/virheellinen/);
    const r = deserializeMatrix({ path: 5 });
    expect(r.warnings.some((w) => /^Polkuhaku: /.test(w))).toBe(true);
    expect(r.state.path).toEqual(initialPathState());

    const goodRun = beginSearchRun({ id: 'a', ts: '2026-10-18T10:00:00.000Z', query: QUERY, params: P(), mode: '234', hash: 'c'.repeat(64), datasetSha: null, verdict: { exploratory: false, reason: null } });
    const { state, warnings } = deserializePath({
      form: {
        startText: 3,
        identifiers: [num('lähtö', '415'), { id: 'x', role: 'pomo', kind: 'nimi' }, null, { id: 'y', role: 'tavoite', kind: 'päivämäärä', value: '2020-02-30', dateFormat: '???' }],
        timeRange: { from: 'eilen', to: '2020-01-05' },
        params: { maxEdges: -1, rules: ['foo', 'fib-naapuri'], chordMax: 'paljon', use369: 'kyllä', budget: 50 },
        mode: 'sivuttain',
      },
      nullForm: { R: 7, randomStrings: 5, seedText: '' },
      blindForm: { kind: 'x', decoys: 0, randomStrings: 3, dateFormat: 'MMDD' },
      runs: [goodRun, { ...goodRun, id: 'b', hash: 'ei-tiiviste' }, { ...goodRun, id: 'c', kind: 'vertailu', status: 'valmis' }, 'roska'],
      counts: { searches: -3, nulls: 'x', blinds: 2 },
      index: { searches: { k: { firstSeen: 5, locked: 'x' } } },
      saved: [{ id: 's', createdAt: 't', hash: 'd'.repeat(64), status: 'löytyi', routes: [{ key: 'k', nodes: [{ code: 'x', n: 0 }], steps: [], cost: null }] }],
      blindRuns: [{ id: 'z', ts: 't', hash: 'NOT' }],
    });
    expect(state.form.identifiers).toHaveLength(2);
    expect(state.form.identifiers[1].dateFormat).toBe('DDMMYYYY');
    expect(state.form.startText).toBe('');
    expect(state.form.timeRange).toEqual({ from: null, to: '2020-01-05' });
    expect(state.form.params).toEqual({ ...P(), rules: ['fib-naapuri'], budget: 50 });
    expect(state.form.mode).toBe('kaksisuuntainen');
    expect(state.nullForm).toEqual({ R: 50, randomStrings: 5, seedText: initialPathState().nullForm.seedText });
    expect(state.blindForm).toEqual({ ...initialPathState().blindForm, dateFormat: 'MMDD' });
    // 'käynnissä' → keskeytetty; virheellinen tiiviste ja vertailu ilman asetuksia hylätään.
    expect(state.runs.map((x) => [x.id, x.status])).toEqual([['a', 'keskeytetty']]);
    expect(state.runs[0].error).toMatch(/keskeytyi/);
    expect(state.counts).toEqual({ searches: 1, nulls: 0, blinds: 2 });
    expect(state.saved).toEqual([]);
    expect(state.blindRuns).toEqual([]);
    expect(state.index.searches).toEqual({ [goodRun.queryKey]: { firstSeen: null, seenConfig: null, locked: [goodRun.configKey] } });
    expect(warnings.join(' ')).toMatch(/Polkuhaun tunnisteet: 2 virheellistä/);
    expect(warnings.join(' ')).toMatch(/Polkuhaun ajot: 3 virheellistä/);
    expect(warnings.join(' ')).toMatch(/Tallennetut polkuhaun tulokset: 1 virheellistä/);
    expect(warnings.join(' ')).toMatch(/Sokkotestit: 1 virheellistä/);
  });

  it('sokkotestin kierroksen oikein/väärin johdetaan sijoituksesta, ei tallennetusta lipusta', async () => {
    const res = await blindResult(BP());
    const rec = finishBlindRun(
      beginBlindRun({ id: 's1', ts: '2026-10-18T11:00:00.000Z', hash: 'e'.repeat(64), queryKey: 'q', configKey: 'c', verdict: { exploratory: false, reason: null }, params: BP(), seedText: '7', items: 6, datasetSha: null }),
      res,
      '2026-10-18T11:00:01.000Z',
    );
    expect(rec.folds.length).toBe(res.folds.length);
    const forged = viaJson({ v: 1, blindRuns: [{ ...rec, folds: rec.folds.map((f) => ({ ...f, rankPi: 2, correct: true })) }] });
    const { state } = deserializePath(forged);
    expect(state.blindRuns[0].folds.every((f) => f.correct === false)).toBe(true);
  });

  it('parametrien tarkistus: kelvolliset säilyvät, virheelliset kentät korvataan oletuksella', () => {
    expect(sanitizePathParams(P({ indexWindow: 10, chordMax: 0.5, use369: true }))).toEqual(P({ indexWindow: 10, chordMax: 0.5, use369: true }));
    expect(sanitizePathParams(null)).toEqual(P());
    expect(sanitizePathParams({ ...P(), fibKMax: 2.5, maxRoutes: 0 })).toEqual(P());
  });
});

// ------------------------------------------------------------------ eksploratiivisuus

describe('eksploratiivisuus: parametrit muutettu tulosten näkemisen jälkeen', () => {
  const A = pathConfigKey(QUERY, P());
  const B = pathConfigKey(QUERY, P({ use369: true }));
  const C = pathConfigKey(QUERY, P({ indexWindow: 500 }));
  const K = pathQueryKey(QUERY);

  it('ensimmäinen nähty tulos lukitsee asetukset; muut asetukset ovat eksploratiivisia, samat eivät', () => {
    let ix: ExploreIndex = {};
    expect(exploreVerdict(ix, K, A).exploratory).toBe(false);
    ix = exploreStart(ix, K, A);
    // Ajo käynnissä, tulosta ei vielä nähty: toinen asetus ei ole vielä eksploratiivinen.
    expect(exploreVerdict(ix, K, B).exploratory).toBe(false);
    ix = exploreSeen(ix, K, A, '2026-10-18T10:00:00.000Z');
    expect(exploreVerdict(ix, K, A).exploratory).toBe(false);
    const v = exploreVerdict(ix, K, B);
    expect(v.exploratory).toBe(true);
    expect(v.reason).toContain(EXPLORATORY_LABEL);
    expect(v.reason).toContain('use369: false → true');
    expect(v.reason).toContain('2026-10-18 10:00:00 UTC');
    // B ajetaan ja nähdään: A on yhä lukittu, B pysyy eksploratiivisena.
    ix = exploreSeen(exploreStart(ix, K, B), K, B, '2026-10-18T10:05:00.000Z');
    expect(exploreVerdict(ix, K, A).exploratory).toBe(false);
    expect(exploreVerdict(ix, K, B).exploratory).toBe(true);
    expect(ix[K].firstSeen).toBe('2026-10-18T10:00:00.000Z');
  });

  it('keskeytetyn ajon asetukset valittiin ennen tuloksia, joten ne ovat lukittuja', () => {
    let ix = exploreStart({}, K, A); // keskeytettiin: ei nähty
    ix = exploreSeen(exploreStart(ix, K, B), K, B, '2026-10-18T10:00:00.000Z');
    expect(exploreVerdict(ix, K, A).exploratory).toBe(false);
    expect(exploreVerdict(ix, K, B).exploratory).toBe(false);
    expect(exploreVerdict(ix, K, C).exploratory).toBe(true);
  });

  it('kysely = lähtö- ja tavoitekoodit; tunnetut välisolmut ovat asetus; tekstit, nimet ja hakutila eivät vaikuta', () => {
    const renamed: PathQuery = { ...QUERY, startText: 'muu teksti', identifiers: [{ ...num('lähtö', '415'), label: 'Toinen nimi' }, num('tavoite', '535')] };
    expect(pathQueryKey(renamed)).toBe(K);
    expect(pathConfigKey(renamed, P())).toBe(A);
    const withKnown: PathQuery = { ...QUERY, identifiers: [...QUERY.identifiers, num('tunnettu', '926')] };
    expect(pathQueryKey(withKnown)).toBe(K);
    expect(pathConfigKey(withKnown, P())).not.toBe(A);
    expect(describeConfigChange(A, pathConfigKey(withKnown, P()))).toEqual(['tunnetut: – → 926']);
    const otherGoal: PathQuery = { ...QUERY, identifiers: [num('lähtö', '415'), num('tavoite', '8979')] };
    expect(pathQueryKey(otherGoal)).not.toBe(K);
    expect(codesByRole(withKnown)).toEqual({ lähtö: ['415'], tavoite: ['535'], tunnettu: ['926'] });
  });

  it('hakemisto rakennetaan tallennetuista ajoista, jos se puuttuu', () => {
    const r1 = { ts: '2026-10-18T10:00:00.000Z', queryKey: K, configKey: A, status: 'löytyi' as const };
    const r2 = { ts: '2026-10-18T10:01:00.000Z', queryKey: K, configKey: B, status: 'ei-löytynyt' as const };
    const ix = rebuildIndex({}, [r2, r1]);
    expect(ix[K]).toEqual({ firstSeen: r1.ts, seenConfig: A, locked: [A] });
    expect(exploreVerdict(ix, K, B).exploratory).toBe(true);
  });

  it('sokkotestin asetukset sisältävät siemenen: siemenen vaihto tuloksen jälkeen on eksploratiivinen', () => {
    const story = createSeedStory();
    const items = blindItemsFor('polun-askel', story, [], 'DDMMYYYY');
    const q = blindQueryKey(items, 'polun-askel', 'DDMMYYYY');
    let ix = exploreSeen(exploreStart({}, q, blindConfigKey(BP())), q, blindConfigKey(BP()), '2026-10-18T10:00:00.000Z');
    expect(exploreVerdict(ix, q, blindConfigKey(BP({ seed: 8 }))).reason).toContain('siemen: 7 → 8');
    ix = exploreStart(ix, q, blindConfigKey(BP({ seed: 8 })));
    expect(exploreVerdict(ix, q, blindConfigKey(BP())).exploratory).toBe(false);
  });
});

// ------------------------------------------------------------------ apufunktiot

describe('apufunktiot', () => {
  it('yksi moottorityö kerrallaan: polkuhaku, vertailu, sokkotesti tai reittitesti', () => {
    expect(matrixJobBusy({ path: { running: null }, routeTest: { running: null } })).toBeNull();
    expect(matrixJobBusy({ path: { running: { kind: 'vertailu', label: 'x' } }, routeTest: { running: null } })).toMatch(/^Satunnaisvertailu on käynnissä/);
    expect(matrixJobBusy({ path: { running: { kind: 'sokkotesti', label: 'x' } }, routeTest: { running: null } })).toMatch(/^Sokkotesti/);
    expect(matrixJobBusy({ path: { running: null }, routeTest: { running: { label: 'MAX → IDA' } } })).toMatch(/^Reittitesti on käynnissä \(MAX → IDA\)/);
  });

  it('reitin näyttö: solmut järjestyksessä, virheelliset kohdat ohitetaan', () => {
    const cur = currentFor(QUERY, P());
    const r = cur.outcome.routes[0];
    const o = pathOverlayFromRoute(r, 0);
    expect(o.points).toEqual(r.nodes.map((n) => ({ n: n.n, code: n.code, label: n.labels.join(' / ') })));
    expect(o.label).toMatch(/^Reitti 1: 415 → .*535 \(\d+ askel/);
    const bad = pathOverlayFromRoute({ nodes: [{ code: '12', n: 0, labels: [], roles: [] }, { code: 'ab', n: 5, labels: [], roles: [] }, { code: '535', n: 8, labels: [], roles: [] }], cost: { edges: 2, transforms: 0, span: 6 } }, 1);
    expect(bad.points).toEqual([{ n: 8, code: '535', label: '535' }]);
  });

  it('tunnisteet: sama rooli + koodi ei tuplaannu; tarinan nimet tunnetuiksi ohittavat käytetyt koodit', () => {
    const a = makeIdentifier('lähtö', 'nimi', 'Hanna');
    expect(a.label).toBe('HANNA');
    const { identifiers, added } = mergeIdentifiers([a], [makeIdentifier('lähtö', 'sana', 'hanna'), makeIdentifier('tavoite', 'nimi', 'HANNA')]);
    expect(added.map((i) => i.role)).toEqual(['tavoite']);
    expect(identifiers).toHaveLength(2);
    const known = storyKnownIdentifiers(createSeedStory(), identifiers);
    expect(known.every((k) => k.role === 'tunnettu' && k.origin === 'tarina')).toBe(true);
    expect(known.map((k) => k.label)).not.toContain('HANNA');
    expect(known.map((k) => k.label)).toEqual(expect.arrayContaining(['IDA', 'MATTI', 'SALLA', 'MAX', 'MINI']));
  });

  it('sokkotestin kohteet: seed-tarinan polkujen askeleet kelpaavat; tapahtumat ilman päivämäärää ohitetaan syyn kanssa', () => {
    const story = createSeedStory();
    const s1 = blindItemStats('polun-askel', story, [], BP(), { story, events: [] });
    expect(s1.usable).toBeGreaterThan(0);
    expect(s1.total).toBe(story.paths.reduce((a, p) => a + p.steps.length, 0));
    const events = [
      { id: 'e1', title: 'Muutto', date: '2014-03-23' },
      { id: 'e2', title: 'Häät', date: '' },
    ];
    const s2 = blindItemStats('tapahtuma', story, events, BP({ kind: 'tapahtuma' }), { story, events });
    expect(s2.total).toBe(2);
    expect(s2.usable).toBe(0);
    expect(s2.skipped.map((x) => x.label)).toEqual(['Häät', 'Muutto (2014-03-23)']);
    expect(s2.skipped[0].reason).toMatch(/päivämäärää/);
  });

  it('uusin sokkotesti samoilla polkuhaun parametreilla; muuten ei testattu', async () => {
    const res = await blindResult(BP());
    const mk = (id: string, ts: string, path: PathParams) =>
      finishBlindRun(
        beginBlindRun({ id, ts, hash: 'f'.repeat(64), queryKey: 'q', configKey: 'c', verdict: { exploratory: false, reason: null }, params: BP({ path }), seedText: '7', items: 6, datasetSha: null }),
        res,
        ts,
      );
    const runs = [mk('a', '2026-10-18T10:00:00.000Z', P()), mk('b', '2026-10-18T11:00:00.000Z', P()), mk('c', '2026-10-18T12:00:00.000Z', P({ maxEdges: 3 }))];
    expect(latestBlindFor(runs, P())?.id).toBe('b');
    expect(latestBlindFor(runs, P({ maxEdges: 3 }))?.id).toBe('c');
    expect(latestBlindFor(runs, P({ use369: true }))).toBeNull();
    expect(latestBlindFor([failRun({ ...runs[1], finishedAt: null, error: null }, 'Keskeytetty', 't')], P())).toBeNull();
  });

  it('BH-q: puuttuvat p-arvot oletetaan ykkösiksi', () => {
    expect(pathBH([0.01], 1)[0]).toBeCloseTo(0.01);
    expect(pathBH([0.01], 5)[0]).toBeCloseTo(0.05);
  });
});

// ------------------------------------------------------------------ toiminnot storea vasten

describe('polkuhaun toiminnot', () => {
  it('lukitus ennen tulosta: tiiviste lasketaan ja ajo kirjataan ennen moottorikutsua', async () => {
    setPathForm({ startText: QUERY.startText, goalText: QUERY.goalText });
    for (const i of QUERY.identifiers) addPathIdentifier(i);
    const out = await runPathSearch('kaksisuuntainen');
    expect(out?.status).toBe('löytyi');
    const expected = await sha256Hex(canonicalQuery({ ...QUERY, identifiers: store.get().matrix.path.form.identifiers }, P(), 'kaksisuuntainen'));
    // Moottorikutsun hetkellä ajo oli jo kirjattu tiivisteineen tilassa 'käynnissä'.
    expect(seenAtCall).toHaveLength(1);
    expect(seenAtCall[0].type).toBe('pathSearch');
    expect(seenAtCall[0].runs.map((r) => [r.status, r.hash])).toEqual([['käynnissä', expected]]);
    const p = store.get().matrix.path;
    expect(p.runs[0].status).toBe('löytyi');
    expect(p.runs[0].hash).toBe(expected);
    expect(p.current?.hash).toBe(expected);
    expect(p.current?.hashMatches).toBe(true);
    expect(p.current?.exploratory).toBe(false);
    expect(p.counts.searches).toBe(1);
    expect(p.running).toBeNull();
    expect(store.get().audit.some((a) => a.type === 'matriisi' && /Polkuhaku lukittu/.test(a.text))).toBe(true);
    expect(store.get().matrix.log.some((e) => e.kind === 'polkuhaku' && /valmis/.test(e.text))).toBe(true);

    // 369-laajennus saman kyselyn tuloksen näkemisen jälkeen: eksploratiivinen. Lomakkeen parametrit eivät muutu.
    await runPathSearch('kaksisuuntainen', { use369: true });
    const p2 = store.get().matrix.path;
    expect(p2.runs[1].use369).toBe(true);
    expect(p2.runs[1].exploratory).toBe(true);
    expect(p2.runs[1].exploratoryReason).toContain(EXPLORATORY_LABEL);
    expect(p2.form.params.use369).toBe(false);
    expect(store.get().audit.some((a) => /^369-laajennus/.test(a.text))).toBe(true);

    // Sama asetus kuin ensimmäisessä ajossa (eri hakutila): ei eksploratiivinen.
    await runPathSearch('234');
    expect(store.get().matrix.path.runs[2].exploratory).toBe(false);
    // Parametrin muutos tuloksen jälkeen: eksploratiivinen.
    setPathParams({ indexWindow: 100 });
    await runPathSearch('kaksisuuntainen');
    expect(store.get().matrix.path.runs[3].exploratory).toBe(true);
    expect(store.get().matrix.path.counts.searches).toBe(4);
  });

  it('ei reittiä: syyt näkyvät tuloksessa, eikä mitään täydennetä', async () => {
    addPathIdentifier(num('lähtö', '415'));
    addPathIdentifier(num('tavoite', '00000000'));
    const out = await runPathSearch('kaksisuuntainen');
    expect(out?.status).toBe('ei-löytynyt');
    expect(out?.routes).toEqual([]);
    expect(out!.reasons.length + out!.failures.length).toBeGreaterThan(0);
    expect(store.get().matrix.path.runs[0].reasons).toBeGreaterThan(0);
  });

  it('satunnaisvertailu: lukitaan ennen ajoa, Path Score lasketaan ja vertailu lasketaan monivertailuun', async () => {
    for (const i of QUERY.identifiers) addPathIdentifier(i);
    await runPathSearch('kaksisuuntainen');
    store.set((s) => ({ matrix: { ...s.matrix, path: { ...s.matrix.path, nullForm: { R: 50, randomStrings: 0, seedText: '1' } } } }));
    expect(await runPathNullComparison()).toBe(true);
    const call = seenAtCall.find((c) => c.type === 'pathNull')!;
    expect(call.runs[1].kind).toBe('vertailu');
    expect(call.runs[1].status).toBe('käynnissä');
    expect(call.runs[1].hash).toMatch(/^[0-9a-f]{64}$/);
    const p = store.get().matrix.path;
    expect(p.counts).toEqual({ searches: 1, nulls: 1, blinds: 0 });
    expect(p.current?.null?.nulls[0].replicates).toBe(50);
    expect(p.current?.null?.reproducible).toBe(true);
    expect(p.current?.scores[0].total).not.toBeNull();
    expect(p.runs[1].status).toBe('valmis');
    expect(p.runs[1].pValue).not.toBeNull();
    // Tallennus: kaikki kolme osaa ja vertailu mukana.
    const saved = savePathResult('Testi');
    expect(saved?.nulls).toHaveLength(1);
    expect(saved?.blindRef).toBeNull();
    expect(saved?.startText).toBe('');
    expect(savePathResult('Uudestaan')).toBeNull();
  });

  it('yksi työ kerrallaan: käynnissä oleva polkuhaku estää haun, vertailun, sokkotestin ja reittitestin', async () => {
    for (const i of QUERY.identifiers) addPathIdentifier(i);
    let release!: () => void;
    gate = new Promise<void>((r) => (release = r));
    const first = runPathSearch('kaksisuuntainen');
    await vi.waitFor(() => expect(seenAtCall).toHaveLength(1));
    expect(store.get().matrix.path.running?.kind).toBe('haku');
    expect(await runPathSearch('234')).toBeNull();
    expect(store.get().matrix.path.error).toMatch(/Polkuhaku on käynnissä/);
    expect(await runBlindTest()).toBe(false);
    expect(store.get().matrix.path.blindError).toMatch(/Polkuhaku on käynnissä/);
    expect(await runRouteTest({ codes: [{ name: '14', code: '14' }, { name: '92', code: '92' }], order: '234', R: 10, seedText: '1', randomStrings: 0 })).toBeNull();
    expect(store.get().matrix.routeTest.error).toMatch(/Polkuhaku on käynnissä/);
    release();
    await first;
    expect(store.get().matrix.path.running).toBeNull();
    expect(store.get().matrix.path.counts.searches).toBe(1);
    // Reittitesti käynnissä → polkuhaku hylätään.
    store.set((s) => ({ matrix: { ...s.matrix, routeTest: { ...s.matrix.routeTest, running: { done: 0, total: 1, startedAt: 't', label: '14 → 92' } } } }));
    expect(await runPathSearch('kaksisuuntainen')).toBeNull();
    expect(store.get().matrix.path.error).toMatch(/Reittitesti on käynnissä/);
  });

  it('sokkotesti: kanoninen kuvaus lukitaan ennen ajoa, kaikki ajot tallennetaan', async () => {
    store.set((s) => ({ matrix: { ...s.matrix, path: { ...s.matrix.path, blindForm: { kind: 'polun-askel', decoys: 3, seedText: '7', randomStrings: 1, dateFormat: 'DDMMYYYY' } } } }));
    expect(await runBlindTest()).toBe(true);
    const call = seenAtCall.find((c) => c.type === 'blindTest')!;
    expect(call.blindRuns.map((r) => r.status)).toEqual(['käynnissä']);
    const p = store.get().matrix.path;
    expect(p.blindRuns[0].status).toBe('valmis');
    expect(p.blindRuns[0].hash).toBe(call.blindRuns[0].hash);
    expect(p.blindRuns[0].folds.length).toBeGreaterThan(0);
    expect(p.blindRuns[0].summary?.verdict).toBeTruthy();
    expect(p.counts.blinds).toBe(1);
    expect(store.get().matrix.log.some((e) => e.kind === 'sokkotesti')).toBe(true);
    // Siemenen vaihto tuloksen jälkeen: eksploratiivinen.
    store.set((s) => ({ matrix: { ...s.matrix, path: { ...s.matrix.path, blindForm: { ...s.matrix.path.blindForm, seedText: '8' } } } }));
    await runBlindTest();
    expect(store.get().matrix.path.blindRuns[1].exploratory).toBe(true);
  });

  it('tunnisteiden poiminta tekstistä ja tarinan nimet tunnetuiksi', () => {
    setPathForm({ startText: 'Hannan muutto', goalText: 'Ida ja jokin tuntematon' });
    expect(extractPathIdentifiers('lähtö')).toBe(1);
    expect(extractPathIdentifiers('tavoite')).toBe(1);
    expect(extractPathIdentifiers('tavoite')).toBe(0);
    const ids = store.get().matrix.path.form.identifiers;
    expect(ids.map((i) => [i.role, i.label, i.origin])).toEqual([
      ['lähtö', 'HANNA', 'teksti'],
      ['tavoite', 'IDA', 'teksti'],
    ]);
    expect(addStoryNamesAsKnown()).toBeGreaterThan(0);
    expect(store.get().matrix.path.form.identifiers.filter((i) => i.role === 'tunnettu').map((i) => i.label)).not.toContain('IDA');
  });

  it('reitti spiraaliin ja 3D:hen: päällyskerros, ensimmäinen solmu valituksi ja välilehti vaihtuu', async () => {
    for (const i of QUERY.identifiers) addPathIdentifier(i);
    await runPathSearch('kaksisuuntainen');
    const route = store.get().matrix.path.current!.outcome.routes[0];
    showPathRoute(0, 'spiraali');
    let s = store.get();
    expect(s.pathOverlay?.points.map((p) => p.n)).toEqual(route.nodes.map((n) => n.n));
    expect(s.tab).toBe('map');
    expect(s.mapMode).toBe('spiral');
    expect(s.selection?.n).toBe(route.nodes[0].n);
    showPathRoute(0, '3d');
    s = store.get();
    expect(s.tab).toBe('space');
    clearPathOverlay();
    expect(store.get().pathOverlay).toBeNull();
    // Päällyskerros ei tallennu laitteelle.
    expect(JSON.stringify(serializeMatrix(store.get().matrix))).not.toContain('pathOverlay');
  });
});
