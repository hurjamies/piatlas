// Nimetyt hyppysäännöt (PIATLAS-JUMP-1.0.0). Määrittely: docs/MATRIISI.md §6.
//
// Hyppysääntö on erillinen, käyttäjän erikseen käynnistämä operaatio. Lukusuunta (234/432) ei käynnistä sitä
// eikä vaikuta siihen: tulos riippuu vain säännöstä ja perustasta n. Numerot luetaan suoraan lähdeaineistosta.

import { digitsAt } from '../digits';
import { nearestIndex } from '../search';
import { codeHits, verifyHit } from './hits';
import { fmtExpectedFi, fmtInt } from './ops369';
import type { RefCode } from './refs';
import { referenceCodes, t9Code } from './refs';
import type { MatrixEdge, MatrixEnv, NodeRef } from './types';
import { JUMP_VERSION, normName, realmOf, toRoman } from './types';

export type JumpOpId = 'hyppy-2-3-4' | 'hyppy-4-3-2';

export const JUMP_IDS: readonly JumpOpId[] = ['hyppy-2-3-4', 'hyppy-4-3-2'];

export const JUMP_DEFINITIONS: Record<JumpOpId, { title: string; definition: string; offsets: number[] }> = {
  'hyppy-2-3-4': {
    title: 'Hyppy +2, +3, +4',
    definition:
      'Kohdat n + 2, n + 5 ja n + 9 (kumulatiiviset hypyt +2, +3, +4). Luetaan numerot ja verrataan ' +
      '3-numeroisiin viitekoodeihin.',
    offsets: [2, 5, 9],
  },
  'hyppy-4-3-2': {
    title: 'Hyppy −4, −3, −2',
    definition:
      'Kohdat n − 4, n − 7 ja n − 9 (kumulatiiviset hypyt −4, −3, −2). Luetaan numerot ja verrataan ' +
      '3-numeroisiin viitekoodeihin.',
    offsets: [-4, -7, -9],
  },
};

export const JUMP_NOTE = 'Hyppysääntö on erillinen nimetty operaatio. Suunta 234/432 ei tarkoita hyppyjä.';

export interface JumpResult {
  version: string;
  op: JumpOpId;
  target: NodeRef;
  base: number | null;
  positions: { n: number; digit: string }[];
  jumpString: string;
  matches: RefCode[];
  findings: MatrixEdge[];
  nothingNew: boolean;
  notes: string[];
  expected: number;
}

/** Perusta: n ja sen tunnetut numerot (osuma n … n + L − 1 tai pelkkä kohta, L = 1). */
interface Base {
  n: number;
  L: number;
  code: string | null;
}

function nearestHitBase(env: MatrixEnv, code: string, notes: string[]): Base | null {
  if (!/^\d+$/.test(code)) {
    notes.push(`Koodi "${code}" ei ole numerojono.`);
    return null;
  }
  const hits = codeHits(env.digits, code);
  const i = nearestIndex(hits, env.anchor.n);
  if (i < 0) {
    notes.push(`Koodilla ${code} ei ole osumia aineistossa.`);
    return null;
  }
  notes.push(
    `Perusta: koodin ${code} osuma lähinnä ankkuria (${env.anchor.label} @${fmtInt(env.anchor.n)}) on @${fmtInt(hits[i])} ` +
      `(${fmtInt(hits.length)} osumaa).`,
  );
  return { n: hits[i], L: code.length, code };
}

function nameBase(env: MatrixEnv, name: string, intro: string, notes: string[]): Base | null {
  const code = t9Code(name);
  if (!code) {
    notes.push(`Nimeä ${normName(name)} ei voi koodata T9:llä.`);
    return null;
  }
  notes.push(`${intro}nimen ${normName(name)} T9-koodi on ${code}. Koodi on nimen ominaisuus, ei henkilön.`);
  return nearestHitBase(env, code, notes);
}

function resolveBase(target: NodeRef, env: MatrixEnv, notes: string[]): Base | null {
  const N = env.digits.length;
  if (!N) {
    notes.push('Aineistoa ei ole ladattu.');
    return null;
  }
  switch (target.kind) {
    case 'hit':
      if (!verifyHit(env.digits, target.code, target.n)) {
        notes.push(`Osuma ${target.code} @${fmtInt(target.n)} ei täsmää lähdeaineistoon; perustaa ei käytetä.`);
        return null;
      }
      notes.push(`Perusta: osuma ${target.code} @${fmtInt(target.n)} (tarkistettu ✓).`);
      return { n: target.n, L: target.code.length, code: target.code };
    case 'position':
      if (!Number.isInteger(target.n) || target.n < 1 || target.n > N) {
        notes.push(`Kohta ${target.n} on aineiston ulkopuolella (1 … ${fmtInt(N)}).`);
        return null;
      }
      notes.push(`Perusta: kohta n = ${fmtInt(target.n)}.`);
      return { n: target.n, L: 1, code: null };
    case 'root': {
      const a = env.anchor;
      if (!verifyHit(env.digits, a.code, a.n)) {
        notes.push(`Lähtöankkuri ${a.label} ${a.code} @${fmtInt(a.n)} ei täsmää lähdeaineistoon.`);
        return null;
      }
      notes.push(`Perusta: lähtöankkuri ${a.label} ${a.code} @${fmtInt(a.n)} (tarkistettu ✓).`);
      return { n: a.n, L: a.code.length, code: a.code };
    }
    case 'code':
      return nearestHitBase(env, target.code, notes);
    case 'name':
      return nameBase(env, target.name, '', notes);
    case 'person': {
      const p = env.story.persons.find((x) => x.id === target.personId);
      if (!p) {
        notes.push(`Henkilöä "${target.personId}" ei löydy tarinamallista.`);
        return null;
      }
      const label = p.homonymOrdinal ? `${p.name} ${toRoman(p.homonymOrdinal)}` : p.name;
      return nameBase(env, p.name, `Henkilö ${label}: `, notes);
    }
    default:
      notes.push('Hyppysääntö vaatii π-sijainnin (osuma, kohta, koodi, nimi, henkilö tai juuri); tälle solmulle sitä ei ole.');
      return null;
  }
}

/**
 * Ajaa nimetyn hyppysäännön. Ei riipu env.direction-arvosta. Odotus = Σ 3-numeroisten viitekoodien
 * todennäköisyydet, kun jokainen tuntematon numero on 1/10 (= määrä · 10^−3). Jos hyppykohta osuu perustan
 * omaan osumaan, sen numero on tunnettu ja todennäköisyys ehdollistetaan siihen (täsmää → 1, ei → 0).
 */
export function runJump(op: JumpOpId, target: NodeRef, env: MatrixEnv): JumpResult {
  const def = JUMP_DEFINITIONS[op];
  const notes: string[] = [JUMP_NOTE];
  const three = referenceCodes(env.story).filter((r) => r.code.length === 3);
  const base = resolveBase(target, env, notes);
  const empty: JumpResult = {
    version: JUMP_VERSION,
    op,
    target,
    base: null,
    positions: [],
    jumpString: '',
    matches: [],
    findings: [],
    nothingNew: true,
    notes,
    expected: 0,
  };
  if (!base) {
    notes.push('Hyppysääntöä ei voitu ajaa.');
    return empty;
  }
  const N = env.digits.length;
  const taken: { n: number; digit: string; off: number; known: boolean }[] = [];
  for (const off of def.offsets) {
    const m = base.n + off;
    if (m < 1 || m > N) {
      notes.push(`Kohta ${m} (n ${off > 0 ? '+' : '−'} ${Math.abs(off)}) on aineiston ulkopuolella (1 … ${fmtInt(N)}).`);
      continue;
    }
    const known = m >= base.n && m <= base.n + base.L - 1;
    taken.push({ n: m, digit: digitsAt(env.digits, m, 1), off, known });
    if (known) {
      notes.push(
        `Kohta ${fmtInt(m)} kuuluu perustan omaan osumaan ${base.code} @${fmtInt(base.n)}: sen numero on tunnettu, ` +
          'joten odotus on ehdollistettu siihen.',
      );
    }
  }
  const positions = taken.map(({ n, digit }) => ({ n, digit }));
  const complete = taken.length === def.offsets.length;
  const jumpString = positions.map((p) => p.digit).join('');
  const matches = complete ? three.filter((r) => r.code === jumpString) : [];
  let expected = 0;
  if (complete) {
    for (const r of three) {
      let p = 1;
      for (let j = 0; j < 3; j++) p *= taken[j].known ? (r.code[j] === taken[j].digit ? 1 : 0) : 0.1;
      expected += p;
    }
  } else {
    notes.push('Hyppyjono jäi vajaaksi, joten vertailua ei tehty.');
  }

  const crosses = realmOf(target) !== 'pi';
  const findings: MatrixEdge[] = taken.map(({ n, digit, off }) => {
    const step = `${off > 0 ? '+' : '−'} ${Math.abs(off)}`;
    return {
      to: { kind: 'position', n },
      layer: 'matemaattinen',
      group: `Hyppysääntö · ${def.title}`,
      relation: `n ${step}: numero ${digit} (@${fmtInt(n)})`,
      trace: `${op} · perusta n = ${base.n} · kohta ${base.n} ${step} = ${n} · numero ${digit}`,
      direction: null,
      domain: null,
      op,
      verified: digitsAt(env.digits, n, 1) === digit,
      metrics: { n, siirtymä: off, numero: digit },
      crossesRealm: crosses,
    };
  });

  notes.push(
    `Hyppyjono ${jumpString || '–'}; 3-numeroiset viitekoodit: ${three.map((r) => `${r.name} ${r.code}`).join(', ') || 'ei yhtään'}. ` +
      `Odotus ${fmtExpectedFi(expected)}.`,
  );
  if (matches.length) notes.push(`Hyppyjono on sama merkkijono kuin ${matches.map((r) => `${r.name} ${r.code}`).join(', ')}.`);

  return {
    version: JUMP_VERSION,
    op,
    target,
    base: base.n,
    positions,
    jumpString,
    matches,
    findings,
    nothingNew: matches.length === 0,
    notes,
    expected,
  };
}
