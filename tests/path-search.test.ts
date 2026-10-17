import { describe, expect, it } from 'vitest';
import { codeHits, verifyHit } from '../src/core/matrix/hits';
import { FIB_3K, fmtInt, STEPS_369 } from '../src/core/matrix/ops369';
import { createSeedStory } from '../src/core/matrix/seed';
import type { StoryModel } from '../src/core/matrix/types';
import { chordDistance, mapIndex } from '../src/core/mapping';
import { createRng } from '../src/core/random';
import { canonicalQuery, fnv1a, stableStringify } from '../src/core/path/canonical';
import type { IdentifierContext } from '../src/core/path/identifiers';
import {
  activeRules,
  buildGraph,
  neighbours,
  nodeId,
  PATH_RULES,
  PathGraph,
  reverseConsistent,
  RULE_ORDER,
} from '../src/core/path/rules';
import { searchPaths, validatePathParams } from '../src/core/path/search';
import { piSource, randomStringSource, uniformSource } from '../src/core/path/source';
import {
  DEFAULT_PATH_PARAMS,
  IdentifierRole,
  PATH_VERSION,
  PathIdentifier,
  PathParams,
  PathQuery,
  PathRuleId,
  SearchMode,
  SearchOutcome,
} from '../src/core/path/types';
import { handleRequest } from '../src/engine/handlers';
import { FIXTURE_DIGITS, FULL, HAS_FULL } from './helpers';

// ------------------------------------------------------------------ apuvälineet

/** Kapea sitova väli (U+202F), jota fmtInt käyttää tuhaterottimena. */
const T = ' ';
const MODES: SearchMode[] = ['234', '432', 'kaksisuuntainen'];

/** Synteettinen aineisto: nollia, joihin koodit istutetaan 1-pohjaisiin kohtiin. */
function plant(N: number, items: [number, string][]): string {
  const a = new Array<string>(N).fill('0');
  for (const [n, code] of items) for (let i = 0; i < code.length; i++) a[n - 1 + i] = code[i];
  return a.join('');
}

const P = (over: Partial<PathParams> = {}): PathParams => ({ ...DEFAULT_PATH_PARAMS, ...over });

function num(role: IdentifierRole, value: string, label = value): PathIdentifier {
  return { id: `${role}:${value}`, role, kind: 'numerojono', label, value, origin: 'käyttäjä' };
}

function name(role: IdentifierRole, n: string): PathIdentifier {
  return { id: `${role}:${n}`, role, kind: 'nimi', label: n, value: n, origin: 'käyttäjä' };
}

function query(ids: PathIdentifier[], startText = '', goalText = ''): PathQuery {
  return { startText, goalText, identifiers: ids, timeRange: null };
}

const EMPTY_STORY: StoryModel = { version: 1, seedVersion: 'testi', identifiers: [], persons: [], relations: [], glosses: [], paths: [] };
const CTX: IdentifierContext = { story: EMPTY_STORY, events: [] };

function graphOf(digits: string, codes: string[], params: PathParams): PathGraph {
  const src = piSource(digits, 'testi');
  return buildGraph(codes, (c) => src.hitsOf(c), digits.length, params);
}

const at = (g: PathGraph, code: string, n: number): number => {
  const id = nodeId(g, code, n);
  expect(id).toBeGreaterThanOrEqual(0);
  return id;
};

/** Ehdokkaat lyhyesti: "sääntö koodi@n Δ". */
const brief = (g: PathGraph, node: number, side: '234' | '432'): string[] =>
  neighbours(node, side, g).map((c) => `${c.rule} ${c.code}@${c.n} ${c.delta}`);

function bestCost(o: SearchOutcome): number | null {
  return o.routes.length ? o.routes[0].cost.edges + o.routes[0].cost.transforms : null;
}

/** Tulos ilman aikaa (ms). */
const stable = (o: SearchOutcome): Omit<SearchOutcome, 'ms'> => {
  const { ms: _ms, ...rest } = o;
  void _ms;
  return rest;
};

/** Jokainen reitti: solmut ketjuna, askeleet sääntöjen mukaisia, delta = to.n − from.n, kustannus täsmää. */
function expectWellFormed(o: SearchOutcome, digits: string | null): void {
  for (const r of o.routes) {
    expect(r.steps.length).toBe(r.nodes.length - 1);
    expect(r.key).toBe(r.nodes.map((n) => `${n.code}@${n.n}`).join('>'));
    expect(r.nodes[0].roles).toContain('lähtö');
    expect(r.nodes[r.nodes.length - 1].roles).toContain('tavoite');
    let span = 0;
    let transforms = 0;
    r.steps.forEach((s, i) => {
      expect(s.from).toEqual(r.nodes[i]);
      expect(s.to).toEqual(r.nodes[i + 1]);
      expect(RULE_ORDER).toContain(s.rule);
      expect(s.layer).toBe(PATH_RULES[s.rule].layer);
      expect(s.domain).toBe(PATH_RULES[s.rule].domain);
      expect(s.transform).toBe(PATH_RULES[s.rule].is369);
      expect(s.delta).toBe(s.to.n - s.from.n);
      expect(s.metrics['Δn']).toBe(s.delta);
      expect(s.branching).toBeGreaterThanOrEqual(1);
      span += Math.abs(s.delta);
      if (s.transform) transforms++;
      if (digits) {
        expect(s.verified).toBe(true);
        expect(verifyHit(digits, s.from.code, s.from.n)).toBe(true);
        expect(verifyHit(digits, s.to.code, s.to.n)).toBe(true);
        expect(s.digitsFrom).toBe(s.from.code);
        expect(s.digitsTo).toBe(s.to.code);
      } else {
        expect(s.verified).toBeNull();
        expect(s.digitsFrom).toBeNull();
      }
    });
    expect(r.cost).toEqual({ edges: r.steps.length, transforms, span });
    if (o.mode !== 'kaksisuuntainen') expect(r.meetIndex).toBeNull();
    if (o.mode === '234') expect(r.steps.every((s) => s.side === '234')).toBe(true);
    if (o.mode === '432') expect(r.steps.every((s) => s.side === '432')).toBe(true);
    if (o.mode === 'kaksisuuntainen') {
      // lähtöpuolen askeleet ensin, sitten tavoitepuolen
      const m = r.meetIndex!;
      r.steps.forEach((s, i) => expect(s.side).toBe(i < m ? '234' : '432'));
    }
  }
  // järjestys (hinta, muunnokset, Σ|Δn|, avain)
  for (let i = 1; i < o.routes.length; i++) {
    const a = o.routes[i - 1];
    const b = o.routes[i];
    const ka = [a.cost.edges + a.cost.transforms, a.cost.transforms, a.cost.span];
    const kb = [b.cost.edges + b.cost.transforms, b.cost.transforms, b.cost.span];
    const cmp = ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2] || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    expect(cmp).toBeLessThan(0);
  }
}

// ------------------------------------------------------------------ säännöt

describe('säännöt: määrittely ja aktivointi', () => {
  it('kuusi sääntöä, 369 vain use369 = true', () => {
    expect(RULE_ORDER).toEqual(['indeksi-seuraava', 'fib-naapuri', 'oktaedri-lähin', '369-siirtymä', '369-fib3k', '369-mod9']);
    for (const id of RULE_ORDER) expect(PATH_RULES[id].id).toBe(id);
    expect(activeRules(DEFAULT_PATH_PARAMS).map((r) => r.id)).toEqual(['indeksi-seuraava', 'fib-naapuri', 'oktaedri-lähin']);
    expect(activeRules({ ...DEFAULT_PATH_PARAMS, use369: true }).map((r) => r.id)).toEqual(RULE_ORDER);
    // 369-tunnus listassa ei yksin aktivoi sääntöä
    expect(activeRules({ rules: ['369-mod9', 'fib-naapuri'], use369: false }).map((r) => r.id)).toEqual(['fib-naapuri']);
    expect(PATH_RULES['oktaedri-lähin'].undirected).toBe(true);
    expect(RULE_ORDER.filter((r) => PATH_RULES[r].is369)).toEqual(['369-siirtymä', '369-fib3k', '369-mod9']);
    expect(PATH_RULES['fib-naapuri']).toMatchObject({ layer: 'geometrinen', domain: 'spiraali' });
    expect(PATH_RULES['indeksi-seuraava']).toMatchObject({ layer: 'matemaattinen', domain: 'pi-indeksi' });
    expect(reverseConsistent(activeRules({ rules: ['fib-naapuri'], use369: false }))).toBe(true);
    expect(reverseConsistent(activeRules(DEFAULT_PATH_PARAMS))).toBe(false);
  });

  it('indeksi-seuraava: jokaisen koodin lähin osuma W:n sisällä, myös sama koodi; 432 = lähin ennen', () => {
    const digits = plant(1000, [
      [100, '111'],
      [150, '222'],
      [400, '222'],
      [120, '333'],
      [180, '111'],
    ]);
    const g = graphOf(digits, ['111', '222', '333'], P({ rules: ['indeksi-seuraava'], indexWindow: 100 }));
    const a = at(g, '111', 100);
    expect(brief(g, a, '234')).toEqual(['indeksi-seuraava 111@180 80', 'indeksi-seuraava 222@150 50', 'indeksi-seuraava 333@120 20']);
    const c = neighbours({ code: '111', n: 100 }, '234', g)[1];
    expect(c.formula).toBe('150 = lähin 222-osuma > 100 (Δn = 50 ≤ W = 100)');
    expect(c).toMatchObject({ cost: 1, transform: false, delta: 50, metrics: { 'Δn': 50, W: 100 } });
    // 222@150: seuraava 222 on 400 (Δ 250 > W) → ei ehdokasta
    expect(brief(g, at(g, '222', 150), '234')).toEqual(['indeksi-seuraava 111@180 30']);
    expect(brief(g, at(g, '222', 150), '432')).toEqual(['indeksi-seuraava 111@100 -50', 'indeksi-seuraava 333@120 -30']);
    expect(neighbours(at(g, '222', 150), '432', g)[0].formula).toBe('100 = lähin 111-osuma < 150 (n − n′ = 50 ≤ W = 100)');
  });

  it('fib-naapuri: n ± F_k, yksi ehdokas jokaista samasta kohdasta alkavaa koodia kohden', () => {
    // 4444 kohdassa 155 sisältää myös koodin 444 kohdissa 155 ja 156
    const digits = plant(3000, [
      [100, '111'],
      [155, '4444'],
      [1697, '222'],
    ]);
    const g = graphOf(digits, ['111', '222', '444', '4444'], P({ rules: ['fib-naapuri'], fibKMin: 2, fibKMax: 20 }));
    const a = at(g, '111', 100);
    // 155 = 100 + F10 (55), 156 = 100 + F_? (56 ei ole Fibonacci), 1697 = 100 + F17 (1 597)
    expect(brief(g, a, '234')).toEqual(['fib-naapuri 444@155 55', 'fib-naapuri 4444@155 55', 'fib-naapuri 222@1697 1597']);
    const cs = neighbours(a, '234', g);
    expect(cs[0].formula).toBe('100 + F10 (55) = 155');
    expect(cs[2].formula).toBe(`100 + F17 (1${T}597) = 1${T}697`);
    expect(cs[2].metrics).toEqual({ 'Δn': 1597, k: 17, F: 1597 });
    const back = neighbours(at(g, '222', 1697), '432', g);
    expect(back.map((c) => c.formula)).toEqual([`1${T}697 − F17 (1${T}597) = 100`]);
    expect(back[0].delta).toBe(-1597);
    // kMax rajaa: F17 ei mukana, kun kMax = 16
    const g2 = graphOf(digits, ['111', '222'], P({ rules: ['fib-naapuri'], fibKMin: 2, fibKMax: 16 }));
    expect(brief(g2, at(g2, '111', 100), '234')).toEqual([]);
  });

  it('oktaedri-lähin: k lähintä kohtaa chord-rajan sisällä, suunnaton', () => {
    const n0 = 500;
    // etsitään kohdat, jotka ovat 3D-kartalla lähimpänä kohtaa n0
    const cands: { m: number; d: number }[] = [];
    for (let m = 1; m <= 20000; m++) if (Math.abs(m - n0) >= 4) cands.push({ m, d: chordDistance(mapIndex(n0), mapIndex(m)) });
    cands.sort((x, y) => x.d - y.d || x.m - y.m);
    // kolme lähintä, joiden välissä on vähintään yksi nolla (ei ylimääräisiä osumia)
    const picked: { m: number; d: number }[] = [];
    for (const c of cands) {
      if (picked.every((o) => Math.abs(o.m - c.m) >= 4)) picked.push(c);
      if (picked.length === 3) break;
    }
    const [m1, m2, m3] = picked;
    expect(m1.d).toBeLessThan(m2.d);
    expect(m2.d).toBeLessThan(m3.d);
    const digits = plant(20010, [
      [n0, '111'],
      [m1.m, '222'],
      [m2.m, '333'],
      [m3.m, '222'],
    ]);
    const params = P({ rules: ['oktaedri-lähin'], nearestK: 2, chordMax: m3.d * 1.0001 });
    const g = graphOf(digits, ['111', '222', '333'], params);
    const a = at(g, '111', n0);
    const out = neighbours(a, '234', g);
    // k = 2: kolmas (m3) on chord-rajan sisällä, mutta ei kahden lähimmän joukossa
    expect(out.map((c) => `${c.code}@${c.n}`)).toEqual([`222@${m1.m}`, `333@${m2.m}`]);
    expect(out.map((c) => c.metrics.sija)).toEqual([1, 2]);
    expect(out[0].metrics.chord).toBeCloseTo(m1.d, 6);
    expect(out[0].formula).toContain(`chord(500, ${fmtInt(m1.m)}) = ${m1.d.toFixed(6).replace('.', ',')} ≤ `);
    expect(out[0].formula).toContain('1. lähin kohta (k = 2)');
    const g3 = graphOf(digits, ['111', '222', '333'], { ...params, nearestK: 3 });
    expect(neighbours(at(g3, '111', n0), '234', g3).map((c) => c.n)).toEqual([m1.m, m2.m, m3.m]);
    expect(out[0].delta).toBe(m1.m - n0);
    // suunnaton: 432-puolella samat ehdokkaat
    expect(brief(g, a, '432')).toEqual(brief(g, a, '234'));
    // chordMax rajaa
    const g2 = graphOf(digits, ['111', '222', '333'], P({ rules: ['oktaedri-lähin'], nearestK: 5, chordMax: m1.d * 0.999 }));
    expect(neighbours(at(g2, '111', n0), '234', g2)).toEqual([]);
    // sama kohta ei ole geometrinen naapuri
    for (const c of neighbours(a, '234', g)) expect(c.n).not.toBe(n0);
  });

  it('369-säännöt: siirtymä 3·6·9, F₃ₖ ja mod 9 (muunnos, hinta 2), vain use369 = true', () => {
    expect(STEPS_369).toEqual([3, 6, 9]);
    expect(FIB_3K.map((f) => f.F)).toEqual([2, 8, 34, 144, 610, 2584, 10946]);
    const digits = plant(2000, [
      [100, '111'],
      [106, '222'],
      [134, '333'],
      [110, '444'],
      [127, '444'],
    ]);
    const base = { rules: [] as PathRuleId[], indexWindow: 10 };
    const off = graphOf(digits, ['111', '222', '333', '444'], P({ ...base, use369: false }));
    expect(neighbours(at(off, '111', 100), '234', off)).toEqual([]);
    const g = graphOf(digits, ['111', '222', '333', '444'], P({ ...base, use369: true }));
    const out = neighbours(at(g, '111', 100), '234', g);
    expect(out.map((c) => `${c.rule} ${c.code}@${c.n} ${c.formula}`)).toEqual([
      '369-siirtymä 222@106 100 + 6 = 106',
      '369-fib3k 333@134 100 + F9 (34) = 134',
      '369-mod9 444@127 127 = lähin 444-osuma > 100, jolle Δn ≡ 0 (mod 9): 27 = 9 · 3 ≤ 9W = 90',
    ]);
    for (const c of out) expect(c).toMatchObject({ transform: true, cost: 2 });
    // 444@110: Δn = 10 ≢ 0 (mod 9) → ohitetaan, lähin kelvollinen on 127
    const back = neighbours(at(g, '444', 127), '432', g);
    expect(back.map((c) => c.formula)).toEqual(['100 = lähin 111-osuma < 127, jolle Δn ≡ 0 (mod 9): 27 = 9 · 3 ≤ 9W = 90']);
    expect(neighbours(at(g, '222', 106), '432', g).map((c) => c.formula)).toEqual(['106 − 6 = 100']);
    expect(neighbours(at(g, '333', 134), '432', g).map((c) => c.formula)).toEqual(['134 − F9 (34) = 100']);
  });
});

// ------------------------------------------------------------------ haku: istutetut reitit

describe('searchPaths: istutetut reitit löytyvät täsmällisin kaavoin', () => {
  // S → K (F15 = 610) → G (F12 = 144); D-solmut ovat umpikujia lähtöpuolella.
  const digits = plant(3000, [
    [1000, '111'],
    [1610, '222'],
    [1754, '333'],
    [1013, '444'],
    [1034, '444'],
  ]);
  const src = piSource(digits, 'synteettinen');
  const ids = [num('lähtö', '111', 'S'), num('tunnettu', '222', 'K'), num('tavoite', '333', 'G'), num('tunnettu', '444', 'D')];
  const params = P({ rules: ['fib-naapuri'], maxRoutes: 1 });

  it('234: kaikki askeleet lähtöpuolelta', () => {
    const o = searchPaths(query(ids), params, '234', src, CTX);
    expect(o.status).toBe('löytyi');
    expectWellFormed(o, digits);
    const r = o.routes[0];
    expect(r.key).toBe('111@1000>222@1610>333@1754');
    expect(r.steps.map((s) => s.formula)).toEqual([`1${T}000 + F15 (610) = 1${T}610`, `1${T}610 + F12 (144) = 1${T}754`]);
    expect(r.steps.map((s) => s.delta)).toEqual([610, 144]);
    expect(r.cost).toEqual({ edges: 2, transforms: 0, span: 754 });
    expect(r.nodes.map((n) => n.labels[0])).toEqual(['S', 'K', 'G']);
    expect(r.nodes[1].roles).toEqual(['tunnettu']);
    expect(o.forward).not.toBeNull();
    expect(o.backward).toBeNull();
    expect(o.reachedSample[0]).toMatchObject({ depth: 0, via: null, node: { code: '111', n: 1000 } });
    expect(o.reachedSample.some((x) => x.node.code === '444' && x.depth === 1 && x.via === 'fib-naapuri')).toBe(true);
  });

  it('432: reitti käännetään luettavaksi lähtö → tavoite, kaavat tavoitepuolelta', () => {
    const o = searchPaths(query(ids), params, '432', src, CTX);
    expectWellFormed(o, digits);
    const r = o.routes[0];
    expect(r.key).toBe('111@1000>222@1610>333@1754');
    expect(r.steps.map((s) => s.side)).toEqual(['432', '432']);
    expect(r.steps.map((s) => s.formula)).toEqual([`1${T}610 − F15 (610) = 1${T}000`, `1${T}754 − F12 (144) = 1${T}610`]);
    expect(r.steps.map((s) => s.delta)).toEqual([610, 144]);
    expect(o.forward).toBeNull();
    expect(o.backward).not.toBeNull();
  });

  it('kaksisuuntainen: lähtöpuolen polku + tavoitepuolen polku käännettynä, kohtaaminen K:ssa', () => {
    const o = searchPaths(query(ids), params, 'kaksisuuntainen', src, CTX);
    expectWellFormed(o, digits);
    const r = o.routes[0];
    expect(r.key).toBe('111@1000>222@1610>333@1754');
    expect(r.meetIndex).toBe(1);
    expect(r.steps.map((s) => [s.side, s.formula, s.delta])).toEqual([
      ['234', `1${T}000 + F15 (610) = 1${T}610`, 610],
      ['432', `1${T}754 − F12 (144) = 1${T}610`, 144],
    ]);
    // haarautuminen = laajennetun solmun ehdokkaiden määrä (S: D, D, K; G: K)
    expect(r.steps.map((s) => s.branching)).toEqual([3, 1]);
    expect(o.forward!.expanded).toBe(1);
    expect(o.backward!.expanded).toBe(1);
    expect(o.reachedSample).toEqual([]);
  });

  it('indeksi-seuraava: kaksi askelta, kun suora yhteys on W:n ulkopuolella', () => {
    const d2 = plant(1000, [
      [100, '111'],
      [150, '222'],
      [180, '333'],
    ]);
    const s2 = piSource(d2, 'synteettinen');
    const q2 = query([num('lähtö', '111'), num('tunnettu', '222'), num('tavoite', '333')]);
    for (const mode of MODES) {
      const o = searchPaths(q2, P({ rules: ['indeksi-seuraava'], indexWindow: 60 }), mode, s2, CTX);
      expectWellFormed(o, d2);
      expect(o.routes.map((r) => r.key)).toEqual(['111@100>222@150>333@180']);
    }
    const o234 = searchPaths(q2, P({ rules: ['indeksi-seuraava'], indexWindow: 60 }), '234', s2, CTX);
    expect(o234.routes[0].steps.map((s) => s.formula)).toEqual([
      '150 = lähin 222-osuma > 100 (Δn = 50 ≤ W = 60)',
      '180 = lähin 333-osuma > 150 (Δn = 30 ≤ W = 60)',
    ]);
    // W = 100: suora askel 111 → 333 (Δ 80) on paras
    const wide = searchPaths(q2, P({ rules: ['indeksi-seuraava'], indexWindow: 100 }), '234', s2, CTX);
    expect(wide.routes[0].key).toBe('111@100>333@180');
  });

  it('369: use369 = false → ei 369-askelta; use369 = true → muunnos, hinta 2', () => {
    const d3 = plant(2000, [
      [100, '111'],
      [106, '222'],
    ]);
    const s3 = piSource(d3, 'synteettinen');
    const q3 = query([num('lähtö', '111'), num('tavoite', '222')]);
    for (const mode of MODES) {
      const off = searchPaths(q3, P({ rules: ['fib-naapuri'], use369: false }), mode, s3, CTX);
      expect(off.status).toBe('ei-löytynyt');
      expect(off.routes).toEqual([]);
      const on = searchPaths(q3, P({ rules: ['fib-naapuri'], use369: true }), mode, s3, CTX);
      expectWellFormed(on, d3);
      expect(on.routes.map((r) => r.key)).toEqual(['111@100>222@106']);
      const s = on.routes[0].steps[0];
      expect(s).toMatchObject({ rule: '369-siirtymä', transform: true, delta: 6, layer: 'matemaattinen', domain: 'pi-indeksi' });
      expect(on.routes[0].cost).toEqual({ edges: 1, transforms: 1, span: 6 });
      expect(bestCost(on)).toBe(2);
    }
  });

  it('369-reitti on kalliimpi kuin perusreitti: 2 perusaskelta (hinta 2) ennen 2 askeleen 369-reittiä (hinta 3)', () => {
    // S@100 → G@106 (369-siirtymä, hinta 2), S@100 → K@105 (F5) → G@106 (indeksi-seuraava, W = 2) hinta 2
    const d4 = plant(2000, [
      [100, '111'],
      [105, '5'],
      [106, '222'],
    ]);
    const s4 = piSource(d4, 'synteettinen');
    const q4 = query([num('lähtö', '111'), num('tunnettu', '5'), num('tavoite', '222')]);
    const o = searchPaths(q4, P({ rules: ['fib-naapuri', 'indeksi-seuraava'], indexWindow: 2, minCodeLength: 1, use369: true, maxRoutes: 3 }), '234', s4, CTX);
    expectWellFormed(o, d4);
    // tasatilanne hinnassa 2: vähemmän muunnoksia ensin
    expect(o.routes[0].cost).toEqual({ edges: 2, transforms: 0, span: 6 });
    expect(o.routes[0].key).toBe('111@100>5@105>222@106');
  });
});

// ------------------------------------------------------------------ vertailu raakaan hakuun

/** Raaka haku kerroksittain: D[e][v] = pienin hinta solmuun v täsmälleen e askeleella annetulla puolella. */
function layers(g: PathGraph, side: '234' | '432', sources: number[], maxEdges: number): Map<number, number>[] {
  const out: Map<number, number>[] = [new Map(sources.map((s) => [s, 0]))];
  for (let e = 1; e <= maxEdges; e++) {
    const next = new Map<number, number>();
    for (const [v, c] of out[e - 1]) {
      for (const cand of neighbours(v, side, g)) {
        const nc = c + cand.cost;
        if (nc < (next.get(cand.to) ?? Number.POSITIVE_INFINITY)) next.set(cand.to, nc);
      }
    }
    out.push(next);
  }
  return out;
}

/** Paras hinta: 234 = lähtöpuolen kävelyt, 432 = tavoitepuolen kävelyt, kaksisuuntainen = paras yhdistelmä solmussa. */
function bruteBest(g: PathGraph, starts: number[], goals: number[], mode: SearchMode, maxEdges: number): number | null {
  const F = layers(g, '234', starts, maxEdges);
  const B = layers(g, '432', goals, maxEdges);
  const goalSet = new Set(goals);
  const startSet = new Set(starts);
  let best = Number.POSITIVE_INFINITY;
  if (mode === '234') for (let e = 1; e <= maxEdges; e++) for (const [v, c] of F[e]) if (goalSet.has(v)) best = Math.min(best, c);
  if (mode === '432') for (let e = 1; e <= maxEdges; e++) for (const [v, c] of B[e]) if (startSet.has(v)) best = Math.min(best, c);
  if (mode === 'kaksisuuntainen') {
    for (let e1 = 0; e1 <= maxEdges; e1++)
      for (let e2 = 0; e1 + e2 <= maxEdges; e2++) {
        if (e1 + e2 === 0) continue;
        for (const [v, c] of F[e1]) {
          const cb = B[e2].get(v);
          if (cb !== undefined) best = Math.min(best, c + cb);
        }
      }
  }
  return Number.isFinite(best) ? best : null;
}

function randomPlanted(seed: number, codes: string[], perCode: number, N: number): string {
  const rng = createRng(seed);
  const used: number[] = [];
  const items: [number, string][] = [];
  for (const code of codes) {
    let placed = 0;
    while (placed < perCode) {
      const n = rng.int(1, N - 4);
      // vähintään yksi nolla koodien välissä: ei ylimääräisiä osumia
      if (used.some((u) => Math.abs(u - n) < 4)) continue;
      used.push(n);
      items.push([n, code]);
      placed++;
    }
  }
  return plant(N, items);
}

describe('234, 432 ja kaksisuuntainen vs. raaka haku pienillä synteettisillä graafeilla', () => {
  const codes = ['111', '222', '333', '444'];
  const ids = [num('lähtö', '111'), num('tavoite', '222'), num('tunnettu', '333'), num('tunnettu', '444')];

  function check(params: PathParams, seeds: number[], N: number, perCode: number): { found: number; agree: number } {
    let found = 0;
    let agree = 0;
    for (const seed of seeds) {
      const digits = randomPlanted(seed, codes, perCode, N);
      const src = piSource(digits, `synteettinen ${seed}`);
      const g = buildGraph([...codes].sort(), (c) => src.hitsOf(c), N, params);
      const starts = Array.from(g.hitNode[g.codes.indexOf('111')]);
      const goals = Array.from(g.hitNode[g.codes.indexOf('222')]);
      const costs: (number | null)[] = [];
      for (const mode of MODES) {
        const o = searchPaths(query(ids), params, mode, src, CTX);
        expectWellFormed(o, digits);
        const expected = bruteBest(g, starts, goals, mode, params.maxEdges);
        expect(bestCost(o), `siemen ${seed}, tila ${mode}`).toBe(expected);
        expect(o.status).toBe(expected === null ? 'ei-löytynyt' : 'löytyi');
        costs.push(bestCost(o));
      }
      if (costs[0] !== null) found++;
      if (costs[0] === costs[1] && costs[1] === costs[2]) agree++;
    }
    return { found, agree };
  }

  it('käänteiset säännöt (fib-naapuri + 369): kaikki kolme tilaa antavat saman parhaan hinnan', () => {
    const params = P({ rules: ['fib-naapuri'], use369: true, maxEdges: 4, fibKMax: 16 });
    // 369-mod9 ei ole käänteinen → testataan erikseen ilman sitä: vain fib + 369-siirtymä/fib3k ovat käänteisiä
    expect(reverseConsistent(activeRules({ rules: ['fib-naapuri'], use369: false }))).toBe(true);
    const r1 = check(P({ rules: ['fib-naapuri'], maxEdges: 4, fibKMax: 16 }), [1, 2, 3, 4, 5, 6, 7, 8], 2500, 25);
    expect(r1.agree).toBe(8);
    expect(r1.found).toBeGreaterThan(3);
    // use369 (mukana epäsymmetrinen mod 9): jokainen tila vastaa omaa raakaa hakuaan
    const r2 = check(params, [11, 12, 13, 14, 15, 16], 2500, 25);
    expect(r2.found).toBeGreaterThan(2);
  });

  it('epäsymmetriset säännöt (oletus): jokainen tila vastaa raakaa hakua; kaksisuuntainen ≤ 234 ja ≤ 432', () => {
    const params = P({ indexWindow: 150, maxEdges: 4, chordMax: 0.05, fibKMax: 16 });
    for (const seed of [21, 22, 23, 24, 25, 26, 27, 28]) {
      const digits = randomPlanted(seed, codes, 10, 4000);
      const src = piSource(digits, 'synteettinen');
      const g = buildGraph([...codes].sort(), (c) => src.hitsOf(c), 4000, params);
      const starts = Array.from(g.hitNode[g.codes.indexOf('111')]);
      const goals = Array.from(g.hitNode[g.codes.indexOf('222')]);
      const got: Record<string, number | null> = {};
      for (const mode of MODES) {
        const o = searchPaths(query(ids), params, mode, src, CTX);
        expectWellFormed(o, digits);
        got[mode] = bestCost(o);
        expect(got[mode], `siemen ${seed}, tila ${mode}`).toBe(bruteBest(g, starts, goals, mode, params.maxEdges));
      }
      const bi = got.kaksisuuntainen ?? Number.POSITIVE_INFINITY;
      expect(bi).toBeLessThanOrEqual(got['234'] ?? Number.POSITIVE_INFINITY);
      expect(bi).toBeLessThanOrEqual(got['432'] ?? Number.POSITIVE_INFINITY);
    }
  });

  it('kaksisuuntainen on tarkka myös, kun 432-säännöt eivät ole 234-sääntöjen käänteisiä', () => {
    // indeksi-seuraava, W = 60. 234: S@100 → X@110 → X@150 → G@200 (3 askelta; S:n lähin X on 110).
    // 432: G@200 ← X@150 ← S@100 (G:n lähin X ennen on 150, sen lähin S ennen on 100): 2 askelta.
    // Tavallinen ehto (paras kohtaaminen ≤ top₂₃₄ + top₄₃₂) pysähtyisi kohtaamiseen X@150, hinta 3.
    const d = plant(1000, [
      [100, '111'],
      [110, '333'],
      [150, '333'],
      [200, '222'],
    ]);
    const s = piSource(d, 'synteettinen');
    const q = query([num('lähtö', '111'), num('tavoite', '222'), num('tunnettu', '333')]);
    const params = P({ rules: ['indeksi-seuraava'], indexWindow: 60, maxRoutes: 1 });
    const o234 = searchPaths(q, params, '234', s, CTX);
    const o432 = searchPaths(q, params, '432', s, CTX);
    const bi = searchPaths(q, params, 'kaksisuuntainen', s, CTX);
    expect(o234.routes.map((r) => r.key)).toEqual(['111@100>333@110>333@150>222@200']);
    expect(o432.routes.map((r) => r.key)).toEqual(['111@100>333@150>222@200']);
    expect(bi.routes.map((r) => r.key)).toEqual(['111@100>333@150>222@200']);
    expect(bestCost(bi)).toBe(2);
    expect(bi.routes[0].meetIndex).toBe(0);
    expect(bi.routes[0].steps.map((x) => x.formula)).toEqual([
      '100 = lähin 111-osuma < 150 (n − n′ = 50 ≤ W = 60)',
      '150 = lähin 333-osuma < 200 (n − n′ = 50 ≤ W = 60)',
    ]);
    expectWellFormed(bi, d);
  });
});

// ------------------------------------------------------------------ epäonnistumiset ja syyt

describe('syyt: budjetti, maxEdges ja hylätyt koodit', () => {
  // ketju S → A → B → G Fibonacci-askelin F10 = 55, F12 = 144, F14 = 377 (ei-peräkkäiset k: ei oikoteitä,
  // koska esim. F11 + F12 = F13 olisi suora yhteys)
  const digits = plant(3000, [
    [1000, '111'],
    [1055, '555'],
    [1199, '666'],
    [1576, '222'],
  ]);
  const src = piSource(digits, 'synteettinen');
  const ids = [num('lähtö', '111'), num('tunnettu', '555'), num('tunnettu', '666'), num('tavoite', '222')];

  it('kolmen askeleen ketju löytyy maxEdges = 3, ei maxEdges = 2', () => {
    for (const mode of MODES) {
      const ok = searchPaths(query(ids), P({ rules: ['fib-naapuri'], maxEdges: 3 }), mode, src, CTX);
      expect(ok.routes.map((r) => r.key)).toEqual(['111@1000>555@1055>666@1199>222@1576']);
      const no = searchPaths(query(ids), P({ rules: ['fib-naapuri'], maxEdges: 2 }), mode, src, CTX);
      expect(no.status).toBe('ei-löytynyt');
      expect(no.routes).toEqual([]);
      const text = no.reasons.join('\n');
      if (mode === '234') expect(text).toContain('Lähtöpuolen haku (234) kävi läpi kaikki enintään 2 askeleen päässä olevat solmut');
      if (mode === '432') expect(text).toContain('Tavoitepuolen haku (432) kävi läpi kaikki enintään 2 askeleen päässä olevat solmut');
      if (mode === 'kaksisuuntainen') expect(text).toContain('Rintamat eivät kohdanneet 2 askeleen sisällä');
    }
  });

  it('budjetti loppuu: syy kertoo puolen ja laajennusten määrän', () => {
    const o = searchPaths(query(ids), P({ rules: ['fib-naapuri'], budget: 1 }), '234', src, CTX);
    expect(o.status).toBe('ei-löytynyt');
    expect(o.forward).toMatchObject({ expanded: 1, budgetHit: true });
    expect(o.reasons.join('\n')).toContain('Budjetti loppui lähtöpuolella (234) 1 laajennuksen jälkeen (budget = 1)');
    const b = searchPaths(query(ids), P({ rules: ['fib-naapuri'], budget: 1 }), 'kaksisuuntainen', src, CTX);
    // kumpikin puoli laajentaa yhden solmun → kohtaamista ei vielä ole (reitti vaatii 3 askelta)
    expect(b.forward!.budgetHit || b.backward!.budgetHit).toBe(true);
    expect(b.reasons.join('\n')).toMatch(/Budjetti loppui (lähtöpuolella \(234\)|tavoitepuolella \(432\))/);
    expect(b.reasons.join('\n')).toContain('Rintamat eivät kohdanneet ennen kuin budjetti loppui');
  });

  it('rintama tyhjenee ennen maxEdges-rajaa: syy kertoo syvyyden', () => {
    const o = searchPaths(query([num('lähtö', '111'), num('tavoite', '222')]), P({ rules: ['fib-naapuri'] }), '234', src, CTX);
    expect(o.status).toBe('ei-löytynyt');
    expect(o.reasons.join('\n')).toContain('rintama tyhjeni 0 askeleen jälkeen');
  });

  it('liian lyhyt koodi, nolla osumaa, liikaa osumia ja koodausvirhe hylätään syineen', () => {
    const d = plant(3000, [
      [1000, '111'],
      [1055, '555'],
      [2000, '555'],
      [2500, '555'],
      [1144, '22'],
      [1288, '222'],
    ]);
    const s = piSource(d, 'synteettinen');
    const q = query([
      num('lähtö', '111'),
      num('tunnettu', '22', 'LYHYT'),
      num('tunnettu', '98765', 'PUUTTUU'),
      num('tunnettu', '555', 'YLEINEN'),
      name('tunnettu', 'X@'),
      num('tavoite', '222'),
    ]);
    const o = searchPaths(q, P({ maxHitsPerCode: 2 }), 'kaksisuuntainen', s, CTX);
    const reasonOf = (code: string | null) => o.failures.find((f) => f.code === code)?.reason ?? '';
    expect(reasonOf('22')).toContain('liian lyhyt: 2 < minCodeLength = 3');
    expect(reasonOf('98765')).toContain('ei ole osumia aineistossa (synteettinen)');
    expect(reasonOf('555')).toContain('3 osumaa > maxHitsPerCode = 2');
    expect(o.failures.find((f) => f.code === null)).toMatchObject({ label: 'X@' });
    expect(reasonOf(null)).toContain('ei kuulu T9-näppäimistöön');
    const used = Object.fromEntries(o.vocabulary.map((v) => [v.code, v.used]));
    expect(used).toEqual({ '111': true, '222': true, '22': false, '555': false, '98765': false });
    expect(o.vocabulary.find((v) => v.code === '555')).toMatchObject({ hits: 3, labels: ['YLEINEN'], roles: ['tunnettu'] });
    // hylättyjä koodeja ei käytetä solmuina
    for (const r of o.routes) for (const n of r.nodes) expect(['111', '222']).toContain(n.code);
  });

  it('tyhjä lähtö- tai tavoitejoukko → ei-löytynyt syineen; virheelliset parametrit ja tyhjä aineisto → virhe', () => {
    const noGoal = searchPaths(query([num('lähtö', '111')]), P(), '234', src, CTX);
    expect(noGoal.status).toBe('ei-löytynyt');
    expect(noGoal.reasons.join('\n')).toContain('Tavoitetilalle ei ole tunnisteita');
    const badGoal = searchPaths(query([num('lähtö', '111'), num('tavoite', '98765')]), P(), '234', src, CTX);
    expect(badGoal.status).toBe('ei-löytynyt');
    expect(badGoal.reasons.join('\n')).toContain('Tavoitejoukossa ei ole yhtään käyttökelpoista koodia');
    const badParams = searchPaths(query(ids), P({ maxEdges: 0, chordMax: -1 }), '234', src, CTX);
    expect(badParams.status).toBe('virhe');
    expect(badParams.reasons.join('\n')).toContain('maxEdges');
    expect(validatePathParams(P({ rules: ['outo' as PathRuleId] }))).toEqual(['Tuntematon sääntö "outo".']);
    expect(validatePathParams(DEFAULT_PATH_PARAMS)).toEqual([]);
    const empty = searchPaths(query(ids), P(), '234', piSource('', 'tyhjä'), CTX);
    expect(empty.status).toBe('virhe');
    expect(empty.reasons[0]).toContain('Aineisto on tyhjä');
  });

  it('samat lähtö- ja tavoitejoukot: varoitus syissä, haku jatkuu', () => {
    const d = plant(3000, [
      [1000, '111'],
      [1055, '111'],
    ]);
    const s = piSource(d, 'synteettinen');
    const q = query([num('lähtö', '111', 'MATTI'), num('tavoite', '111', 'MATTI')]);
    for (const mode of MODES) {
      const o = searchPaths(q, P({ rules: ['fib-naapuri'] }), mode, s, CTX);
      expect(o.reasons[0]).toContain('Lähtö- ja tavoitetila koodautuvat samaksi tunnistejoukoksi (MATTI)');
      // reitti alkaa ja päättyy eri osumaan (ei nollan askeleen reittiä eikä silmukkaa)
      expect(o.status).toBe('löytyi');
      for (const r of o.routes) {
        expect(r.steps.length).toBeGreaterThanOrEqual(1);
        expect(r.nodes[0].n).not.toBe(r.nodes[r.nodes.length - 1].n);
      }
      expectWellFormed(o, d);
    }
  });
});

// ------------------------------------------------------------------ symboliset linkit eivät ole särmiä

describe('symboliset linkit eivät koskaan ole hakusärmiä', () => {
  it('tarinan suhteet, tulkinnat, polut ja tapahtumien linkit eivät muuta tulosta', () => {
    // MATTI = 62884, HANNA = 42662 kaukana toisistaan: mikään sääntö ei yhdistä niitä
    const digits = plant(200000, [
      [1000, '62884'],
      [150000, '42662'],
    ]);
    const src = piSource(digits, 'synteettinen');
    const q = query([name('lähtö', 'MATTI'), name('tavoite', 'HANNA')], 'Matti ja Hanna eivät ole yhdessä', 'Matti ja Hanna ovat yhdessä');
    const story = createSeedStory();
    const linked: StoryModel = {
      ...story,
      relations: [
        ...story.relations,
        { id: 'r-mh', from: 'matti', to: 'hanna-3', kind: 'puoliso', note: 'symbolinen', source: 'käyttäjä' },
      ],
      glosses: [
        ...story.glosses,
        {
          id: 'g-x',
          symbol: '62884',
          meanings: ['HANNA'],
          context: { kind: 'tarina' },
          personId: 'hanna-3',
          name: 'HANNA',
          note: '',
          source: 'käyttäjä',
          createdAt: '2026-10-17T00:00:00.000Z',
        },
      ],
    };
    const ctxLinked: IdentifierContext = {
      story: linked,
      events: [{ id: 'e1', title: 'Tapaaminen', date: '2020-01-01', personIds: ['matti', 'hanna-3'] }],
    };
    for (const mode of MODES) {
      const plain = searchPaths(q, P(), mode, src, CTX);
      const withLinks = searchPaths(q, P(), mode, src, ctxLinked);
      expect(plain.status).toBe('ei-löytynyt');
      expect(stable(withLinks)).toEqual(stable(plain));
    }
  });

  it('jokainen reitin askel on PATH_RULES-säännön tulos (seed-tarina, synteettinen aineisto)', () => {
    const digits = randomPlanted(99, ['62884', '42662', '72552', '432'], 15, 30000);
    const src = piSource(digits, 'synteettinen');
    const ctx: IdentifierContext = { story: createSeedStory(), events: [] };
    const q = query([name('lähtö', 'MATTI'), name('lähtö', 'HANNA'), name('tavoite', 'SALLA'), name('tavoite', 'IDA')]);
    for (const mode of MODES) {
      const o = searchPaths(q, P({ use369: true }), mode, src, ctx);
      expectWellFormed(o, digits);
      for (const r of o.routes) for (const s of r.steps) expect(['pi-indeksi', 'spiraali', 'oktaedri']).toContain(s.domain);
    }
  });
});

// ------------------------------------------------------------------ determinismi, kanonisointi, lähteet

describe('determinismi ja kanonisointi', () => {
  const digits = randomPlanted(5, ['111', '222', '333'], 20, 5000);
  const src = piSource(digits, 'synteettinen');
  const ids = [num('lähtö', '111'), num('tavoite', '222'), num('tunnettu', '333')];

  it('sama syöte → sama tulos ja sama sormenjälki', () => {
    for (const mode of MODES) {
      const a = searchPaths(query(ids), P({ use369: true }), mode, src, CTX);
      const b = searchPaths(query(ids), P({ use369: true }), mode, piSource(digits, 'synteettinen'), CTX);
      expect(stable(b)).toEqual(stable(a));
      expect(a.resultFingerprint).toMatch(/^[0-9a-f]{8}$/);
      expect(a.version).toBe(PATH_VERSION);
    }
  });

  it('tunnisteiden järjestys ja symboliset tekstit eivät vaikuta koodeihin eivätkä reitteihin', () => {
    const a = searchPaths(query(ids, 'a', 'b'), P(), 'kaksisuuntainen', src, CTX);
    const b = searchPaths(query([...ids].reverse(), 'toinen teksti', 'kolmas'), P(), 'kaksisuuntainen', src, CTX);
    expect(b.routes).toEqual(a.routes);
    expect(b.resultFingerprint).toBe(a.resultFingerprint);
    const ca = JSON.parse(a.canonical);
    const cb = JSON.parse(b.canonical);
    expect(cb.koodit).toEqual(ca.koodit);
    expect(cb.parametrit).toEqual(ca.parametrit);
    expect(cb.symbolinen.lähtöteksti).toBe('toinen teksti');
  });

  it('kanoninen kysely: koodit rooleittain järjestettyinä, säännöt, parametrit, tila ja versio', () => {
    const q = query([name('tavoite', 'SALLA'), name('lähtö', 'MATTI'), name('lähtö', 'HANNA'), name('tavoite', 'IDA')], 'alku', 'loppu');
    const c = JSON.parse(canonicalQuery(q, P({ rules: ['oktaedri-lähin', 'indeksi-seuraava'] }), '432'));
    expect(c.versio).toBe(PATH_VERSION);
    expect(c.tila).toBe('432');
    expect(c.koodit).toEqual({ lähtö: ['42662', '62884'], tavoite: ['432', '72552'], tunnettu: [] });
    expect(c.parametrit.rules).toEqual(['indeksi-seuraava', 'oktaedri-lähin']);
    expect(c.symbolinen.lähtöteksti).toBe('alku');
    expect(c.symbolinen.huomautus).toContain('ei vaikuta hakuun');
    // sääntöjen järjestys parametreissa ei vaikuta; use369 lisää 369-säännöt
    expect(canonicalQuery(q, P({ rules: ['indeksi-seuraava', 'oktaedri-lähin'] }), '432')).toBe(
      canonicalQuery(q, P({ rules: ['oktaedri-lähin', 'indeksi-seuraava'] }), '432'),
    );
    expect(JSON.parse(canonicalQuery(q, P({ use369: true }), '432')).parametrit.rules).toHaveLength(6);
    expect(canonicalQuery(q, P(), '234')).not.toBe(canonicalQuery(q, P(), '432'));
    expect(canonicalQuery(q, P({ maxEdges: 5 }), '234')).not.toBe(canonicalQuery(q, P(), '234'));
  });

  it('stableStringify ja fnv1a', () => {
    expect(stableStringify({ b: 1, a: [2, { d: 1, c: null }] })).toBe('{"a":[2,{"c":null,"d":1}],"b":1}');
    expect(fnv1a('')).toBe('811c9dc5');
    expect(fnv1a('a')).toBe('e40c292c');
    expect(fnv1a('ä')).toBe(fnv1a('ä'));
    expect(fnv1a('ä')).not.toBe(fnv1a('a'));
  });
});

describe('osumalähteet', () => {
  it('piSource: codeHits ja tarkistettavat numerot', () => {
    const s = piSource(FIXTURE_DIGITS, 'fixture');
    expect(s).toMatchObject({ kind: 'pii', N: 2000, label: 'fixture' });
    expect(Array.from(s.hitsOf('592'))).toEqual(Array.from(codeHits(FIXTURE_DIGITS, '592')));
    expect(s.hitsOf('x').length).toBe(0);
  });

  it('uniformSource: osumamäärät säilyvät, paikat 1 … N − L + 1, deterministinen, koodien järjestys ei vaikuta', () => {
    const spec = [
      { code: '432', count: 50 },
      { code: '62884', count: 9 },
      { code: '42', count: 300 },
    ];
    const a = uniformSource(spec, 1000, 7, 'tasajakauma 7');
    const b = uniformSource([...spec].reverse(), 1000, 7, 'tasajakauma 7');
    const c = uniformSource(spec, 1000, 8, 'tasajakauma 8');
    expect(a).toMatchObject({ kind: 'tasajakauma', N: 1000, digits: null });
    for (const { code, count } of spec) {
      const h = Array.from(a.hitsOf(code));
      expect(h).toHaveLength(count);
      expect(new Set(h).size).toBe(count);
      expect(h).toEqual([...h].sort((x, y) => x - y));
      expect(Math.min(...h)).toBeGreaterThanOrEqual(1);
      expect(Math.max(...h)).toBeLessThanOrEqual(1000 - code.length + 1);
      expect(Array.from(b.hitsOf(code))).toEqual(h);
    }
    expect(Array.from(c.hitsOf('432'))).not.toEqual(Array.from(a.hitsOf('432')));
    expect(a.hitsOf('999').length).toBe(0);
    // määrä rajataan alkukohtien määrään
    expect(uniformSource([{ code: '12345', count: 10 }], 7, 1, 't').hitsOf('12345').length).toBe(3);
  });

  it('randomStringSource: siemenellinen jono, findAll-osumat tarkistettavissa', () => {
    const a = randomStringSource(20000, 42, 'satunnaisjono 42');
    const b = randomStringSource(20000, 42, 'satunnaisjono 42');
    expect(a.kind).toBe('satunnaisjono');
    expect(a.digits).toBe(b.digits);
    const h = a.hitsOf('432');
    expect(h).toBe(a.hitsOf('432')); // välimuisti
    expect(Array.from(h)).toEqual(Array.from(b.hitsOf('432')));
    for (const n of h) expect(verifyHit(a.digits!, '432', n)).toBe(true);
  });

  it('haku nollamalleissa: tasajakaumassa ei tarkistusta (verified = null), satunnaisjonossa tarkistetaan', () => {
    const ids = [num('lähtö', '432'), num('tavoite', '629')];
    const u = uniformSource(
      [
        { code: '432', count: 60 },
        { code: '629', count: 60 },
      ],
      50000,
      3,
      'tasajakauma',
    );
    const ou = searchPaths(query(ids), P(), 'kaksisuuntainen', u, CTX);
    expect(ou.sourceLabel).toBe('tasajakauma');
    expect(ou.status).toBe('löytyi');
    expectWellFormed(ou, null);
    const r = randomStringSource(50000, 3, 'satunnaisjono');
    const or = searchPaths(query(ids), P(), 'kaksisuuntainen', r, CTX);
    expect(or.status).toBe('löytyi');
    expectWellFormed(or, r.digits);
  });
});

// ------------------------------------------------------------------ moottori

describe('moottori: pathSearch', () => {
  it('handleRequest palauttaa saman tuloksen kuin searchPaths π-aineistosta', async () => {
    const state = { digits: FIXTURE_DIGITS };
    // 592 @4 ja 653 @7: "1415926535…"
    const q = query([num('lähtö', '592'), num('tavoite', '653')]);
    const out = (await handleRequest(state, { type: 'pathSearch', query: q, params: P(), mode: 'kaksisuuntainen', ctx: CTX })) as SearchOutcome;
    const direct = searchPaths(q, P(), 'kaksisuuntainen', piSource(FIXTURE_DIGITS, out.sourceLabel), CTX);
    expect(out.sourceLabel).toBe(`π-desimaalit (N = 2${T}000)`);
    expect(stable(out)).toEqual(stable(direct));
    expect(out.status).toBe('löytyi');
    expect(out.routes[0].key).toBe('592@4>653@7');
    expectWellFormed(out, FIXTURE_DIGITS);
    const none = (await handleRequest({ digits: '' }, { type: 'pathSearch', query: q, params: P(), mode: '234', ctx: CTX })) as SearchOutcome;
    expect(none.status).toBe('virhe');
  });
});

// ------------------------------------------------------------------ täysi aineisto

describe.skipIf(!HAS_FULL)('täysi 1M-aineisto', () => {
  const digits = FULL!;
  const src = piSource(digits, 'pi_digits_1m.txt');
  const ctx: IdentifierContext = { story: createSeedStory(), events: [] };
  const q = query([name('lähtö', 'MATTI'), name('lähtö', 'HANNA'), name('tavoite', 'SALLA'), name('tavoite', 'IDA')], 'Matti ja Hanna', 'Salla ja Ida');

  it('tunnetut osumamäärät sanastossa', () => {
    const o = searchPaths(q, P(), 'kaksisuuntainen', src, ctx);
    const hits = Object.fromEntries(o.vocabulary.map((v) => [v.labels[0], v.hits]));
    expect(hits).toEqual({ MATTI: 9, HANNA: 7, SALLA: 6, IDA: 1054 });
    expect(Array.from(codeHits(digits, '432'))).toContain(858511);
    expect(Array.from(codeHits(digits, '62884'))).toContain(858260);
    expect(Array.from(codeHits(digits, '42662'))).toContain(858610);
    expect(Array.from(codeHits(digits, '72552'))).toContain(856712);
  });

  it('{MATTI, HANNA} → {SALLA, IDA}, oletusparametrit, kaksisuuntainen: jokainen solmu tarkistettu', () => {
    const o = searchPaths(q, P(), 'kaksisuuntainen', src, ctx);
    expect(o.status).toBe('löytyi');
    expect(o.routes).toHaveLength(DEFAULT_PATH_PARAMS.maxRoutes);
    expectWellFormed(o, digits);
    // paras: MATTI @858 260 → IDA @858 511 (seuraava 432-osuma, Δn = 251)
    expect(o.routes[0].key).toBe('62884@858260>432@858511');
    expect(o.routes[0].steps[0].formula).toBe(`858${T}511 = lähin 432-osuma > 858${T}260 (Δn = 251 ≤ W = 2${T}000)`);
    expect(o.ms).toBeLessThan(1500);
  });

  it('kaikki tilat ja 369 + tunnetut MAX ja MINI: tarkistetut solmut, kaksisuuntainen ≤ 234 ja 432, alle 1,5 s', () => {
    const q2 = query([...q.identifiers, name('tunnettu', 'MAX'), name('tunnettu', 'MINI')]);
    for (const use369 of [false, true]) {
      const got: Record<string, number | null> = {};
      for (const mode of MODES) {
        const o = searchPaths(q2, P({ use369 }), mode, src, ctx);
        expect(o.status).toBe('löytyi');
        expectWellFormed(o, digits);
        expect(o.ms).toBeLessThan(1500);
        got[mode] = bestCost(o);
      }
      expect(got.kaksisuuntainen!).toBeLessThanOrEqual(got['234']!);
      expect(got.kaksisuuntainen!).toBeLessThanOrEqual(got['432']!);
    }
    const vocab = searchPaths(q2, P(), '234', src, ctx).vocabulary;
    expect(Object.fromEntries(vocab.map((v) => [v.labels[0], v.hits]))).toMatchObject({ MAX: 1040, MINI: 108 });
  });

  it('harvinaiset koodit: MATTI → SALLA ilman välisolmuja ei löydy, ja syy kerrotaan', () => {
    const o = searchPaths(query([name('lähtö', 'MATTI'), name('tavoite', 'SALLA')]), P(), 'kaksisuuntainen', src, ctx);
    expect(o.status).toBe('ei-löytynyt');
    expect(o.reasons.join('\n')).toContain('Rintamat eivät kohdanneet 6 askeleen sisällä');
  });
});
