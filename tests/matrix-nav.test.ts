// Matriisin navigointi storea vasten: osuman avaus toisesta näkymästä säilyttää nykyisen polun, murupolku sulkee
// alasivun, käsin valittu solmu lisätään näkyvänä askeleena, ja tarinan palautus tai tuonti poistaa (kirjaten)
// tapahtumien henkilölinkit, joiden henkilöitä ei ole uudessa tarinassa.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSeedStory } from '../src/core/matrix/seed';
import { upsertPerson } from '../src/core/matrix/story';
import { firstTestRoute } from '../src/core/matrix/trail';
import { nodeKey } from '../src/core/matrix/types';
import type { LifeEvent, SearchTerm } from '../src/core/types';
import { initialMatrixState, OPENED_FROM_HIT_GROUP } from '../src/state/matrix';
import { importStory, jumpToCrumb, matrixEnv, openMatrixAtHit, openSelectedNode, resetStoryToSeed } from '../src/state/matrix-actions';
import { SELECTED_BY_USER_GROUP } from '../src/state/matrix-select';
import { store, type TermHits } from '../src/state/store';
import { FIXTURE_DIGITS } from './helpers';

vi.mock('../src/engine/client', () => ({
  getEngine: () => ({ call: async () => null, cancel: async () => {}, onModeChange: () => () => {}, mode: 'inline' }),
}));

const TERM: SearchTerm = {
  id: 't-926',
  label: 'testi',
  value: '926',
  kind: 'numerojono',
  encoding: 'RAW',
  scandi: 'none',
  uppercase: true,
  color: '#72e1d1',
  visible: true,
  mode: 'contiguous',
  createdAt: '2026-10-16T12:00:00.000Z',
};

const HITS: TermHits = {
  status: 'ready',
  code: '926',
  hits: Int32Array.from([5]),
  count: 1,
  expected: 2,
  positions: 1,
  truncated: false,
  ms: 0,
};

const keys = () => store.get().matrix.trail.map((s) => nodeKey(s.ref));

beforeEach(() => {
  store.set({
    digits: FIXTURE_DIGITS,
    matrix: initialMatrixState(),
    terms: [TERM],
    hits: { [TERM.id]: HITS },
    events: [],
    audit: [],
    tab: 'map',
  });
});

describe('osuman Matriisi-painike ei hävitä polkua', () => {
  it('pelkkä juuri: juuri → koodi → osuma', () => {
    openMatrixAtHit(TERM.id, 5);
    expect(keys()).toEqual(['root', 'code:926', 'hit:926@5']);
    expect(store.get().tab).toBe('matrix');
  });

  it('pidempi polku: osuma lisätään loppuun askeleena "avattu osumasta", ja ilmoitus kertoo sen', () => {
    const { trail } = firstTestRoute(matrixEnv());
    store.set((s) => ({ matrix: { ...s.matrix, trail, sub: 'loki' } }));
    openMatrixAtHit(TERM.id, 5);
    const m = store.get().matrix;
    expect(m.trail.slice(0, trail.length)).toEqual(trail);
    expect(keys()[trail.length]).toBe('hit:926@5');
    expect(m.trail[trail.length].via?.group).toBe(OPENED_FROM_HIT_GROUP);
    expect(m.sub).toBeNull();
    expect(store.get().toast?.text).toMatch(/lisättiin polun loppuun/);
  });

  it('polulla jo oleva osuma: palataan siihen, polku sinne asti säilyy', () => {
    openMatrixAtHit(TERM.id, 5);
    openSelectedNode({ kind: 'gloss', glossId: 'g-23' }, 'solmuvalitsin');
    expect(keys()).toEqual(['root', 'code:926', 'hit:926@5', 'gloss:g-23']);
    openMatrixAtHit(TERM.id, 5);
    expect(keys()).toEqual(['root', 'code:926', 'hit:926@5']);
    expect(store.get().toast?.text).toMatch(/jo polulla/);
  });
});

describe('murupolku sulkee alasivun', () => {
  it('muru katkaisee polun ja sulkee Loki-sivun; nykyinen muru vain sulkee sivun', () => {
    const { trail } = firstTestRoute(matrixEnv());
    store.set((s) => ({ matrix: { ...s.matrix, trail, sub: 'loki' } }));
    jumpToCrumb(2);
    expect(store.get().matrix.trail).toHaveLength(3);
    expect(store.get().matrix.sub).toBeNull();
    store.set((s) => ({ matrix: { ...s.matrix, sub: 'tarina' } }));
    jumpToCrumb(2);
    expect(store.get().matrix.trail).toHaveLength(3);
    expect(store.get().matrix.sub).toBeNull();
  });
});

describe('käsin valittu solmu', () => {
  it('lisätään nykyisen polun loppuun askeleena "valittu käyttäjän toimesta"; Tarina-sivu suljetaan', () => {
    store.set((s) => ({ matrix: { ...s.matrix, sub: 'tarina' } }));
    openSelectedNode({ kind: 'gloss', glossId: 'g-43' }, 'Tarina-sivu');
    const m = store.get().matrix;
    expect(keys()).toEqual(['root', 'gloss:g-43']);
    expect(m.trail[1].via?.group).toBe(SELECTED_BY_USER_GROUP);
    expect(m.trail[1].via?.relation).toMatch(/^valittu käyttäjän toimesta \(Tarina-sivu\): 43 = /);
    expect(m.sub).toBeNull();
    expect(store.get().tab).toBe('matrix');
    expect(m.log[m.log.length - 1].text).toMatch(/Ei laskettu yhteys/);
  });
});

describe('tarinan palautus ja tuonti: tapahtumien henkilölinkit', () => {
  const AINO = {
    id: 'aino',
    name: 'AINO',
    homonymOrdinal: null,
    description: '',
    roles: [],
    period: null,
    source: 'käyttäjä' as const,
    createdAt: '2026-10-16T12:00:00.000Z',
  };
  const EVENT: LifeEvent = {
    id: 'e1',
    title: 'Ainon syntymä',
    date: '1950-01-01',
    note: '',
    linkedHits: [],
    personIds: ['aino', 'hanna-3'],
    createdAt: '2026-10-16T12:00:00.000Z',
  };

  it('palautus siemendataan poistaa puuttuvan henkilön linkin ja kirjaa sen muutoshistoriaan', () => {
    store.set((s) => ({ events: [EVENT], matrix: { ...s.matrix, story: upsertPerson(s.matrix.story, AINO) } }));
    resetStoryToSeed();
    expect(store.get().events[0].personIds).toEqual(['hanna-3']);
    const a = store.get().audit.filter((x) => x.type === 'tapahtuma');
    expect(a).toHaveLength(1);
    expect(a[0].text).toMatch(/Siemendatan palautus: poistettu henkilölinkit AINO \(aino\) tapahtumasta "Ainon syntymä"/);
  });

  it('tuonti: sama tarkistus; linkit, joiden henkilö on uudessa tarinassa, säilyvät', () => {
    store.set((s) => ({ events: [EVENT], matrix: { ...s.matrix, story: upsertPerson(s.matrix.story, AINO) } }));
    importStory(upsertPerson(createSeedStory(), AINO), 'testi.json');
    expect(store.get().events[0].personIds).toEqual(['aino', 'hanna-3']);
    expect(store.get().audit.filter((x) => x.type === 'tapahtuma')).toHaveLength(0);
    const seed = createSeedStory();
    importStory({ ...seed, persons: seed.persons.filter((p) => p.id !== 'hanna-3') }, 'ilman-hannaa.json');
    expect(store.get().events[0].personIds).toEqual([]);
    expect(store.get().audit.filter((x) => x.type === 'tapahtuma').map((x) => x.text).join(' ')).toMatch(/Tarinan tuonti \(ilman-hannaa\.json\)/);
  });
});
