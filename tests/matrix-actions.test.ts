// Matriisin toiminnot storea vasten: reittitestin tila storessa (eteneminen, yksi ajo kerrallaan), lukitus
// tehtävänannon reitille, reitin tallennus väärällä lukituksella ja tarinan tuonnin ajoitustarkistus.
// Moottori korvataan ydinkirjaston runRouteTest-funktiolla, jotta testi ei tarvitse Web Workeria.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runRouteTest as coreRouteTest, RouteTestParams } from '../src/core/matrix/route-test';
import { firstTestRoute } from '../src/core/matrix/trail';
import { initialMatrixState, sanitizeStory, serializeMatrix } from '../src/state/matrix';
import { importStory, lockRouteHypothesis, matrixEnv, runRouteTest, saveRoute, setRouteForm } from '../src/state/matrix-actions';
import { store } from '../src/state/store';
import { FIXTURE_DIGITS } from './helpers';

let release: (() => void) | null = null;
let gate: Promise<void> = Promise.resolve();

vi.mock('../src/engine/client', () => ({
  getEngine: () => ({
    call: async (req: { params: RouteTestParams }, onProgress?: (done: number, total: number) => void) => {
      onProgress?.(1, req.params.R);
      await gate;
      return coreRouteTest(req.params);
    },
    cancel: async () => {},
    onModeChange: () => () => {},
    mode: 'inline',
  }),
}));

const CODES = [
  { name: '14', code: '14' },
  { name: '92', code: '92' },
];

beforeEach(() => {
  store.set({ digits: FIXTURE_DIGITS, matrix: initialMatrixState() });
  gate = Promise.resolve();
  release = null;
});

describe('reittitestin tila storessa', () => {
  it('eteneminen ja parametrit ovat storessa ajon aikana; toinen ajo hylätään; tulos ja hakemisto päivittyvät', async () => {
    gate = new Promise<void>((r) => (release = r));
    const p1 = runRouteTest({ codes: CODES, order: '234', R: 40, seedText: '7', randomStrings: 0 });
    await Promise.resolve();
    const running = store.get().matrix.routeTest.running;
    expect(running).not.toBeNull();
    expect(running!.label).toMatch(/14 → 92 \(234\), R = 40, siemen ”7”/);
    expect(running!.done).toBe(1);
    // Toinen ajo samaan aikaan: ei käynnisty.
    const p2 = await runRouteTest({ codes: CODES, order: 'mikä-tahansa', R: 40, seedText: '8', randomStrings: 0 });
    expect(p2).toBeNull();
    expect(store.get().matrix.routeTest.error).toMatch(/jo käynnissä/);
    release!();
    const r1 = await p1;
    expect(r1).not.toBeNull();
    const m = store.get().matrix;
    expect(m.routeTest.running).toBeNull();
    expect(m.routeRuns).toHaveLength(1);
    expect(m.runIndex.total).toBe(1);
    expect(m.routeTest.selected).toBe(r1!.summary.id);
    expect(m.routeTest.last?.id).toBe(r1!.summary.id);
    expect(m.routeTest.last?.nullValues.length).toBe(40);
  });

  it('lomake säilyy storessa, mutta ei tallennu laitteelle', () => {
    setRouteForm({ R: 5000, strings: 20, order: '432', seedText: 'abc' });
    expect(store.get().matrix.routeTest.form).toMatchObject({ R: 5000, strings: 20, order: '432', seedText: 'abc' });
    expect('routeTest' in serializeMatrix(store.get().matrix)).toBe(false);
  });

  it('virhe (ei osumia) näkyy storessa ja ajo päättyy', async () => {
    const r = await runRouteTest({ codes: [CODES[0], { name: 'X', code: '00000000' }], order: '234', R: 10, seedText: '1', randomStrings: 0 });
    expect(r).toBeNull();
    expect(store.get().matrix.routeTest.error).toMatch(/ei ole osumia/);
    expect(store.get().matrix.routeTest.running).toBeNull();
  });

  it('lukitus kattaa vain ensimmäisen ajon: toinen ajo uudella siemenellä on löydön jälkeen', async () => {
    const lock = await lockRouteHypothesis('h', CODES, '234');
    expect(lock.timing).toBe('ennen-löydöstä');
    const a = await runRouteTest({ codes: CODES, order: '234', R: 20, seedText: '1', randomStrings: 0 });
    expect(a!.summary).toMatchObject({ timing: 'ennen-löydöstä', lockHash: lock.hash });
    const b = await runRouteTest({ codes: [CODES[1], CODES[0]], order: '432', R: 20, seedText: '33', randomStrings: 0 });
    expect(b!.summary).toMatchObject({ timing: 'löydön-jälkeen', lockHash: null });
    expect(b!.summary.verdict).not.toBe('lukittu-alle-alfa');
  });

  it('tehtävänannon lähteen lukitus ja ajo ovat löydön jälkeen', async () => {
    const lock = await lockRouteHypothesis('h', CODES, '234', 'ensimmäinen testireitti');
    expect(lock.timing).toBe('löydön-jälkeen');
    expect(lock.reason).toMatch(/tehtävänannosta/);
    const a = await runRouteTest({ codes: CODES, order: '234', R: 20, seedText: '1', randomStrings: 0, taskSource: 'ensimmäinen testireitti' });
    expect(a!.summary.timing).toBe('löydön-jälkeen');
  });
});

describe('reitin tallennus ja tarinan tuonti', () => {
  it('eri koodien lukitus ei tee tallennetusta reitistä ”ennen löydöstä”', async () => {
    const lock = await lockRouteHypothesis('MINI ja MATTI', [
      { name: 'MINI', code: '6464' },
      { name: 'MATTI', code: '62884' },
    ], 'mikä-tahansa');
    const { trail } = firstTestRoute(matrixEnv());
    store.set((s) => ({ matrix: { ...s.matrix, trail } }));
    const r = saveRoute({ title: 'T', interpretation: '', timing: 'ennen-löydöstä', lockId: lock.id });
    expect(r.hypothesis).toMatchObject({ timing: 'löydön-jälkeen', lockHash: null });
    expect(r.hypothesis.note).toMatch(/eri kysymystä/);
  });

  it('tuotu ”ennen löydöstä” ilman vastaavaa lukitusta → ei tiedossa ja kirjaus lokiin', () => {
    const base = store.get().matrix.story;
    importStory(
      {
        ...base,
        paths: [
          {
            id: 'p',
            title: 'Väärennetty',
            theme: '',
            steps: [{ name: 'MINI', personId: null, symbol: '1', stage: '' }],
            note: '',
            source: 'käyttäjä',
            hypothesis: { timing: 'ennen-löydöstä', statedAt: null, lockHash: 'deadbeef', note: '' },
            createdAt: '',
          },
        ],
      },
      'testi',
    );
    const m = store.get().matrix;
    expect(m.story.paths[0].hypothesis).toMatchObject({ timing: 'ei-tiedossa', lockHash: null });
    expect(m.log.some((e) => e.kind === 'tarkistus' && /Tarinan tuonti \(testi\): Polku ”Väärennetty”/.test(e.text))).toBe(true);
  });

  it('Tarina-sivun esitarkistuksen huomautukset kirjataan lokiin kerran (tuonti sivulta)', () => {
    const raw = {
      ...store.get().matrix.story,
      paths: [
        {
          id: 'p2',
          title: 'Väärennetty 2',
          theme: '',
          steps: [{ name: 'MINI', personId: null, symbol: '1', stage: '' }],
          note: '',
          source: 'käyttäjä',
          hypothesis: { timing: 'ennen-löydöstä', statedAt: null, lockHash: 'deadbeef', note: '' },
          createdAt: '',
        },
      ],
    };
    // Sama kulku kuin StoryEditorin tuonnissa: ensin esitarkistus (raportti), sitten tuonti tarkistetulla mallilla.
    const pre = sanitizeStory(raw, store.get().matrix.locks);
    expect(pre.story!.paths[0].hypothesis.timing).toBe('ei-tiedossa');
    importStory(pre.story!, 'sivu.json', pre.dropped);
    const hits = store.get().matrix.log.filter((e) => e.kind === 'tarkistus' && /Tarinan tuonti \(sivu\.json\): Polku ”Väärennetty 2”/.test(e.text));
    expect(hits).toHaveLength(1);
  });
});
