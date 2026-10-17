import { describe, expect, it } from 'vitest';
import { digitsAt } from '../src/core/digits';
import { verifyHit } from '../src/core/matrix/hits';
import { expand, GROUPS } from '../src/core/matrix/expand';
import { JUMP_DEFINITIONS, JUMP_IDS, JUMP_NOTE, runJump } from '../src/core/matrix/jumps';
import {
  DISCLAIMER_369,
  digitalRoot,
  FIB_3K,
  OP369_IDS,
  Op369Report,
  Op369Result,
  OPS369_DEFINITIONS,
  run369,
} from '../src/core/matrix/ops369';
import { referenceCodes } from '../src/core/matrix/refs';
import { createSeedStory } from '../src/core/matrix/seed';
import type { Direction, MatrixEdge, MatrixEnv, NodeRef } from '../src/core/matrix/types';
import { JUMP_VERSION, nodeKey, OPS369_VERSION } from '../src/core/matrix/types';
import { createRng } from '../src/core/random';
import { FULL, HAS_FULL } from './helpers';

const RAN_AT = '2026-10-16T12:00:00.000Z';

function envFor(digits: string, direction: Direction = '234', anchor = { code: '432', n: 858511, label: 'IDA' }): MatrixEnv {
  return { digits, story: createSeedStory(), anchor, direction, events: [] };
}

/** Taustajono pelkistä numeroista 0 ja 1: yksikään viitekoodi (432, 62884, 42662, 72552, 629, 6464) ei voi syntyä siihen. */
function background(N: number, seed: number): string[] {
  const rng = createRng(seed);
  return Array.from({ length: N }, () => String(rng.int(0, 1)));
}

function plant(arr: string[], n: number, code: string): void {
  for (let j = 0; j < code.length; j++) arr[n - 1 + j] = code[j];
}

const T = 1000; // synteettisen kohteen 432 alkukohta

function synthetic(plants: [number, string][] = [], N = 3000): string {
  const a = background(N, 7);
  plant(a, T, '432');
  for (const [n, c] of plants) plant(a, n, c);
  return a.join('');
}

const result = (r: Op369Report, id: string): Op369Result => r.results.find((x) => x.id === id)!;
const allFindings = (r: Op369Result): MatrixEdge[] => [...(r.primary?.findings ?? []), ...(r.opposite?.findings ?? [])];
const allReported = (r: Op369Result): MatrixEdge[] => [...(r.primary?.reported ?? []), ...(r.opposite?.reported ?? [])];

/** n ± F_k (fib-3k) on spiraalinaapuruus ja geo-369 kävely kartoituksessa: geometrinen. Muut: matemaattinen. */
const LAYER_OF: Record<string, string> = { 'geo-369': 'geometrinen', 'fib-3k': 'geometrinen' };

/** Jokainen löytö ja raportoitu askel viittaa π-solmuun, joka täsmää lähdeaineistoon. */
function expectFindingsVerified(digits: string, r: Op369Report): void {
  for (const m of r.results) {
    for (const e of [...allFindings(m), ...allReported(m)]) {
      expect(e.verified).toBe(true);
      expect(e.op).toBe(`369:${m.id}`);
      expect(e.group).toBe(`369 · ${m.title}`);
      expect(e.layer).toBe(LAYER_OF[m.id] ?? 'matemaattinen');
      if (e.to.kind === 'hit') expect(verifyHit(digits, e.to.code, e.to.n)).toBe(true);
      else {
        // hyppyjonon löytö: kohdat alku, alku + askel, … lukevat koodin
        expect(e.to.kind).toBe('position');
        const { alku, askel, L } = e.metrics as { alku: number; askel: number; L: number };
        const read = Array.from({ length: L }, (_, j) => digits[alku + askel * j - 1]).join('');
        expect(e.relation).toContain(read);
        expect(alku + askel * (L - 1)).toBe((e.to as { n: number }).n);
      }
    }
  }
}

/** nothingNew, matches ja findings ovat keskenään johdonmukaisia. */
function expectConsistent(r: Op369Report): void {
  for (const m of r.results) {
    if (!m.applicable) {
      expect(m.primary).toBeNull();
      expect(m.opposite).toBeNull();
      expect(m.reasonNotApplicable).toBeTruthy();
      expect(m.nothingNew).toBe(true);
      continue;
    }
    expect(m.reasonNotApplicable).toBeNull();
    for (const d of [m.primary!, m.opposite!]) {
      expect(d.findings.length).toBeLessThanOrEqual(d.matches);
      if (d.matches < 1000) expect(d.findings.length).toBe(d.matches);
      // Raportoidut askeleet vain geometrisessa kävelyssä, eikä niitä lasketa löydöiksi.
      if (m.id === 'geo-369') {
        expect(d.matches).toBe(0);
        expect(d.findings).toEqual([]);
        expect(d.checks.every((c) => !c.match)).toBe(true);
      } else expect(d.reported).toEqual([]);
    }
    expect(m.nothingNew).toBe(m.primary!.matches + m.opposite!.matches === 0);
    expect(m.nothingNew).toBe(allFindings(m).length === 0);
  }
  // Vain vertailumenetelmät ratkaisevat kokonaistuloksen (geo-369:n askeleet tuotetaan aina).
  expect(r.nothingNewOverall).toBe(r.results.filter((m) => m.id !== 'geo-369').every((m) => m.nothingNew));
  if (r.nothingNewOverall && r.results.some((m) => m.applicable)) expect(r.summary).toMatch(/^Ei uutta: /);
  expect(r.disclaimer).toBe(DISCLAIMER_369);
  expect(`${r.summary} ${JSON.stringify(r.results)}`).not.toMatch(/merkitykselli|merkitsevä|todistaa/i);
}

describe('digitaalinen juuri', () => {
  it('dr(0) = 0 ja dr(x) = 1 + (x − 1) mod 9', () => {
    expect(digitalRoot(0)).toBe(0);
    expect(digitalRoot(9)).toBe(9);
    expect(digitalRoot(18)).toBe(9);
    expect(digitalRoot(10)).toBe(1);
    expect(digitalRoot(251)).toBe(8);
    expect(digitalRoot(858511)).toBe(1);
    expect(digitalRoot(-12)).toBe(3);
  });

  it('numerojonolle käytetään numerosummaa', () => {
    expect(digitalRoot('629')).toBe(8);
    expect(digitalRoot('234')).toBe(9);
    expect(digitalRoot('432')).toBe(9);
    expect(digitalRoot('0')).toBe(0);
    expect(digitalRoot('000')).toBe(0);
    expect(digitalRoot('42662')).toBe(2);
    // pitkä jono ei menetä tarkkuutta
    expect(digitalRoot('9'.repeat(40))).toBe(9);
    for (let x = 0; x < 2000; x++) expect(digitalRoot(String(x))).toBe(digitalRoot(x));
  });

  it('dr ja mod 9 sisältävät saman informaation', () => {
    for (let x = 1; x < 500; x++) {
      expect(digitalRoot(x) === 9).toBe(x % 9 === 0);
      expect([3, 6, 9].includes(digitalRoot(x))).toBe(x % 3 === 0);
    }
  });
});

describe('369-määritelmät', () => {
  it('kuusi menetelmää, F_{3k} oikein', () => {
    expect([...OP369_IDS]).toEqual(['offset-369', 'skip-369', 'mod-9', 'digital-root', 'geo-369', 'fib-3k']);
    expect(Object.keys(OPS369_DEFINITIONS).sort()).toEqual([...OP369_IDS].sort());
    expect(FIB_3K.map((x) => x.F)).toEqual([2, 8, 34, 144, 610, 2584, 10946]);
    expect(OPS369_DEFINITIONS['digital-root'].definition).toMatch(/Sama informaatio kuin mod 9/);
    expect(OPS369_DEFINITIONS['geo-369'].definition).toMatch(/algoritminen valinta/);
  });
});

describe('369 synteettisellä aineistolla (istutetut viitekoodit)', () => {
  // 234: MATTI kohtaan n + 6 (offset), MAX kohtaan n + F9 = n + 34 (fib-3k)
  // 432: MINI kohtaan n − 9 (offset), SALLA kohtaan n − F12 = n − 144 (fib-3k)
  const planted = synthetic([
    [T + 6, '62884'],
    [T + 34, '629'],
    [T - 9, '6464'],
    [T - 144, '72552'],
  ]);
  const env = envFor(planted, '234', { code: '432', n: T, label: 'IDA' });
  const target: NodeRef = { kind: 'hit', code: '432', n: T };
  const rep = run369(target, env, RAN_AT);

  it('offset-369 löytää istutetut koodit kohdista n + 6 ja n − 9', () => {
    const off = result(rep, 'offset-369');
    expect(off.applicable).toBe(true);
    expect(off.nothingNew).toBe(false);
    expect(off.primary!.direction).toBe('234');
    expect(off.opposite!.direction).toBe('432');
    expect(off.primary!.findings.map((e) => e.to)).toEqual([{ kind: 'hit', code: '62884', n: T + 6 }]);
    expect(off.opposite!.findings.map((e) => e.to)).toEqual([{ kind: 'hit', code: '6464', n: T - 9 }]);
    const e = off.primary!.findings[0];
    expect(e.direction).toBe('234');
    expect(e.domain).toBe('pi-indeksi');
    expect(e.crossesRealm).toBe(false);
    expect(e.metrics!['Δn']).toBe(6);
    expect(off.primary!.checks.find((c) => c.match)!.label).toBe('n + 6 → MATTI 62884');
    expect(off.opposite!.checks.find((c) => c.match)!.label).toBe('n − 9 → MINI 6464');
  });

  it('fib-3k löytää istutetut koodit kohdista n + F9 ja n − F12', () => {
    const fib = result(rep, 'fib-3k');
    expect(fib.nothingNew).toBe(false);
    expect(fib.primary!.domain).toBe('spiraali');
    expect(fib.primary!.findings.map((e) => e.to)).toEqual([{ kind: 'hit', code: '629', n: T + 34 }]);
    expect(fib.opposite!.findings.map((e) => e.to)).toEqual([{ kind: 'hit', code: '72552', n: T - 144 }]);
    expect(fib.primary!.checks).toHaveLength(7 * 6);
  });

  it('n ± F_k: sama luokitus (geometrinen, spiraali) 369 fib-3k:ssa ja osumasolmun Fibonacci-naapureissa', () => {
    const fib = allFindings(result(rep, 'fib-3k'));
    expect(fib.length).toBe(2);
    for (const e of fib) expect(e).toMatchObject({ layer: 'geometrinen', domain: 'spiraali' });
    expect(fib[0].trace).toMatch(/spiraalinaapuruus n ± F_k/);
    const hood = expand(target, env).edges.filter((e) => e.group === GROUPS.fib);
    expect(hood.length).toBeGreaterThan(0);
    for (const e of hood) expect(e).toMatchObject({ layer: 'geometrinen', domain: 'spiraali' });
    // Sama kohde n + F9 = n + 34 (MAX 629) molemmissa, sama tyyppi.
    const same = hood.find((e) => nodeKey(e.to) === `hit:629@${T + 34}`);
    expect(same).toBeDefined();
    expect(same!.layer).toBe(fib[0].layer);
    expect(same!.domain).toBe(fib[0].domain);
    // Muut 369-perheet pysyvät matemaattisina.
    for (const id of ['offset-369', 'skip-369', 'mod-9', 'digital-root'])
      for (const e of allFindings(result(rep, id))) expect(e.layer).toBe('matemaattinen');
  });

  it('löydöt tarkistetaan lähdeaineistosta ja raportti on johdonmukainen', () => {
    expectFindingsVerified(planted, rep);
    expectConsistent(rep);
    expect(rep.summary).toMatch(/^6 menetelmää, \d+ löytöä, odotus \d/);
  });

  it('position-kohde (L = 1) löytää samat siirtymät', () => {
    const r = run369({ kind: 'position', n: T }, env, RAN_AT);
    const off = result(r, 'offset-369');
    expect(off.primary!.findings.map((e) => e.to)).toEqual([{ kind: 'hit', code: '62884', n: T + 6 }]);
    expect(off.opposite!.findings.map((e) => e.to)).toEqual([{ kind: 'hit', code: '6464', n: T - 9 }]);
    expect(result(r, 'mod-9').primary!.checks[0].label).toBe('n mod 9');
    // dr(koodi) puuttuu, koska kohdalla ei ole koodia
    expect(result(r, 'digital-root').primary!.checks.map((c) => c.label)).not.toContain('dr(koodi)');
    expectFindingsVerified(planted, r);
    expectConsistent(r);
  });

  it('skip-369 löytää istutetun hyppyjonon molempiin suuntiin', () => {
    const a = background(3000, 11);
    plant(a, T, '432');
    a[T + 9 - 1] = '3';
    a[T + 18 - 1] = '2'; // 234, askel 9: 4 · 3 · 2
    a[T - 6 - 1] = '3';
    a[T - 12 - 1] = '2'; // 432, askel 6: 4 · 3 · 2
    const d = a.join('');
    const r = run369({ kind: 'hit', code: '432', n: T }, envFor(d, '234', { code: '432', n: T, label: 'IDA' }), RAN_AT);
    const sk = result(r, 'skip-369');
    expect(sk.primary!.findings.map((e) => e.to)).toEqual([{ kind: 'position', n: T + 18 }]);
    expect(sk.opposite!.findings.map((e) => e.to)).toEqual([{ kind: 'position', n: T - 12 }]);
    expect(sk.primary!.findings[0].metrics).toMatchObject({ alku: T, askel: 9, loppu: T + 18, L: 3 });
    expect(sk.opposite!.findings[0].metrics).toMatchObject({ alku: T, askel: -6, loppu: T - 12, L: 3 });
    expectFindingsVerified(d, r);
    expectConsistent(r);
  });

  it('ilman istutuksia: ei uutta, mutta kaikki tarkistukset listataan', () => {
    const d = synthetic();
    const r = run369({ kind: 'hit', code: '432', n: T }, envFor(d, '234', { code: '432', n: T, label: 'IDA' }), RAN_AT);
    expect(r.results.every((m) => m.applicable)).toBe(true);
    expect(r.nothingNewOverall).toBe(true);
    expect(r.summary).toBe('Ei uutta: mikään menetelmä ei löytänyt yhteyttä.');
    for (const m of r.results) {
      expect(m.nothingNew).toBe(true);
      expect(allFindings(m)).toHaveLength(0);
      expect(m.primary!.checks.length).toBeGreaterThan(0);
      expect(m.opposite!.checks.length).toBeGreaterThan(0);
    }
    expect(result(r, 'offset-369').primary!.checks).toHaveLength(18);
    expect(result(r, 'skip-369').opposite!.checks).toHaveLength(18);
    expect(result(r, 'fib-3k').opposite!.checks).toHaveLength(42);
    // ainoa viitekoodin osuma on kohde itse → ei Δn-vertailuja eikä kävelyä
    expect(result(r, 'mod-9').primary!.expected).toBe(0);
    expect(result(r, 'geo-369').primary!.checks).toHaveLength(9);
    expect(result(r, 'geo-369').primary!.checks.every((c) => /pysähtyi/.test(c.value))).toBe(true);
    expectConsistent(r);
  });

  it('odotusarvot: Σ 3 · 10^−L, ehdollistettuna päällekkäisiin kohteen numeroihin', () => {
    const d = synthetic();
    const r = run369({ kind: 'hit', code: '432', n: T }, envFor(d, '234', { code: '432', n: T, label: 'IDA' }), RAN_AT);
    const base = 2e-3 + 1e-4 + 3e-5; // 432, 629 (L3) + 6464 (L4) + 62884, 42662, 72552 (L5)
    expect(result(r, 'offset-369').primary!.expected).toBeCloseTo(3 * base, 12);
    // 432, k = 3: 6464 kohdassa n − 3 kattaa kohdan n ('4' = koodin 4. numero) → 10^−3; L5-koodit → 0
    expect(result(r, 'offset-369').opposite!.expected).toBeCloseTo(3e-3 + 2 * base, 12);
    const k3 = result(r, 'offset-369').opposite!.checks.find((c) => c.label === 'n − 3 → MINI 6464')!;
    expect(k3.detail).toMatch(/ehdollinen todennäköisyys/);
    // skip: kohdan n numero 4 tunnetaan → 432: 10^−2, 42662: 10^−4, muut 0 (3 askelta)
    expect(result(r, 'skip-369').primary!.expected).toBeCloseTo(3 * (1e-2 + 1e-4), 12);
    expect(result(r, 'skip-369').opposite!.expected).toBeCloseTo(3 * (1e-2 + 1e-4), 12);
    // fib: F3 = 2 on päällekkäin kohteen kanssa eikä mikään koodi sovi tunnettuihin numeroihin → 0;
    // F18 = 2584 ja F21 = 10946 ovat aineiston (N = 3000) ulkopuolella → ei lasketa; jäljelle 4 · base
    expect(result(r, 'fib-3k').primary!.expected).toBeCloseTo(4 * base, 12);
    expect(result(r, 'fib-3k').opposite!.expected).toBeCloseTo(4 * base, 12);
    const outside = result(r, 'fib-3k').primary!.checks.filter((c) => c.value === 'aineiston ulkopuolella');
    expect(outside).toHaveLength(2 * 6);
    expect(outside.every((c) => !c.match && c.position === null)).toBe(true);
    expect(result(r, 'geo-369').primary!.expected).toBeNull();
    expect(result(r, 'geo-369').primary!.expectedNote).toMatch(/algoritminen valinta/);
  });

  it('kohteen oma osuma ja sen kanssa päällekkäiset saman koodin osumat ohitetaan', () => {
    const a = background(3000, 5);
    plant(a, T, '646464'); // 6464 kohdissa T ja T + 2 (päällekkäin)
    plant(a, T + 100, '6464');
    plant(a, T + 300, '432');
    const d = a.join('');
    const r = run369({ kind: 'hit', code: '6464', n: T }, envFor(d, '234', { code: '432', n: T + 300, label: 'IDA' }), RAN_AT);
    const mini = result(r, 'mod-9').primary!.checks.find((c) => c.label === 'Δn → MINI 6464')!;
    expect(mini.position).toBe(T + 100);
    const own = result(r, 'offset-369').primary!.checks.find((c) => c.label === 'n + 3 → MINI 6464')!;
    expect(own.match).toBe(false);
    expect(own.detail).toMatch(/Ohitettu: päällekkäinen kohteen oman osuman kanssa/);
    expectConsistent(r);
  });

  it('suunta valitsee ensisijaisen ja vastakkaisen tuloksen', () => {
    const r234 = run369({ kind: 'hit', code: '432', n: T }, { ...env, direction: '234' }, RAN_AT);
    const r432 = run369({ kind: 'hit', code: '432', n: T }, { ...env, direction: '432' }, RAN_AT);
    expect(r432.direction).toBe('432');
    for (const id of ['offset-369', 'skip-369', 'fib-3k', 'geo-369']) {
      expect(result(r432, id).primary).toEqual(result(r234, id).opposite);
      expect(result(r432, id).opposite).toEqual(result(r234, id).primary);
    }
  });

  it('ei muuta ympäristöä ja on deterministinen', () => {
    const e = envFor(planted, '234', { code: '432', n: T, label: 'IDA' });
    const before = JSON.stringify(e);
    const a = run369(target, e, RAN_AT);
    const b = run369(target, e, RAN_AT);
    expect(JSON.stringify(e)).toBe(before);
    expect(a).toEqual(b);
    expect(a.ranAt).toBe(RAN_AT);
    expect(a.version).toBe(OPS369_VERSION);
    expect(a.targetKey).toBe('hit:432@1000');
    expect(a.referenceCodes).toEqual(referenceCodes(e.story));
  });
});

describe('369 tarinasolmuille ja rajatapauksille', () => {
  const d = synthetic([[T + 6, '62884']]);
  const env = envFor(d, '234', { code: '432', n: T, label: 'IDA' });

  it('polku B: vain mod-9 ja digital-root, käyttäjän symbolinumeroista 234 / 432', () => {
    const r = run369({ kind: 'path', pathId: 'polku-b' }, env, RAN_AT);
    for (const m of r.results) {
      const only = m.id === 'mod-9' || m.id === 'digital-root';
      expect(m.applicable).toBe(only);
      if (!only) expect(m.reasonNotApplicable).toMatch(/symbolinumeroista/);
      else {
        expect(m.notes.join(' ')).toMatch(/laskettu käyttäjän antamista symbolinumeroista/);
        expect(m.primary!.domain).toBe('tarina');
        expect(m.primary!.checks[0].value).toMatch(/^(dr\()?234[ )]/);
        expect(m.opposite!.checks[0].value).toMatch(/^(dr\()?432[ )]/);
        expect(m.primary!.checks[0].detail).toMatch(/käyttäjän antamista symbolinumeroista/);
        expect(m.primary!.expected).toBeNull();
        expect(allFindings(m)).toHaveLength(0);
      }
    }
    expect(result(r, 'mod-9').primary!.checks[0].value).toBe('234 mod 9 = 0 (≡ 0)');
    expect(result(r, 'digital-root').opposite!.checks[0].value).toBe('dr(432) = 9 ∈ {3, 6, 9}');
    // laskelma käyttäjän luvuista ei ole π-yhteys
    expect(r.nothingNewOverall).toBe(true);
    expect(r.summary).toMatch(/käyttäjän antamista symbolinumeroista/);
    expectConsistent(r);
    // suunta 432: ensisijainen tulos luetaan takaperin
    const r432 = run369({ kind: 'path', pathId: 'polku-b' }, { ...env, direction: '432' }, RAN_AT);
    expect(result(r432, 'mod-9').primary!.checks[0].value).toMatch(/^432 /);
  });

  it('tulkinta ja polkujen yhdistys lasketaan symbolinumeroista', () => {
    const g = run369({ kind: 'gloss', glossId: 'g-23' }, env, RAN_AT);
    expect(g.results.filter((m) => m.applicable).map((m) => m.id)).toEqual(['mod-9', 'digital-root']);
    expect(result(g, 'digital-root').primary!.checks[0].value).toBe('dr(23) = 5');
    expect(result(g, 'digital-root').opposite!.checks[0].value).toBe('dr(32) = 5');
    const j = run369({ kind: 'junction', personId: 'hanna-3', pathIds: ['polku-a', 'polku-b'] }, env, RAN_AT);
    expect(result(j, 'mod-9').primary!.checks.map((c) => c.value)).toEqual(['629 mod 9 = 8', '234 mod 9 = 0 (≡ 0)']);
    expect(result(j, 'mod-9').opposite!.checks.map((c) => c.value)).toEqual(['926 mod 9 = 8', '432 mod 9 = 0 (≡ 0)']);
    expectConsistent(g);
    expectConsistent(j);
  });

  it('tapahtuma, puuttuva solmu ja tarkistamaton osuma eivät sovellu', () => {
    for (const ref of [
      { kind: 'event', eventId: 'e1' },
      { kind: 'path', pathId: 'ei-ole' },
      { kind: 'person', personId: 'ei-ole' },
      { kind: 'hit', code: '432', n: T + 1 },
      { kind: 'position', n: 0 },
      { kind: 'position', n: d.length + 1 },
    ] as NodeRef[]) {
      const r = run369(ref, env, RAN_AT);
      expect(r.results.every((m) => !m.applicable)).toBe(true);
      expect(r.summary).toMatch(/^Ei sovellettavia menetelmiä: /);
      expectConsistent(r);
    }
    const bad = run369({ kind: 'hit', code: '432', n: T + 1 }, env, RAN_AT);
    expect(bad.results[0].reasonNotApplicable).toMatch(/ei täsmää lähdeaineistoon/);
  });

  it('numerosolmu: vain koodin numeron omat arvot', () => {
    const r = run369({ kind: 'digit', code: '629', index: 1 }, env, RAN_AT);
    expect(r.results.filter((m) => m.applicable).map((m) => m.id)).toEqual(['mod-9', 'digital-root']);
    expect(result(r, 'digital-root').primary!.checks[0].value).toBe('dr(2) = 2');
    expect(result(r, 'mod-9').notes.join(' ')).toMatch(/koodin numerosta/);
  });

  it('juurisolmu ajetaan lähtöankkurille', () => {
    const root = run369({ kind: 'root' }, env, RAN_AT);
    const hit = run369({ kind: 'hit', code: '432', n: T }, env, RAN_AT);
    for (const id of OP369_IDS) {
      expect(result(root, id).primary!.checks).toEqual(result(hit, id).primary!.checks);
      expect(result(root, id).opposite!.checks).toEqual(result(hit, id).opposite!.checks);
    }
    expect(result(root, 'offset-369').notes[0]).toMatch(/Juurisolmu: 369 ajetaan lähtöankkurille IDA 432/);
  });
});

describe.skipIf(!HAS_FULL)('369 oikealla aineistolla: IDA 432 @858 511', () => {
  const D = FULL!;
  const env = envFor(D);
  const target: NodeRef = { kind: 'hit', code: '432', n: 858511 };

  it('on nopea (< 300 ms) ja deterministinen', () => {
    const t0 = performance.now();
    const a = run369(target, env, RAN_AT);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(300);
    const b = run369(target, env, RAN_AT);
    expect(a).toEqual(b);
  });

  it('kaikki menetelmät ja molemmat suunnat, kaikki tarkistukset listattu', () => {
    const r = run369(target, env, RAN_AT);
    expect(r.results.map((m) => m.id)).toEqual([...OP369_IDS]);
    expect(r.referenceCodes.map((x) => x.code)).toEqual(['432', '62884', '42662', '72552', '629', '6464']);
    for (const m of r.results) {
      expect(m.applicable).toBe(true);
      expect(m.primary!.direction).toBe('234');
      expect(m.opposite!.direction).toBe('432');
    }
    const counts = Object.fromEntries(r.results.map((m) => [m.id, [m.primary!.checks.length, m.opposite!.checks.length]]));
    expect(counts).toEqual({
      'offset-369': [18, 18],
      'skip-369': [18, 18],
      'mod-9': [7, 6],
      'digital-root': [8, 6],
      'geo-369': [9, 9],
      'fib-3k': [42, 42],
    });
    for (const m of r.results) {
      for (const d of [m.primary!, m.opposite!]) {
        if (m.id === 'geo-369') expect(d.expected).toBeNull();
        else {
          expect(Number.isFinite(d.expected)).toBe(true);
          expect(d.expected!).toBeGreaterThan(0);
        }
        expect(d.checks.filter((c) => c.match).length).toBe(d.matches);
        expect(d.expectedNote.length).toBeGreaterThan(0);
      }
    }
    expectFindingsVerified(D, r);
    expectConsistent(r);
    expect(r.summary).toMatch(/^6 menetelmää, \d+ löytöä, odotus \d+(,\d+)?; geo-369: \d+ raportoitua kävelyaskelta/);
  });

  it('Δn-vertailut käyttävät tunnettuja lähimpiä osumia', () => {
    const r = run369(target, env, RAN_AT);
    const pos = (id: string, dir: 'primary' | 'opposite', label: string) =>
      result(r, id)[dir]!.checks.find((c) => c.label === label)!.position;
    expect(pos('mod-9', 'primary', 'Δn → MAX 629')).toBe(859001); // +490
    expect(pos('mod-9', 'opposite', 'Δn → MAX 629')).toBe(857589); // −922
    expect(pos('mod-9', 'opposite', 'Δn → MATTI 62884')).toBe(858260); // −251
    expect(pos('mod-9', 'primary', 'Δn → MATTI 62884')).toBe(937991);
    expect(pos('mod-9', 'primary', 'Δn → HANNA 42662')).toBe(858610); // +99
    expect(pos('mod-9', 'primary', 'Δn → MINI 6464')).toBe(858960);
    expect(pos('mod-9', 'primary', 'Δn → SALLA 72552')).toBeNull(); // SALLAn osumat ovat kaikki ennen ankkuria
    expect(pos('mod-9', 'opposite', 'Δn → SALLA 72552')).toBe(856712);
    // Δn = 99 ≡ 0 (mod 9) → löytö HANNA @858 610; dr(99) = 9
    expect(result(r, 'mod-9').primary!.findings.map((e) => e.to)).toContainEqual({ kind: 'hit', code: '42662', n: 858610 });
    expect(result(r, 'digital-root').primary!.findings.map((e) => e.to)).toContainEqual({ kind: 'hit', code: '42662', n: 858610 });
    expect(result(r, 'mod-9').opposite!.checks.find((c) => c.label === 'Δn → MATTI 62884')!.value).toBe('Δn = 251 · Δn mod 9 = 8');
    // omat arvot ovat laskelmia, eivät löytöjä
    const own = result(r, 'digital-root').primary!.checks.slice(0, 2);
    expect(own.map((c) => c.value)).toEqual(['dr(858511) = 1', 'dr(432) = 9 ∈ {3, 6, 9}']);
    expect(own.every((c) => !c.match)).toBe(true);
    // mod-9:n löydöt ovat digital-rootin löytöjen osajoukko (sama informaatio)
    const dr = new Set(allFindings(result(r, 'digital-root')).map((e) => JSON.stringify(e.to)));
    for (const e of allFindings(result(r, 'mod-9'))) expect(dr.has(JSON.stringify(e.to))).toBe(true);
  });

  it('geo-369: 9 askelta, raportoidaan 3, 6 ja 9 (ei löytöjä), ei vierailtuja kohtia uudelleen', () => {
    const r = run369(target, env, RAN_AT);
    const g = result(r, 'geo-369');
    expect(g.nothingNew).toBe(true);
    for (const d of [g.primary!, g.opposite!]) {
      expect(d.domain).toBe('oktaedri');
      expect(d.checks.map((c) => c.label)).toEqual(Array.from({ length: 9 }, (_, i) => `askel ${i + 1}`));
      expect(d.checks.filter((c) => c.match)).toEqual([]);
      expect(d.checks.filter((c) => /^raportoitu askel/.test(c.detail ?? '')).map((c) => c.label)).toEqual(['askel 3', 'askel 6', 'askel 9']);
      expect(d.matches).toBe(0);
      expect(d.findings).toEqual([]);
      expect(d.reported.map((e) => e.metrics!.askel)).toEqual([3, 6, 9]);
      for (const e of d.reported) expect(e).toMatchObject({ layer: 'geometrinen', domain: 'oktaedri', op: '369:geo-369', verified: true });
      const ns = d.checks.map((c) => c.position);
      expect(new Set(ns).size).toBe(9);
      expect(ns).not.toContain(858511);
      for (const c of d.checks) expect(c.value).toMatch(d.direction === '234' ? /vastapäivään$/ : /myötäpäivään$/);
    }
  });

  it('koodi 42662: offset/skip/fib kaikille 7 osumalle, mod-9 koodin arvosta', () => {
    const r = run369({ kind: 'code', code: '42662' }, env, RAN_AT);
    expect(r.results.every((m) => m.applicable)).toBe(true);
    for (const id of ['offset-369', 'skip-369', 'fib-3k']) {
      const m = result(r, id);
      expect(m.notes.join(' ')).toMatch(/Koodin 42662 osumia aineistossa: 7\./);
      expect(m.notes.join(' ')).toMatch(/234: \d+\/7 osumassa löytö, odotus/);
      expect(m.notes.join(' ')).toMatch(/432: \d+\/7 osumassa löytö, odotus/);
      for (const d of [m.primary!, m.opposite!]) {
        expect(d.checks.length).toBe((id === 'fib-3k' ? 7 : 3) * 6);
        for (const c of d.checks) expect(c.value).toMatch(/^\d+\/\d+ osumassa/);
        expect(d.expected!).toBeGreaterThan(0);
        expect(d.expectedNote).toMatch(/\/7 osumassa löytö/);
        for (const e of d.findings) expect([100986, 138380, 249991, 277284, 293979, 699002, 858610]).toContain(e.metrics!.lähtö);
      }
    }
    // kohteen oman koodin päällekkäinen sijoitus n + 3 ohitetaan kaikissa 7 osumassa
    expect(result(r, 'offset-369').primary!.checks.find((c) => c.label === 'n + 3 → HANNA 42662')!.value).toBe('0/0 osumassa (ohitettu 7)');
    expect(result(r, 'mod-9').primary!.checks.map((c) => c.value)).toEqual(['42662 mod 9 = 2', '4 + 2 + 6 + 6 + 2 = 20; 20 mod 9 = 2']);
    expect(result(r, 'mod-9').opposite!.checks[0].value).toBe('26624 mod 9 = 2');
    expect(result(r, 'mod-9').primary!.expected).toBeNull();
    expect(result(r, 'geo-369').notes.join(' ')).toMatch(/lähimmästä osumasta 42662 @858 610/);
    expectFindingsVerified(D, r);
    expectConsistent(r);
  });

  it('nimi ja henkilö käyttävät nimen T9-koodia ja ylittävät kerrosrajan', () => {
    const code = run369({ kind: 'code', code: '42662' }, env, RAN_AT);
    for (const ref of [{ kind: 'name', name: 'HANNA' }, { kind: 'person', personId: 'hanna-3' }] as NodeRef[]) {
      const r = run369(ref, env, RAN_AT);
      for (const id of OP369_IDS) {
        expect(result(r, id).primary!.checks).toEqual(result(code, id).primary!.checks);
        expect(result(r, id).notes[0]).toMatch(/T9-koodi on 42662/);
      }
      const geo = allReported(result(r, 'geo-369'));
      expect(geo.length).toBeGreaterThan(0);
      for (const e of geo) expect(e.crossesRealm).toBe(true);
      expectConsistent(r);
    }
    expect(result(run369({ kind: 'person', personId: 'hanna-3' }, env, RAN_AT), 'mod-9').notes[0]).toMatch(/^Henkilö HANNA III: /);
    for (const e of allReported(result(code, 'geo-369'))) expect(e.crossesRealm).toBe(false);
  });

  it('koodi 42662 ja HANNA III: kun vertailumenetelmät eivät löydä mitään, kokonaistulos on ”Ei uutta” (geo-369 ei estä)', () => {
    for (const ref of [{ kind: 'code', code: '42662' }, { kind: 'person', personId: 'hanna-3' }] as NodeRef[]) {
      const r = run369(ref, env, RAN_AT);
      const comparisons = r.results.filter((m) => m.id !== 'geo-369');
      expect(comparisons.map((m) => m.id)).toEqual(['offset-369', 'skip-369', 'mod-9', 'digital-root', 'fib-3k']);
      for (const m of comparisons) {
        expect(m.applicable).toBe(true);
        expect([m.primary!.matches, m.opposite!.matches]).toEqual([0, 0]);
        expect(m.nothingNew).toBe(true);
      }
      const geo = result(r, 'geo-369');
      expect(geo.applicable).toBe(true);
      expect(geo.nothingNew).toBe(true);
      expect([geo.primary!.reported.length, geo.opposite!.reported.length]).toEqual([3, 3]);
      expect(r.nothingNewOverall).toBe(true);
      expect(r.summary).toBe(
        'Ei uutta: mikään menetelmä ei löytänyt yhteyttä. Lisäksi geo-369: 6 raportoitua kävelyaskelta ' +
          '(tuotetaan aina, eivät ole löytöjä; odotusta ei määritellä).',
      );
      expect(r.summary).not.toMatch(/löytöä/);
      expectFindingsVerified(D, r);
      expectConsistent(r);
    }
  });

  it('koodi 432: yli tuhat osumaa, suoritus pysyy nopeana', () => {
    const t0 = performance.now();
    const r = run369({ kind: 'code', code: '432' }, env, RAN_AT);
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(result(r, 'offset-369').notes.join(' ')).toMatch(/Koodin 432 osumia aineistossa: 1 054\./);
    expectFindingsVerified(D, r);
    expectConsistent(r);
  });
});

// ---------------------------------------------------------------- hyppysäännöt

describe('nimetyt hyppysäännöt', () => {
  it('määritelmät: +2, +5, +9 ja −4, −7, −9', () => {
    expect([...JUMP_IDS]).toEqual(['hyppy-2-3-4', 'hyppy-4-3-2']);
    expect(JUMP_DEFINITIONS['hyppy-2-3-4'].offsets).toEqual([2, 5, 9]);
    expect(JUMP_DEFINITIONS['hyppy-4-3-2'].offsets).toEqual([-4, -7, -9]);
    // Määritelmät eivät puhu lukusuunnasta: suunta 234/432 ei ole hyppy.
    for (const def of Object.values(JUMP_DEFINITIONS)) expect(`${def.title} ${def.definition}`).not.toMatch(/suun|234|432/i);
    expect(JUMP_NOTE).toBe('Hyppysääntö on erillinen nimetty operaatio. Suunta 234/432 ei tarkoita hyppyjä.');
  });

  const P = 500;
  const a = background(2000, 3);
  plant(a, 1500, '432'); // ankkuri
  a[P + 2 - 1] = '4';
  a[P + 5 - 1] = '3';
  a[P + 9 - 1] = '2';
  a[P - 4 - 1] = '6';
  a[P - 7 - 1] = '2';
  a[P - 9 - 1] = '9';
  const d = a.join('');
  const env = envFor(d, '234', { code: '432', n: 1500, label: 'IDA' });

  it('hyppy-2-3-4 löytää istutetun 432:n kohdista n + 2, n + 5, n + 9', () => {
    const r = runJump('hyppy-2-3-4', { kind: 'position', n: P }, env);
    expect(r.version).toBe(JUMP_VERSION);
    expect(r.base).toBe(P);
    expect(r.positions).toEqual([
      { n: P + 2, digit: '4' },
      { n: P + 5, digit: '3' },
      { n: P + 9, digit: '2' },
    ]);
    expect(r.jumpString).toBe('432');
    expect(r.matches).toEqual([{ name: 'IDA', code: '432' }]);
    expect(r.nothingNew).toBe(false);
    expect(r.expected).toBeCloseTo(2e-3, 15); // 432 ja 629
    expect(r.findings).toHaveLength(3);
    for (const e of r.findings) {
      expect(e.layer).toBe('matemaattinen');
      expect(e.op).toBe('hyppy-2-3-4');
      expect(e.direction).toBeNull();
      expect(e.verified).toBe(true);
      expect(e.to.kind).toBe('position');
      expect(digitsAt(d, (e.to as { n: number }).n, 1)).toBe(e.metrics!.numero);
    }
    expect(r.notes[0]).toBe(JUMP_NOTE);
  });

  it('hyppy-4-3-2 löytää istutetun 629:n kohdista n − 4, n − 7, n − 9', () => {
    const r = runJump('hyppy-4-3-2', { kind: 'position', n: P }, env);
    expect(r.jumpString).toBe('629');
    expect(r.matches).toEqual([{ name: 'MAX', code: '629' }]);
    expect(r.findings.map((e) => e.metrics!.siirtymä)).toEqual([-4, -7, -9]);
  });

  it('lukusuunta ei vaikuta hyppysääntöön', () => {
    for (const op of JUMP_IDS) {
      const x = runJump(op, { kind: 'position', n: P }, { ...env, direction: '234' });
      const y = runJump(op, { kind: 'position', n: P }, { ...env, direction: '432' });
      expect(y).toEqual(x);
      expect(x.findings.every((e) => e.direction == null && e.domain == null)).toBe(true);
    }
  });

  it('rajat: aineiston alku ja loppu', () => {
    const start = runJump('hyppy-4-3-2', { kind: 'position', n: 3 }, env);
    expect(start.base).toBe(3);
    expect(start.positions).toEqual([]);
    expect(start.jumpString).toBe('');
    expect(start.matches).toEqual([]);
    expect(start.expected).toBe(0);
    expect(start.nothingNew).toBe(true);
    expect(start.notes.filter((n) => /aineiston ulkopuolella/.test(n))).toHaveLength(3);
    const almost = runJump('hyppy-4-3-2', { kind: 'position', n: 8 }, env); // 8 − 4 = 4 ok, 1 ok, −1 ulkona
    expect(almost.positions.map((p) => p.n)).toEqual([4, 1]);
    expect(almost.findings.map((e) => e.metrics!.siirtymä)).toEqual([-4, -7]);
    expect(almost.expected).toBe(0);
    const N = d.length;
    const end = runJump('hyppy-2-3-4', { kind: 'position', n: N - 3 }, env);
    expect(end.positions.map((p) => p.n)).toEqual([N - 1]);
    expect(end.matches).toEqual([]);
    expect(end.notes.join(' ')).toMatch(/vajaaksi/);
    const exact = runJump('hyppy-2-3-4', { kind: 'position', n: N - 9 }, env);
    expect(exact.positions.map((p) => p.n)).toEqual([N - 7, N - 4, N]);
  });

  it('osumakohde: oman osuman tunnettu numero ehdollistaa odotuksen', () => {
    const r = runJump('hyppy-2-3-4', { kind: 'hit', code: '432', n: 1500 }, env);
    expect(r.positions[0]).toEqual({ n: 1502, digit: '2' });
    expect(r.expected).toBe(0); // kumpikaan 3-numeroinen koodi (432, 629) ei ala numerolla 2
    expect(r.notes.join(' ')).toMatch(/kuuluu perustan omaan osumaan/);
    const bad = runJump('hyppy-2-3-4', { kind: 'hit', code: '432', n: 1501 }, env);
    expect(bad.base).toBeNull();
    expect(bad.nothingNew).toBe(true);
  });

  it('koodi- ja nimikohde käyttävät ankkuria lähintä osumaa; tarinasolmulla ei perustaa', () => {
    const c = runJump('hyppy-2-3-4', { kind: 'code', code: '432' }, env);
    expect(c.base).toBe(1500);
    const nm = runJump('hyppy-2-3-4', { kind: 'name', name: 'Ida' }, env);
    expect(nm.base).toBe(1500);
    expect(nm.findings.every((e) => e.crossesRealm)).toBe(true);
    const root = runJump('hyppy-4-3-2', { kind: 'root' }, env);
    expect(root.base).toBe(1500);
    const path = runJump('hyppy-2-3-4', { kind: 'path', pathId: 'polku-b' }, env);
    expect(path.base).toBeNull();
    expect(path.findings).toEqual([]);
    expect(path.notes[0]).toBe(JUMP_NOTE);
  });

  it.skipIf(!HAS_FULL)('oikea aineisto: IDA @858 511 ja MAX ankkuria lähinnä', () => {
    const e = envFor(FULL!);
    const r = runJump('hyppy-2-3-4', { kind: 'hit', code: '432', n: 858511 }, e);
    expect(r.positions.map((p) => p.n)).toEqual([858513, 858516, 858520]);
    expect(r.jumpString).toBe(r.positions.map((p) => FULL![p.n - 1]).join(''));
    expect(r.jumpString[0]).toBe('2');
    const max = runJump('hyppy-4-3-2', { kind: 'code', code: '629' }, e);
    expect(max.base).toBe(859001);
    expect(max.jumpString).toBe([859001 - 4, 859001 - 7, 859001 - 9].map((n) => FULL![n - 1]).join(''));
  });
});
