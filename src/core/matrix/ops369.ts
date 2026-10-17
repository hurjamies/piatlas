// 369-avausavain (PIATLAS-369-1.0.0). Määrittely: docs/MATRIISI.md §5.
//
// 369 ei ole suodatin eikä tulkinta. Se on käyttäjän erikseen käynnistämä laskennallinen tarkistus yhdelle
// solmulle. Jokainen menetelmä ajetaan valittuun suuntaan (env.direction) ja vastakkaiseen. Raportti listaa
// kaikki tarkistukset, myös ne, joissa mitään ei löytynyt, ja odotetun satunnaisosumien määrän, kun se on
// määritelty. Jokainen löytö on särmä (MatrixEdge) π-kerroksen solmuun, ja osumat tarkistetaan lähdeaineistosta.
//
// Käsitteet:
//  - tarkistus (OpCheck): yksi laskettu kohta. `match` = löytökriteeri täyttyi ja tarkistus on vertailu
//    johonkin muuhun kuin kohteeseen itseensä. Kohteen omat arvot (n, koodi, käyttäjän symbolinumerot)
//    näytetään laskelmina (match = false), koska ne eivät ole yhteyksiä.
//  - matches = tarkistukset, joissa match = true (= löytöjen määrä; findings voi olla katkaistu).
//  - expected = odotettu satunnaisosumien määrä samoille tarkistuksille. Kun tarkistettava kohta on
//    päällekkäin kohteen omien numeroiden kanssa, todennäköisyys ehdollistetaan tunnettuihin numeroihin
//    (tunnettu numero täsmää → kerroin 1, ei täsmää → 0, tuntematon → 1/10).
//  - reported = raportoidut askeleet: geo-369:n kävelyaskeleet 3, 6 ja 9 tuotetaan aina, kun ehdokkaita riittää.
//    Ne ovat avattavia särmiä, mutta eivät löytöjä: matches = 0, eivätkä ne vaikuta nothingNew- tai
//    nothingNewOverall-arvoon eivätkä yhteenvedon löytömäärään.

import { FIB } from '../fibonacci';
import { chordDistance, mapIndex, Vec3 } from '../mapping';
import { lowerBound, nearestIndex } from '../search';
import { codeHits, verifyHit } from './hits';
import type { RefCode } from './refs';
import { referenceCodes, t9Code } from './refs';
import type { Direction, DirectionDomain, Layer, MatrixEdge, MatrixEnv, NodeRef, StoryPath } from './types';
import { nodeKey, normName, opposite, OPS369_VERSION, realmOf, toRoman } from './types';

export type Op369Id = 'offset-369' | 'skip-369' | 'mod-9' | 'digital-root' | 'geo-369' | 'fib-3k';

export interface OpCheck {
  label: string;
  value: string;
  match: boolean;
  position?: number | null;
  detail?: string;
}

export interface OpDirectionResult {
  direction: Direction;
  domain: DirectionDomain | null;
  checks: OpCheck[];
  findings: MatrixEdge[];
  /** Aina tuotettavat raportoidut askeleet (geo-369). Eivät ole löytöjä: eivät sisälly matches-arvoon. Muilla tyhjä. */
  reported: MatrixEdge[];
  matches: number;
  expected: number | null;
  expectedNote: string;
}

export interface Op369Result {
  id: Op369Id;
  title: string;
  definition: string;
  applicable: boolean;
  reasonNotApplicable: string | null;
  primary: OpDirectionResult | null;
  opposite: OpDirectionResult | null;
  nothingNew: boolean;
  notes: string[];
}

export interface Op369Report {
  version: string;
  target: NodeRef;
  targetKey: string;
  ranAt: string;
  direction: Direction;
  referenceCodes: RefCode[];
  results: Op369Result[];
  nothingNewOverall: boolean;
  summary: string;
  disclaimer: string;
}

/** Menetelmät määrittelyn järjestyksessä. */
export const OP369_IDS: readonly Op369Id[] = ['offset-369', 'skip-369', 'mod-9', 'digital-root', 'geo-369', 'fib-3k'];

/** k ∈ {3, 6, 9}: siirtymät ja hyppyaskeleet. */
export const STEPS_369: readonly number[] = [3, 6, 9];

/** F_{3k}, k = 1…7: 2, 8, 34, 144, 610, 2584, 10946. */
export const FIB_3K: readonly { k: number; F: number }[] = [3, 6, 9, 12, 15, 18, 21].map((k) => ({ k, F: FIB[k] }));

/** Koodisolmulla offset-, hyppy- ja Fibonacci-tarkistukset ajetaan enintään näin monelle osumalle. */
export const AGGREGATE_HIT_CAP = 2000;

/** Löytösärmien enimmäismäärä yhdessä suunnassa (määrä `matches` lasketaan aina kokonaan). */
export const FINDINGS_CAP = 1000;

export const DISCLAIMER_369 =
  '369 on laskennallinen tarkistus. Se ei tuota tulkintaa, eikä löytö ole todiste tarkoituksellisuudesta.';

export const OPS369_DEFINITIONS: Record<Op369Id, { title: string; definition: string }> = {
  'offset-369': {
    title: 'Siirtymä 3 · 6 · 9',
    definition:
      'Alkaako jonkin viitekoodin täsmäosuma kohdasta n + k (234) tai n − k (432), k ∈ {3, 6, 9}? ' +
      'Odotus Σ_koodit 3 · 10^−L aineiston sisällä olevista kohdista. Jos kohta on päällekkäin kohteen omien ' +
      'numeroiden kanssa, todennäköisyys ehdollistetaan niihin. Kohteen oman koodin päällekkäisiä osumia ei lasketa.',
  },
  'skip-369': {
    title: 'Hyppyjono 3 · 6 · 9',
    definition:
      'Hyppyjono askeleella s ∈ {3, 6, 9}: numerot kohdista n, n ± s, n ± 2s, … (234: +, 432: −). ' +
      'Onko jonon alku jokin viitekoodi? Kohdan n numero on tunnettu, joten odotus on 10^−(L−1) koodia ja ' +
      'askelta kohden, jos koodin ensimmäinen numero on sama kuin kohdassa n, muuten 0.',
  },
  'mod-9': {
    title: 'Mod 9',
    definition:
      'n mod 9 ja Δn mod 9 lähimpään viitekoodin osumaan suunnassa (234: seuraava, 432: edellinen). ' +
      'Löytö = Δn ≡ 0 (mod 9), perusosuus 1/9 jokaista verrattua Δn:ää kohden.',
  },
  'digital-root': {
    title: 'Digitaalinen juuri',
    definition:
      'Digitaalinen juuri dr(x) = 1 + (x − 1) mod 9 (dr(0) = 0) luvuille n, koodi ja Δn. Löytö = dr(Δn) ∈ {3, 6, 9}, ' +
      'perusosuus 1/3. Sama informaatio kuin mod 9 (dr(x) = 9 ⇔ x ≡ 0 mod 9), joten menetelmät eivät ole riippumattomia.',
  },
  'geo-369': {
    title: 'Geometrinen kävely',
    definition:
      '3D-lähimmän naapurin kävely viitekoodien osumien joukossa oktaedrikartalla (mapIndex): jokainen askel ' +
      'lähimpään (chord) vierailemattomaan kohtaan, jonka atsimuutti atan2(y, x) on suuntaan 234 vastapäivään ja ' +
      '432 myötäpäivään (0 < Δφ < π). Tasatilanteessa pienempi n. Raportoidaan askeleet 3, 6 ja 9. ' +
      'Reitti on algoritminen valinta, ei piin ominaisuus. Askeleet tuotetaan aina, kun ehdokkaita riittää, joten ne ' +
      'ovat raportoituja tarkistuksia, eivät löytöjä: ne eivät vaikuta ”Ei uutta” -tulokseen.',
  },
  'fib-3k': {
    title: 'Fibonacci F₃ₖ',
    definition:
      'Kohdat n ± F_{3k}, k = 1…7 (F3 = 2, F6 = 8, F9 = 34, F12 = 144, F15 = 610, F18 = 2584, F21 = 10946): ' +
      'alkaako niistä viitekoodin osuma? Odotus Σ 7 · 10^−L (päällekkäisissä kohdissa ehdollistettu kohteen numeroihin). ' +
      'Suhde n ± F_k on spiraalinaapuruus (geometrinen, alue spiraali), sama kuin osumasolmun Fibonacci-naapureissa.',
  },
};

// ---------------------------------------------------------------- apufunktiot

/** dr(0) = 0, muuten dr(x) = 1 + (x − 1) mod 9. Numerojonolle käytetään numerosummaa. */
export function digitalRoot(x: number | string): number {
  if (typeof x === 'string') {
    const s = digitSum(x);
    return s === 0 ? 0 : 1 + ((s - 1) % 9);
  }
  if (!Number.isFinite(x)) return NaN;
  const v = Math.abs(Math.trunc(x));
  return v === 0 ? 0 : 1 + ((v - 1) % 9);
}

function digitSum(s: string): number {
  let sum = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i) - 48;
    if (c >= 0 && c <= 9) sum += c;
  }
  return sum;
}

const is369 = (r: number): boolean => r === 3 || r === 6 || r === 9;

const NNBSP = ' ';

/** 858511 → "858 511" (sama esitys kuin käyttöliittymässä). */
export function fmtInt(n: number): string {
  if (!Number.isFinite(n)) return '–';
  const s = Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP);
  return (n < 0 ? '−' : '') + s;
}

/** Odotusarvo suomalaisella desimaalipilkulla: 1,3 · 0,064 · 2,1e-4. */
export function fmtExpectedFi(x: number): string {
  if (!Number.isFinite(x)) return '–';
  if (x === 0) return '0';
  if (x >= 100) return fmtInt(x);
  if (x >= 1) return x.toFixed(1).replace('.', ',');
  if (x >= 0.001) return String(Number(x.toPrecision(2))).replace('.', ',');
  return x.toExponential(1).replace('.', ',');
}

const fmtDec = (x: number, d: number): string => x.toFixed(d).replace('.', ',');
const sgn = (s: number): string => (s > 0 ? '+' : '−');

function personLabel(name: string, ordinal: number | null): string {
  return ordinal ? `${name} ${toRoman(ordinal)}` : name;
}

/** Polun symbolinen numerojono suunnassa: 234 = määrittelyjärjestys, 432 = takaperin. */
function symbolString(p: StoryPath, d: Direction): string {
  const steps = d === '234' ? p.steps : [...p.steps].reverse();
  return steps.map((s) => s.symbol.trim()).join('');
}

// ---------------------------------------------------------------- konteksti

interface Ref extends RefCode {
  L: number;
  hits: Int32Array;
}

/** Tunnetut numerot: kohdat n … n + L − 1 (osuma tai yksittäinen kohta, jolloin L = 1 ja code = null). */
interface Span {
  n: number;
  L: number;
  code: string | null;
}

interface Ctx {
  digits: string;
  N: number;
  refs: Ref[];
  source: NodeRef;
  anchor: MatrixEnv['anchor'];
}

type Plan =
  | { kind: 'single'; span: Span; notes: string[] }
  | { kind: 'code'; code: string; total: number; considered: Int32Array; geoStart: Span | null; geoNote: string | null; notes: string[] }
  | {
      kind: 'values';
      domain: DirectionDomain;
      values: Record<Direction, { label: string; digits: string }[]>;
      fromUser: boolean;
      reasonOthers: string;
      notes: string[];
    }
  | { kind: 'none'; reason: string; notes: string[] };

const USER_NOTE = 'laskettu käyttäjän antamista symbolinumeroista';

function nonePlan(reason: string, notes: string[] = []): Plan {
  return { kind: 'none', reason, notes };
}

function nearestToAnchor(hits: Int32Array, anchorN: number): number | null {
  const i = nearestIndex(hits, anchorN); // tasatilanteessa pienempi n
  return i < 0 ? null : hits[i];
}

function codePlan(ctx: Ctx, code: string, notes: string[]): Plan {
  if (!/^\d+$/.test(code)) return nonePlan(`Koodi "${code}" ei ole numerojono.`, notes);
  const all = codeHits(ctx.digits, code);
  const considered = all.subarray(0, Math.min(all.length, AGGREGATE_HIT_CAP));
  notes.push(`Koodin ${code} osumia aineistossa: ${fmtInt(all.length)}.`);
  if (all.length > AGGREGATE_HIT_CAP) {
    notes.push(
      `Osumia on yli ${fmtInt(AGGREGATE_HIT_CAP)}: siirtymä-, hyppy- ja Fibonacci-tarkistukset ajettiin ` +
        `${fmtInt(AGGREGATE_HIT_CAP)} ensimmäiselle osumalle (n:n mukaan).`,
    );
  }
  const g = nearestToAnchor(all, ctx.anchor.n);
  const geoStart: Span | null = g == null ? null : { n: g, L: code.length, code };
  const geoNote = g == null ? null : `Kävely alkaa ankkuria (${ctx.anchor.label} @${fmtInt(ctx.anchor.n)}) lähimmästä osumasta ${code} @${fmtInt(g)}.`;
  return { kind: 'code', code, total: all.length, considered, geoStart, geoNote, notes };
}

function namePlan(ctx: Ctx, name: string, intro: string): Plan {
  const code = t9Code(name);
  if (!code) return nonePlan(`Nimeä ${name} ei voi koodata T9:llä.`);
  return codePlan(ctx, code, [
    `${intro}Nimen ${normName(name)} T9-koodi on ${code}; menetelmät ajetaan koodille ${code} kuten koodisolmulle. ` +
      'Koodi on nimen ominaisuus, ei henkilön.',
  ]);
}

function resolvePlan(target: NodeRef, env: MatrixEnv, ctx: Ctx): Plan {
  const { digits, N } = ctx;
  const noData = !digits;
  switch (target.kind) {
    case 'hit': {
      if (noData) return nonePlan('Aineistoa ei ole ladattu.');
      if (!/^\d+$/.test(target.code)) return nonePlan(`Koodi "${target.code}" ei ole numerojono.`);
      if (!verifyHit(digits, target.code, target.n)) {
        return nonePlan(
          `Osuma ${target.code} @${fmtInt(target.n)} ei täsmää lähdeaineistoon (kohdat n … n + L − 1 ≠ koodi). Sijaintia ei käytetä.`,
        );
      }
      return {
        kind: 'single',
        span: { n: target.n, L: target.code.length, code: target.code },
        notes: [`Osuma ${target.code} @${fmtInt(target.n)} tarkistettu lähdeaineistosta ✓.`],
      };
    }
    case 'root': {
      const a = env.anchor;
      if (noData) return nonePlan('Aineistoa ei ole ladattu.');
      if (!verifyHit(digits, a.code, a.n)) {
        return nonePlan(`Lähtöankkuri ${a.label} ${a.code} @${fmtInt(a.n)} ei täsmää lähdeaineistoon.`);
      }
      return {
        kind: 'single',
        span: { n: a.n, L: a.code.length, code: a.code },
        notes: [`Juurisolmu: 369 ajetaan lähtöankkurille ${a.label} ${a.code} @${fmtInt(a.n)} (tarkistettu ✓).`],
      };
    }
    case 'position': {
      if (noData) return nonePlan('Aineistoa ei ole ladattu.');
      if (!Number.isInteger(target.n) || target.n < 1 || target.n > N) {
        return nonePlan(`Kohta ${target.n} on aineiston ulkopuolella (1 … ${fmtInt(N)}).`);
      }
      return {
        kind: 'single',
        span: { n: target.n, L: 1, code: null },
        notes: [`Kohta n = ${fmtInt(target.n)} käsitellään yhden numeron mittaisena (L = 1): numero ${digits[target.n - 1]}.`],
      };
    }
    case 'code':
      return codePlan(ctx, target.code, []);
    case 'name':
      return namePlan(ctx, target.name, '');
    case 'homonyms':
      return namePlan(ctx, target.name, `Samannimiset (${normName(target.name)}): `);
    case 'person': {
      const p = env.story.persons.find((x) => x.id === target.personId);
      if (!p) return nonePlan(`Henkilöä "${target.personId}" ei löydy tarinamallista.`);
      return namePlan(ctx, p.name, `Henkilö ${personLabel(p.name, p.homonymOrdinal)}: `);
    }
    case 'path': {
      const p = env.story.paths.find((x) => x.id === target.pathId);
      if (!p) return nonePlan(`Polkua "${target.pathId}" ei löydy tarinamallista.`);
      const v234 = symbolString(p, '234');
      const v432 = symbolString(p, '432');
      if (!/^\d+$/.test(v234)) return nonePlan(`Polun ${p.title} symbolit eivät ole numeroita.`);
      return {
        kind: 'values',
        domain: 'tarina',
        values: {
          '234': [{ label: `${p.title}, 234 (polun järjestys)`, digits: v234 }],
          '432': [{ label: `${p.title}, 432 (takaperin)`, digits: v432 }],
        },
        fromUser: true,
        reasonOthers: 'Polulla ei ole π-sijaintia: vain mod-9 ja digital-root lasketaan käyttäjän antamista symbolinumeroista.',
        notes: [`Polku ${p.title}: ${USER_NOTE} (234: ${v234}, 432: ${v432}). Laskelma ei ole π-havainto.`],
      };
    }
    case 'gloss': {
      const g = env.story.glosses.find((x) => x.id === target.glossId);
      if (!g) return nonePlan(`Tulkintaa "${target.glossId}" ei löydy tarinamallista.`);
      const s = g.symbol.trim();
      if (!/^\d+$/.test(s)) return nonePlan(`Tulkinnan symboli "${g.symbol}" ei ole numerojono.`);
      const rev = [...s].reverse().join('');
      return {
        kind: 'values',
        domain: 'koodi',
        values: {
          '234': [{ label: `symboli ${s} (vasemmalta oikealle)`, digits: s }],
          '432': [{ label: `symboli ${rev} (oikealta vasemmalle)`, digits: rev }],
        },
        fromUser: true,
        reasonOthers: 'Tulkinnalla ei ole π-sijaintia: vain mod-9 ja digital-root lasketaan käyttäjän antamista symbolinumeroista.',
        notes: [`Tulkinta "${g.meanings.join(', ')}": ${USER_NOTE} (${s}). Laskelma ei ole π-havainto.`],
      };
    }
    case 'junction': {
      const paths = target.pathIds
        .map((id) => env.story.paths.find((x) => x.id === id))
        .filter((x): x is StoryPath => !!x);
      if (!paths.length) return nonePlan('Yhdistyksen polkuja ei löydy tarinamallista.');
      const values: Record<Direction, { label: string; digits: string }[]> = { '234': [], '432': [] };
      for (const p of paths) {
        for (const d of ['234', '432'] as const) {
          const v = symbolString(p, d);
          if (/^\d+$/.test(v)) values[d].push({ label: `${p.title}, ${d}`, digits: v });
        }
      }
      if (!values['234'].length) return nonePlan('Yhdistyksen polkujen symbolit eivät ole numeroita.');
      return {
        kind: 'values',
        domain: 'tarina',
        values,
        fromUser: true,
        reasonOthers: 'Polkujen yhdistyksellä ei ole π-sijaintia: vain mod-9 ja digital-root lasketaan käyttäjän antamista symbolinumeroista.',
        notes: [`Yhdistys (${paths.map((p) => p.title).join(' + ')}): ${USER_NOTE}. Laskelma ei ole π-havainto.`],
      };
    }
    case 'digit': {
      const d = target.code[target.index];
      if (d == null || !/^\d$/.test(d)) return nonePlan(`Koodissa ${target.code} ei ole numeroa paikassa ${target.index + 1}.`);
      const label = `numero ${d} (koodi ${target.code}, paikka ${target.index + 1})`;
      return {
        kind: 'values',
        domain: 'koodi',
        values: { '234': [{ label, digits: d }], '432': [{ label, digits: d }] },
        fromUser: false,
        reasonOthers: 'Koodin yksittäisellä numerolla ei ole π-sijaintia. Avaa koodi tai osuma, jotta sijaintiin perustuvat menetelmät voidaan ajaa.',
        notes: ['Laskettu koodin numerosta; numerolla ei ole π-sijaintia.'],
      };
    }
    case 'event':
      return nonePlan('Tapahtumalla ei ole π-sijaintia eikä symbolinumeroita, joten 369 ei sovellu.');
  }
}

// ---------------------------------------------------------------- sijoitukset (offset, skip, fib)

type PlacementStatus = 'ulkopuolella' | 'oma' | 'rakenteellinen' | 'vertailu';

interface Placement {
  status: PlacementStatus;
  /** Ehdollinen todennäköisyys satunnaisjonossa, kun kohteen numerot tunnetaan. */
  prob: number;
  read: string;
  match: boolean;
  last: number;
}

/**
 * Koodi sijoitettuna kohtiin start, start + stride, …, start + (L − 1)·stride.
 *  - ulkopuolella: jokin kohta ei ole välillä 1 … N
 *  - oma: kohteen oman koodin peräkkäinen osuma, joka on päällekkäin kohteen kanssa (ei lasketa)
 *  - rakenteellinen: kaikki kohdat ovat kohteen omia numeroita (ei satunnaisvertailu)
 *  - vertailu: lasketaan; prob = Π (tunnettu ? [täsmää] : 1/10)
 */
function evalPlacement(digits: string, span: Span, code: string, start: number, stride: number, contiguous: boolean): Placement {
  const L = code.length;
  const N = digits.length;
  const last = start + stride * (L - 1);
  if (Math.min(start, last) < 1 || Math.max(start, last) > N) {
    return { status: 'ulkopuolella', prob: 0, read: '', match: false, last };
  }
  const s0 = span.n;
  const s1 = span.n + span.L - 1;
  if (contiguous && span.code === code && start <= s1 && last >= s0) {
    return { status: 'oma', prob: 0, read: digits.substr(start - 1, L), match: false, last };
  }
  let known = true;
  let unknown = 0;
  let read = '';
  for (let j = 0; j < L; j++) {
    const p = start + stride * j;
    const ch = digits[p - 1];
    read += ch;
    if (p >= s0 && p <= s1) {
      if (ch !== code[j]) known = false;
    } else unknown++;
  }
  if (unknown === 0) return { status: 'rakenteellinen', prob: 0, read, match: false, last };
  return { status: 'vertailu', prob: known ? Math.pow(10, -unknown) : 0, read, match: read === code, last };
}

type FamilyId = 'offset-369' | 'skip-369' | 'fib-3k';

interface Family {
  id: FamilyId;
  domain: DirectionDomain;
  /** Löytösärmän tyyppi. n ± F_k on spiraalinaapuruus → geometrinen (sama kuin expand.ts:n Fibonacci-naapureissa). */
  layer: Layer;
  amounts: readonly { a: number; tag: string }[];
  contiguous: boolean;
}

const FAMILIES: Record<FamilyId, Family> = {
  'offset-369': {
    id: 'offset-369',
    domain: 'pi-indeksi',
    layer: 'matemaattinen',
    amounts: STEPS_369.map((a) => ({ a, tag: String(a) })),
    contiguous: true,
  },
  'skip-369': {
    id: 'skip-369',
    domain: 'pi-indeksi',
    layer: 'matemaattinen',
    amounts: STEPS_369.map((a) => ({ a, tag: String(a) })),
    contiguous: false,
  },
  'fib-3k': {
    id: 'fib-3k',
    domain: 'spiraali',
    layer: 'geometrinen',
    amounts: FIB_3K.map(({ k, F }) => ({ a: F, tag: `F${k} (${F})` })),
    contiguous: true,
  },
};

function placeFor(f: Family, n: number, sigma: number, a: number): { start: number; stride: number } {
  return f.contiguous ? { start: n + sigma * a, stride: 1 } : { start: n, stride: sigma * a };
}

function familyLabel(f: Family, sigma: number, tag: string, r: RefCode): string {
  if (f.id === 'skip-369') return `askel ${sgn(sigma)}${tag} → ${r.name} ${r.code}`;
  return `n ${sgn(sigma)} ${tag} → ${r.name} ${r.code}`;
}

const STATUS_DETAIL: Record<Exclude<PlacementStatus, 'vertailu'>, string> = {
  ulkopuolella: 'Kohta on aineiston ulkopuolella; ei lasketa odotukseen.',
  oma: 'Ohitettu: päällekkäinen kohteen oman osuman kanssa (sama koodi).',
  rakenteellinen: 'Rakenteellinen: kaikki numerot ovat kohteen omia numeroita, joten kyse ei ole satunnaisvertailusta.',
};

function makeEdge(
  ctx: Ctx,
  id: Op369Id,
  to: NodeRef,
  d: Direction,
  domain: DirectionDomain,
  relation: string,
  trace: string,
  metrics: Record<string, number | string>,
  verified: boolean,
  layer: Layer = 'matemaattinen',
): MatrixEdge {
  return {
    to,
    layer,
    group: `369 · ${OPS369_DEFINITIONS[id].title}`,
    relation,
    trace,
    direction: d,
    domain,
    op: `369:${id}`,
    verified,
    metrics,
    crossesRealm: realmOf(ctx.source) !== realmOf(to),
  };
}

interface PlacementAt {
  r: Ref;
  sigma: number;
  a: number;
  tag: string;
  start: number;
  stride: number;
}

function placementEdge(ctx: Ctx, f: Family, d: Direction, span: Span, at: PlacementAt, pl: Placement, viaHit: boolean): MatrixEdge {
  const { r, sigma, a, tag, start, stride } = at;
  const src = viaHit ? `${span.code} @${fmtInt(span.n)}: ` : '';
  if (f.contiguous) {
    const to: NodeRef = { kind: 'hit', code: r.code, n: start };
    return makeEdge(
      ctx,
      f.id,
      to,
      d,
      f.domain,
      `${src}n ${sgn(sigma)} ${tag} → ${r.name} ${r.code} @${fmtInt(start)}`,
      `369:${f.id} · ${d} · kohdat ${start}–${start + r.L - 1} = ${pl.read} · n = ${span.n} ${sgn(sigma)} ${a}` +
        (f.id === 'fib-3k' ? ' · spiraalinaapuruus n ± F_k (Vogelin spiraali; kartoitus on valinta, ei piin ominaisuus)' : ''),
      { n: start, 'Δn': sigma * a, L: r.L, ...(viaHit ? { lähtö: span.n } : {}) },
      verifyHit(ctx.digits, r.code, start),
      f.layer,
    );
  }
  const to: NodeRef = { kind: 'position', n: pl.last };
  let ok = true;
  for (let j = 0; j < r.L; j++) if (ctx.digits[start + stride * j - 1] !== r.code[j]) ok = false;
  return makeEdge(
    ctx,
    f.id,
    to,
    d,
    f.domain,
    `${src}hyppyjono askeleella ${sgn(sigma)}${a}: ${r.name} ${r.code} (kohdat ${fmtInt(start)} … ${fmtInt(pl.last)})`,
    `369:skip-369 · ${d} · kohdat ${Array.from({ length: r.L }, (_, j) => start + stride * j).join(', ')} = ${pl.read}`,
    { alku: start, askel: stride, loppu: pl.last, L: r.L },
    ok,
  );
}

function familySingle(ctx: Ctx, f: Family, span: Span, d: Direction): OpDirectionResult {
  const sigma = d === '234' ? 1 : -1;
  const checks: OpCheck[] = [];
  const findings: MatrixEdge[] = [];
  let expected = 0;
  let matches = 0;
  let counted = 0;
  for (const { a, tag } of f.amounts) {
    for (const r of ctx.refs) {
      const { start, stride } = placeFor(f, span.n, sigma, a);
      const pl = evalPlacement(ctx.digits, span, r.code, start, stride, f.contiguous);
      const label = familyLabel(f, sigma, tag, r);
      if (pl.status !== 'vertailu') {
        checks.push({
          label,
          value: pl.status === 'ulkopuolella' ? 'aineiston ulkopuolella' : pl.read,
          match: false,
          position: pl.status === 'ulkopuolella' ? null : start,
          detail: STATUS_DETAIL[pl.status],
        });
        continue;
      }
      counted++;
      expected += pl.prob;
      const plain = Math.pow(10, -r.L);
      checks.push({
        label,
        value: `${pl.read} ${pl.match ? '=' : '≠'} ${r.code}`,
        match: pl.match,
        position: start,
        detail:
          pl.prob === plain
            ? `todennäköisyys ${fmtExpectedFi(pl.prob)}`
            : `ehdollinen todennäköisyys ${fmtExpectedFi(pl.prob)} (osa kohdista on kohteen tunnettuja numeroita)`,
      });
      if (pl.match) {
        matches++;
        if (findings.length < FINDINGS_CAP) findings.push(placementEdge(ctx, f, d, span, { r, sigma, a, tag, start, stride }, pl, false));
      }
    }
  }
  return {
    direction: d,
    domain: f.domain,
    checks,
    findings,
    reported: [],
    matches,
    expected,
    expectedNote:
      `Odotus = todennäköisyyksien summa ${counted} lasketulle tarkistukselle ` +
      '(10^−L koodia kohden; kohteen tunnettujen numeroiden kanssa päällekkäiset kohdat ehdollistettu).',
  };
}

function familyAggregate(ctx: Ctx, f: Family, code: string, hits: Int32Array, d: Direction, notes: string[]): OpDirectionResult {
  const sigma = d === '234' ? 1 : -1;
  const L = code.length;
  const combos = f.amounts.flatMap(({ a, tag }) => ctx.refs.map((r) => ({ a, tag, r, counted: 0, matched: 0, expected: 0, skipped: 0 })));
  const findings: MatrixEdge[] = [];
  const hitHas = new Uint8Array(hits.length);
  let matches = 0;
  let expected = 0;
  for (let h = 0; h < hits.length; h++) {
    const span: Span = { n: hits[h], L, code };
    for (const c of combos) {
      const { start, stride } = placeFor(f, span.n, sigma, c.a);
      const pl = evalPlacement(ctx.digits, span, c.r.code, start, stride, f.contiguous);
      if (pl.status !== 'vertailu') {
        c.skipped++;
        continue;
      }
      c.counted++;
      c.expected += pl.prob;
      expected += pl.prob;
      if (pl.match) {
        c.matched++;
        matches++;
        hitHas[h] = 1;
        if (findings.length < FINDINGS_CAP) {
          findings.push(placementEdge(ctx, f, d, span, { r: c.r, sigma, a: c.a, tag: c.tag, start, stride }, pl, true));
        }
      }
    }
  }
  let x = 0;
  for (let h = 0; h < hits.length; h++) x += hitHas[h];
  notes.push(`${d}: ${x}/${hits.length} osumassa löytö, odotus ${fmtExpectedFi(expected)} (täsmäyksiä ${matches}).`);
  const checks: OpCheck[] = combos.map((c) => ({
    label: familyLabel(f, sigma, c.tag, c.r),
    value: `${c.matched}/${c.counted} osumassa` + (c.skipped ? ` (ohitettu ${c.skipped})` : ''),
    match: c.matched > 0,
    position: null,
    detail: `odotus ${fmtExpectedFi(c.expected)}`,
  }));
  return {
    direction: d,
    domain: f.domain,
    checks,
    findings,
    reported: [],
    matches,
    expected,
    expectedNote:
      `${x}/${hits.length} osumassa löytö (${matches} täsmäystä), odotus ${fmtExpectedFi(expected)} täsmäystä ` +
      '(Σ k · p yli osumien ja tarkistusten). Ohitetut: aineiston ulkopuolella, päällekkäin oman osuman kanssa tai rakenteelliset.' +
      (matches > findings.length ? ` Särmiä näytetään ${findings.length}.` : ''),
  };
}

// ---------------------------------------------------------------- mod 9 ja digitaalinen juuri

const OWN_DETAIL = 'Kohteen oma arvo: näytetään laskelmana, ei lasketa yhteydeksi eikä odotukseen. Ei riipu suunnasta.';
const SAME_INFO =
  'dr ja mod 9 sisältävät saman informaation (dr(x) = 9 ⇔ x ≡ 0 mod 9, dr(x) ∈ {3, 6, 9} ⇔ x ≡ 0 mod 3), joten mod-9 ja digital-root eivät ole riippumattomia.';

/** Lähin saman viitekoodin osuma suunnassa. Kohteen oma osuma ja sen kanssa päällekkäiset saman koodin osumat ohitetaan. */
function nearestInDirection(r: Ref, span: Span, d: Direction): number | null {
  const same = r.code === span.code;
  if (d === '234') {
    const t = same ? span.n + span.L : span.n + 1;
    const i = lowerBound(r.hits, t);
    return i < r.hits.length ? r.hits[i] : null;
  }
  const t = same ? span.n - span.L : span.n - 1;
  const i = lowerBound(r.hits, t + 1) - 1;
  return i >= 0 ? r.hits[i] : null;
}

function residueSingle(ctx: Ctx, id: 'mod-9' | 'digital-root', span: Span, d: Direction, isPrimary: boolean): OpDirectionResult {
  const checks: OpCheck[] = [];
  const findings: MatrixEdge[] = [];
  if (isPrimary) {
    if (id === 'mod-9') {
      const r = span.n % 9;
      checks.push({ label: 'n mod 9', value: `${fmtInt(span.n)} mod 9 = ${r}${r === 0 ? ' (≡ 0)' : ''}`, match: false, position: span.n, detail: OWN_DETAIL });
    } else {
      const rn = digitalRoot(span.n);
      checks.push({ label: 'dr(n)', value: `dr(${span.n}) = ${rn}${is369(rn) ? ' ∈ {3, 6, 9}' : ''}`, match: false, position: span.n, detail: OWN_DETAIL });
      if (span.code) {
        const rc = digitalRoot(span.code);
        checks.push({ label: 'dr(koodi)', value: `dr(${span.code}) = ${rc}${is369(rc) ? ' ∈ {3, 6, 9}' : ''}`, match: false, position: null, detail: OWN_DETAIL });
      }
    }
  }
  let counted = 0;
  let matches = 0;
  for (const r of ctx.refs) {
    const label = `Δn → ${r.name} ${r.code}`;
    const m = nearestInDirection(r, span, d);
    if (m == null) {
      checks.push({ label, value: 'ei osumaa tähän suuntaan', match: false, position: null, detail: 'Ei vertailua.' });
      continue;
    }
    counted++;
    const dn = Math.abs(m - span.n);
    let match: boolean;
    let value: string;
    if (id === 'mod-9') {
      const res = dn % 9;
      match = res === 0;
      value = `Δn = ${fmtInt(dn)} · Δn mod 9 = ${res}`;
    } else {
      const dr = digitalRoot(dn);
      match = is369(dr);
      value = `Δn = ${fmtInt(dn)} · dr(Δn) = ${dr}`;
    }
    checks.push({ label, value, match, position: m, detail: `lähin ${r.code}-osuma suuntaan ${d}: @${fmtInt(m)}` });
    if (match) {
      matches++;
      findings.push(
        makeEdge(
          ctx,
          id,
          { kind: 'hit', code: r.code, n: m },
          d,
          'pi-indeksi',
          `${id === 'mod-9' ? 'Δn ≡ 0 (mod 9)' : `dr(Δn) = ${digitalRoot(dn)}`}: ${r.name} ${r.code} @${fmtInt(m)} (Δn = ${fmtInt(dn)})`,
          `369:${id} · ${d} · lähin ${r.code}-osuma @${m}, Δn = |${m} − ${span.n}| = ${dn}` +
            (id === 'mod-9' ? `, ${dn} mod 9 = 0` : `, dr(${dn}) = ${digitalRoot(dn)}`),
          { n: m, 'Δn': dn, ...(id === 'mod-9' ? { 'Δn mod 9': 0 } : { 'dr(Δn)': digitalRoot(dn) }) },
          verifyHit(ctx.digits, r.code, m),
        ),
      );
    }
  }
  const rate = id === 'mod-9' ? 1 / 9 : 1 / 3;
  return {
    direction: d,
    domain: 'pi-indeksi',
    checks,
    findings,
    reported: [],
    matches,
    expected: counted * rate,
    expectedNote: `Perusosuus ${id === 'mod-9' ? '1/9' : '1/3'} jokaiselle verratulle Δn:lle (${counted} vertailua). ${SAME_INFO}`,
  };
}

function residueValues(
  id: 'mod-9' | 'digital-root',
  values: { label: string; digits: string }[],
  d: Direction,
  domain: DirectionDomain,
  fromUser: boolean,
  isPrimary: boolean,
  codeMode: boolean,
): OpDirectionResult {
  const detail = fromUser
    ? `Laskettu käyttäjän antamista symbolinumeroista. ${OWN_DETAIL}`
    : codeMode
      ? `Laskettu koodin omista numeroista. ${OWN_DETAIL}`
      : `Laskettu koodin numerosta. ${OWN_DETAIL}`;
  const checks: OpCheck[] = [];
  for (const v of values) {
    const s = digitSum(v.digits);
    if (id === 'mod-9') {
      const r = s % 9;
      checks.push({ label: `${v.label}: mod 9`, value: `${v.digits} mod 9 = ${r}${r === 0 ? ' (≡ 0)' : ''}`, match: false, position: null, detail });
      if (codeMode && isPrimary) {
        checks.push({ label: `${v.label}: numerosumma`, value: `${[...v.digits].join(' + ')} = ${s}; ${s} mod 9 = ${s % 9}`, match: false, position: null, detail });
      }
    } else {
      const r = digitalRoot(v.digits);
      checks.push({ label: `${v.label}: dr`, value: `dr(${v.digits}) = ${r}${is369(r) ? ' ∈ {3, 6, 9}' : ''}`, match: false, position: null, detail });
      if (codeMode && isPrimary) {
        checks.push({ label: `${v.label}: dr(numerosumma)`, value: `dr(${s}) = ${digitalRoot(s)}`, match: false, position: null, detail });
      }
    }
  }
  return {
    direction: d,
    domain,
    checks,
    findings: [],
    reported: [],
    matches: 0,
    expected: null,
    expectedNote: fromUser
      ? `Käyttäjän antamat luvut eivät ole satunnaisotos, joten odotusarvoa ei määritellä. ${SAME_INFO}`
      : `Ei vertailuja: lasketaan vain ${codeMode ? 'koodin' : 'numeron'} omat arvot, joten odotusarvoa ei määritellä. ${SAME_INFO}`,
  };
}

// ---------------------------------------------------------------- geo-369

interface GeoPoints {
  n: Int32Array;
  ref: Int32Array;
  p: Vec3[];
  phi: Float64Array;
}

let geoDigits = '';
let geoKey = '';
let geoCache: GeoPoints | null = null;

/** Kaikkien viitekoodien osumat oktaedrikartalla, järjestyksessä (n, viitekoodin järjestys). Välimuisti aineistolle. */
function geoPoints(digits: string, refs: Ref[]): GeoPoints {
  const key = refs.map((r) => r.code).join(',');
  if (geoCache && digits === geoDigits && key === geoKey) return geoCache;
  const pairs: [number, number][] = [];
  refs.forEach((r, ri) => {
    for (let i = 0; i < r.hits.length; i++) pairs.push([r.hits[i], ri]);
  });
  pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const n = Int32Array.from(pairs, (x) => x[0]);
  const ref = Int32Array.from(pairs, (x) => x[1]);
  const p = pairs.map((x) => mapIndex(x[0]));
  const phi = Float64Array.from(p, (v) => Math.atan2(v.y, v.x));
  geoCache = { n, ref, p, phi };
  geoDigits = digits;
  geoKey = key;
  return geoCache;
}

const TWO_PI = 2 * Math.PI;

interface GeoStep {
  step: number;
  n: number;
  ref: Ref;
  chord: number;
  dPhi: number;
}

function geoWalk(ctx: Ctx, start: Span, d: Direction): { steps: GeoStep[]; pointCount: number } {
  const pts = geoPoints(ctx.digits, ctx.refs);
  const visited: number[] = [start.n];
  let cur = mapIndex(start.n);
  let curPhi = Math.atan2(cur.y, cur.x);
  const steps: GeoStep[] = [];
  for (let s = 1; s <= 9; s++) {
    let best = -1;
    let bestD = Number.POSITIVE_INFINITY;
    let bestPhi = 0;
    for (let i = 0; i < pts.n.length; i++) {
      let dp = pts.phi[i] - curPhi;
      if (dp < 0) dp += TWO_PI;
      const ok = d === '234' ? dp > 0 && dp < Math.PI : dp > Math.PI && dp < TWO_PI;
      if (!ok || visited.includes(pts.n[i])) continue;
      const dist = chordDistance(cur, pts.p[i]);
      // Järjestys (n, viitekoodi) → ensimmäinen pienin etäisyys = pienempi n tasatilanteessa.
      if (dist < bestD) {
        bestD = dist;
        best = i;
        bestPhi = dp;
      }
    }
    if (best < 0) break;
    visited.push(pts.n[best]);
    cur = pts.p[best];
    curPhi = pts.phi[best];
    steps.push({ step: s, n: pts.n[best], ref: ctx.refs[pts.ref[best]], chord: bestD, dPhi: d === '234' ? bestPhi : TWO_PI - bestPhi });
  }
  return { steps, pointCount: pts.n.length };
}

/**
 * Kävelyn askeleet 3, 6 ja 9 ovat raportoituja askeleita (`reported`), eivät löytöjä: ne syntyvät aina, kun
 * ehdokkaita riittää. Siksi matches = 0, findings = [] ja tarkistusten match = false.
 */
function geoDirection(ctx: Ctx, start: Span, d: Direction): OpDirectionResult {
  const { steps, pointCount } = geoWalk(ctx, start, d);
  const checks: OpCheck[] = [];
  const reported: MatrixEdge[] = [];
  const rot = d === '234' ? 'vastapäivään' : 'myötäpäivään';
  for (let s = 1; s <= 9; s++) {
    const st = steps[s - 1];
    const isReported = s % 3 === 0;
    if (!st) {
      checks.push({
        label: `askel ${s}`,
        value: 'kävely pysähtyi: ei vierailematonta ehdokasta tällä puolella',
        match: false,
        position: null,
        detail: isReported ? 'raportoitava askel puuttuu' : undefined,
      });
      continue;
    }
    const deg = (st.dPhi * 180) / Math.PI;
    checks.push({
      label: `askel ${s}`,
      value: `${st.ref.name} ${st.ref.code} @${fmtInt(st.n)} · chord ${fmtDec(st.chord, 4)} · Δφ ${fmtDec(deg, 1)}° ${rot}`,
      match: false,
      position: st.n,
      detail: isReported ? 'raportoitu askel (3, 6, 9): tuotetaan aina, ei löytö' : undefined,
    });
    if (isReported) {
      reported.push(
        makeEdge(
          ctx,
          'geo-369',
          { kind: 'hit', code: st.ref.code, n: st.n },
          d,
          'oktaedri',
          `kävelyn askel ${s}: ${st.ref.name} ${st.ref.code} @${fmtInt(st.n)}`,
          `369:geo-369 · ${d} · lähtö @${start.n}, ${pointCount} pistettä, askel ${s} → @${st.n} (chord ${st.chord.toFixed(6)}, Δφ ${deg.toFixed(2)}° ${rot})`,
          { askel: s, n: st.n, chord: Number(st.chord.toFixed(6)), 'Δφ°': Number(deg.toFixed(2)) },
          verifyHit(ctx.digits, st.ref.code, st.n),
          'geometrinen',
        ),
      );
    }
  }
  return {
    direction: d,
    domain: 'oktaedri',
    checks,
    findings: [],
    reported,
    matches: 0,
    expected: null,
    expectedNote:
      'Odotusta ei määritellä: kävely on algoritminen valinta valitussa kartoituksessa (mapIndex). Askeleet 3, 6 ja 9 ' +
      'tuotetaan aina, kun ehdokkaita riittää, joten ne eivät ole satunnaisvertailu eivätkä löytöjä (eivät vaikuta ' +
      `”Ei uutta” -tulokseen). Pisteitä ${pointCount}; kävely ${steps.length}/9 askelta.`,
  };
}

// ---------------------------------------------------------------- menetelmä ja raportti

function runMethod(id: Op369Id, plan: Plan, ctx: Ctx, primaryDir: Direction): Op369Result {
  const def = OPS369_DEFINITIONS[id];
  const base = { id, title: def.title, definition: def.definition };
  const na = (reason: string, notes: string[]): Op369Result => ({
    ...base,
    applicable: false,
    reasonNotApplicable: reason,
    primary: null,
    opposite: null,
    nothingNew: true,
    notes,
  });
  const notes = [...plan.notes];
  let make: ((d: Direction, isPrimary: boolean) => OpDirectionResult) | null = null;

  if (plan.kind === 'none') return na(plan.reason, notes);
  if (plan.kind === 'values') {
    if (id !== 'mod-9' && id !== 'digital-root') return na(plan.reasonOthers, notes);
    make = (d, isPrimary) => residueValues(id, plan.values[d], d, plan.domain, plan.fromUser, isPrimary, false);
    notes.push(SAME_INFO);
  } else if (plan.kind === 'single') {
    const span = plan.span;
    if (id === 'mod-9' || id === 'digital-root') {
      make = (d, isPrimary) => residueSingle(ctx, id, span, d, isPrimary);
      notes.push(SAME_INFO);
    } else if (id === 'geo-369') {
      make = (d) => geoDirection(ctx, span, d);
    } else {
      const f = FAMILIES[id];
      make = (d) => familySingle(ctx, f, span, d);
    }
  } else {
    // koodisolmu
    const code = plan.code;
    if (id === 'mod-9' || id === 'digital-root') {
      const rev = [...code].reverse().join('');
      const values: Record<Direction, { label: string; digits: string }[]> = {
        '234': [{ label: `koodi ${code} (vasemmalta oikealle)`, digits: code }],
        '432': [{ label: `koodi ${rev} (oikealta vasemmalle)`, digits: rev }],
      };
      make = (d, isPrimary) => residueValues(id, values[d], d, 'koodi', false, isPrimary, true);
      notes.push('Koodisolmulle lasketaan koodin arvo ja numerosumma; sijaintiin perustuvat Δn-vertailut tehdään osumasolmusta.');
      notes.push(SAME_INFO);
    } else if (id === 'geo-369') {
      const g = plan.geoStart;
      if (!g) return na('Koodilla ei ole osumia aineistossa.', notes);
      if (plan.geoNote) notes.push(plan.geoNote);
      make = (d) => geoDirection(ctx, g, d);
    } else {
      if (!plan.considered.length) return na('Koodilla ei ole osumia aineistossa.', notes);
      const f = FAMILIES[id];
      make = (d) => familyAggregate(ctx, f, code, plan.considered, d, notes);
    }
  }

  const primary = make(primaryDir, true);
  const opp = make(opposite(primaryDir), false);
  return {
    ...base,
    applicable: true,
    reasonNotApplicable: null,
    primary,
    opposite: opp,
    nothingNew: primary.matches + opp.matches === 0,
    notes,
  };
}

/**
 * 369-avausavain yhdelle solmulle. Puhdas funktio: ei muuta ympäristöä, ei lue kelloa (ranAt annetaan).
 * Viitekoodit = tarinan lähtötunnisteiden ja henkilöiden nimien T9-koodit (referenceCodes).
 */
export function run369(target: NodeRef, env: MatrixEnv, ranAt: string): Op369Report {
  const refCodes = referenceCodes(env.story);
  const ctx: Ctx = {
    digits: env.digits,
    N: env.digits.length,
    refs: refCodes.map((r) => ({ ...r, L: r.code.length, hits: codeHits(env.digits, r.code) })),
    source: target,
    anchor: env.anchor,
  };
  const plan = resolvePlan(target, env, ctx);
  const results = OP369_IDS.map((id) => runMethod(id, plan, ctx, env.direction));

  const applicable = results.filter((r) => r.applicable);
  // Vain vertailumenetelmät ratkaisevat ”Ei uutta” -tuloksen: geo-369:n askeleet raportoidaan aina, eivätkä ne ole löytöjä.
  const nothingNewOverall = results.filter((r) => r.id !== 'geo-369').every((r) => r.nothingNew);
  let found = 0;
  let exp = 0;
  let geo = 0;
  for (const r of applicable) {
    for (const dr of [r.primary, r.opposite]) {
      if (!dr) continue;
      geo += dr.reported.length;
      found += dr.matches;
      if (r.id !== 'geo-369' && dr.expected != null) exp += dr.expected;
    }
  }
  const geoText = geo ? `geo-369: ${geo} raportoitua kävelyaskelta (tuotetaan aina, eivät ole löytöjä; odotusta ei määritellä)` : '';
  let summary: string;
  if (!applicable.length) {
    summary = `Ei sovellettavia menetelmiä: ${plan.kind === 'none' ? plan.reason : 'ei laskettavaa'}`;
  } else if (nothingNewOverall) {
    summary = 'Ei uutta: mikään menetelmä ei löytänyt yhteyttä.';
    if (plan.kind === 'values') summary += ` Mod 9 ja digitaalinen juuri ${plan.fromUser ? USER_NOTE : 'laskettu koodin numerosta'}.`;
    if (geoText) summary += ` Lisäksi ${geoText}.`;
  } else {
    summary = `${applicable.length} menetelmää, ${found} löytöä, odotus ${fmtExpectedFi(exp)}`;
    if (geoText) summary += `; ${geoText}`;
    summary += '.';
  }

  return {
    version: OPS369_VERSION,
    target,
    targetKey: nodeKey(target),
    ranAt,
    direction: env.direction,
    referenceCodes: refCodes,
    results,
    nothingNewOverall,
    summary,
    disclaimer: DISCLAIMER_369,
  };
}
