import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/random';
import { describe as describeNode, expand, GROUPS } from '../src/core/matrix/expand';
import { codeHits, verifyHit } from '../src/core/matrix/hits';
import { createSeedStory } from '../src/core/matrix/seed';
import { removeGloss, upsertPerson } from '../src/core/matrix/story';
import { crossings, firstTestRoute, isOnTrail, openEdge, rootTrail, trailKeys, truncateTo } from '../src/core/matrix/trail';
import type { Direction, Expansion, MatrixEdge, MatrixEnv, MatrixEvent, NodeRef, TrailStep } from '../src/core/matrix/types';
import { DIRECTION_SEMANTICS, directionLabel, MAX_DEPTH, nodeKey, realmOf } from '../src/core/matrix/types';
import { FIXTURE_DIGITS, full, HAS_FULL } from './helpers';

const EVENTS: MatrixEvent[] = [
  { id: 'e-b', title: 'Toinen tapahtuma', date: '2005-08-15', note: 'testi', linkedHits: [], personIds: ['hanna-3', 'max'] },
  { id: 'e-a', title: 'Ensimmäinen tapahtuma', date: '1990-05-01', note: '', linkedHits: ['ida@273', 'x@99999999'], personIds: ['hanna-3'] },
  { id: 'e-c', title: 'Päiväämätön', date: 'ei tiedossa', note: '', linkedHits: [], personIds: ['hanna-3', 'poistettu'] },
];

/** Fixture-ympäristö: piin 2000 ensimmäistä desimaalia, ankkuri IDA 432 @273 (ainoa 432 fixturessa). */
function fixtureEnv(direction: Direction = '234', events: MatrixEvent[] = []): MatrixEnv {
  return { digits: FIXTURE_DIGITS, story: createSeedStory(), anchor: { code: '432', n: 273, label: 'IDA' }, direction, events };
}

function fullEnv(direction: Direction = '234', events: MatrixEvent[] = []): MatrixEnv {
  return { digits: full(), story: createSeedStory(), anchor: { code: '432', n: 858511, label: 'IDA' }, direction, events };
}

const byGroup = (x: Expansion, group: string) => x.edges.filter((e) => e.group === group);
const keysOf = (edges: MatrixEdge[]) => edges.map((e) => nodeKey(e.to));
const find = (x: Expansion, pred: (e: MatrixEdge) => boolean) => {
  const e = x.edges.find(pred);
  if (!e) throw new Error('särmää ei löytynyt');
  return e;
};

const LAYERS = new Set(['matemaattinen', 'geometrinen', 'ajallinen', 'symbolinen']);

/** Yhden särmän invariantit (määrittely §1, §4, §8). Palauttaa rikkomukset (tyhjä = kunnossa). */
function edgeProblems(from: NodeRef, e: MatrixEdge, digits: string): string[] {
  const where = `${nodeKey(from)} → ${nodeKey(e.to)} [${e.group}]`;
  const p: string[] = [];
  if (!e.trace.trim()) p.push(`${where}: tyhjä jäljitys`);
  if (!e.relation.trim()) p.push(`${where}: tyhjä suhde`);
  if (!e.group.trim()) p.push(`${where}: tyhjä ryhmä`);
  if (e.crossesRealm !== (realmOf(from) !== realmOf(e.to))) p.push(`${where}: väärä crossesRealm`);
  if (!LAYERS.has(e.layer)) p.push(`${where}: tuntematon kerros ${e.layer}`);
  if (e.direction) {
    if (!e.domain) p.push(`${where}: suunta ilman aluetta`);
    else {
      if (!e.relation.includes(DIRECTION_SEMANTICS[e.domain][e.direction])) p.push(`${where}: suhde ei kerro suunnan merkitystä`);
      if (!e.trace.includes(directionLabel(e.direction, e.domain))) p.push(`${where}: jäljitys ei kerro suuntaa`);
    }
  } else if (e.domain != null) p.push(`${where}: alue ilman suuntaa`);
  if (e.to.kind === 'hit' && (e.verified !== true || !verifyHit(digits, e.to.code, e.to.n)))
    p.push(`${where}: tarkistamaton osumasärmä`);
  if (e.to.kind === 'position' && !(e.to.n >= 1 && e.to.n <= digits.length)) p.push(`${where}: kohta aineiston ulkopuolella`);
  // Symbolinen tulkinta ei koskaan esiinny matemaattisena: tarinasolmuun johtava särmä on symbolinen tai ajallinen.
  if (realmOf(e.to) === 'tarina' && e.layer !== 'symbolinen' && e.layer !== 'ajallinen') p.push(`${where}: tarinasolmu kerroksessa ${e.layer}`);
  if (/merkityksellinen/i.test(`${e.relation} ${e.trace}`)) p.push(`${where}: kielletty sana`);
  return p;
}

function checkEdge(from: NodeRef, e: MatrixEdge, digits: string): void {
  expect(edgeProblems(from, e, digits)).toEqual([]);
}

/** Leveyshaku juuresta: avaa kaikki solmut syvyyteen `depth` asti ja tarkistaa jokaisen särmän. */
function bfsCheck(env: MatrixEnv, depth: number): { expanded: number; edges: number; kinds: Set<string> } {
  const seen = new Set<string>(['root']);
  let frontier: NodeRef[] = [{ kind: 'root' }];
  let expanded = 0;
  let edges = 0;
  const kinds = new Set<string>();
  const problems: string[] = [];
  for (let d = 0; d <= depth; d++) {
    const next: NodeRef[] = [];
    for (const r of frontier) {
      const x = expand(r, env);
      expanded++;
      kinds.add(r.kind);
      if (x.node.key !== nodeKey(r) || x.node.realm !== realmOf(r)) problems.push(`${nodeKey(r)}: väärä avain tai kerros`);
      for (const e of x.edges) {
        edges++;
        if (problems.length < 50) problems.push(...edgeProblems(r, e, env.digits));
        const k = nodeKey(e.to);
        if (!seen.has(k)) {
          seen.add(k);
          next.push(e.to);
        }
      }
    }
    frontier = next;
  }
  expect(problems).toEqual([]);
  return { expanded, edges, kinds };
}

// ====================================================================== fixture-aineisto (ajetaan aina)

describe('juurisolmu', () => {
  it('fixture: otsikko ankkurista, ankkuri tarkistettu, lähtötunnisteet nimi- ja koodisolmuina', () => {
    const x = expand({ kind: 'root' }, fixtureEnv());
    expect(x.node.title).toBe('Lähtöankkuri IDA 432 @273');
    expect(x.node.realm).toBe('pi');
    expect(x.node.facts[0]).toMatchObject({ label: 'Ankkurin tarkistus', verified: true, layer: 'matemaattinen' });
    expect(keysOf(byGroup(x, GROUPS.anchor))).toEqual(['hit:432@273']);
    const names = byGroup(x, GROUPS.identifiers);
    expect(keysOf(names)).toEqual(['name:IDA', 'name:MATTI', 'name:HANNA', 'name:SALLA', 'name:MAX', 'name:MINI']);
    for (const e of names) expect(e).toMatchObject({ layer: 'symbolinen', crossesRealm: true });
    const codes = byGroup(x, GROUPS.identifierCodes);
    expect(keysOf(codes)).toEqual(['code:432', 'code:62884', 'code:42662', 'code:72552', 'code:629', 'code:6464']);
    for (const e of codes) expect(e).toMatchObject({ layer: 'matemaattinen', crossesRealm: false });
    expect(codes[4].trace).toContain('T9: M=6 A=2 X=9');
    expect(codes[2].trace).toContain('T9: H=4 A=2 N=6 N=6 A=2');
  });

  it('testireitti: särmä koodiin 629, suhde määrittelyn mukaan', () => {
    const x = expand({ kind: 'root' }, fixtureEnv());
    const t = byGroup(x, GROUPS.testRoute);
    expect(t.length).toBe(1);
    expect(t[0].to).toEqual({ kind: 'code', code: '629' });
    expect(t[0].relation).toBe('Ensimmäinen testireitti: MAX (629) → 2 → HANNA → HANNA III');
  });

  it('ankkuri, jota ei löydy aineistosta: huomautus eikä osumasärmää', () => {
    const env = { ...fixtureEnv(), anchor: { code: '432', n: 858511, label: 'IDA' } };
    const x = expand({ kind: 'root' }, env);
    expect(x.node.title).toBe('Lähtöankkuri IDA 432 @858 511');
    expect(x.node.facts[0].verified).toBe(false);
    expect(x.node.piPosition).toBeNull();
    expect(x.edges.some((e) => e.to.kind === 'hit')).toBe(false);
    expect(x.notes.join(' ')).toMatch(/ei löydy lähdeaineistosta/);
    // Ilmoitetut sijainnit (MATTI 858260, MINI 858960) eivät ole fixturessa: ei särmiä, huomautus.
    expect(x.notes.join(' ')).toMatch(/MATTI 62884 @858 260 ei täsmää/);
  });
});

describe('nimi-, koodi- ja numerosolmut (fixture)', () => {
  it('nimi HANNA: T9-koodi, samannimiset, kolme henkilöä, tulkinnat', () => {
    const x = expand({ kind: 'name', name: 'HANNA' }, fixtureEnv());
    expect(x.node.realm).toBe('tarina');
    expect(x.node.subtitle).toContain('sama nimi ei tarkoita samaa henkilöä');
    expect(x.node.facts.map((f) => f.value)).toContain('T9-koodi 42662 on nimen ominaisuus, ei henkilön.');
    const code = find(x, (e) => e.to.kind === 'code');
    expect(code).toMatchObject({ to: { code: '42662' }, layer: 'matemaattinen', crossesRealm: true });
    expect(code.trace).toContain('T9: H=4 A=2 N=6 N=6 A=2');
    expect(keysOf(byGroup(x, GROUPS.homonyms))).toEqual(['homonyms:HANNA']);
    const persons = byGroup(x, GROUPS.persons);
    expect(keysOf(persons)).toEqual(['person:hanna-1', 'person:hanna-2', 'person:hanna-3']);
    expect(persons.map((e) => e.relation)).toEqual(['henkilö HANNA I', 'henkilö HANNA II', 'henkilö HANNA III']);
    for (const e of persons) expect(e).toMatchObject({ layer: 'symbolinen', crossesRealm: false });
    expect(keysOf(byGroup(x, GROUPS.glosses))).toEqual(['gloss:g-629-2', 'gloss:g-b-2']);
  });

  it('nimi MINI: ei henkilöitä → huomautus, vain koodisärmä', () => {
    const x = expand({ kind: 'name', name: 'mini' }, fixtureEnv());
    expect(x.notes).toContain('Nimellä ei ole henkilöitä tarinassa.');
    expect(keysOf(x.edges)).toEqual(['code:6464']);
  });

  it('koodi 629: portit suunnassa, nimi MAX, tulkinnat, kaikki fixturen osumat', () => {
    const x234 = expand({ kind: 'code', code: '629' }, fixtureEnv('234'));
    expect(x234.node.title).toBe('MAX 629');
    expect(keysOf(byGroup(x234, GROUPS.gates))).toEqual(['digit:629#0', 'digit:629#1', 'digit:629#2']);
    expect(keysOf(byGroup(x234, GROUPS.names))).toEqual(['name:MAX']);
    expect(keysOf(byGroup(x234, GROUPS.glosses))).toEqual(['gloss:g-629-6', 'gloss:g-629-2', 'gloss:g-629-9']);
    expect(keysOf(byGroup(x234, GROUPS.allHits(2)))).toEqual(['hit:629@570', 'hit:629@736']);
    const x432 = expand({ kind: 'code', code: '629' }, fixtureEnv('432'));
    expect(keysOf(byGroup(x432, GROUPS.gates))).toEqual(['digit:629#2', 'digit:629#1', 'digit:629#0']);
    expect(keysOf(byGroup(x432, GROUPS.allHits(2)))).toEqual(['hit:629@736', 'hit:629@570']);
    for (const e of byGroup(x432, GROUPS.gates)) expect(e).toMatchObject({ direction: '432', domain: 'koodi' });
    // Lähin osuma ankkuriin (273): 570, Δn +297.
    expect(byGroup(x234, GROUPS.nearestAnchor)[0]).toMatchObject({ to: { n: 570 }, metrics: { Δn: 297 } });
    const facts = Object.fromEntries(x234.node.facts.map((f) => [f.label, f.value]));
    expect(facts['Pituus']).toBe('3 numeroa');
    expect(facts['Osumia aineistossa']).toMatch(/^2 /);
    expect(facts['T9-monitulkintaisuus']).toMatch(/^36 /);
  });

  it('koodi ilman osumia ja virheellinen koodi', () => {
    const x = expand({ kind: 'code', code: '42662' }, fixtureEnv());
    expect(x.edges.some((e) => e.to.kind === 'hit')).toBe(false);
    expect(x.notes.join(' ')).toMatch(/ei ole osumia/);
    const bad = expand({ kind: 'code', code: 'abc' }, fixtureEnv());
    expect(bad.node.missing).toBe(true);
    expect(bad.edges).toEqual([]);
  });

  it('numero 629#1: tulkinnat kontekstijärjestyksessä, koodi ja muut portit', () => {
    const x = expand({ kind: 'digit', code: '629', index: 1 }, fixtureEnv('234'));
    expect(x.node.facts.map((f) => f.value)).toEqual(['2', '2/3', '629']);
    const gl = byGroup(x, GROUPS.glosses);
    expect(keysOf(gl)).toEqual(['gloss:g-629-2', 'gloss:g-2-tarina', 'gloss:g-b-2']);
    expect(gl[0].relation).toMatch(/^tulkinta tässä koodissa/);
    expect(gl[1].relation).toMatch(/^käyttäjän tarinan yleistulkinta/);
    for (const e of gl) expect(e).toMatchObject({ layer: 'symbolinen', crossesRealm: true });
    expect(find(x, (e) => e.group === GROUPS.code)).toMatchObject({ to: { kind: 'code', code: '629' }, layer: 'matemaattinen' });
    const gates = byGroup(x, GROUPS.gates);
    expect(keysOf(gates)).toEqual(['digit:629#0', 'digit:629#2']);
    expect(gates[1].relation).toMatch(/^seuraava portti 3\/3: 9/);
    const r432 = byGroup(expand({ kind: 'digit', code: '629', index: 1 }, fixtureEnv('432')), GROUPS.gates);
    expect(keysOf(r432)).toEqual(['digit:629#2', 'digit:629#0']);
    expect(r432[1].relation).toMatch(/^seuraava portti 1\/3: 6/);
    expect(expand({ kind: 'digit', code: '629', index: 3 }, fixtureEnv()).node.missing).toBe(true);
  });
});

describe('osuma- ja indeksisolmut (fixture)', () => {
  it('osuma 629@570: tarkistus, koordinaatit, koodi, saman koodin seuraava ja paluu indeksiin', () => {
    const x = expand({ kind: 'hit', code: '629', n: 570 }, fixtureEnv('234'));
    expect(x.node.missing).toBeFalsy();
    expect(x.node.piPosition).toEqual({ n: 570, code: '629' });
    expect(x.node.facts[0]).toMatchObject({ verified: true, value: 'digits[570…572] = "629" ✓' });
    expect(x.node.facts.find((f) => f.label === 'Δn ankkuriin')!.value).toMatch(/^\+297/);
    expect(x.node.facts.filter((f) => f.layer === 'geometrinen').length).toBeGreaterThanOrEqual(3);
    expect(keysOf(byGroup(x, GROUPS.code))).toEqual(['code:629']);
    expect(keysOf(byGroup(x, GROUPS.sameCode))).toEqual(['hit:629@736']);
    expect(keysOf(byGroup(x, GROUPS.position))).toEqual(['pos:570']);
    expect(keysOf(byGroup(x, GROUPS.names))).toEqual(['name:MAX']);
    // Fixturessa ainoa muu viitekoodin osuma on IDA @273 (< 570): suuntaan 234 ei löydy.
    expect(byGroup(x, GROUPS.refNearest)).toEqual([]);
    const back = expand({ kind: 'hit', code: '629', n: 570 }, fixtureEnv('432'));
    expect(byGroup(back, GROUPS.refNearest).map((e) => [nodeKey(e.to), e.metrics!.Δn])).toEqual([['hit:432@273', -297]]);
    for (const e of x.edges) checkEdge(x.node.ref, e, FIXTURE_DIGITS);
  });

  it('Fibonacci-naapurit: k* − 3 … k* + 2, suunta ulos / sisään', () => {
    const x = expand({ kind: 'hit', code: '629', n: 570 }, fixtureEnv('234'));
    const fib = byGroup(x, GROUPS.fib);
    expect(fib.length).toBeGreaterThan(0);
    for (const e of fib) {
      expect(e).toMatchObject({ layer: 'geometrinen', direction: '234', domain: 'spiraali' });
      const n = e.to.kind === 'hit' || e.to.kind === 'position' ? e.to.n : -1;
      expect(n - 570).toBe(e.metrics!.F_k);
    }
    const ks = fib.map((e) => e.metrics!.k as number);
    expect(ks).toEqual([...ks].sort((a, b) => a - b));
    expect(ks[ks.length - 1] - ks[0]).toBeLessThanOrEqual(5);
    const inward = byGroup(expand({ kind: 'hit', code: '629', n: 570 }, fixtureEnv('432')), GROUPS.fib);
    for (const e of inward) expect((e.to as { n: number }).n - 570).toBe(-(e.metrics!.F_k as number));
  });

  it('tarkistamaton osuma: missing, ei yhtään osumasärmää', () => {
    const x = expand({ kind: 'hit', code: '629', n: 571 }, fixtureEnv());
    expect(x.node.missing).toBe(true);
    expect(x.node.facts[0].verified).toBe(false);
    expect(x.edges.some((e) => e.to.kind === 'hit')).toBe(false);
    expect(keysOf(x.edges)).toEqual(['code:629', 'pos:571']);
    expect(x.notes.join(' ')).toMatch(/ei löydy lähdeaineistosta/);
  });

  it('π-indeksi 274: osuma IDA @273 peittää kohdan, viereiset kohdat suunnassa', () => {
    const x = expand({ kind: 'position', n: 274 }, fixtureEnv('234'));
    expect(x.node.facts[0].value).toBe(`digits[274] = ${FIXTURE_DIGITS[273]}`);
    expect(x.node.facts[1].value).toContain(`[${FIXTURE_DIGITS[273]}]`);
    expect(keysOf(byGroup(x, GROUPS.atPosition))).toEqual(['hit:432@273']);
    expect(byGroup(x, GROUPS.atPosition)[0].relation).toMatch(/peittää kohdan \(merkki 2\/3\)/);
    const adj = byGroup(x, GROUPS.adjacent);
    expect(adj.map((e) => [nodeKey(e.to), e.direction])).toEqual([
      ['pos:275', '234'],
      ['pos:273', '432'],
    ]);
    const adj432 = byGroup(expand({ kind: 'position', n: 274 }, fixtureEnv('432')), GROUPS.adjacent);
    expect(keysOf(adj432)).toEqual(['pos:273', 'pos:275']);
    expect(byGroup(expand({ kind: 'position', n: 273 }, fixtureEnv()), GROUPS.atPosition)[0].relation).toMatch(/alkaa tästä kohdasta/);
    expect(keysOf(byGroup(expand({ kind: 'position', n: 1 }, fixtureEnv()), GROUPS.adjacent))).toEqual(['pos:2']);
    expect(expand({ kind: 'position', n: 2001 }, fixtureEnv()).node.missing).toBe(true);
    expect(expand({ kind: 'position', n: 0 }, fixtureEnv()).node.missing).toBe(true);
  });
});

describe('tarinasolmut', () => {
  it('HANNA III suuntaan 234: polut A ja B, jatkot A: → MAX ja B: → SALLA → IDA', () => {
    const x = expand({ kind: 'person', personId: 'hanna-3' }, fixtureEnv('234'));
    expect(x.node.title).toBe('HANNA III');
    expect(x.node.subtitle).toBe('henkilö · samannimisistä kolmas (kronologinen)');
    const facts = Object.fromEntries(x.node.facts.map((f) => [f.label, f.value]));
    expect(facts['Järjestysnumero']).toContain('samannimisten kronologinen järjestys (ei symbolinen numero)');
    expect(facts['Ajanjakso']).toBe('ajanjakso ei tiedossa');
    expect(facts['Roolit']).toBe('Maxin äiti');
    const paths = byGroup(x, GROUPS.paths);
    expect(keysOf(paths)).toEqual(['path:polku-a', 'path:polku-b']);
    expect(paths[0].relation).toBe('Polku A · sukupolvien jatkuvuus: MATTI (6) → HANNA (2) → MAX (9)');
    expect(paths[1].relation).toBe('Polku B · ihmissuhteiden kehityspolku: HANNA (2) → SALLA (3) → IDA (4)');
    const cont = byGroup(x, GROUPS.continuation('234'));
    expect(cont.map((e) => [nodeKey(e.to), e.relation.split(' · ')[0]])).toEqual([
      ['person:max', 'jatko polulla A: → MAX'],
      ['person:salla', 'jatko polulla B: → SALLA'],
      ['person:ida', 'jatko polulla B: → SALLA → IDA'],
    ]);
    for (const e of cont) expect(e).toMatchObject({ direction: '234', domain: 'tarina', layer: 'symbolinen' });
    expect(byGroup(x, GROUPS.junction)[0].to).toEqual({ kind: 'junction', personId: 'hanna-3', pathIds: ['polku-a', 'polku-b'] });
    expect(keysOf(byGroup(x, GROUPS.names))).toEqual(['name:HANNA']);
    expect(keysOf(byGroup(x, GROUPS.homonyms))).toEqual(['homonyms:HANNA']);
    expect(byGroup(x, GROUPS.relations).map((e) => [nodeKey(e.to), e.relation])).toEqual([['person:max', 'HANNA III on henkilön MAX äiti']]);
    const code = find(x, (e) => e.to.kind === 'code');
    expect(code).toMatchObject({ to: { code: '42662' }, layer: 'matemaattinen', crossesRealm: true });
    expect(code.relation).toBe('nimen T9-koodi (sama kaikille samannimisille)');
  });

  it('HANNA III suuntaan 432: A → MATTI, B ei jatkoa; polkusolmu B näyttää IDA → SALLA → HANNA', () => {
    const x = expand({ kind: 'person', personId: 'hanna-3' }, fixtureEnv('432'));
    const cont = byGroup(x, GROUPS.continuation('432'));
    expect(cont.map((e) => [nodeKey(e.to), e.relation.split(' · ')[0]])).toEqual([['person:matti', 'jatko polulla A: → MATTI']]);
    expect(x.notes.join(' ')).toMatch(/Polku B: ei jatkoa suuntaan 432/);
    const pathB = find(x, (e) => nodeKey(e.to) === 'path:polku-b');
    const p = expand(pathB.to, fixtureEnv('432'));
    const steps = byGroup(p, GROUPS.steps('432'));
    expect(keysOf(steps)).toEqual(['person:ida', 'person:salla', 'person:hanna-3']);
    expect(steps.map((e) => e.relation.split(' · 432')[0])).toEqual([
      '1. IDA (4) · integraatio, uusi tila',
      '2. SALLA (3) · kokemus, kriisi',
      '3. HANNA (2) · siirtymä',
    ]);
  });

  it('polku B: symbolinen jono 432 = IDAn T9-koodi vain merkkijonojen yhtäläisyytenä', () => {
    const p432 = expand({ kind: 'path', pathId: 'polku-b' }, fixtureEnv('432'));
    const text =
      'symbolinen numerojono 432 = IDAn T9-koodi (merkkijonojen yhtäläisyys käyttäjän antamien numeroiden ja koodin välillä, ei π-havainto)';
    expect(p432.node.facts.map((f) => f.value)).toContain(text);
    const m = byGroup(p432, GROUPS.symbolMatch);
    expect(m.length).toBe(1);
    expect(m[0]).toMatchObject({ to: { kind: 'code', code: '432' }, layer: 'symbolinen', relation: text, crossesRealm: true });
    expect(p432.node.facts.find((f) => f.label === 'Hypoteesin ajoitus')!.value).toMatch(/^Ajoitus ei tiedossa/);
    const p234 = expand({ kind: 'path', pathId: 'polku-b' }, fixtureEnv('234'));
    expect(byGroup(p234, GROUPS.symbolMatch)).toEqual([]);
    expect(keysOf(byGroup(p234, GROUPS.steps('234')))).toEqual(['person:hanna-3', 'person:salla', 'person:ida']);
    expect(byGroup(p234, GROUPS.steps('234'))[0].relation).toMatch(/^1\. HANNA \(2\) · siirtymä/);
    expect(keysOf(byGroup(p234, GROUPS.junction))).toEqual(['junction:hanna-3:polku-a+polku-b']);
    // Polku A 234: 629 = MAXin koodi (rakenteellinen, koska numerot on johdettu koodista).
    const a = byGroup(expand({ kind: 'path', pathId: 'polku-a' }, fixtureEnv('234')), GROUPS.symbolMatch);
    expect(a[0].relation).toMatch(/^symbolinen numerojono 629 = MAXin T9-koodi/);
    expect(a[0].trace).toMatch(/rakenteellinen/);
  });

  it('samannimiset HANNA: I → II → III suuntaan 234 ja III → II → I suuntaan 432', () => {
    const h234 = expand({ kind: 'homonyms', name: 'HANNA' }, fixtureEnv('234'));
    expect(keysOf(byGroup(h234, GROUPS.homonymPersons))).toEqual(['person:hanna-1', 'person:hanna-2', 'person:hanna-3']);
    expect(byGroup(h234, GROUPS.chronology).map((e) => e.relation.split(' · ')[0])).toEqual([
      'HANNA I → HANNA II (kronologinen järjestys)',
      'HANNA II → HANNA III (kronologinen järjestys)',
    ]);
    for (const e of [...byGroup(h234, GROUPS.homonymPersons), ...byGroup(h234, GROUPS.chronology)])
      expect(e).toMatchObject({ layer: 'ajallinen', domain: 'aika', direction: '234' });
    expect(keysOf(byGroup(h234, GROUPS.code))).toEqual(['code:42662']);
    const h432 = expand({ kind: 'homonyms', name: 'HANNA' }, fixtureEnv('432'));
    expect(keysOf(byGroup(h432, GROUPS.homonymPersons))).toEqual(['person:hanna-3', 'person:hanna-2', 'person:hanna-1']);
    expect(byGroup(h432, GROUPS.chronology).map((e) => e.relation.split(' · ')[0])).toEqual([
      'HANNA III → HANNA II (kronologinen järjestys)',
      'HANNA II → HANNA I (kronologinen järjestys)',
    ]);
    expect(expand({ kind: 'homonyms', name: 'MINI' }, fixtureEnv()).node.missing).toBe(true);
  });

  it('yhdistys HANNA III: haarat, edeltävät ja seuraavat askeleet; alkuperäiset polut säilyvät', () => {
    const ref: NodeRef = { kind: 'junction', personId: 'hanna-3', pathIds: ['polku-b', 'polku-a'] };
    const x = expand(ref, fixtureEnv('234'));
    expect(keysOf(byGroup(x, GROUPS.branches))).toEqual(['path:polku-b', 'path:polku-a']);
    expect(keysOf(byGroup(x, GROUPS.leading('234')))).toEqual(['person:matti']);
    expect(byGroup(x, GROUPS.continuation('234')).map((e) => [nodeKey(e.to), e.relation.split(' · ')[0]])).toEqual([
      ['person:salla', 'jatko polulla B: → SALLA'],
      ['person:ida', 'jatko polulla B: → SALLA → IDA'],
      ['person:max', 'jatko polulla A: → MAX'],
    ]);
    const y = expand(ref, fixtureEnv('432'));
    expect(byGroup(y, GROUPS.leading('432')).map((e) => e.relation.split(' · ')[0])).toEqual([
      'edeltävä askel polulla B: IDA (4) → SALLA (3) → HANNA III',
      'edeltävä askel polulla B: SALLA (3) → HANNA III',
      'edeltävä askel polulla A: MAX (9) → HANNA III',
    ]);
    const bad = expand({ kind: 'junction', personId: 'hanna-3', pathIds: ['ei-ole'] }, fixtureEnv());
    expect(bad.node.missing).toBe(true);
    expect(bad.notes.join(' ')).toMatch(/"ei-ole"/);
  });

  it('tulkinta g-629-2: henkilö, nimi, konteksti ja saman symbolin muut tulkinnat', () => {
    const x = expand({ kind: 'gloss', glossId: 'g-629-2' }, fixtureEnv());
    expect(x.notes).toContain('Käyttäjän tulkinta — ei matemaattinen havainto.');
    expect(x.node.facts.find((f) => f.label === 'Konteksti')!.value).toBe('koodi 629');
    expect(keysOf(x.edges)).toEqual(['person:hanna-3', 'name:HANNA', 'code:629', 'gloss:g-2-tarina', 'gloss:g-b-2']);
    expect(find(x, (e) => e.to.kind === 'code')).toMatchObject({ layer: 'symbolinen', crossesRealm: true });
    const b = expand({ kind: 'gloss', glossId: 'g-b-3' }, fixtureEnv());
    expect(keysOf(b.edges)).toContain('path:polku-b');
  });

  it('tapahtumat: henkilön aikajana suunnassa, linkit indekseinä, edellinen/seuraava', () => {
    const p234 = expand({ kind: 'person', personId: 'hanna-3' }, fixtureEnv('234', EVENTS));
    expect(keysOf(byGroup(p234, GROUPS.events))).toEqual(['event:e-a', 'event:e-b', 'event:e-c']);
    for (const e of byGroup(p234, GROUPS.events)) expect(e).toMatchObject({ layer: 'ajallinen', domain: 'aika' });
    const p432 = expand({ kind: 'person', personId: 'hanna-3' }, fixtureEnv('432', EVENTS));
    expect(keysOf(byGroup(p432, GROUPS.events))).toEqual(['event:e-b', 'event:e-a', 'event:e-c']);
    const ea = expand({ kind: 'event', eventId: 'e-a' }, fixtureEnv('234', EVENTS));
    expect(keysOf(byGroup(ea, GROUPS.persons))).toEqual(['person:hanna-3']);
    const linked = byGroup(ea, GROUPS.linkedHits);
    expect(keysOf(linked)).toEqual(['pos:273']);
    expect(linked[0]).toMatchObject({ layer: 'matemaattinen', crossesRealm: true });
    expect(linked[0].trace).toContain('käyttäjän linkki');
    expect(ea.notes.join(' ')).toMatch(/"x@99999999"/);
    expect(byGroup(ea, GROUPS.eventOrder).map((e) => [nodeKey(e.to), e.direction])).toEqual([['event:e-b', '234']]);
    const eb = expand({ kind: 'event', eventId: 'e-b' }, fixtureEnv('432', EVENTS));
    expect(byGroup(eb, GROUPS.eventOrder).map((e) => [nodeKey(e.to), e.direction])).toEqual([['event:e-a', '432']]);
    const ec = expand({ kind: 'event', eventId: 'e-c' }, fixtureEnv('234', EVENTS));
    expect(ec.notes.join(' ')).toMatch(/"poistettu" puuttuu/);
    expect(byGroup(ec, GROUPS.eventOrder)).toEqual([]);
  });

  it('puuttuvat tiedot: missing = true, huomautus, ei kaatumista', () => {
    const env = fixtureEnv('234', EVENTS);
    const refs: NodeRef[] = [
      { kind: 'person', personId: 'ei-ole' },
      { kind: 'gloss', glossId: 'ei-ole' },
      { kind: 'path', pathId: 'ei-ole' },
      { kind: 'event', eventId: 'ei-ole' },
      { kind: 'junction', personId: 'ei-ole', pathIds: ['polku-a'] },
      { kind: 'homonyms', name: 'EI-OLE' },
      { kind: 'digit', code: '629', index: -1 },
      { kind: 'hit', code: '629', n: 0 },
      { kind: 'position', n: 1.5 },
      { kind: 'name', name: '   ' },
    ];
    for (const r of refs) {
      const x = expand(r, env);
      expect(x.node.missing, nodeKey(r)).toBe(true);
      expect(x.notes.length, nodeKey(r)).toBeGreaterThan(0);
      for (const e of x.edges) checkEdge(r, e, env.digits);
    }
    // Poistettuun henkilöön viittaava askel avautuu nimisolmuna.
    const m = createSeedStory();
    const story = { ...m, persons: m.persons.filter((p) => p.id !== 'salla') };
    const x = expand({ kind: 'path', pathId: 'polku-b' }, { ...env, story });
    expect(keysOf(byGroup(x, GROUPS.steps('234')))).toEqual(['person:hanna-3', 'name:SALLA', 'person:ida']);
    expect(x.notes.join(' ')).toMatch(/"salla" puuttuu/);
  });

  it('describe palauttaa samat solmutiedot kuin expand; avaus on deterministinen', () => {
    const env = fixtureEnv('432', EVENTS);
    const refs: NodeRef[] = [
      { kind: 'root' },
      { kind: 'name', name: 'HANNA' },
      { kind: 'code', code: '629' },
      { kind: 'digit', code: '629', index: 2 },
      { kind: 'hit', code: '432', n: 273 },
      { kind: 'position', n: 100 },
      { kind: 'gloss', glossId: 'g-23' },
      { kind: 'person', personId: 'max' },
      { kind: 'homonyms', name: 'HANNA' },
      { kind: 'path', pathId: 'polku-a' },
      { kind: 'junction', personId: 'hanna-3', pathIds: ['polku-a', 'polku-b'] },
      { kind: 'event', eventId: 'e-a' },
    ];
    for (const r of refs) {
      const a = expand(r, env);
      expect(describeNode(r, env), nodeKey(r)).toEqual(a.node);
      expect(expand(r, env), nodeKey(r)).toEqual(a);
    }
  });

  it('henkilön nimen vaihto näkyy otsikoissa (numerointi uudelleen)', () => {
    const m = createSeedStory();
    const story = upsertPerson(m, { ...m.persons.find((p) => p.id === 'hanna-1')!, name: 'AINO' });
    const env = { ...fixtureEnv(), story };
    expect(describeNode({ kind: 'person', personId: 'hanna-3' }, env).title).toBe('HANNA II');
    expect(describeNode({ kind: 'person', personId: 'hanna-1' }, env).title).toBe('AINO');
  });
});

describe('kaikki särmät syvyyteen 3 (fixture)', () => {
  it.each(['234', '432'] as const)('suunta %s: jäljitys, kerrosrajat, suunnat ja tarkistetut osumat', (dir) => {
    const r = bfsCheck(fixtureEnv(dir, EVENTS), 3);
    expect(r.expanded).toBeGreaterThan(30);
    for (const k of ['root', 'name', 'code', 'digit', 'hit', 'position', 'gloss', 'person', 'homonyms', 'path', 'junction'])
      expect(r.kinds.has(k), k).toBe(true);
  });
});

// ====================================================================== reitti (murupolku)

describe('reitti ja silmukoiden esto', () => {
  const env = fixtureEnv();
  const edgeTo = (from: NodeRef, key: string): MatrixEdge => {
    const x = expand(from, env, { hitLimit: 50 });
    const e = x.edges.find((ed) => nodeKey(ed.to) === key);
    if (!e) throw new Error(`särmää ${nodeKey(from)} → ${key} ei löytynyt`);
    return e;
  };

  it('rootTrail ja openEdge lisää askeleen, jonka via kopioidaan särmästä', () => {
    const t0 = rootTrail();
    expect(t0).toEqual([{ ref: { kind: 'root' }, via: null }]);
    const e = edgeTo({ kind: 'root' }, 'name:HANNA');
    const r = openEdge(t0, e);
    expect(r.result).toBe('lisätty');
    expect(trailKeys(r.trail)).toEqual(['root', 'name:HANNA']);
    expect(r.trail[1].via).toEqual({ relation: e.relation, layer: e.layer, crossesRealm: true, trace: e.trace, group: e.group });
    expect(t0.length).toBe(1); // syötettä ei muuteta
  });

  it('jo reitillä olevan solmun avaus palaa siihen (ei kaksoiskappaleita)', () => {
    let t = rootTrail();
    t = openEdge(t, edgeTo({ kind: 'root' }, 'name:HANNA')).trail;
    t = openEdge(t, edgeTo({ kind: 'name', name: 'HANNA' }, 'person:hanna-3')).trail;
    t = openEdge(t, edgeTo({ kind: 'person', personId: 'hanna-3' }, 'person:max')).trail;
    expect(trailKeys(t)).toEqual(['root', 'name:HANNA', 'person:hanna-3', 'person:max']);
    const back = openEdge(t, edgeTo({ kind: 'person', personId: 'max' }, 'name:MAX'));
    expect(back.result).toBe('lisätty');
    // MAX → (suhde) HANNA III, joka on jo reitillä kohdassa 2.
    const loop = openEdge(t, edgeTo({ kind: 'person', personId: 'max' }, 'person:hanna-3'));
    expect(loop.result).toBe('palattu');
    expect(trailKeys(loop.trail)).toEqual(['root', 'name:HANNA', 'person:hanna-3']);
    expect(isOnTrail(t, { kind: 'person', personId: 'hanna-3' })).toBe(2);
    expect(isOnTrail(t, { kind: 'person', personId: 'salla' })).toBe(-1);
  });

  it('fromIndex haarauttaa aiemmasta askeleesta; myöhemmät askeleet eivät aiheuta paluuta', () => {
    let t = rootTrail();
    t = openEdge(t, edgeTo({ kind: 'root' }, 'name:HANNA')).trail;
    t = openEdge(t, edgeTo({ kind: 'name', name: 'HANNA' }, 'person:hanna-3')).trail;
    const r = openEdge(t, edgeTo({ kind: 'root' }, 'code:629'), 0);
    expect(r.result).toBe('lisätty');
    expect(trailKeys(r.trail)).toEqual(['root', 'code:629']);
    // Kohde ennen fromIndexiä → paluu.
    const again = openEdge(t, edgeTo({ kind: 'person', personId: 'hanna-3' }, 'name:HANNA'), 2);
    expect(again.result).toBe('palattu');
    expect(trailKeys(again.trail)).toEqual(['root', 'name:HANNA']);
    const self = openEdge(t, edgeTo({ kind: 'root' }, 'name:HANNA'), 0);
    expect(self.result).toBe('lisätty');
    expect(trailKeys(self.trail)).toEqual(['root', 'name:HANNA']);
    // Kohde reitillä vasta fromIndexin jälkeen → katkaistaan fromIndexiin ja lisätään (ei kaksoiskappaletta).
    const skip = openEdge(t, edgeTo({ kind: 'name', name: 'HANNA' }, 'person:hanna-3'), 0);
    expect(skip.result).toBe('lisätty');
    expect(trailKeys(skip.trail)).toEqual(['root', 'person:hanna-3']);
  });

  it('MAX_DEPTH: reitti ei kasva yli rajan', () => {
    const x = expand({ kind: 'position', n: 1 }, env);
    let t: TrailStep[] = [...rootTrail()];
    for (let n = 1; t.length < MAX_DEPTH; n++) t = [...t, { ref: { kind: 'position', n }, via: null }];
    expect(t.length).toBe(MAX_DEPTH);
    const e = { ...x.edges[0], to: { kind: 'position', n: 999 } as NodeRef };
    const r = openEdge(t, e);
    expect(r.result).toBe('syvyysraja');
    expect(r.trail).toBe(t);
    expect(openEdge(t, e, MAX_DEPTH - 2).result).toBe('lisätty');
    expect(openEdge(t, { ...e, to: { kind: 'position', n: 5 } }).result).toBe('palattu');
  });

  it('truncateTo, trailKeys, crossings', () => {
    const { trail } = firstTestRoute(env);
    expect(trailKeys(truncateTo(trail, 2))).toEqual(['root', 'code:629', 'digit:629#1']);
    expect(trailKeys(truncateTo(trail, -5))).toEqual(['root']);
    expect(truncateTo(trail, 99).length).toBe(trail.length);
    expect(truncateTo([], 3)).toEqual(rootTrail());
    expect(crossings(trail)).toEqual([3]);
    expect(crossings(rootTrail())).toEqual([]);
  });

  it('ensimmäinen testireitti todellisia särmiä pitkin', () => {
    for (const dir of ['234', '432'] as const) {
      const { trail, errors } = firstTestRoute(fixtureEnv(dir));
      expect(errors).toEqual([]);
      expect(trailKeys(trail)).toEqual(['root', 'code:629', 'digit:629#1', 'gloss:g-629-2', 'name:HANNA', 'person:hanna-3']);
      expect(crossings(trail)).toEqual([3]);
      expect(trail[3].via!.crossesRealm).toBe(true);
      expect(trail.slice(1).filter((s) => s.via!.crossesRealm).length).toBe(1);
      expect(trail[1].via!.group).toBe(GROUPS.testRoute);
      expect(trail[3].via!.relation).toMatch(/^tulkinta tässä koodissa: 2 = HANNA/);
      // Jokainen askel on todellinen särmä edellisestä solmusta.
      for (let i = 1; i < trail.length; i++) {
        const ex = expand(trail[i - 1].ref, fixtureEnv(dir), { hitLimit: 0 });
        const e = ex.edges.find((ed) => nodeKey(ed.to) === nodeKey(trail[i].ref) && ed.relation === trail[i].via!.relation);
        expect(e, `askel ${i}`).toBeDefined();
      }
    }
  });

  it('testireitti raportoi puuttuvan särmän', () => {
    const env2 = { ...fixtureEnv(), story: removeGloss(createSeedStory(), 'g-629-2') };
    const r = firstTestRoute(env2);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(trailKeys(r.trail)).toEqual(['root', 'code:629', 'digit:629#1']);
  });

  it('satunnaiskävely 500 askelta (fixture): ei koskaan kaksoiskappaletta, raja pitää', () => {
    randomWalk(fixtureEnv('234', EVENTS), 500, 12345);
    randomWalk(fixtureEnv('432', EVENTS), 500, 777);
  });
});

function randomWalk(env: MatrixEnv, steps: number, seed: number): void {
  const rng = createRng(seed);
  let trail = rootTrail();
  const results = new Set<string>();
  for (let s = 0; s < steps; s++) {
    if (s % 37 === 0) env = { ...env, direction: env.direction === '234' ? '432' : '234' };
    const from = rng.float() < 0.2 ? rng.int(0, trail.length - 1) : trail.length - 1;
    const x = expand(trail[from].ref, env, { hitLimit: 200 });
    if (!x.edges.length) {
      trail = truncateTo(trail, Math.max(0, from - 1));
      continue;
    }
    const e = x.edges[rng.int(0, x.edges.length - 1)];
    const r = openEdge(trail, e, from);
    results.add(r.result);
    const keys = trailKeys(r.trail);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys[0]).toBe('root');
    expect(r.trail.length).toBeLessThanOrEqual(MAX_DEPTH);
    if (r.result === 'lisätty') {
      expect(keys[keys.length - 1]).toBe(nodeKey(e.to));
      expect(r.trail.length).toBe(from + 2);
      expect(r.trail[r.trail.length - 1].via!.crossesRealm).toBe(realmOf(trail[from].ref) !== realmOf(e.to));
    }
    if (r.result === 'palattu') expect(keys[keys.length - 1]).toBe(nodeKey(e.to));
    if (r.result === 'syvyysraja') expect(r.trail).toBe(trail);
    trail = r.trail;
  }
  expect(results.has('lisätty')).toBe(true);
}

// ====================================================================== täysi 1M-aineisto

describe.skipIf(!HAS_FULL)('matriisi täydellä 1M-aineistolla', () => {
  it('juuri: otsikko, ankkuri tarkistettu ja ilmoitetut sijainnit', () => {
    const x = expand({ kind: 'root' }, fullEnv());
    expect(x.node.title).toBe('Lähtöankkuri IDA 432 @858 511');
    expect(x.node.facts[0]).toMatchObject({ verified: true, value: 'digits[858511…858513] = "432" ✓' });
    expect(keysOf(byGroup(x, GROUPS.anchor))).toEqual(['hit:432@858511']);
    expect(keysOf(byGroup(x, GROUPS.reportedPositions))).toEqual(['hit:62884@858260', 'hit:6464@858960']);
    // Määrä ja odotus samalla tuhaterottimella (ennen: "1054 (odotus satunnaisjonossa 1 000)").
    expect(x.node.facts.find((f) => f.label === 'Koodin osumia')!.value).toBe('1 054 (odotus satunnaisjonossa 1 000)');
  });

  it('koodin ja osuman määrät tuhaterottimin', () => {
    const c = expand({ kind: 'code', code: '629' }, fullEnv());
    expect(c.node.facts.find((f) => f.label === 'Osumia aineistossa')!.value).toBe('1 040 (kaikki alkukohdat, myös päällekkäiset)');
    const h = expand({ kind: 'hit', code: '432', n: 858511 }, fullEnv());
    expect(h.node.facts.find((f) => f.label === 'Osuma')!.value).toMatch(/^\d{1,3}( \d{3})*\/1 054 koodin 432 osumista/);
  });

  it('IDA @858511 suuntaan 234: HANNA @858610 (Δn +99)', () => {
    const x = expand({ kind: 'hit', code: '432', n: 858511 }, fullEnv('234'));
    const ref = byGroup(x, GROUPS.refNearest);
    const hanna = ref.find((e) => e.to.kind === 'hit' && e.to.code === '42662')!;
    expect(hanna.to).toEqual({ kind: 'hit', code: '42662', n: 858610 });
    expect(hanna.metrics!.Δn).toBe(99);
    expect(hanna).toMatchObject({ direction: '234', domain: 'pi-indeksi', verified: true, layer: 'matemaattinen' });
    expect(ref.find((e) => e.to.kind === 'hit' && e.to.code === '629')!.metrics!.Δn).toBe(490);
    expect(ref.some((e) => e.to.kind === 'hit' && e.to.code === '72552')).toBe(false); // SALLA: ei osumaa suuntaan 234
    expect(x.notes.join(' ')).toMatch(/SALLA 72552 ei ole osumaa suuntaan 234/);
    expect(keysOf(byGroup(x, GROUPS.sameCode))[0]).toBe('hit:432@859630');
    expect(byGroup(x, GROUPS.sameCode).length).toBe(5);
    expect(byGroup(x, GROUPS.near3d).length).toBe(5);
    const d3 = byGroup(x, GROUPS.near3d).map((e) => e.metrics!.d3 as number);
    expect(d3).toEqual([...d3].sort((a, b) => a - b));
    const oct = byGroup(x, GROUPS.octa);
    expect(oct.length).toBe(1);
    expect(oct[0]).toMatchObject({ direction: '234', domain: 'oktaedri', layer: 'geometrinen' });
    expect(oct[0].metrics!['Δφ°'] as number).toBeGreaterThan(0);
  });

  it('IDA @858511 suuntaan 432: SALLA @856712 (−1799) ja MATTI @858260 (−251)', () => {
    const x = expand({ kind: 'hit', code: '432', n: 858511 }, fullEnv('432'));
    const ref = byGroup(x, GROUPS.refNearest);
    const get = (code: string) => ref.find((e) => e.to.kind === 'hit' && e.to.code === code)!;
    expect(get('72552').to).toEqual({ kind: 'hit', code: '72552', n: 856712 });
    expect(get('72552').metrics!.Δn).toBe(-1799);
    expect(get('62884').to).toEqual({ kind: 'hit', code: '62884', n: 858260 });
    expect(get('62884').metrics!.Δn).toBe(-251);
    expect(get('629').metrics!.Δn).toBe(-922);
    expect(get('42662').to).toEqual({ kind: 'hit', code: '42662', n: 699002 });
    for (const e of ref) expect(e).toMatchObject({ direction: '432', domain: 'pi-indeksi' });
    const same = byGroup(x, GROUPS.sameCode).map((e) => (e.to as { n: number }).n);
    expect(same.length).toBe(5);
    expect(same).toEqual([...same].sort((a, b) => b - a));
    expect(same[0]).toBeLessThan(858511);
  });

  it('koodi 42662 listaa kaikki 7 HANNA-osumaa; koodi 629 kaikki 1040 ja noudattaa hitLimitiä', () => {
    const h = expand({ kind: 'code', code: '42662' }, fullEnv('234'));
    expect(byGroup(h, GROUPS.allHits(7)).map((e) => (e.to as { n: number }).n)).toEqual([
      100986, 138380, 249991, 277284, 293979, 699002, 858610,
    ]);
    expect(h.truncated).toEqual([]);
    expect(byGroup(h, GROUPS.nearestAnchor)[0]).toMatchObject({ to: { n: 858610 }, metrics: { Δn: 99 } });

    const m = expand({ kind: 'code', code: '629' }, fullEnv('234'));
    const all = byGroup(m, GROUPS.allHits(1040));
    expect(all.length).toBe(1040);
    expect(all.map((e) => (e.to as { n: number }).n)).toEqual(Array.from(codeHits(full(), '629')));
    expect(byGroup(m, GROUPS.nearestAnchor)[0]).toMatchObject({ to: { n: 859001 }, metrics: { Δn: 490 } });
    const lim = expand({ kind: 'code', code: '629' }, fullEnv('432'), { hitLimit: 100 });
    const shown = byGroup(lim, GROUPS.allHits(1040));
    expect(shown.length).toBe(100);
    expect((shown[0].to as { n: number }).n).toBe(codeHits(full(), '629')[1039]);
    expect(lim.truncated).toEqual([{ group: GROUPS.allHits(1040), shown: 100, total: 1040 }]);
    // Lähin osuma näytetään erikseen, vaikka lista on rajattu.
    expect(byGroup(lim, GROUPS.nearestAnchor).length).toBe(1);

    const mini = expand({ kind: 'code', code: '6464' }, fullEnv());
    expect(keysOf(byGroup(mini, GROUPS.allHits(108)))).toContain('hit:6464@858960');
    const ida = expand({ kind: 'code', code: '432' }, fullEnv());
    expect(byGroup(ida, GROUPS.allHits(1054)).length).toBe(1054);
    expect(nodeKey(byGroup(ida, GROUPS.nearestAnchor)[0].to)).not.toBe('hit:432@858511');
  });

  it('kaikki särmät syvyyteen 3 juuresta molempiin suuntiin: jäljitys, kerrosraja, tarkistetut osumat', () => {
    for (const dir of ['234', '432'] as const) {
      const r = bfsCheck(fullEnv(dir, EVENTS), 3);
      expect(r.expanded).toBeGreaterThan(10_000);
      expect(r.kinds.has('hit')).toBe(true);
      expect(r.kinds.has('position')).toBe(true);
    }
  });

  it('ensimmäinen testireitti ja satunnaiskävely täydellä aineistolla', () => {
    const { trail, errors } = firstTestRoute(fullEnv());
    expect(errors).toEqual([]);
    expect(trailKeys(trail)).toEqual(['root', 'code:629', 'digit:629#1', 'gloss:g-629-2', 'name:HANNA', 'person:hanna-3']);
    randomWalk(fullEnv('234', EVENTS), 500, 2026);
  });
});
