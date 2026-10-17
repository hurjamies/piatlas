import { describe, expect, it } from 'vitest';
import { t9Code } from '../src/core/matrix/refs';
import { createSeedStory } from '../src/core/matrix/seed';
import type { StoryModel } from '../src/core/matrix/types';
import {
  codeSet,
  encodeIdentifier,
  extractIdentifiers,
  IdentifierContext,
  identifiersForTimeRange,
  isValidIsoDate,
  sameIdentifierSets,
  sameSetsWarning,
  storyNames,
} from '../src/core/path/identifiers';
import type { IdentifierKind, IdentifierRole, PathIdentifier } from '../src/core/path/types';

function ident(kind: IdentifierKind, value: string, extra: Partial<PathIdentifier> = {}): PathIdentifier {
  return { id: `${kind}:${value}`, role: 'lähtö', kind, label: value, value, origin: 'käyttäjä', ...extra };
}

function seedCtx(events: IdentifierContext['events'] = []): IdentifierContext {
  return { story: createSeedStory(), events };
}

const names = (ids: PathIdentifier[]): string[] => ids.map((i) => i.label);

describe('encodeIdentifier: koodaussäännöt', () => {
  it('nimi, sana ja henkilö: T9 suomalaisella translitteroinnilla (sama kuin t9Code)', () => {
    const h = encodeIdentifier(ident('nimi', 'Hanna'));
    expect(h).toMatchObject({ ok: true, code: '42662', error: null });
    expect(h.rule).toContain('H=4 A=2 N=6 N=6 A=2');
    expect(h.rule).toContain('Å,Ä→A, Ö→O');
    expect(encodeIdentifier(ident('henkilö', 'MATTI')).code).toBe('62884');
    expect(encodeIdentifier(ident('sana', 'toivo')).code).toBe('86486');
    // Skandinaaviset kirjaimet: Ä → A, Ö → O
    expect(encodeIdentifier(ident('sana', 'Äiti')).code).toBe(t9Code('AITI'));
    expect(encodeIdentifier(ident('nimi', 'Örö')).code).toBe('676');
    for (const n of ['IDA', 'MAX', 'MINI', 'SALLA']) expect(encodeIdentifier(ident('nimi', n)).code).toBe(t9Code(n));
    // välit ja yhdysmerkit ohitetaan
    expect(encodeIdentifier(ident('nimi', 'Anna-Liisa')).code).toBe(t9Code('ANNALIISA'));
  });

  it('numerojono: raaka (erottimet ohitetaan), muu merkki on virhe', () => {
    expect(encodeIdentifier(ident('numerojono', '858 511')).code).toBe('858511');
    expect(encodeIdentifier(ident('numerojono', '12-34.56')).code).toBe('123456');
    const bad = encodeIdentifier(ident('numerojono', '12a'));
    expect(bad.ok).toBe(false);
    expect(bad.code).toBe('');
    expect(bad.error).toContain('"a" ei ole numero');
  });

  it('päivämäärä ja tapahtuma: dateToDigits, oletusmuoto DDMMYYYY', () => {
    const d = encodeIdentifier(ident('päivämäärä', '2014-03-23'));
    expect(d).toMatchObject({ ok: true, code: '23032014' });
    expect(d.rule).toBe('Päivämäärä 2014-03-23 muodossa DDMMYYYY: 23032014');
    expect(encodeIdentifier(ident('päivämäärä', '2014-03-23', { dateFormat: 'YYYYMMDD' })).code).toBe('20140323');
    expect(encodeIdentifier(ident('tapahtuma', '2014-03-23', { dateFormat: 'DDMM' })).code).toBe('2303');
    expect(encodeIdentifier(ident('tapahtuma', '2014-03-23', { dateFormat: 'DDMMYY' })).code).toBe('230314');
  });

  it('virheet suomeksi, ei poikkeuksia', () => {
    const cases: [PathIdentifier, string][] = [
      [ident('nimi', ''), 'arvo on tyhjä'],
      [ident('nimi', 'Hanna@'), 'ei kuulu T9-näppäimistöön'],
      [ident('päivämäärä', '2014-02-30'), 'ei ole kelvollinen päivämäärä'],
      [ident('päivämäärä', '23.3.2014'), 'ei ole kelvollinen päivämäärä'],
      [ident('tapahtuma', '', { label: 'Muutto' }), 'Tapahtumalla Muutto ei ole päivämäärää'],
      [{ ...ident('nimi', 'X'), kind: 'outo' as IdentifierKind }, 'Tuntematon tunnisteen tyyppi'],
    ];
    for (const [id, msg] of cases) {
      const r = encodeIdentifier(id);
      expect(r.ok).toBe(false);
      expect(r.error).toContain(msg);
      expect(r.identifier).toBe(id);
    }
  });

  it('kalenteripäivän tarkistus huomioi karkausvuodet', () => {
    expect(isValidIsoDate('2024-02-29')).toBe(true);
    expect(isValidIsoDate('2023-02-29')).toBe(false);
    expect(isValidIsoDate('1900-02-29')).toBe(false);
    expect(isValidIsoDate('2000-02-29')).toBe(true);
    expect(isValidIsoDate('2024-13-01')).toBe(false);
  });
});

describe('extractIdentifiers: vain tarinan tunnetut nimet', () => {
  it('"Matti ja Hanna eivät ole parisuhteessa" → MATTI, HANNA', () => {
    const ids = extractIdentifiers('Matti ja Hanna eivät ole parisuhteessa', 'lähtö', seedCtx());
    expect(names(ids)).toEqual(['MATTI', 'HANNA']);
    for (const i of ids) {
      expect(i).toMatchObject({ role: 'lähtö', kind: 'nimi', origin: 'teksti', eventId: null });
      expect(i.value).toBe(i.label);
      expect(encodeIdentifier(i).code).toBe(t9Code(i.label));
    }
    // MATTI on yksi henkilö → personId; HANNA on kolme henkilöä → ei arvata
    expect(ids[0].personId).toBe('matti');
    expect(ids[1].personId).toBeNull();
  });

  it('taivutusmuoto alkuosana: "Hannan kanssa" → HANNA', () => {
    expect(names(extractIdentifiers('Hannan kanssa', 'tavoite', seedCtx()))).toEqual(['HANNA']);
    expect(names(extractIdentifiers('Idalle ja Maxille, Sallasta', 'tavoite', seedCtx()))).toEqual(['IDA', 'MAX', 'SALLA']);
  });

  it('tuntemattomat sanat ohitetaan, mitään ei keksitä', () => {
    expect(extractIdentifiers('Kalle ja Pekka menivät kauppaan', 'lähtö', seedCtx())).toEqual([]);
    expect(extractIdentifiers('', 'lähtö', seedCtx())).toEqual([]);
    // "Idea" ei ala nimellä IDA, "Minä" ei ala nimellä MINI
    expect(extractIdentifiers('Idea: minä ja maailma', 'lähtö', seedCtx())).toEqual([]);
  });

  it('sama nimi vain kerran, ensimmäisen esiintymän järjestyksessä', () => {
    const ids = extractIdentifiers('Hanna, Matti ja Hannan äiti sekä HANNA', 'lähtö', seedCtx());
    expect(names(ids)).toEqual(['HANNA', 'MATTI']);
  });

  it('täsmävastaavuus voittaa, muuten pisin nimi, jolla sana alkaa', () => {
    const story: StoryModel = {
      ...createSeedStory(),
      identifiers: [],
      persons: [
        { ...createSeedStory().persons[0], id: 'anna', name: 'ANNA' },
        { ...createSeedStory().persons[0], id: 'annamari', name: 'ANNAMARI' },
      ],
    };
    const ctx: IdentifierContext = { story, events: [] };
    expect(names(extractIdentifiers('Annamarin kanssa', 'lähtö', ctx))).toEqual(['ANNAMARI']);
    expect(names(extractIdentifiers('Annan kanssa', 'lähtö', ctx))).toEqual(['ANNA']);
    expect(names(extractIdentifiers('Anna', 'lähtö', ctx))).toEqual(['ANNA']);
  });

  it('tarinan nimet: lähtötunnisteet ja henkilöt kerran', () => {
    expect(storyNames(createSeedStory())).toEqual(['IDA', 'MATTI', 'HANNA', 'SALLA', 'MAX', 'MINI']);
  });
});

describe('identifiersForTimeRange: aikarajaus koskee vain tapahtumia', () => {
  const events = [
    { id: 'e1', title: 'Muutto', date: '2014-03-23' },
    { id: 'e2', title: 'Häät', date: '2019-06-15' },
  ];
  const ev = (id: string, date: string, role: IdentifierRole = 'tavoite'): PathIdentifier =>
    ident('tapahtuma', date, { id: `tapahtuma:${id}`, eventId: id, label: id, role });

  it('rajauksen ulkopuoliset tapahtumat jätetään pois huomautuksen kanssa', () => {
    const ids = [ev('e1', '2014-03-23'), ev('e2', '2019-06-15'), ident('nimi', 'HANNA')];
    const r = identifiersForTimeRange(ids, { story: createSeedStory(), events }, { from: '2015-01-01', to: null });
    expect(r.identifiers.map((i) => i.id)).toEqual(['tapahtuma:e2', 'nimi:HANNA']);
    expect(r.notes.some((n) => n.includes('Muutto (2014-03-23) jätettiin pois'))).toBe(true);
    expect(r.notes.some((n) => n.includes('ei vaikuta piin indekseihin'))).toBe(true);
  });

  it('rajat mukaan lukien; ilman rajausta kaikki säilyvät', () => {
    const ids = [ev('e1', '2014-03-23'), ev('e2', '2019-06-15')];
    const ctx = { story: createSeedStory(), events };
    expect(identifiersForTimeRange(ids, ctx, { from: '2014-03-23', to: '2019-06-15' }).identifiers).toHaveLength(2);
    expect(identifiersForTimeRange(ids, ctx, { from: '2014-03-24', to: '2019-06-14' }).identifiers).toHaveLength(0);
    expect(identifiersForTimeRange(ids, ctx, null)).toEqual({ identifiers: ids, notes: [] });
    expect(identifiersForTimeRange(ids, ctx, { from: null, to: null }).identifiers).toHaveLength(2);
  });

  it('tapahtuman päivä kontekstista, jos tunnisteen arvo ei ole päivämäärä; virheellinen raja ohitetaan', () => {
    const ctx = { story: createSeedStory(), events };
    const noDate = ident('tapahtuma', '', { eventId: 'e1', label: 'Muutto' });
    expect(identifiersForTimeRange([noDate], ctx, { from: '2015-01-01', to: null }).identifiers).toEqual([]);
    const r = identifiersForTimeRange([noDate], ctx, { from: '1.1.2015', to: null });
    expect(r.identifiers).toEqual([noDate]);
    expect(r.notes[0]).toContain('ei ole muotoa VVVV-KK-PP');
    const unknown = ident('tapahtuma', '', { eventId: 'xx', label: 'Tuntematon' });
    const r2 = identifiersForTimeRange([unknown], ctx, { from: '2015-01-01', to: null });
    expect(r2.identifiers).toEqual([unknown]);
    expect(r2.notes.some((n) => n.includes('päivämäärä puuttuu'))).toBe(true);
  });
});

describe('sameIdentifierSets: lähtö- ja tavoitejoukko koodien mukaan', () => {
  it('sama joukko eri järjestyksessä ja eri tyypeillä, kun koodit ovat samat', () => {
    const start = [ident('nimi', 'MATTI'), ident('nimi', 'HANNA')];
    const goal = [ident('nimi', 'Hanna'), ident('numerojono', '62884')];
    expect(sameIdentifierSets(start, goal)).toBe(true);
    expect(sameIdentifierSets(start, [...goal, ident('nimi', 'SALLA')])).toBe(false);
    expect(sameIdentifierSets(start, [ident('nimi', 'MATTI')])).toBe(false);
    expect(sameIdentifierSets([], [])).toBe(false);
    expect(sameIdentifierSets(['62884'], ['62884'])).toBe(true);
    expect(codeSet([ident('nimi', 'MATTI'), ident('numerojono', 'x')])).toEqual(new Set(['62884']));
  });

  it('varoitusteksti (docs §1)', () => {
    const w = sameSetsWarning(['MATTI', 'HANNA']);
    expect(w).toContain('Lähtö- ja tavoitetila koodautuvat samaksi tunnistejoukoksi (MATTI, HANNA)');
    expect(w).toContain('haku ei voi erottaa niitä');
    expect(w).toContain('Anna tavoitteelle oma tunniste');
  });
});
