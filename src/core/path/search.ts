// Path Discovery: reitinhaku (234, 432, kaksisuuntainen). Määrittely: docs/POLKUHAKU.md §2–4.
//
// Haku on puhdas ja deterministinen: sama kysely, parametrit, tila ja osumalähde → sama tulos ja sama sormenjälki
// (paitsi ms). Särmät tulevat vain säännöistä (rules.ts). Tarinan suhteita, tulkintoja ja tapahtumien linkkejä ei
// lueta lainkaan: IdentifierContext-oliota käytetään vain aikarajaukseen (tapahtumien päivämäärät).
//
// Toteutus: nimiöhaku (label-setting) kummallekin puolelle. Nimiön kustannus on (hinta, muunnokset, Σ|Δn|)
// leksikografisesti; hinta = askeleet + 369-askeleet. Samassa solmussa säilytetään nimiöt, joita mikään toinen ei
// dominoi (pienempi tai yhtä suuri kustannus ja enintään yhtä monta askelta), jotta maxEdges-raja ei hävitä
// halvempia reittejä. Lähtö- ja tavoitesolmut ovat lähdenimiöitä (hinta 0). Reitti syntyy, kun saman solmun
// nimiöt kummaltakin puolelta kohtaavat:
//  - 234: vain lähtöpuoli laajenee; tavoitesolmujen lähdenimiöt odottavat (reitti päättyy tavoitesolmuun)
//  - 432: vain tavoitepuoli laajenee 432-säännöillä; reitti käännetään luettavaksi lähtö → tavoite
//  - kaksisuuntainen: pienempi rintama laajenee ensin (ks. pysäytys alla: epäsymmetrisillä säännöillä pienemmän
//    rintamahinnan puoli ensin); reitti = lähtöpuolen polku + tavoitepuolen polku käännettynä
// Pysäytys: k = maxRoutes parasta reittiä on vahvistettu, kun k:nnen reitin hinta < LB, missä LB on alaraja
// jokaiselle vielä löytymättömälle reitille:
//  - 234: top₂₃₄ + 1, 432: top₄₃₂ + 1 (top = rintaman pienin hinta)
//  - kaksisuuntainen, kun kaikki säännöt ovat toistensa käänteisiä (fib-naapuri, 369-siirtymä, 369-fib3k):
//    top₂₃₄ + top₄₃₂ + 1, eli paras kohtaaminen ≤ top₂₃₄ + top₄₃₂ (tavallinen kaksisuuntainen ehto)
//  - kaksisuuntainen muuten: min(top₂₃₄, top₄₃₂) + 1. 432-säännöt ovat 234-sääntöjen peilikuvia eivätkä
//    käänteisiä (esim. "lähin osuma ennen" ≠ "x:n lähin seuraava on y"), joten tavallinen ehto voisi pysäyttää
//    ennen parasta reittiä. Tämä ehto pitää tuloksen tarkkana.
// Budjetti rajaa laajennukset puolta kohden; jos se loppuu, syy kerrotaan.

import { verifyHit } from '../matrix/hits';
import { fmtInt } from '../matrix/ops369';
import type { RunHooks } from '../stats';
import { canonicalQuery, fnv1a } from './canonical';
import type { IdentifierContext } from './identifiers';
import { encodeIdentifier, identifiersForTimeRange, ROLE_ORDER, sameIdentifierSets, sameSetsWarning } from './identifiers';
import type { PathGraph, PathSide } from './rules';
import { buildGraph, describeEdge, forEachNeighbour, nodeKeyOf, PATH_RULES, reverseConsistent, RULE_ORDER, ruleCost } from './rules';
import type {
  EncodedIdentifier,
  HitSource,
  IdentifierRole,
  PathNode,
  PathParams,
  PathQuery,
  PathRoute,
  PathRuleId,
  PathStep,
  SearchFailure,
  SearchMode,
  SearchOutcome,
  SideStats,
} from './types';
import { PATH_VERSION } from './types';

export interface SearchOptions {
  hooks?: RunHooks;
}

/** reachedSample-listan enimmäiskoko. */
export const REACHED_SAMPLE_LIMIT = 200;

const INF = Number.POSITIVE_INFINITY;
const now = (): number => (typeof performance !== 'undefined' ? performance.now() : 0);
const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const MODE_LABEL: Record<SearchMode, string> = {
  '234': '234 (lähtöpuolelta eteenpäin)',
  '432': '432 (tavoitepuolelta taaksepäin)',
  kaksisuuntainen: 'kaksisuuntainen',
};

const SIDE_LABEL: Record<PathSide, string> = { '234': 'lähtöpuolella (234)', '432': 'tavoitepuolella (432)' };

// ------------------------------------------------------------------ parametrit

/** Parametrien tarkistus. Palauttaa virheet suomeksi (tyhjä = kelvolliset). */
export function validatePathParams(p: PathParams): string[] {
  const errors: string[] = [];
  const int = (v: unknown, name: keyof PathParams, min: number) => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min) errors.push(`Parametrin ${name} on oltava kokonaisluku ≥ ${min} (nyt ${String(v)}).`);
  };
  if (!p || typeof p !== 'object') return ['Parametrit puuttuvat.'];
  if (!Array.isArray(p.rules)) errors.push('Parametrin rules on oltava lista sääntöjä.');
  else for (const r of p.rules) if (!RULE_ORDER.includes(r)) errors.push(`Tuntematon sääntö "${String(r)}".`);
  int(p.indexWindow, 'indexWindow', 0);
  int(p.fibKMin, 'fibKMin', 0);
  int(p.fibKMax, 'fibKMax', 0);
  int(p.nearestK, 'nearestK', 0);
  if (typeof p.chordMax !== 'number' || !Number.isFinite(p.chordMax) || p.chordMax < 0) {
    errors.push(`Parametrin chordMax on oltava äärellinen luku ≥ 0 (nyt ${String(p.chordMax)}).`);
  }
  int(p.minCodeLength, 'minCodeLength', 1);
  int(p.maxHitsPerCode, 'maxHitsPerCode', 1);
  int(p.maxEdges, 'maxEdges', 1);
  int(p.budget, 'budget', 1);
  int(p.maxRoutes, 'maxRoutes', 1);
  return errors;
}

// ------------------------------------------------------------------ nimiöt

/** Yhden puolen nimiöt (hakupuu) ja prioriteettijono. */
class Side {
  node: number[] = [];
  cost: number[] = [];
  tr: number[] = [];
  span: number[] = [];
  edges: number[] = [];
  parent: number[] = [];
  rule: number[] = [];
  param: number[] = [];
  root: number[] = [];
  branch: number[] = [];
  dead: boolean[] = [];
  /** 0 = ei jonossa, 1 = jonossa, 2 = laajennettu. */
  state: number[] = [];
  byNode: (number[] | undefined)[];
  heap: number[] = [];
  live = 0;
  expanded = 0;
  maxDepth = 0;
  budgetHit = false;

  constructor(
    readonly dir: PathSide,
    readonly active: boolean,
    size: number,
  ) {
    this.byNode = new Array<number[] | undefined>(size);
  }

  private less(a: number, b: number): boolean {
    const c = this.cost;
    if (c[a] !== c[b]) return c[a] < c[b];
    const t = this.tr;
    if (t[a] !== t[b]) return t[a] < t[b];
    const s = this.span;
    if (s[a] !== s[b]) return s[a] < s[b];
    return a < b;
  }

  push(id: number): void {
    const h = this.heap;
    h.push(id);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(h[i], h[p])) break;
      [h[i], h[p]] = [h[p], h[i]];
      i = p;
    }
    this.state[id] = 1;
    this.live++;
  }

  private popRaw(): number {
    const h = this.heap;
    const top = h[0];
    const last = h.pop()!;
    if (h.length) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < h.length && this.less(h[l], h[m])) m = l;
        if (r < h.length && this.less(h[r], h[m])) m = r;
        if (m === i) break;
        [h[i], h[m]] = [h[m], h[i]];
        i = m;
      }
    }
    return top;
  }

  /** Rintaman pienin hinta (kuolleet nimiöt ohitetaan). ∞, jos rintama on tyhjä. */
  topCost(): number {
    while (this.heap.length && this.dead[this.heap[0]]) this.popRaw();
    return this.heap.length ? this.cost[this.heap[0]] : INF;
  }

  /** Seuraava laajennettava nimiö (topCost() < ∞ on tarkistettu). */
  pop(): number {
    this.topCost();
    const id = this.popRaw();
    this.state[id] = 2;
    this.live--;
    return id;
  }

  kill(id: number): void {
    this.dead[id] = true;
    if (this.state[id] === 1) this.live--;
  }

  isSource(id: number): boolean {
    return this.parent[id] < 0;
  }

  reachedNodes(): number {
    let r = 0;
    for (const l of this.byNode) if (l && l.length) r++;
    return r;
  }
}

/** a ≤ b leksikografisesti (hinta, muunnokset, Σ|Δn|). */
function lexLE(ac: number, at: number, as: number, bc: number, bt: number, bs: number): boolean {
  if (ac !== bc) return ac < bc;
  if (at !== bt) return at < bt;
  return as <= bs;
}

interface Meeting {
  f: number;
  b: number;
  cost: number;
  tr: number;
  span: number;
  edges: number;
  key: string;
  group: string;
  meet: number;
}

function meetingLess(a: Meeting, b: Meeting): boolean {
  if (a.cost !== b.cost) return a.cost < b.cost;
  if (a.tr !== b.tr) return a.tr < b.tr;
  if (a.span !== b.span) return a.span < b.span;
  return a.key < b.key;
}

interface EngineResult {
  fwd: Side;
  bwd: Side;
  top: Meeting[];
  complete: boolean;
  consistent: boolean;
}

/** Nimiöhaku. starts/goals = solmutunnukset nousevassa järjestyksessä. */
function runEngine(
  graph: PathGraph,
  starts: number[],
  goals: number[],
  mode: SearchMode,
  params: PathParams,
  hooks: RunHooks | undefined,
): EngineResult {
  const fwd = new Side('234', mode !== '432', graph.size);
  const bwd = new Side('432', mode !== '234', graph.size);
  const k = params.maxRoutes;
  const maxEdges = params.maxEdges;
  const consistent = reverseConsistent(graph.rules);
  const top: Meeting[] = [];

  const key = (nodes: number[]): string => nodes.map((x) => nodeKeyOf(graph, x)).join('>');

  const tryMeeting = (f: number, b: number): void => {
    const edges = fwd.edges[f] + bwd.edges[b];
    if (edges < 1 || edges > maxEdges) return;
    if (fwd.root[f] === bwd.root[b]) return; // lähtösolmu = tavoitesolmu: silmukka, ei reitti
    const cost = fwd.cost[f] + bwd.cost[b];
    const tr = fwd.tr[f] + bwd.tr[b];
    const span = fwd.span[f] + bwd.span[b];
    if (top.length >= k) {
      const w = top[k - 1];
      if (!lexLE(cost, tr, span, w.cost, w.tr, w.span)) return;
    }
    const nodes: number[] = [];
    for (let l = f; l >= 0; l = fwd.parent[l]) nodes.push(fwd.node[l]);
    nodes.reverse();
    const meet = nodes.length - 1;
    for (let l = bwd.parent[b]; l >= 0; l = bwd.parent[l]) nodes.push(bwd.node[l]);
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) if (nodes[i] === nodes[j]) return; // ei yksinkertainen
    const kk = key(nodes);
    const group = mode === '234' ? `t${nodes[nodes.length - 1]}` : mode === '432' ? `l${nodes[0]}` : kk;
    const m: Meeting = { f, b, cost, tr, span, edges, key: kk, group, meet };
    const same = top.findIndex((x) => x.group === group);
    if (same >= 0) {
      if (!meetingLess(m, top[same])) return;
      top.splice(same, 1);
    }
    let i = top.length;
    while (i > 0 && meetingLess(m, top[i - 1])) i--;
    top.splice(i, 0, m);
    if (top.length > k) top.length = k;
  };

  const add = (
    side: Side,
    other: Side,
    node: number,
    cost: number,
    tr: number,
    span: number,
    edges: number,
    parent: number,
    rule: number,
    param: number,
    root: number,
    branch: number,
  ): void => {
    const list = side.byNode[node];
    if (list && parent >= 0) {
      for (const l of list) {
        if (!side.isSource(l) && side.edges[l] <= edges && lexLE(side.cost[l], side.tr[l], side.span[l], cost, tr, span)) return;
      }
    }
    const id = side.node.length;
    side.node.push(node);
    side.cost.push(cost);
    side.tr.push(tr);
    side.span.push(span);
    side.edges.push(edges);
    side.parent.push(parent);
    side.rule.push(rule);
    side.param.push(param);
    side.root.push(root);
    side.branch.push(branch);
    side.dead.push(false);
    side.state.push(0);
    if (edges > side.maxDepth) side.maxDepth = edges;
    if (list) {
      if (parent >= 0) {
        for (let i = list.length - 1; i >= 0; i--) {
          const l = list[i];
          if (!side.isSource(l) && edges <= side.edges[l] && lexLE(cost, tr, span, side.cost[l], side.tr[l], side.span[l])) {
            side.kill(l);
            list.splice(i, 1);
          }
        }
      }
      list.push(id);
    } else side.byNode[node] = [id];
    if (side.active && edges < maxEdges) side.push(id);
    const others = other.byNode[node];
    if (others) {
      for (const o of others) {
        if (side === fwd) tryMeeting(id, o);
        else tryMeeting(o, id);
      }
    }
  };

  for (const s of starts) add(fwd, bwd, s, 0, 0, 0, 0, -1, -1, 0, s, 0);
  for (const g of goals) add(bwd, fwd, g, 0, 0, 0, 0, -1, -1, 0, g, 0);

  const buf: number[] = [];
  const ruleIndex = new Map<PathRuleId, number>(RULE_ORDER.map((r, i) => [r, i]));
  const sink = (rule: PathRuleId, to: number, param: number): void => {
    buf.push(ruleIndex.get(rule)!, to, param);
  };

  const expand = (side: Side, other: Side): void => {
    const L = side.pop();
    side.expanded++;
    const x = side.node[L];
    const nx = graph.nodeN[x];
    buf.length = 0;
    const count = forEachNeighbour(graph, x, side.dir, sink);
    for (let i = 0; i < buf.length; i += 3) {
      const r = RULE_ORDER[buf[i]];
      const to = buf[i + 1];
      add(
        side,
        other,
        to,
        side.cost[L] + ruleCost(r),
        side.tr[L] + (PATH_RULES[r].is369 ? 1 : 0),
        side.span[L] + Math.abs(graph.nodeN[to] - nx),
        side.edges[L] + 1,
        L,
        buf[i],
        buf[i + 2],
        side.root[L],
        count,
      );
    }
  };

  const budget = params.budget;
  const totalBudget = budget * ((fwd.active ? 1 : 0) + (bwd.active ? 1 : 0));
  let complete = false;
  let steps = 0;
  for (;;) {
    const tf = fwd.active ? fwd.topCost() : INF;
    const tb = bwd.active ? bwd.topCost() : INF;
    const lb = mode === '234' ? tf + 1 : mode === '432' ? tb + 1 : consistent ? tf + tb + 1 : Math.min(tf, tb) + 1;
    const kth = top.length >= k ? top[k - 1].cost : INF;
    if (kth < lb) {
      complete = true;
      break;
    }
    const canF = tf < INF && fwd.expanded < budget;
    const canB = tb < INF && bwd.expanded < budget;
    if (!canF && !canB) {
      // Rintamat tyhjenivät (kaikki reitit maxEdges-rajan sisällä on löydetty) tai budjetti loppui.
      complete = tf === INF && tb === INF;
      break;
    }
    // Kaksisuuntainen: pienempi rintama ensin. Kun säännöt eivät ole käänteisiä, alaraja nousee vain pienemmän
    // rintamahinnan puolelta, joten se laajenee ensin (tasatilanteessa pienempi rintama, sitten 234).
    let useF: boolean;
    if (!canB) useF = true;
    else if (!canF) useF = false;
    else if (!consistent && tf !== tb) useF = tf < tb;
    else useF = fwd.live <= bwd.live;
    if (useF) expand(fwd, bwd);
    else expand(bwd, fwd);
    if (hooks?.onProgress && ++steps % 512 === 0) hooks.onProgress(fwd.expanded + bwd.expanded, totalBudget);
  }
  fwd.budgetHit = fwd.active && fwd.expanded >= budget && fwd.topCost() < INF;
  bwd.budgetHit = bwd.active && bwd.expanded >= budget && bwd.topCost() < INF;
  if (fwd.budgetHit || bwd.budgetHit) complete = false;
  hooks?.onProgress?.(fwd.expanded + bwd.expanded, totalBudget);
  return { fwd, bwd, top, complete, consistent };
}

// ------------------------------------------------------------------ haku

interface VocabInfo {
  code: string;
  labels: string[];
  roles: IdentifierRole[];
  hits: number;
  used: boolean;
  note: string | null;
}

function sideStats(s: Side): SideStats {
  return {
    expanded: s.expanded,
    reached: s.reachedNodes(),
    frontier: s.live,
    budgetHit: s.budgetHit,
    maxDepthReached: s.maxDepth,
  };
}

/**
 * Reitinhaku lähtötunnisteista tavoitetunnisteisiin. Ks. tiedoston alun kuvaus ja docs/POLKUHAKU.md §4.
 * Jokainen reitin solmu on sanaston koodin osuma; kun lähteellä on numerot, molemmat solmut tarkistetaan
 * verifyHit-funktiolla jokaisessa askeleessa.
 */
export function searchPaths(
  query: PathQuery,
  params: PathParams,
  mode: SearchMode,
  source: HitSource,
  ctx: IdentifierContext | null,
  opts: SearchOptions = {},
): SearchOutcome {
  const t0 = now();
  const reasons: string[] = [];
  const failures: SearchFailure[] = [];
  let canonical = '';
  try {
    canonical = canonicalQuery(query, params, mode);
  } catch {
    canonical = '';
  }
  const base = (): Omit<SearchOutcome, 'status' | 'routes' | 'reachedSample' | 'forward' | 'backward' | 'vocabulary' | 'resultFingerprint' | 'ms'> => ({
    version: PATH_VERSION,
    mode,
    failures,
    reasons,
    params,
    canonical,
    sourceLabel: source.label,
  });
  const done = (
    status: SearchOutcome['status'],
    routes: PathRoute[],
    vocabulary: SearchOutcome['vocabulary'],
    reachedSample: SearchOutcome['reachedSample'] = [],
    forward: SideStats | null = null,
    backward: SideStats | null = null,
  ): SearchOutcome => ({
    ...base(),
    status,
    routes,
    reachedSample,
    forward,
    backward,
    vocabulary,
    resultFingerprint: fingerprint(mode, status, routes),
    ms: Math.round((now() - t0) * 10) / 10,
  });

  if (mode !== '234' && mode !== '432' && mode !== 'kaksisuuntainen') {
    reasons.push(`Tuntematon hakutila "${String(mode)}".`);
    return done('virhe', [], []);
  }
  const paramErrors = validatePathParams(params);
  if (paramErrors.length) {
    reasons.push(...paramErrors);
    return done('virhe', [], []);
  }
  if (!source || !(source.N > 0)) {
    reasons.push('Aineisto on tyhjä (N = 0): lataa piin desimaalit ennen hakua.');
    return done('virhe', [], []);
  }

  // 1. Aikarajaus ja koodaus
  const ranged = identifiersForTimeRange(query.identifiers ?? [], ctx ?? null, query.timeRange ?? null);
  reasons.push(...ranged.notes);
  const encoded: EncodedIdentifier[] = ranged.identifiers.map(encodeIdentifier);
  const byCode = new Map<string, { labels: string[]; roles: IdentifierRole[] }>();
  for (const e of encoded) {
    const label = e.identifier.label || e.identifier.value || e.identifier.id;
    if (!e.ok) {
      failures.push({ code: null, label, reason: e.error ?? 'Tunnistetta ei voitu koodata.' });
      continue;
    }
    if (!ROLE_ORDER.includes(e.identifier.role)) {
      failures.push({ code: e.code, label, reason: `Tuntematon rooli "${String(e.identifier.role)}".` });
      continue;
    }
    let v = byCode.get(e.code);
    if (!v) {
      v = { labels: [], roles: [] };
      byCode.set(e.code, v);
    }
    if (!v.labels.includes(label)) v.labels.push(label);
    if (!v.roles.includes(e.identifier.role)) v.roles.push(e.identifier.role);
  }

  // 2. Sanasto: hylkäykset syineen
  const vocab: VocabInfo[] = [];
  for (const [code, v] of byCode) {
    v.roles.sort((a, b) => ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b));
    const hits = source.hitsOf(code).length;
    const who = v.labels.join(', ');
    let note: string | null = null;
    if (code.length < params.minCodeLength) {
      note = `Koodi ${code} (${who}) on liian lyhyt: ${code.length} < minCodeLength = ${params.minCodeLength}; lyhyellä koodilla on liikaa osumia (${fmtInt(hits)}).`;
    } else if (hits === 0) {
      note = `Koodilla ${code} (${who}) ei ole osumia aineistossa (${source.label}).`;
    } else if (hits > params.maxHitsPerCode) {
      note = `Koodilla ${code} (${who}) on ${fmtInt(hits)} osumaa > maxHitsPerCode = ${fmtInt(params.maxHitsPerCode)}; koodia ei käytetä solmuina.`;
    }
    if (note) failures.push({ code, label: who, reason: note });
    vocab.push({ code, labels: [...v.labels], roles: [...v.roles], hits, used: note === null, note });
  }
  vocab.sort((a, b) => ROLE_ORDER.indexOf(a.roles[0]) - ROLE_ORDER.indexOf(b.roles[0]) || cmpStr(a.code, b.code));
  const vocabulary = vocab.map((v) => ({ ...v }));

  // Lähtö- ja tavoitejoukko samat? (koodien mukaan; haku jatkuu, mutta varoitus on syissä)
  const startEnc = encoded.filter((e) => e.ok && e.identifier.role === 'lähtö');
  const goalEnc = encoded.filter((e) => e.ok && e.identifier.role === 'tavoite');
  if (sameIdentifierSets(startEnc, goalEnc)) {
    const labels: string[] = [];
    for (const e of startEnc) if (!labels.includes(e.identifier.label)) labels.push(e.identifier.label);
    reasons.push(sameSetsWarning(labels));
  }

  const used = vocab.filter((v) => v.used);
  const startCodes = used.filter((v) => v.roles.includes('lähtö'));
  const goalCodes = used.filter((v) => v.roles.includes('tavoite'));
  const missing = (role: IdentifierRole) => {
    const [state, set] = role === 'lähtö' ? ['Lähtötila', 'Lähtöjoukossa'] : ['Tavoitetila', 'Tavoitejoukossa'];
    const any = (query.identifiers ?? []).some((i) => i.role === role);
    const anyRanged = ranged.identifiers.some((i) => i.role === role);
    if (!any) reasons.push(`${state}lle ei ole tunnisteita: lisää vähintään yksi nimi, sana, numerojono tai päivämäärä.`);
    else if (!anyRanged) reasons.push(`${state}n tunnisteet jäivät kaikki aikarajauksen ulkopuolelle.`);
    else reasons.push(`${set} ei ole yhtään käyttökelpoista koodia (ks. hylätyt koodit).`);
  };
  if (!startCodes.length) missing('lähtö');
  if (!goalCodes.length) missing('tavoite');
  if (!startCodes.length || !goalCodes.length) return done('ei-löytynyt', [], vocabulary);

  // 3. Graafi ja haku
  const codes = used.map((v) => v.code).sort(cmpStr);
  const graph = buildGraph(codes, (c) => source.hitsOf(c), source.N, params);
  const info = new Map(used.map((v) => [v.code, v]));
  const nodesOf = (vs: VocabInfo[]): number[] => {
    const out: number[] = [];
    for (const v of vs) {
      const c = graph.codes.indexOf(v.code);
      for (let i = 0; i < graph.hitNode[c].length; i++) out.push(graph.hitNode[c][i]);
    }
    return out.sort((a, b) => a - b);
  };
  const starts = nodesOf(startCodes);
  const goals = nodesOf(goalCodes);
  const eng = runEngine(graph, starts, goals, mode, params, opts.hooks);

  const pathNode = (x: number): PathNode => {
    const code = graph.codes[graph.nodeCode[x]];
    const v = info.get(code)!;
    return { code, n: graph.nodeN[x], labels: [...v.labels], roles: [...v.roles] };
  };
  const digits = source.digits;
  const read = (x: number): string | null => (digits ? digits.substr(graph.nodeN[x] - 1, graph.codes[graph.nodeCode[x]].length) : null);
  const verified = (a: number, b: number): boolean | null =>
    digits
      ? verifyHit(digits, graph.codes[graph.nodeCode[a]], graph.nodeN[a]) && verifyHit(digits, graph.codes[graph.nodeCode[b]], graph.nodeN[b])
      : null;

  const makeStep = (from: number, to: number, side: PathSide, rule: PathRuleId, param: number, branching: number): PathStep => {
    // 432-askeleen ehdokas laskettiin tavoitepuolen solmusta (to) kohti solmua from.
    const c = side === '234' ? describeEdge(graph, from, '234', rule, to, param) : describeEdge(graph, to, '432', rule, from, param);
    const def = PATH_RULES[rule];
    const delta = graph.nodeN[to] - graph.nodeN[from];
    return {
      from: pathNode(from),
      to: pathNode(to),
      rule,
      side,
      layer: def.layer,
      domain: def.domain,
      formula: c.formula,
      delta,
      metrics: { ...c.metrics, 'Δn': delta },
      branching,
      transform: def.is369,
      verified: verified(from, to),
      digitsFrom: read(from),
      digitsTo: read(to),
    };
  };

  const routes: PathRoute[] = eng.top.map((m) => {
    const { fwd, bwd } = eng;
    const fChain: number[] = [];
    for (let l = m.f; l >= 0; l = fwd.parent[l]) fChain.push(l);
    fChain.reverse();
    const bChain: number[] = [];
    for (let l = m.b; l >= 0; l = bwd.parent[l]) bChain.push(l);
    const nodeIds = [...fChain.map((l) => fwd.node[l]), ...bChain.slice(1).map((l) => bwd.node[l])];
    const steps: PathStep[] = [];
    for (let i = 1; i < fChain.length; i++) {
      const l = fChain[i];
      steps.push(makeStep(fwd.node[fChain[i - 1]], fwd.node[l], '234', RULE_ORDER[fwd.rule[l]], fwd.param[l], fwd.branch[l]));
    }
    for (let j = 0; j + 1 < bChain.length; j++) {
      const l = bChain[j];
      steps.push(makeStep(bwd.node[l], bwd.node[bChain[j + 1]], '432', RULE_ORDER[bwd.rule[l]], bwd.param[l], bwd.branch[l]));
    }
    const transforms = steps.filter((s) => s.transform).length;
    let span = 0;
    for (const s of steps) span += Math.abs(s.delta);
    return {
      key: m.key,
      nodes: nodeIds.map(pathNode),
      steps,
      cost: { edges: steps.length, transforms, span },
      meetIndex: mode === 'kaksisuuntainen' ? m.meet : null,
    };
  });

  // 4. Saavutetut solmut (234/432)
  const reachedSample: SearchOutcome['reachedSample'] = [];
  if (mode !== 'kaksisuuntainen') {
    const s = mode === '234' ? eng.fwd : eng.bwd;
    const rows: { node: number; depth: number; via: PathRuleId | null }[] = [];
    s.byNode.forEach((list, node) => {
      if (!list || !list.length) return;
      // Paras nimiö (hinta, muunnokset, Σ|Δn|, tunnus): lähdenimiö (hinta 0) voittaa aina.
      let best = list[0];
      for (const l of list) {
        const better =
          s.cost[l] !== s.cost[best]
            ? s.cost[l] < s.cost[best]
            : s.tr[l] !== s.tr[best]
              ? s.tr[l] < s.tr[best]
              : s.span[l] !== s.span[best]
                ? s.span[l] < s.span[best]
                : l < best;
        if (better) best = l;
      }
      rows.push({ node, depth: s.edges[best], via: s.parent[best] < 0 ? null : RULE_ORDER[s.rule[best]] });
    });
    rows.sort((a, b) => a.depth - b.depth || graph.nodeN[a.node] - graph.nodeN[b.node] || a.node - b.node);
    for (const r of rows.slice(0, REACHED_SAMPLE_LIMIT)) reachedSample.push({ node: pathNode(r.node), depth: r.depth, via: r.via });
  }

  // 5. Syyt
  const fStats = eng.fwd.active ? sideStats(eng.fwd) : null;
  const bStats = eng.bwd.active ? sideStats(eng.bwd) : null;
  explain(reasons, mode, params, eng, routes.length, graph.size);

  return done(routes.length ? 'löytyi' : 'ei-löytynyt', routes, vocabulary, reachedSample, fStats, bStats);
}

function budgetText(s: Side, budget: number): string {
  return (
    `Budjetti loppui ${SIDE_LABEL[s.dir]} ${fmtInt(s.expanded)} laajennuksen jälkeen (budget = ${fmtInt(budget)}); ` +
    `rintamaan jäi ${fmtInt(s.live)} nimiötä, syvin taso ${s.maxDepth} askelta.`
  );
}

function explain(reasons: string[], mode: SearchMode, params: PathParams, eng: EngineResult, found: number, size: number): void {
  const { fwd, bwd } = eng;
  const budgetSides = [fwd, bwd].filter((s) => s.active && s.budgetHit);
  for (const s of budgetSides) reasons.push(budgetText(s, params.budget));
  if (found) {
    if (budgetSides.length) {
      reasons.push('Löydetyt reitit ovat parhaat siihen mennessä löydetyt; budjetin vuoksi parempia reittejä ei voitu sulkea pois.');
    } else if (found < params.maxRoutes) {
      reasons.push(
        `Reittejä löytyi ${found} < maxRoutes = ${params.maxRoutes}: ${MODE_LABEL[mode]} -haku kävi läpi kaikki ` +
          `${params.maxEdges} askeleen sisällä saavutettavat solmut.`,
      );
    }
    return;
  }
  if (!size) {
    reasons.push('Sanastossa ei ole yhtään solmua.');
    return;
  }
  const depthNote = (s: Side, what: string) =>
    s.maxDepth < params.maxEdges
      ? ` ${what} rintama tyhjeni ${s.maxDepth} askeleen jälkeen: sääntöjen mukaisia uusia naapureita ei ollut.`
      : '';
  if (mode === '234') {
    if (!fwd.budgetHit) {
      reasons.push(
        `Lähtöpuolen haku (234) kävi läpi kaikki enintään ${params.maxEdges} askeleen päässä olevat solmut ` +
          `(${fmtInt(fwd.expanded)} laajennusta, ${fmtInt(fwd.reachedNodes())} solmua), eikä yksikään tavoitesolmu ollut niiden joukossa.` +
          depthNote(fwd, 'Lähtöpuolen'),
      );
    } else reasons.push('Tavoitesolmua ei saavutettu ennen kuin budjetti loppui.');
  } else if (mode === '432') {
    if (!bwd.budgetHit) {
      reasons.push(
        `Tavoitepuolen haku (432) kävi läpi kaikki enintään ${params.maxEdges} askeleen päässä olevat solmut ` +
          `(${fmtInt(bwd.expanded)} laajennusta, ${fmtInt(bwd.reachedNodes())} solmua), eikä yksikään lähtösolmu ollut niiden joukossa.` +
          depthNote(bwd, 'Tavoitepuolen'),
      );
    } else reasons.push('Lähtösolmua ei saavutettu ennen kuin budjetti loppui.');
  } else if (!budgetSides.length) {
    reasons.push(
      `Rintamat eivät kohdanneet ${params.maxEdges} askeleen sisällä: lähtöpuoli (234) saavutti ${fmtInt(fwd.reachedNodes())} solmua ` +
        `(${fmtInt(fwd.expanded)} laajennusta, syvin ${fwd.maxDepth} askelta), tavoitepuoli (432) ${fmtInt(bwd.reachedNodes())} solmua ` +
        `(${fmtInt(bwd.expanded)} laajennusta, syvin ${bwd.maxDepth} askelta).` +
        depthNote(fwd, 'Lähtöpuolen') +
        depthNote(bwd, 'Tavoitepuolen'),
    );
  } else reasons.push('Rintamat eivät kohdanneet ennen kuin budjetti loppui.');
}

/** Tuloksen sormenjälki: tila, status, reittien avaimet, kustannukset sekä askelten säännöt ja puolet. */
function fingerprint(mode: SearchMode, status: SearchOutcome['status'], routes: PathRoute[]): string {
  const lines = routes.map(
    (r) =>
      `${r.key}|${r.cost.edges}/${r.cost.transforms}/${r.cost.span}|${r.steps.map((s) => `${s.rule}:${s.side}`).join(',')}`,
  );
  return fnv1a(`${PATH_VERSION}|${mode}|${status}\n${lines.join('\n')}`);
}
