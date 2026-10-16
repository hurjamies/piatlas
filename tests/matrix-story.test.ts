import { describe, expect, it } from 'vitest';
import { t9Code } from '../src/core/matrix/refs';
import { createSeedStory } from '../src/core/matrix/seed';
import {
  assignHomonymOrdinals,
  continuation,
  getGloss,
  getPath,
  getPerson,
  glossContextLabel,
  glossesFor,
  homonymChronology,
  junction,
  leadingSteps,
  pathsOfName,
  pathsOfPerson,
  personLabel,
  personReferences,
  personsByName,
  removeGloss,
  removePath,
  removePerson,
  removeRelation,
  stepsInDirection,
  symbolString,
  upsertGloss,
  upsertPath,
  upsertPerson,
  upsertRelation,
  validateStory,
  verifyIdentifiers,
} from '../src/core/matrix/story';
import type { Gloss, MatrixEvent, Person, StoryModel, StoryPath } from '../src/core/matrix/types';
import { FIXTURE_DIGITS, full, HAS_FULL } from './helpers';

const T0 = '2026-10-16T00:00:00.000Z';

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as object)) deepFreeze(v);
  }
  return o;
}

function frozenSeed(): StoryModel {
  return deepFreeze(createSeedStory());
}

function newPerson(id: string, name: string, extra: Partial<Person> = {}): Person {
  return {
    id,
    name,
    homonymOrdinal: null,
    description: '',
    roles: [],
    period: null,
    source: 'käyttäjä',
    createdAt: T0,
    ...extra,
  };
}

const ordinals = (m: StoryModel, ids: string[]) => ids.map((id) => getPerson(m, id)!.homonymOrdinal);
const symbols = (m: StoryModel) => m.paths.map((p) => p.steps.map((s) => s.symbol).join(''));
const names = (steps: { name: string }[]) => steps.map((s) => s.name);

describe('siemendata ja samannimiset henkilöt', () => {
  it('siemen on eheä: validateStory palauttaa nolla virhettä', () => {
    expect(validateStory(createSeedStory())).toEqual([]);
  });

  it('kolme Hannaa ovat eri henkilöitä: eri tunnukset, järjestysnumerot 1–3, HANNA I–III, sama T9 42662', () => {
    const m = createSeedStory();
    const hannas = personsByName(m, 'hanna');
    expect(hannas.map((p) => p.id)).toEqual(['hanna-1', 'hanna-2', 'hanna-3']);
    expect(new Set(hannas.map((p) => p.id)).size).toBe(3);
    expect(hannas.map((p) => p.homonymOrdinal)).toEqual([1, 2, 3]);
    expect(hannas.map((p) => personLabel(m, p))).toEqual(['HANNA I', 'HANNA II', 'HANNA III']);
    expect(hannas.map((p) => t9Code(p.name))).toEqual(['42662', '42662', '42662']);
  });

  it('personLabel: yksi henkilö → pelkkä nimi, tuntematon → "(poistettu)", tunnus tai olio käy', () => {
    const m = createSeedStory();
    expect(personLabel(m, 'matti')).toBe('MATTI');
    expect(personLabel(m, 'max')).toBe('MAX');
    expect(personLabel(m, 'hanna-3')).toBe('HANNA III');
    expect(personLabel(m, getPerson(m, 'hanna-1')!)).toBe('HANNA I');
    expect(personLabel(m, 'ei-ole')).toBe('ei-ole (poistettu)');
  });

  it('personLabel: järjestysnumero ilman samannimisiä ei tuota roomalaista numeroa', () => {
    const m = createSeedStory();
    const bad = { ...m, persons: m.persons.map((p) => (p.id === 'matti' ? { ...p, homonymOrdinal: 1 } : p)) };
    expect(personLabel(bad, 'matti')).toBe('MATTI');
  });

  it('personsByName järjestää: järjestysnumero (null viimeisenä), ajanjakso, luontiaika, tunnus', () => {
    const base = createSeedStory();
    const m: StoryModel = {
      ...base,
      persons: [
        newPerson('e', 'AINO', { createdAt: '2026-01-02T00:00:00Z' }),
        newPerson('d', 'AINO', { createdAt: '2026-01-01T00:00:00Z' }),
        newPerson('c', 'AINO', { period: { start: '1950-01-01', end: null } }),
        newPerson('b', 'AINO', { homonymOrdinal: 2 }),
        newPerson('a', 'AINO', { homonymOrdinal: 1 }),
        newPerson('f', 'aino', { createdAt: '2026-01-02T00:00:00Z' }),
      ],
    };
    expect(personsByName(m, ' Aino ').map((p) => p.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('homonymChronology: siemenessä peruste on järjestysnumero (ajanjaksoja ei tiedetä)', () => {
    const m = createSeedStory();
    const c = homonymChronology(m, 'HANNA');
    expect(c.basis).toBe('järjestysnumero');
    expect(c.persons.map((p) => p.id)).toEqual(['hanna-1', 'hanna-2', 'hanna-3']);
    expect(homonymChronology(m, 'MAX').basis).toBe('yksi');
    expect(homonymChronology(m, 'MINI')).toEqual({ persons: [], basis: 'yksi' });
  });

  it('homonymChronology: ajanjakso vain, jos jokaisella on alkupäivä', () => {
    const m = createSeedStory();
    const withPeriods: StoryModel = {
      ...m,
      persons: m.persons.map((p) =>
        p.id === 'hanna-1'
          ? { ...p, period: { start: '1980-01-01', end: null } }
          : p.id === 'hanna-2'
            ? { ...p, period: { start: '1960-01-01', end: null } }
            : p.id === 'hanna-3'
              ? { ...p, period: { start: '2000-01-01', end: null } }
              : p,
      ),
    };
    const c = homonymChronology(withPeriods, 'HANNA');
    expect(c.basis).toBe('ajanjakso');
    expect(c.persons.map((p) => p.id)).toEqual(['hanna-2', 'hanna-1', 'hanna-3']);
    const partial: StoryModel = {
      ...withPeriods,
      persons: withPeriods.persons.map((p) => (p.id === 'hanna-2' ? { ...p, period: { start: null, end: '1970-01-01' } } : p)),
    };
    expect(homonymChronology(partial, 'HANNA').basis).toBe('järjestysnumero');
  });
});

describe('polut ja suunnat 234 / 432', () => {
  it('pathsOfPerson ja pathsOfName', () => {
    const m = createSeedStory();
    expect(pathsOfPerson(m, 'hanna-3').map((o) => [o.path.id, o.index])).toEqual([
      ['polku-a', 1],
      ['polku-b', 0],
    ]);
    expect(pathsOfPerson(m, 'hanna-1')).toEqual([]);
    expect(pathsOfName(m, 'hanna').map((o) => [o.path.id, o.index])).toEqual([
      ['polku-a', 1],
      ['polku-b', 0],
    ]);
    expect(pathsOfName(m, 'IDA').map((o) => [o.path.id, o.index])).toEqual([['polku-b', 2]]);
  });

  it('henkilö voi esiintyä samalla polulla useasti', () => {
    const m = createSeedStory();
    const loop: StoryPath = {
      ...getPath(m, 'polku-b')!,
      id: 'silmukka',
      steps: [
        { name: 'HANNA', personId: 'hanna-3', symbol: '2', stage: '' },
        { name: 'SALLA', personId: 'salla', symbol: '3', stage: '' },
        { name: 'HANNA', personId: 'hanna-3', symbol: '2', stage: '' },
      ],
    };
    const m2 = upsertPath(m, loop);
    expect(pathsOfPerson(m2, 'hanna-3').filter((o) => o.path.id === 'silmukka').map((o) => o.index)).toEqual([0, 2]);
    const j = junction(m2, 'hanna-3', ['silmukka'], '234');
    expect(j.branches.map((b) => [b.index, names(b.before), names(b.after)])).toEqual([
      [0, [], ['SALLA', 'HANNA']],
      [2, ['HANNA', 'SALLA'], []],
    ]);
  });

  it('polku B: symbolinen numerojono 234 eteenpäin ja 432 takaperin', () => {
    const m = createSeedStory();
    const b = getPath(m, 'polku-b')!;
    const a = getPath(m, 'polku-a')!;
    expect(symbolString(b, '234')).toBe('234');
    expect(symbolString(b, '432')).toBe('432');
    expect(symbolString(a, '234')).toBe('629');
    expect(symbolString(a, '432')).toBe('926');
  });

  it('stepsInDirection palauttaa uuden taulukon eikä muuta polkua', () => {
    const m = frozenSeed();
    const b = getPath(m, 'polku-b')!;
    const fwd = stepsInDirection(b, '234');
    const rev = stepsInDirection(b, '432');
    expect(names(fwd)).toEqual(['HANNA', 'SALLA', 'IDA']);
    expect(names(rev)).toEqual(['IDA', 'SALLA', 'HANNA']);
    expect(fwd).not.toBe(b.steps);
    expect(names(b.steps)).toEqual(['HANNA', 'SALLA', 'IDA']);
  });

  it('jatko HANNA III:sta: 234 B → SALLA, IDA; A → MAX; 432 A → MATTI; B takaperin → []', () => {
    const m = createSeedStory();
    const a = getPath(m, 'polku-a')!;
    const b = getPath(m, 'polku-b')!;
    expect(names(continuation(b, 0, '234'))).toEqual(['SALLA', 'IDA']);
    expect(names(continuation(a, 1, '234'))).toEqual(['MAX']);
    expect(names(continuation(a, 1, '432'))).toEqual(['MATTI']);
    expect(continuation(b, 0, '432')).toEqual([]);
    expect(names(continuation(b, 2, '432'))).toEqual(['SALLA', 'HANNA']);
    expect(continuation(b, 2, '234')).toEqual([]);
    expect(continuation(b, 7, '234')).toEqual([]);
    expect(continuation(b, -1, '432')).toEqual([]);
    expect(names(leadingSteps(b, 0, '432'))).toEqual(['IDA', 'SALLA']);
    expect(names(leadingSteps(a, 1, '234'))).toEqual(['MATTI']);
  });

  it('junction: haarat edeltävine ja seuraavine askelineen; alkuperäiset polut eivät muutu', () => {
    const m = frozenSeed();
    const before = JSON.stringify(m);
    const j234 = junction(m, 'hanna-3', ['polku-a', 'polku-b'], '234');
    expect(j234.missing).toEqual([]);
    expect(j234.branches.map((x) => [x.path.id, x.index, names(x.before), names(x.after)])).toEqual([
      ['polku-a', 1, ['MATTI'], ['MAX']],
      ['polku-b', 0, [], ['SALLA', 'IDA']],
    ]);
    const j432 = junction(m, 'hanna-3', ['polku-a', 'polku-b'], '432');
    expect(j432.branches.map((x) => [x.path.id, names(x.before), names(x.after)])).toEqual([
      ['polku-a', ['MAX'], ['MATTI']],
      ['polku-b', ['IDA', 'SALLA'], []],
    ]);
    const bad = junction(m, 'hanna-3', ['polku-a', 'ei-ole', 'polku-a'], '234');
    expect(bad.branches.length).toBe(1);
    expect(bad.missing).toEqual(['ei-ole']);
    expect(junction(m, 'hanna-1', ['polku-a'], '234')).toEqual({ branches: [], missing: ['polku-a'] });
    expect(JSON.stringify(m)).toBe(before);
  });
});

describe('tulkinnat ovat aina kontekstisidonnaisia', () => {
  it('glossesFor: sama konteksti ensin, sitten tarina, sitten muut kontekstit', () => {
    const m = createSeedStory();
    const r = glossesFor(m, '2', { kind: 'koodi', code: '629' });
    expect(r.map((x) => [x.gloss.id, x.match])).toEqual([
      ['g-629-2', 'sama-konteksti'],
      ['g-2-tarina', 'tarina'],
      ['g-b-2', 'muu-konteksti'],
    ]);
    const p = glossesFor(m, '2', { kind: 'polku', pathId: 'polku-b' });
    expect(p.map((x) => [x.gloss.id, x.match])).toEqual([
      ['g-b-2', 'sama-konteksti'],
      ['g-2-tarina', 'tarina'],
      ['g-629-2', 'muu-konteksti'],
    ]);
    const n = glossesFor(m, '2', null);
    expect(n.map((x) => x.match)).toEqual(['tarina', 'muu-konteksti', 'muu-konteksti']);
    expect(glossesFor(m, '2', { kind: 'tarina' })[0]).toMatchObject({ gloss: { id: 'g-2-tarina' }, match: 'sama-konteksti' });
    expect(glossesFor(m, '7', null)).toEqual([]);
    // Jokainen tulos kantaa oman kontekstinsa: mitään ei muuteta yleispäteväksi merkitykseksi.
    for (const x of n) expect(x.gloss.context).toBeDefined();
  });

  it('glossContextLabel', () => {
    const m = createSeedStory();
    expect(glossContextLabel(m, { kind: 'koodi', code: '629' })).toBe('koodi 629');
    expect(glossContextLabel(m, { kind: 'polku', pathId: 'polku-b' })).toBe('Polku B · ihmissuhteiden kehityspolku');
    expect(glossContextLabel(m, { kind: 'tarina' })).toBe('tarina (käyttäjän tulkinta)');
    expect(glossContextLabel(m, { kind: 'polku', pathId: 'x' })).toBe('polku x (poistettu)');
  });

  it('getPerson / getPath / getGloss', () => {
    const m = createSeedStory();
    expect(getPerson(m, 'salla')!.name).toBe('SALLA');
    expect(getPath(m, 'polku-a')!.title).toBe('Polku A');
    expect(getGloss(m, 'g-629-2')!.symbol).toBe('2');
    expect(getPerson(m, 'x')).toBeNull();
    expect(getPath(m, 'x')).toBeNull();
    expect(getGloss(m, 'x')).toBeNull();
  });
});

describe('validateStory löytää rakenteelliset virheet', () => {
  const m = createSeedStory();
  const has = (errs: string[], re: RegExp) => expect(errs.some((e) => re.test(e)), errs.join('\n')).toBe(true);

  it('päällekkäiset tunnukset', () => {
    const errs = validateStory({
      ...m,
      persons: [...m.persons, newPerson('matti', 'TOINEN')],
      glosses: [...m.glosses, m.glosses[0]],
      paths: [...m.paths, m.paths[0]],
      relations: [...m.relations, m.relations[0]],
    });
    has(errs, /Henkilön tunnus "matti" on käytössä 2 kertaa/);
    has(errs, /Tulkinnan tunnus "g-23"/);
    has(errs, /Polun tunnus "polku-a"/);
    has(errs, /Suhteen tunnus "r-hanna3-max"/);
  });

  it('tuntemattomat viittaukset polussa, tulkinnassa ja suhteessa', () => {
    const errs = validateStory({
      ...m,
      paths: [{ ...m.paths[0], steps: [{ name: 'X', personId: 'ei-ole', symbol: '1', stage: '' }] }, m.paths[1]],
      glosses: [
        ...m.glosses,
        { ...m.glosses[0], id: 'g-x', personId: 'ei-ole' },
        { ...m.glosses[0], id: 'g-y', context: { kind: 'polku', pathId: 'ei-polkua' } },
      ],
      relations: [{ id: 'r-x', from: 'ei-ole', to: 'kumpikaan', kind: 'äiti', note: '', source: 'käyttäjä' }],
    });
    has(errs, /askel 1: tuntematon henkilö "ei-ole"/);
    has(errs, /Tulkinta "g-x": tuntematon henkilö "ei-ole"/);
    has(errs, /Tulkinta "g-y": konteksti viittaa tuntemattomaan polkuun "ei-polkua"/);
    has(errs, /Suhde "r-x": tuntematon lähtöhenkilö "ei-ole"/);
    has(errs, /Suhde "r-x": tuntematon kohdehenkilö "kumpikaan"/);
  });

  it('järjestysnumerot: kaksoisnumero, turha numero, puuttuva numero', () => {
    const dup = validateStory({ ...m, persons: m.persons.map((p) => (p.id === 'hanna-2' ? { ...p, homonymOrdinal: 1 } : p)) });
    has(dup, /Nimi HANNA: järjestysnumero 1 on usealla henkilöllä \(hanna-1, hanna-2\)/);
    const single = validateStory({ ...m, persons: m.persons.map((p) => (p.id === 'max' ? { ...p, homonymOrdinal: 1 } : p)) });
    has(single, /Nimi MAX: vain yhdellä henkilöllä/);
    const miss = validateStory({ ...m, persons: m.persons.map((p) => (p.id === 'hanna-3' ? { ...p, homonymOrdinal: null } : p)) });
    has(miss, /Nimi HANNA: 3 henkilöllä on sama nimi, mutta henkilöltä "hanna-3" puuttuu järjestysnumero/);
  });

  it('askeleen nimi eroaa henkilön nimestä ja tyhjät symbolit', () => {
    const errs = validateStory({
      ...m,
      paths: [
        { ...m.paths[0], steps: [{ name: 'SALLA', personId: 'matti', symbol: '6', stage: '' }] },
        { ...m.paths[1], steps: [{ name: 'IDA', personId: 'ida', symbol: '  ', stage: '' }] },
      ],
      glosses: [...m.glosses, { ...m.glosses[0], id: 'g-tyhja', symbol: '' }],
    });
    has(errs, /henkilön "matti" nimi on MATTI, mutta askeleen nimi on SALLA/);
    has(errs, /askel 1: symboli puuttuu/);
    has(errs, /Tulkinta "g-tyhja": symboli puuttuu/);
  });
});

describe('tietomallin erottelu: symbolinen numero ≠ samannimisten järjestysnumero', () => {
  it('polun askeleen symbolin muutos ei muuta yhtään järjestysnumeroa', () => {
    const m = frozenSeed();
    const b = getPath(m, 'polku-b')!;
    const m2 = upsertPath(m, { ...b, steps: b.steps.map((s) => (s.personId === 'hanna-3' ? { ...s, symbol: '7' } : s)) });
    expect(symbolString(getPath(m2, 'polku-b')!, '234')).toBe('734');
    expect(m2.persons).toEqual(m.persons);
    expect(ordinals(m2, ['hanna-1', 'hanna-2', 'hanna-3'])).toEqual([1, 2, 3]);
    expect(personLabel(m2, 'hanna-3')).toBe('HANNA III');
    expect(validateStory(m2)).toEqual([]);
  });

  it('järjestysnumeron muutos ei muuta polkujen symboleja eikä tulkintoja', () => {
    const m = frozenSeed();
    const m2 = upsertPerson(m, { ...getPerson(m, 'hanna-3')!, homonymOrdinal: 1 });
    expect(ordinals(m2, ['hanna-3', 'hanna-1', 'hanna-2'])).toEqual([1, 2, 3]);
    expect(symbols(m2)).toEqual(symbols(m));
    expect(m2.paths).toEqual(m.paths);
    expect(m2.glosses).toEqual(m.glosses);
    expect(validateStory(m2)).toEqual([]);
  });
});

describe('järjestysnumeroiden uudelleennumerointi', () => {
  it('uusi samanniminen henkilö saa seuraavan numeron', () => {
    const m = frozenSeed();
    const m2 = upsertPerson(m, newPerson('hanna-4', 'Hanna', { createdAt: '2026-10-17T00:00:00Z' }));
    expect(getPerson(m2, 'hanna-4')!.name).toBe('HANNA');
    expect(ordinals(m2, ['hanna-1', 'hanna-2', 'hanna-3', 'hanna-4'])).toEqual([1, 2, 3, 4]);
    expect(personLabel(m2, 'hanna-4')).toBe('HANNA IV');
    expect(validateStory(m2)).toEqual([]);
  });

  it('henkilön voi siirtää kohtaan k antamalla järjestysnumeron k', () => {
    const m = frozenSeed();
    const m2 = upsertPerson(m, newPerson('hanna-0', 'HANNA', { homonymOrdinal: 1 }));
    expect(ordinals(m2, ['hanna-0', 'hanna-1', 'hanna-2', 'hanna-3'])).toEqual([1, 2, 3, 4]);
    const m3 = upsertPerson(m2, { ...getPerson(m2, 'hanna-3')!, homonymOrdinal: 2 });
    expect(ordinals(m3, ['hanna-0', 'hanna-3', 'hanna-1', 'hanna-2'])).toEqual([1, 2, 3, 4]);
  });

  it('nimen vaihto numeroi sekä vanhan että uuden nimiryhmän', () => {
    const m = frozenSeed();
    const renamed = upsertPerson(m, { ...getPerson(m, 'hanna-1')!, name: 'salla', createdAt: '2026-10-17T00:00:00Z' });
    expect(ordinals(renamed, ['hanna-2', 'hanna-3'])).toEqual([1, 2]);
    expect(personLabel(renamed, 'hanna-3')).toBe('HANNA II');
    expect(ordinals(renamed, ['salla', 'hanna-1'])).toEqual([1, 2]);
    expect(personLabel(renamed, 'hanna-1')).toBe('SALLA II');
    expect(personLabel(renamed, 'salla')).toBe('SALLA I');
    expect(validateStory(renamed)).toEqual([]);
    // Takaisin: SALLA-ryhmässä on taas yksi henkilö (null), HANNA-ryhmässä kolme.
    const back = upsertPerson(renamed, { ...getPerson(renamed, 'hanna-1')!, name: 'HANNA' });
    expect(getPerson(back, 'salla')!.homonymOrdinal).toBeNull();
    expect(personsByName(back, 'HANNA').map((p) => [p.id, p.homonymOrdinal])).toEqual([
      ['hanna-2', 1],
      ['hanna-3', 2],
      ['hanna-1', 3],
    ]);
    expect(validateStory(back)).toEqual([]);
  });

  it('assignHomonymOrdinals: yksi henkilö saa null, ryhmä 1…k nykyisessä järjestyksessä', () => {
    const m = createSeedStory();
    const broken: StoryModel = {
      ...m,
      persons: m.persons.map((p) =>
        p.id === 'hanna-1' ? { ...p, homonymOrdinal: 7 } : p.id === 'hanna-3' ? { ...p, homonymOrdinal: null } : p.id === 'max' ? { ...p, homonymOrdinal: 4 } : p,
      ),
    };
    const fixed = assignHomonymOrdinals(assignHomonymOrdinals(broken, 'HANNA'), 'max');
    expect(personsByName(fixed, 'HANNA').map((p) => [p.id, p.homonymOrdinal])).toEqual([
      ['hanna-2', 1],
      ['hanna-1', 2],
      ['hanna-3', 3],
    ]);
    expect(getPerson(fixed, 'max')!.homonymOrdinal).toBeNull();
    expect(validateStory(fixed)).toEqual([]);
    expect(assignHomonymOrdinals(m, 'EI-KETÄÄN').persons).toEqual(m.persons);
  });

  it('ajanjakso ratkaisee järjestyksen, kun numeroita ei vielä ole', () => {
    const base = createSeedStory();
    let m: StoryModel = { ...base, persons: [] };
    m = upsertPerson(m, newPerson('u', 'UNTO', { period: { start: '1990-01-01', end: null } }));
    expect(getPerson(m, 'u')!.homonymOrdinal).toBeNull();
    m = upsertPerson(m, newPerson('v', 'UNTO', { homonymOrdinal: null, period: { start: '1950-01-01', end: null } }));
    // u:lla ei ole numeroa (yksin), v:llä ei ole numeroa: ajanjakso ratkaisee.
    expect(ordinals(m, ['v', 'u'])).toEqual([1, 2]);
  });

  it('numeroton uusi samanniminen ei ohita aiempaa: luontiaika ratkaisee', () => {
    const m = frozenSeed();
    const m2 = upsertPerson(m, newPerson('max-2', 'MAX', { createdAt: '2026-10-17T00:00:00Z' }));
    expect(ordinals(m2, ['max', 'max-2'])).toEqual([1, 2]);
    expect(personLabel(m2, 'max')).toBe('MAX I');
    expect(personLabel(m2, 'max-2')).toBe('MAX II');
    const m3 = upsertPerson(m, newPerson('max-0', 'MAX', { homonymOrdinal: 1, createdAt: '2026-10-17T00:00:00Z' }));
    expect(ordinals(m3, ['max-0', 'max'])).toEqual([1, 2]); // pyydetty paikka 1
  });
});

describe('poistot ja viittaukset', () => {
  const events: MatrixEvent[] = [
    { id: 'e1', title: 'Tapahtuma', date: '2020-01-01', note: '', linkedHits: [], personIds: ['hanna-1'] },
  ];

  it('removePerson kieltäytyy, kun polku, tulkinta tai suhde viittaa henkilöön', () => {
    const m = frozenSeed();
    const r = removePerson(m, 'hanna-3');
    expect(r.model).toBe(m);
    expect(r.error).toMatch(/HANNA III ei voi poistaa/);
    expect(r.error).toMatch(/Polku A \(askel 2\)/);
    expect(r.error).toMatch(/Polku B \(askel 1\)/);
    expect(r.error).toMatch(/tulkinta "g-629-2"/);
    expect(r.error).toMatch(/suhde "r-hanna3-max"/);
    expect(personReferences(m, 'max')).toEqual(['Polku A (askel 3)', 'tulkinta "g-629-9"', 'suhde "r-hanna3-max" (äiti)']);
  });

  it('removePerson kieltäytyy, kun tapahtuma viittaa henkilöön', () => {
    const m = frozenSeed();
    const r = removePerson(m, 'hanna-1', events);
    expect(r.model).toBe(m);
    expect(r.error).toMatch(/tapahtuma "Tapahtuma" \(e1\)/);
  });

  it('removePerson poistaa viittaamattoman henkilön ja numeroi samannimiset uudelleen', () => {
    const m = frozenSeed();
    const r = removePerson(m, 'hanna-1');
    expect(r.error).toBeNull();
    expect(getPerson(r.model, 'hanna-1')).toBeNull();
    expect(ordinals(r.model, ['hanna-2', 'hanna-3'])).toEqual([1, 2]);
    expect(personLabel(r.model, 'hanna-3')).toBe('HANNA II');
    expect(validateStory(r.model)).toEqual([]);
    const r2 = removePerson(removePerson(r.model, 'hanna-2').model, 'hanna-2');
    expect(r2.error).toMatch(/ei löydy/);
    const single = removePerson(r.model, 'hanna-2').model;
    expect(getPerson(single, 'hanna-3')!.homonymOrdinal).toBeNull();
    expect(personLabel(single, 'hanna-3')).toBe('HANNA');
    expect(validateStory(single)).toEqual([]);
  });

  it('removePath kieltäytyy, kun tulkinnan konteksti viittaa polkuun', () => {
    const m = frozenSeed();
    const r = removePath(m, 'polku-b');
    expect(r.model).toBe(m);
    expect(r.error).toMatch(/"g-b-2"/);
    const ok = removePath(m, 'polku-a');
    expect(ok.error).toBeNull();
    expect(getPath(ok.model, 'polku-a')).toBeNull();
    expect(validateStory(ok.model)).toEqual([]);
    expect(removePath(m, 'ei-ole').error).toMatch(/ei löydy/);
  });

  it('upsertGloss / removeGloss / upsertRelation / removeRelation palauttavat uuden mallin', () => {
    const m = frozenSeed();
    const g: Gloss = {
      id: 'g-new',
      symbol: ' 9 ',
      meanings: ['uusi'],
      context: { kind: 'koodi', code: '629' },
      personId: 'max',
      name: 'max',
      note: '',
      source: 'käyttäjä',
      createdAt: T0,
    };
    const m2 = upsertGloss(m, g);
    expect(getGloss(m2, 'g-new')).toMatchObject({ symbol: '9', name: 'MAX' });
    expect(getGloss(m, 'g-new')).toBeNull();
    const m3 = upsertGloss(m2, { ...g, meanings: ['muutettu'] });
    expect(m3.glosses.length).toBe(m2.glosses.length);
    expect(getGloss(m3, 'g-new')!.meanings).toEqual(['muutettu']);
    expect(getGloss(removeGloss(m3, 'g-new'), 'g-new')).toBeNull();
    expect(validateStory(m3)).toEqual([]);

    const r4 = upsertRelation(m, { id: 'r-new', from: 'matti', to: 'hanna-3', kind: 'isä', note: '', source: 'käyttäjä' });
    expect(r4.relations.length).toBe(2);
    expect(m.relations.length).toBe(1);
    expect(upsertRelation(r4, { ...r4.relations[1], kind: 'isoisä' }).relations[1].kind).toBe('isoisä');
    expect(removeRelation(r4, 'r-new').relations.map((r) => r.id)).toEqual(['r-hanna3-max']);
  });

  it('mikään muokkaus ei muuta syötettä (jäädytetty siemen)', () => {
    const m = frozenSeed();
    const snapshot = JSON.stringify(m);
    upsertPerson(m, newPerson('hanna-4', 'HANNA'));
    upsertPerson(m, { ...getPerson(m, 'hanna-1')!, name: 'IDA' });
    removePerson(m, 'hanna-1');
    removePerson(m, 'hanna-3');
    assignHomonymOrdinals(m, 'HANNA', 'hanna-3');
    upsertPath(m, { ...getPath(m, 'polku-a')!, title: 'Uusi' });
    removePath(m, 'polku-a');
    upsertGloss(m, { ...getGloss(m, 'g-23')!, meanings: [] });
    removeGloss(m, 'g-23');
    upsertRelation(m, { ...m.relations[0], kind: 'muu' });
    removeRelation(m, 'r-hanna3-max');
    expect(JSON.stringify(m)).toBe(snapshot);
  });
});

describe('lähtötunnisteiden tarkistus fixture-aineistolla', () => {
  const model = (ids: StoryModel['identifiers']): StoryModel => ({ ...createSeedStory(), identifiers: ids });

  it('oikeat sijainnit ja koodit hyväksytään', () => {
    const r = verifyIdentifiers(
      FIXTURE_DIGITS,
      model([
        { name: 'IDA', code: '432', encoding: 'T9', reportedPositions: [273], reportedBy: 'testi' },
        { name: 'MAX', code: '629', encoding: 'T9', reportedPositions: [570, 736], reportedBy: 'testi' },
      ]),
    );
    expect(r.map((x) => x.ok)).toEqual([true, true]);
    expect(r[1]).toMatchObject({ name: 'MAX', reportedCode: '629', computedCode: '629', codeOk: true, count: 2 });
    expect(r[1].positions).toEqual([
      { n: 570, found: '629', ok: true },
      { n: 736, found: '629', ok: true },
    ]);
    expect(r[1].expected).toBeCloseTo((2000 - 3 + 1) / 1000, 12);
  });

  it('väärä sijainti, väärä koodi ja koodaamaton nimi hylätään', () => {
    const r = verifyIdentifiers(
      FIXTURE_DIGITS,
      model([
        { name: 'MAX', code: '629', encoding: 'T9', reportedPositions: [571], reportedBy: 'testi' },
        { name: 'MAX', code: '628', encoding: 'T9', reportedPositions: [570], reportedBy: 'testi' },
        { name: 'ÆON', code: '666', encoding: 'T9', reportedPositions: [], reportedBy: 'testi' },
        { name: 'IDA', code: '432', encoding: 'T9', reportedPositions: [858511, 0, 1.5], reportedBy: 'testi' },
      ]),
    );
    expect(r[0].ok).toBe(false);
    expect(r[0].codeOk).toBe(true);
    expect(r[0].positions[0]).toEqual({ n: 571, found: FIXTURE_DIGITS.slice(570, 573), ok: false });
    expect(r[1]).toMatchObject({ codeOk: false, computedCode: '629', ok: false });
    expect(r[1].positions[0].ok).toBe(true); // sijainti tarkistetaan nimen todellista koodia vasten
    expect(r[2]).toMatchObject({ computedCode: null, codeOk: false, ok: false });
    expect(r[3].positions.map((p) => p.ok)).toEqual([false, false, false]);
    expect(r[3].positions[0].found).toBe(''); // fixture loppuu ennen kohtaa 858511
  });
});

describe.skipIf(!HAS_FULL)('lähtötunnisteiden tarkistus täydellä 1M-aineistolla', () => {
  it('siemenen kaikki lähtötunnisteet täsmäävät aineistoon', () => {
    const r = verifyIdentifiers(full(), createSeedStory());
    expect(r.every((x) => x.ok)).toBe(true);
    const by = Object.fromEntries(r.map((x) => [x.name, x]));
    expect(by.IDA).toMatchObject({ count: 1054, codeOk: true, positions: [{ n: 858511, found: '432', ok: true }] });
    expect(by.MATTI).toMatchObject({ count: 9, positions: [{ n: 858260, found: '62884', ok: true }] });
    expect(by.HANNA.count).toBe(7);
    expect(by.SALLA.count).toBe(6);
    expect(by.MAX.count).toBe(1040);
    expect(by.MINI).toMatchObject({ count: 108, positions: [{ n: 858960, found: '6464', ok: true }] });
    expect(by.MATTI.expected).toBeCloseTo((1_000_000 - 5 + 1) / 1e5, 9);
  });

  it('muutettu tunniste (väärä sijainti tai väärä koodi) ilmoitetaan virheeksi', () => {
    const m = createSeedStory();
    const tampered: StoryModel = {
      ...m,
      identifiers: m.identifiers.map((i) =>
        i.name === 'MATTI' ? { ...i, reportedPositions: [858261] } : i.name === 'IDA' ? { ...i, code: '433' } : i,
      ),
    };
    const r = Object.fromEntries(verifyIdentifiers(full(), tampered).map((x) => [x.name, x]));
    expect(r.MATTI.ok).toBe(false);
    expect(r.MATTI.positions[0]).toMatchObject({ n: 858261, ok: false });
    expect(r.MATTI.positions[0].found).not.toBe('62884');
    expect(r.IDA).toMatchObject({ ok: false, codeOk: false, reportedCode: '433', computedCode: '432' });
    expect(r.HANNA.ok).toBe(true);
  });
});
