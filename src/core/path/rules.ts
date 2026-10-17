// Path Discovery: säännöt (särmät) ja sanastograafi. Määrittely: docs/POLKUHAKU.md §2–3.
//
// Solmu on sanaston koodin osuma (koodi, n). Särmiä syntyy VAIN tämän tiedoston säännöistä, jotka lasketaan
// osumien sijainneista. Tarinan suhteet, tulkinnat ja tapahtumien linkit eivät ole tässä mukana lainkaan, joten ne
// eivät voi koskaan toimia oikoteinä.
//
// Suunta 234 = lähtöpuolen haku (eteenpäin), 432 = tavoitepuolen haku (taaksepäin). 432-säännöt ovat 234-sääntöjen
// peilikuvia (esim. "lähin osuma ennen"), eivät välttämättä niiden käänteisiä särmiä: indeksi-seuraava, oktaedri-lähin
// ja 369-mod9 eivät ole symmetrisiä (ks. reverseConsistent).

import { FIB } from '../fibonacci';
import { chordDistance, mapIndex } from '../mapping';
import { FIB_3K, fmtInt, STEPS_369 } from '../matrix/ops369';
import { lowerBound } from '../search';
import type { PathParams, PathRuleDef, PathRuleId } from './types';

export type PathSide = '234' | '432';

/** Sääntöjen kiinteä järjestys (ehdokkaiden järjestys, kanonisointi). */
export const RULE_ORDER: readonly PathRuleId[] = [
  'indeksi-seuraava',
  'fib-naapuri',
  'oktaedri-lähin',
  '369-siirtymä',
  '369-fib3k',
  '369-mod9',
];

/** Säännöt ja kaavat täsmälleen kuten docs/POLKUHAKU.md §3. */
export const PATH_RULES: Record<PathRuleId, PathRuleDef> = {
  'indeksi-seuraava': {
    id: 'indeksi-seuraava',
    title: 'Seuraava osuma (π-indeksi)',
    formula: '234: jokaisen sanastokoodin lähin osuma n′ > n, n′ − n ≤ W · 432: lähin osuma n′ < n, n − n′ ≤ W',
    layer: 'matemaattinen',
    domain: 'pi-indeksi',
    undirected: false,
    is369: false,
  },
  'fib-naapuri': {
    id: 'fib-naapuri',
    title: 'Fibonacci-naapuri (spiraali)',
    formula: '234: n + F_k, k ∈ [kMin, kMax], jos kohdasta alkaa sanastokoodin osuma · 432: n − F_k',
    layer: 'geometrinen',
    domain: 'spiraali',
    undirected: false,
    is369: false,
  },
  'oktaedri-lähin': {
    id: 'oktaedri-lähin',
    title: 'Oktaedrin lähin (chord)',
    formula: 'nearestK lähintä sanastokoodin osumaa, chord ≤ chordMax (suuntaa ei ole) · 432: sama',
    layer: 'geometrinen',
    domain: 'oktaedri',
    undirected: true,
    is369: false,
  },
  '369-siirtymä': {
    id: '369-siirtymä',
    title: '369 · siirtymä 3 · 6 · 9',
    formula: '234: n + k, k ∈ {3, 6, 9} · 432: n − k',
    layer: 'matemaattinen',
    domain: 'pi-indeksi',
    undirected: false,
    is369: true,
  },
  '369-fib3k': {
    id: '369-fib3k',
    title: '369 · Fibonacci F₃ₖ',
    formula: '234: n + F_{3k}, k = 1…7 · 432: n − F_{3k}',
    layer: 'geometrinen',
    domain: 'spiraali',
    undirected: false,
    is369: true,
  },
  '369-mod9': {
    id: '369-mod9',
    title: '369 · mod 9',
    formula: '234: lähin osuma n′ > n, (n′ − n) ≡ 0 (mod 9), n′ − n ≤ 9W · 432: vastaavasti n′ < n',
    layer: 'matemaattinen',
    domain: 'pi-indeksi',
    undirected: false,
    is369: true,
  },
};

/** Askeleen hinta: perussääntö 1, 369-askel 1 + 1 (muunnos). */
export function ruleCost(rule: PathRuleId): number {
  return PATH_RULES[rule].is369 ? 2 : 1;
}

/**
 * Käytössä olevat säännöt kiinteässä järjestyksessä: params.rules:n perussäännöt ja, vain kun use369 = true,
 * kaikki kolme 369-sääntöä. 369-tunnus params.rules-listassa ei yksin aktivoi sääntöä.
 */
export function activeRules(params: Pick<PathParams, 'rules' | 'use369'>): PathRuleDef[] {
  const wanted = new Set(params.rules);
  return RULE_ORDER.filter((id) => (PATH_RULES[id].is369 ? params.use369 : wanted.has(id))).map((id) => PATH_RULES[id]);
}

/**
 * Säännöt, joiden 432-särmät ovat täsmälleen 234-särmien käänteiset (u → v 234:ssä ⇔ v → u 432:ssa):
 * fib-naapuri, 369-siirtymä ja 369-fib3k. indeksi-seuraava ("lähin seuraava" vs. "lähin edellinen"), oktaedri-lähin
 * (k lähintä ei ole symmetrinen) ja 369-mod9 eivät ole.
 */
export const REVERSE_CONSISTENT_RULES: ReadonlySet<PathRuleId> = new Set<PathRuleId>(['fib-naapuri', '369-siirtymä', '369-fib3k']);

export function reverseConsistent(rules: readonly PathRuleDef[]): boolean {
  return rules.every((r) => REVERSE_CONSISTENT_RULES.has(r.id));
}

// ------------------------------------------------------------------ graafi

interface Mod9Class {
  hits: Int32Array;
  nodes: Int32Array;
}

interface GeoIndex {
  cell: number;
  g: number;
  xyz: Float64Array;
  cells: Map<number, number[]>;
}

/** Sanaston osumat solmuina ja hakurakenteet sääntöjä varten. Solmut järjestyksessä (n, koodin indeksi). */
export interface PathGraph {
  N: number;
  params: PathParams;
  /** Käytössä olevat säännöt (activeRules). */
  rules: PathRuleDef[];
  /** Sanaston koodit (solmuina käytetyt). */
  codes: string[];
  /** hits[c] = koodin c osumat nousevassa järjestyksessä. */
  hits: Int32Array[];
  /** hitNode[c][i] = koodin c osuman i solmutunnus. */
  hitNode: Int32Array[];
  nodeN: Int32Array;
  nodeCode: Int32Array;
  size: number;
  /** Kohta n → ensimmäinen solmu, joka alkaa kohdasta n (O(1): alkaako sanastokoodin osuma kohdasta p?). */
  startAt: Map<number, number>;
  /** fib-naapuri: (k, F_k), k ∈ [max(2, kMin), kMax], F_k ≤ N. */
  fibSteps: { k: number; F: number }[];
  /** 369-mod9: koodin osumat jäännösluokittain n mod 9. null, jos sääntö ei ole käytössä. */
  mod9: Mod9Class[][] | null;
  /** oktaedri-lähin: 3D-ruudukko (solun koko ≥ chordMax). null, jos sääntö ei ole käytössä. */
  geo: GeoIndex | null;
}

const GEO_MIN = -1.000001;
const GEO_SPAN = 2.000002;

function geoCellKey(geo: GeoIndex, x: number, y: number, z: number): [number, number, number] {
  const ax = (v: number) => {
    const k = Math.floor((v - GEO_MIN) / geo.cell);
    return k < 0 ? 0 : k >= geo.g ? geo.g - 1 : k;
  };
  return [ax(x), ax(y), ax(z)];
}

function buildGeo(nodeN: Int32Array, chordMax: number): GeoIndex {
  // Solun koko ≥ chordMax, joten säteen chordMax pallo mahtuu 3 × 3 × 3 solun alueelle. Alaraja pitää avaimet < 2^30.
  const cell = Math.max(chordMax, GEO_SPAN / 1024);
  const g = Math.max(1, Math.ceil(GEO_SPAN / cell));
  const geo: GeoIndex = { cell, g, xyz: new Float64Array(nodeN.length * 3), cells: new Map() };
  for (let i = 0; i < nodeN.length; i++) {
    const p = mapIndex(nodeN[i]);
    geo.xyz[3 * i] = p.x;
    geo.xyz[3 * i + 1] = p.y;
    geo.xyz[3 * i + 2] = p.z;
    const [cx, cy, cz] = geoCellKey(geo, p.x, p.y, p.z);
    const key = cx + g * (cy + g * cz);
    const list = geo.cells.get(key);
    if (list) list.push(i);
    else geo.cells.set(key, [i]);
  }
  return geo;
}

/**
 * Rakentaa graafin sanaston koodeista. hitsOf palauttaa koodin osumat nousevassa järjestyksessä (1-pohjaiset
 * alkukohdat). Sama koodi useasti → käytetään kerran.
 */
export function buildGraph(codes: readonly string[], hitsOf: (code: string) => Int32Array, N: number, params: PathParams): PathGraph {
  const uniq: string[] = [];
  for (const c of codes) if (!uniq.includes(c)) uniq.push(c);
  const hits = uniq.map((c) => hitsOf(c));
  let size = 0;
  for (const h of hits) size += h.length;
  // k-tie-yhdistäminen järjestykseen (n, koodin indeksi)
  const nodeN = new Int32Array(size);
  const nodeCode = new Int32Array(size);
  const hitNode = hits.map((h) => new Int32Array(h.length));
  const head = new Int32Array(hits.length);
  for (let t = 0; t < size; t++) {
    let bc = -1;
    let bv = Number.POSITIVE_INFINITY;
    for (let c = 0; c < hits.length; c++) {
      if (head[c] < hits[c].length && hits[c][head[c]] < bv) {
        bv = hits[c][head[c]];
        bc = c;
      }
    }
    nodeN[t] = bv;
    nodeCode[t] = bc;
    hitNode[bc][head[bc]++] = t;
  }
  const startAt = new Map<number, number>();
  for (let t = size - 1; t >= 0; t--) startAt.set(nodeN[t], t);

  const rules = activeRules(params);
  const has = (id: PathRuleId) => rules.some((r) => r.id === id);

  const fibSteps: { k: number; F: number }[] = [];
  let lastF = -1;
  for (let k = Math.max(2, Math.floor(params.fibKMin)); k <= params.fibKMax && k < FIB.length; k++) {
    const F = FIB[k];
    if (F === lastF || F > N) continue;
    lastF = F;
    fibSteps.push({ k, F });
  }

  let mod9: Mod9Class[][] | null = null;
  if (has('369-mod9')) {
    mod9 = hits.map((h, c) => {
      const buckets: number[][] = Array.from({ length: 9 }, () => []);
      const nodes: number[][] = Array.from({ length: 9 }, () => []);
      for (let i = 0; i < h.length; i++) {
        buckets[h[i] % 9].push(h[i]);
        nodes[h[i] % 9].push(hitNode[c][i]);
      }
      return buckets.map((b, r) => ({ hits: Int32Array.from(b), nodes: Int32Array.from(nodes[r]) }));
    });
  }

  const geo = has('oktaedri-lähin') && params.nearestK >= 1 && params.chordMax >= 0 && size > 0 ? buildGeo(nodeN, params.chordMax) : null;

  return { N, params, rules, codes: uniq, hits, hitNode, nodeN, nodeCode, size, startAt, fibSteps, mod9, geo };
}

/** Solmun tunnus (koodi, n) tai −1, jos sellaista solmua ei ole. */
export function nodeId(graph: PathGraph, code: string, n: number): number {
  const c = graph.codes.indexOf(code);
  if (c < 0) return -1;
  const i = lowerBound(graph.hits[c], n);
  return i < graph.hits[c].length && graph.hits[c][i] === n ? graph.hitNode[c][i] : -1;
}

/** Solmun avain "koodi@n". */
export function nodeKeyOf(graph: PathGraph, node: number): string {
  return `${graph.codes[graph.nodeCode[node]]}@${graph.nodeN[node]}`;
}

// ------------------------------------------------------------------ naapurit (raaka)

/** Raaka ehdokas: sääntö, kohdesolmu ja säännön parametri (k, askel tai sija). */
export type NeighbourSink = (rule: PathRuleId, to: number, param: number) => void;

function emitAt(graph: PathGraph, p: number, rule: PathRuleId, param: number, sink: NeighbourSink): number {
  const first = graph.startAt.get(p);
  if (first === undefined) return 0;
  let c = 0;
  // Useampi sanastokoodi samassa kohdassa → yksi ehdokas koodia kohden.
  for (let t = first; t < graph.size && graph.nodeN[t] === p; t++) {
    sink(rule, t, param);
    c++;
  }
  return c;
}

function nearestOcta(graph: PathGraph, node: number): { to: number; rank: number; chord: number }[] {
  const geo = graph.geo;
  if (!geo) return [];
  const { chordMax, nearestK } = graph.params;
  const x = geo.xyz[3 * node];
  const y = geo.xyz[3 * node + 1];
  const z = geo.xyz[3 * node + 2];
  const [cx, cy, cz] = geoCellKey(geo, x, y, z);
  const found: { j: number; d: number }[] = [];
  const n0 = graph.nodeN[node];
  for (let dz = -1; dz <= 1; dz++) {
    const zz = cz + dz;
    if (zz < 0 || zz >= geo.g) continue;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = cy + dy;
      if (yy < 0 || yy >= geo.g) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = cx + dx;
        if (xx < 0 || xx >= geo.g) continue;
        const list = geo.cells.get(xx + geo.g * (yy + geo.g * zz));
        if (!list) continue;
        for (const j of list) {
          // Sama kohta (oma solmu tai toinen koodi samassa kohdassa) ei ole geometrinen naapuri.
          if (graph.nodeN[j] === n0) continue;
          const d = chordDistance({ x, y, z }, { x: geo.xyz[3 * j], y: geo.xyz[3 * j + 1], z: geo.xyz[3 * j + 2] });
          if (d <= chordMax) found.push({ j, d });
        }
      }
    }
  }
  // Järjestys (chord, n, koodi); solmutunnusten järjestys on (n, koodi).
  found.sort((a, b) => a.d - b.d || a.j - b.j);
  const out: { to: number; rank: number; chord: number }[] = [];
  let rank = 0;
  let lastN = -1;
  for (const f of found) {
    const n = graph.nodeN[f.j];
    if (n !== lastN) {
      rank++;
      lastN = n;
      if (rank > nearestK) break;
    }
    out.push({ to: f.j, rank, chord: f.d });
  }
  return out;
}

/**
 * Kaikki ehdokkaat solmusta annetulle puolelle, sääntöjen kiinteässä järjestyksessä. Palauttaa ehdokkaiden määrän
 * (haarautuminen). Haku käyttää tätä; neighbours() lisää kaavat ja mittarit.
 */
export function forEachNeighbour(graph: PathGraph, node: number, side: PathSide, sink: NeighbourSink): number {
  const n = graph.nodeN[node];
  const p = graph.params;
  const fwd = side === '234';
  let count = 0;
  for (const rule of graph.rules) {
    switch (rule.id) {
      case 'indeksi-seuraava': {
        for (let c = 0; c < graph.codes.length; c++) {
          const h = graph.hits[c];
          if (fwd) {
            const i = lowerBound(h, n + 1);
            if (i < h.length && h[i] - n <= p.indexWindow) {
              sink(rule.id, graph.hitNode[c][i], 0);
              count++;
            }
          } else {
            const i = lowerBound(h, n) - 1;
            if (i >= 0 && n - h[i] <= p.indexWindow) {
              sink(rule.id, graph.hitNode[c][i], 0);
              count++;
            }
          }
        }
        break;
      }
      case 'fib-naapuri':
        for (const { k, F } of graph.fibSteps) count += emitAt(graph, fwd ? n + F : n - F, rule.id, k, sink);
        break;
      case 'oktaedri-lähin':
        for (const o of nearestOcta(graph, node)) {
          sink(rule.id, o.to, o.rank);
          count++;
        }
        break;
      case '369-siirtymä':
        for (const k of STEPS_369) count += emitAt(graph, fwd ? n + k : n - k, rule.id, k, sink);
        break;
      case '369-fib3k':
        for (const { k, F } of FIB_3K) count += emitAt(graph, fwd ? n + F : n - F, rule.id, k, sink);
        break;
      case '369-mod9': {
        if (!graph.mod9) break;
        const r = n % 9;
        const lim = 9 * p.indexWindow;
        for (let c = 0; c < graph.codes.length; c++) {
          const cls = graph.mod9[c][r];
          if (fwd) {
            const i = lowerBound(cls.hits, n + 1);
            if (i < cls.hits.length && cls.hits[i] - n <= lim) {
              sink(rule.id, cls.nodes[i], 0);
              count++;
            }
          } else {
            const i = lowerBound(cls.hits, n) - 1;
            if (i >= 0 && n - cls.hits[i] <= lim) {
              sink(rule.id, cls.nodes[i], 0);
              count++;
            }
          }
        }
        break;
      }
    }
  }
  return count;
}

// ------------------------------------------------------------------ ehdokkaat kaavoineen

export interface Candidate {
  rule: PathRuleId;
  side: PathSide;
  /** Laajennettava solmu ja kohdesolmu (graafin tunnukset). */
  from: number;
  to: number;
  code: string;
  n: number;
  /** Instansioitu kaava laajennettavasta solmusta katsottuna, esim. "858 511 + F18 (2 584) = 861 095". */
  formula: string;
  /** to.n − from.n hakusuunnassa (432-puolella yleensä negatiivinen). */
  delta: number;
  metrics: Record<string, number | string>;
  /** 369-askel = muunnos. */
  transform: boolean;
  /** 1 tai 2 (369). */
  cost: number;
  /** Säännön parametri: fib k, 369-askel k, oktaedrin sija; muuten 0. */
  param: number;
}

const fmtChord = (x: number): string => x.toFixed(6).replace('.', ',');
const fmtNum = (x: number): string => String(x).replace('.', ',');
const signed = (d: number): string => (d > 0 ? '+' : d < 0 ? '−' : '±') + fmtInt(Math.abs(d));

/**
 * Yhden särmän kuvaus: kaava, Δn ja mittarit. `from` on laajennettava solmu, `side` haun puoli. 432-puolen kaava
 * kuvaa säännön sellaisena kuin se laskettiin tavoitepuolelta (esim. "x on y:n lähin osuma ennen").
 */
export function describeEdge(graph: PathGraph, from: number, side: PathSide, rule: PathRuleId, to: number, param: number): Candidate {
  const n = graph.nodeN[from];
  const m = graph.nodeN[to];
  const code = graph.codes[graph.nodeCode[to]];
  const delta = m - n;
  const fwd = side === '234';
  const sign = fwd ? '+' : '−';
  const W = graph.params.indexWindow;
  let formula: string;
  let metrics: Record<string, number | string>;
  switch (rule) {
    case 'indeksi-seuraava':
      formula = fwd
        ? `${fmtInt(m)} = lähin ${code}-osuma > ${fmtInt(n)} (Δn = ${fmtInt(delta)} ≤ W = ${fmtInt(W)})`
        : `${fmtInt(m)} = lähin ${code}-osuma < ${fmtInt(n)} (n − n′ = ${fmtInt(-delta)} ≤ W = ${fmtInt(W)})`;
      metrics = { 'Δn': delta, W };
      break;
    case 'fib-naapuri':
    case '369-fib3k': {
      const F = FIB[param];
      formula = `${fmtInt(n)} ${sign} F${param} (${fmtInt(F)}) = ${fmtInt(m)}`;
      metrics = { 'Δn': delta, k: param, F };
      break;
    }
    case 'oktaedri-lähin': {
      const geo = graph.geo;
      const chord = geo
        ? chordDistance(
            { x: geo.xyz[3 * from], y: geo.xyz[3 * from + 1], z: geo.xyz[3 * from + 2] },
            { x: geo.xyz[3 * to], y: geo.xyz[3 * to + 1], z: geo.xyz[3 * to + 2] },
          )
        : chordDistance(mapIndex(n), mapIndex(m));
      formula =
        `chord(${fmtInt(n)}, ${fmtInt(m)}) = ${fmtChord(chord)} ≤ ${fmtNum(graph.params.chordMax)} · ` +
        `${param}. lähin kohta (k = ${graph.params.nearestK}), Δn = ${signed(delta)}`;
      metrics = { 'Δn': delta, chord: Number(chord.toFixed(6)), sija: param, k: graph.params.nearestK };
      break;
    }
    case '369-siirtymä':
      formula = `${fmtInt(n)} ${sign} ${param} = ${fmtInt(m)}`;
      metrics = { 'Δn': delta, k: param };
      break;
    case '369-mod9': {
      const d = Math.abs(delta);
      formula =
        `${fmtInt(m)} = lähin ${code}-osuma ${fwd ? '>' : '<'} ${fmtInt(n)}, jolle Δn ≡ 0 (mod 9): ` +
        `${fmtInt(d)} = 9 · ${fmtInt(d / 9)} ≤ 9W = ${fmtInt(9 * W)}`;
      metrics = { 'Δn': delta, 'Δn mod 9': 0, '9W': 9 * W };
      break;
    }
  }
  const def = PATH_RULES[rule];
  return { rule, side, from, to, code, n: m, formula, delta, metrics, transform: def.is369, cost: ruleCost(rule), param };
}

/**
 * Solmun naapurit annetulle puolelle kaavoineen. node = graafin solmutunnus tai { code, n } (solmun on oltava
 * sanaston osuma). Jokainen ehdokas on jonkin PATH_RULES-säännön tulos.
 */
export function neighbours(node: number | { code: string; n: number }, side: PathSide, graph: PathGraph): Candidate[] {
  const id = typeof node === 'number' ? node : nodeId(graph, node.code, node.n);
  if (id < 0 || id >= graph.size) return [];
  const out: Candidate[] = [];
  forEachNeighbour(graph, id, side, (rule, to, param) => out.push(describeEdge(graph, id, side, rule, to, param)));
  return out;
}
