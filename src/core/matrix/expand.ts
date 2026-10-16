// Rekursiivinen solmujen avaus. Määrittely: docs/MATRIISI.md §2, §4 ja §8.
// expand(ref, env) on puhdas ja deterministinen: sama viite + sama ympäristö → samat särmät samassa järjestyksessä.
// Jokaisella särmällä on toistettava jäljitys (`trace`). π-kerroksen osumasärmät tarkistetaan aina
// lähdeaineistosta (verifyHit): tarkistamatonta osumasärmää ei koskaan tuoteta.
// Matemaattinen ja symbolinen kerros pidetään erillään: tarinan tulkinnat merkitään aina käyttäjän tulkinnoiksi.

import { sliceContext } from '../digits';
import { encodeT9Detailed, t9Ambiguity, t9Readings } from '../encodings';
import { FIB, localParastichyK } from '../fibonacci';
import { chordDistance, faceBits, faceName, faceRelation, mapIndex, vogel, type Vec3 } from '../mapping';
import { lowerBound, nearestIndex } from '../search';
import { ENCODING_VERSION, FORMULA_VERSION } from '../version';
import { codeHits, expectedHits, verifyHit } from './hits';
import { referenceCodes, t9Code, type RefCode } from './refs';
import {
  CHRONOLOGY_LABELS,
  continuation,
  getGloss,
  getPath,
  getPerson,
  glossContextLabel,
  glossesFor,
  homonymChronology,
  junction,
  pathsOfName,
  pathsOfPerson,
  personLabel,
  personsByName,
  stepsInDirection,
  symbolString,
} from './story';
import type {
  Direction,
  DirectionDomain,
  Expansion,
  Fact,
  Gloss,
  Layer,
  MatrixEdge,
  MatrixEnv,
  MatrixEvent,
  NodeInfo,
  NodeRef,
  PathStep,
  StoryModel,
  StoryPath,
} from './types';
import { DIRECTION_SEMANTICS, directionLabel, HYPOTHESIS_LABELS, nodeKey, normName, opposite, realmOf } from './types';

/** Osumalistan oletusraja koodisolmussa. Loput ilmoitetaan `truncated`-kentässä. */
export const DEFAULT_HIT_LIMIT = 5000;
/** Saman koodin seuraavat/edelliset osumat osumasolmussa. */
export const SAME_CODE_NEIGHBORS = 5;
/** 3D-lähimmät viitekoodien osumat osumasolmussa. */
export const NEAREST_3D = 5;
/** Fibonacci-naapurit: k = k* − 3 … k* + 2. */
export const FIB_K_BELOW = 3;
export const FIB_K_ABOVE = 2;

/** Ryhmien nimet. Sama käsite käyttää aina samaa ryhmää. */
export const GROUPS = {
  anchor: 'Lähtöankkuri',
  identifiers: 'Lähtötunnisteet',
  identifierCodes: 'Lähtötunnisteiden koodit',
  reportedPositions: 'Ilmoitetut sijainnit',
  testRoute: 'Testireitti',
  code: 'Koodi',
  gates: 'Numeroportit',
  names: 'Nimet',
  persons: 'Henkilöt',
  homonyms: 'Samannimiset',
  homonymPersons: 'Samannimiset henkilöt',
  chronology: 'Kronologia',
  glosses: 'Tulkinnat',
  otherGlosses: 'Saman symbolin muut tulkinnat',
  glossContext: 'Tulkinnan konteksti',
  allHits: (k: number) => `Kaikki osumat (${k})`,
  nearestAnchor: 'Lähin osuma ankkuriin',
  sameCode: 'Saman koodin osumat suunnassa',
  refNearest: 'Viitekoodien lähimmät osumat suunnassa',
  fib: 'Fibonacci-naapurit (spiraali)',
  near3d: '3D-lähimmät viitekoodien osumat',
  octa: 'Oktaedrin atsimuuttinaapuri',
  position: 'π-indeksi',
  atPosition: 'Osumat tässä kohdassa',
  adjacent: 'Viereiset kohdat',
  paths: 'Polut',
  steps: (d: Direction) => `Polun askeleet suunnassa ${d}`,
  continuation: (d: Direction) => `Jatko suuntaan ${d}`,
  leading: (d: Direction) => `Edeltävät askeleet suunnassa ${d}`,
  junction: 'Yhdistä polut',
  branches: 'Yhdistetyt polut',
  symbolMatch: 'Merkkijonon yhtäläisyys',
  relations: 'Suhteet',
  events: 'Tapahtumat',
  linkedHits: 'Linkitetyt osumat',
  eventOrder: 'Tapahtumat ajassa',
} as const;

const SYMBOLIC_NOTE = 'Käyttäjän tulkinta — ei matemaattinen havainto.';
const MAPPING_NOTE = 'Kartoitus on valinta, ei piin ominaisuus.';

// ------------------------------------------------------------------ muotoilu

/** 858511 → "858 511" (välilyönti tuhaterottimena, kuten määrittelyssä). */
export function fmtIndex(n: number): string {
  const s = Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return (n < 0 ? '−' : '') + s;
}

/** +99, −1799, ±0 */
export function fmtSignedIndex(d: number): string {
  return (d > 0 ? '+' : d < 0 ? '−' : '±') + fmtIndex(Math.abs(d));
}

function fmtExp(x: number): string {
  if (!Number.isFinite(x)) return '–';
  if (x >= 100) return fmtIndex(x);
  if (x >= 1) return x.toFixed(2);
  if (x >= 0.001) return x.toFixed(4);
  return x.toExponential(2);
}

function range(n: number, L: number): string {
  return L <= 1 ? `digits[${n}]` : `digits[${n}…${n + L - 1}]`;
}

/** Suomen genetiivi isoin kirjaimin kirjoitetulle nimelle: IDA → IDAn, MAX → MAXin. */
function genitive(name: string): string {
  return /[AEIOUYÅÄÖ]$/.test(name) ? `${name}n` : `${name}in`;
}

const ORDINAL_WORDS = ['ensimmäinen', 'toinen', 'kolmas', 'neljäs', 'viides', 'kuudes', 'seitsemäs', 'kahdeksas', 'yhdeksäs', 'kymmenes'];

function ordinalWord(k: number): string {
  return ORDINAL_WORDS[k - 1] ?? `${k}.`;
}

/** "T9: M=6 A=2 X=9 → 629" encodeT9Detailed-askelista (suomalainen translitterointi). null, jos ei koodattavissa. */
export function t9Trace(name: string): string | null {
  const r = encodeT9Detailed(normName(name), { scandi: 'fi-translit' });
  if (!r.ok) return null;
  return `T9: ${r.steps.map((s) => `${s.ch}=${s.out}`).join(' ')} → ${r.code}`;
}

function dirSuffix(dir: Direction, domain: DirectionDomain): string {
  return ` · ${dir}: ${DIRECTION_SEMANTICS[domain][dir]}`;
}

function pathPhrase(path: StoryPath): string {
  const m = /^polku\s+(.+)$/i.exec(path.title.trim());
  return m ? `polulla ${m[1]}` : `polulla ${path.title}`;
}

function stepChain(steps: PathStep[]): string {
  return steps.map((s) => `${normName(s.name)} (${s.symbol})`).join(' → ');
}

// ------------------------------------------------------------------ avauskonteksti

interface EdgeSpec {
  layer: Layer;
  group: string;
  relation: string;
  trace: string;
  direction?: Direction | null;
  domain?: DirectionDomain | null;
  verified?: boolean | null;
  metrics?: Record<string, number | string>;
}

interface Ctx {
  env: MatrixEnv;
  model: StoryModel;
  dir: Direction;
  from: NodeRef;
  N: number;
  /** false = describe(): vain solmun tiedot, ei särmiä. */
  full: boolean;
  hitLimit: number;
  edges: MatrixEdge[];
  notes: string[];
  truncated: Expansion['truncated'];
  refs: RefCode[];
}

function add(c: Ctx, to: NodeRef, e: EdgeSpec): void {
  c.edges.push({
    to,
    layer: e.layer,
    group: e.group,
    relation: e.relation,
    trace: e.trace,
    direction: e.direction ?? null,
    domain: e.domain ?? null,
    op: null,
    verified: e.verified ?? null,
    ...(e.metrics ? { metrics: e.metrics } : {}),
    crossesRealm: realmOf(c.from) !== realmOf(to),
  });
}

/** Suunnallinen särmä: suunta + alue, ja suunnan merkitys sekä suhteessa että jäljityksessä. */
function addDir(c: Ctx, to: NodeRef, dir: Direction, domain: DirectionDomain, e: EdgeSpec): void {
  add(c, to, {
    ...e,
    direction: dir,
    domain,
    relation: e.relation + dirSuffix(dir, domain),
    trace: `${e.trace} Suunta ${directionLabel(dir, domain)}.`,
  });
}

/** Osumasärmä vain, jos osuma löytyy lähdeaineistosta. Muuten huomautus eikä särmää. */
function addHit(c: Ctx, code: string, n: number, e: EdgeSpec, dir?: { dir: Direction; domain: DirectionDomain }): boolean {
  if (!verifyHit(c.env.digits, code, n)) {
    c.notes.push(`Osumaa ${code} @${fmtIndex(n)} ei löydy lähdeaineistosta (${range(n, code.length)}), joten sitä ei näytetä.`);
    return false;
  }
  const spec: EdgeSpec = { ...e, layer: e.layer, verified: true };
  if (dir) addDir(c, { kind: 'hit', code, n }, dir.dir, dir.domain, spec);
  else add(c, { kind: 'hit', code, n }, spec);
  return true;
}

function hitTrace(code: string, n: number): string {
  return `${range(n, code.length)} = "${code}" ✓ (verifyHit, 1-pohjainen n).`;
}

function nodeInfo(ref: NodeRef, title: string, subtitle: string, facts: Fact[], extra: Partial<NodeInfo> = {}): NodeInfo {
  return { ref, key: nodeKey(ref), realm: realmOf(ref), title, subtitle, facts, piPosition: null, ...extra };
}

function missingNode(c: Ctx, ref: NodeRef, title: string, note: string): NodeInfo {
  c.notes.push(note);
  return nodeInfo(ref, title, 'puuttuva tieto', [], { missing: true });
}

/** Nimet (lähtötunnisteet ja henkilöt), joiden T9-koodi on `code`. Sama nimi kerran. */
function namesForCode(model: StoryModel, code: string): string[] {
  const out: string[] = [];
  const push = (name: string) => {
    const n = normName(name);
    if (n && !out.includes(n) && t9Code(n) === code) out.push(n);
  };
  for (const id of model.identifiers) push(id.name);
  for (const p of model.persons) push(p.name);
  return out;
}

function addNameEdgesForCode(c: Ctx, code: string): void {
  for (const name of namesForCode(c.model, code))
    add(c, { kind: 'name', name }, {
      layer: 'symbolinen',
      group: GROUPS.names,
      relation: `nimi ${name}, jonka T9-koodi on ${code}`,
      trace: `${t9Trace(name)} (${ENCODING_VERSION}). Nimi kuuluu tarinakerrokseen; koodi ei yksilöi nimeä eikä henkilöä.`,
    });
}

function addCodeEdgeForName(c: Ctx, name: string, relation: string, group: string = GROUPS.code): void {
  const code = t9Code(name);
  const trace = t9Trace(name);
  if (!code || !trace) {
    c.notes.push(`Nimeä ${name} ei voi koodata T9:llä, joten koodisolmua ei ole.`);
    return;
  }
  add(c, { kind: 'code', code }, {
    layer: 'matemaattinen',
    group,
    relation,
    trace: `${trace} (${ENCODING_VERSION}, Å,Ä→A, Ö→O).`,
  });
}

// ------------------------------------------------------------------ viitekoodien osumapooli

interface RefHit {
  name: string;
  code: string;
  n: number;
  p: Vec3;
  face: number;
  phi: number;
}

let poolDigits: string | null = null;
let poolKey = '';
let poolCache: RefHit[] = [];

/** Kaikkien viitekoodien osumat pisteineen (välimuisti aineiston ja koodilistan mukaan). */
function refPool(digits: string, refs: RefCode[]): RefHit[] {
  const key = refs.map((r) => `${r.name}=${r.code}`).join(',');
  if (digits === poolDigits && key === poolKey) return poolCache;
  const out: RefHit[] = [];
  for (const r of refs)
    for (const n of codeHits(digits, r.code)) {
      const p = mapIndex(n);
      out.push({ name: r.name, code: r.code, n, p, face: faceBits(p), phi: Math.atan2(p.y, p.x) });
    }
  out.sort((a, b) => a.n - b.n || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  poolDigits = digits;
  poolKey = key;
  poolCache = out;
  return out;
}

const TWO_PI = 2 * Math.PI;
const normAngle = (x: number): number => ((x % TWO_PI) + TWO_PI) % TWO_PI;

// ------------------------------------------------------------------ solmutyypit

function expandRoot(ref: NodeRef, c: Ctx): NodeInfo {
  const { anchor, digits } = c.env;
  const L = anchor.code.length;
  const ok = verifyHit(digits, anchor.code, anchor.n);
  const found = anchor.n >= 1 ? digits.slice(anchor.n - 1, anchor.n - 1 + L) : '';
  const label = normName(anchor.label);
  const labelCode = t9Code(label);
  const count = /^\d+$/.test(anchor.code) ? codeHits(digits, anchor.code).length : 0;
  const facts: Fact[] = [
    {
      label: 'Ankkurin tarkistus',
      value: ok
        ? `${range(anchor.n, L)} = "${anchor.code}" ✓`
        : `${range(anchor.n, L)} = "${found}" ✗ (odotettiin "${anchor.code}")`,
      layer: 'matemaattinen',
      verified: ok,
    },
    {
      label: 'Ankkurin koodi',
      value: labelCode
        ? `T9(${label}) = ${labelCode}${labelCode === anchor.code ? ' ✓' : ` ✗ (ankkurin koodi ${anchor.code})`}`
        : `${label}: ei koodattavissa T9:llä`,
      layer: 'matemaattinen',
      verified: labelCode === anchor.code,
    },
    {
      label: 'Koodin osumia',
      value: `${fmtIndex(count)} (odotus satunnaisjonossa ${fmtExp(expectedHits(c.N, L))})`,
      layer: 'matemaattinen',
    },
    { label: 'Aineisto', value: `N = ${fmtIndex(c.N)} desimaalia (1-pohjainen n)`, layer: 'matemaattinen' },
    { label: 'Viitekoodit', value: c.refs.map((r) => `${r.name} ${r.code}`).join(', ') || '–', layer: 'matemaattinen' },
  ];
  if (!ok) c.notes.push(`Ankkuria ${label} ${anchor.code} @${fmtIndex(anchor.n)} ei löydy lähdeaineistosta, joten ankkuriosumaa ei näytetä.`);
  const node = nodeInfo(ref, `Lähtöankkuri ${label} ${anchor.code} @${fmtIndex(anchor.n)}`, 'π-data · lähtöankkuri ja lähtötunnisteet', facts, {
    piPosition: ok ? { n: anchor.n, code: anchor.code } : null,
  });
  if (!c.full) return node;

  if (ok)
    addHit(c, anchor.code, anchor.n, {
      layer: 'matemaattinen',
      group: GROUPS.anchor,
      relation: `lähtöankkuri ${label} ${anchor.code} @${fmtIndex(anchor.n)}`,
      trace: hitTrace(anchor.code, anchor.n),
      metrics: { n: anchor.n },
    });

  for (const id of c.model.identifiers) {
    const name = normName(id.name);
    add(c, { kind: 'name', name }, {
      layer: 'symbolinen',
      group: GROUPS.identifiers,
      relation: `lähtötunniste ${name}`,
      trace: `Tarinamallin lähtötunniste ${name} (ilmoittanut: ${id.reportedBy}; ilmoitettu koodi ${id.code}, koodaus ${id.encoding}).`,
    });
  }
  for (const id of c.model.identifiers) {
    const name = normName(id.name);
    const code = t9Code(name);
    if (code && code !== id.code)
      c.notes.push(`Lähtötunnisteen ${name} ilmoitettu koodi ${id.code} ei täsmää T9-koodiin ${code}. Käytetään T9-koodia.`);
    addCodeEdgeForName(c, name, `${name} → T9-koodi ${code ?? '–'}`, GROUPS.identifierCodes);
  }
  for (const id of c.model.identifiers) {
    const name = normName(id.name);
    const code = t9Code(name) ?? id.code;
    for (const n of id.reportedPositions) {
      if (code === anchor.code && n === anchor.n) continue; // ankkuri on jo omana särmänään
      if (!verifyHit(digits, code, n)) {
        const got = Number.isInteger(n) && n >= 1 ? digits.slice(n - 1, n - 1 + code.length) : '';
        c.notes.push(
          `Ilmoitettu sijainti ${name} ${code} @${fmtIndex(n)} ei täsmää lähdeaineistoon (kohdassa "${got}"). Sijaintia ei käytetä.`,
        );
        continue;
      }
      addHit(c, code, n, {
        layer: 'matemaattinen',
        group: GROUPS.reportedPositions,
        relation: `${name} ${code} @${fmtIndex(n)} (ilmoittanut: ${id.reportedBy})`,
        trace: `${hitTrace(code, n)} Ilmoitettu sijainti tarkistettu lähdeaineistosta.`,
        metrics: { n, Δn: n - anchor.n },
      });
    }
  }

  const hasMax =
    c.model.identifiers.some((i) => normName(i.name) === 'MAX') || c.model.persons.some((p) => normName(p.name) === 'MAX');
  const maxCode = t9Code('MAX');
  if (hasMax && maxCode) {
    const g = c.model.glosses.find(
      (x) => x.context.kind === 'koodi' && x.context.code === maxCode && x.symbol === maxCode[1],
    );
    const tail = g ? ` → ${g.symbol}${g.name ? ` → ${normName(g.name)}` : ''}${g.personId ? ` → ${personLabel(c.model, g.personId)}` : ''}` : '';
    add(c, { kind: 'code', code: maxCode }, {
      layer: 'symbolinen',
      group: GROUPS.testRoute,
      relation: `Ensimmäinen testireitti: MAX (${maxCode})${tail}`,
      trace: `Tehtävänannon ensimmäinen testireitti (docs/MATRIISI.md §9): ${t9Trace('MAX')}; numero 2 = koodin ${maxCode} toinen portti; tulkinta ${g ? `"${g.id}"` : 'puuttuu'}. Reitin valinta on käyttäjän.`,
    });
  }
  return node;
}

function expandName(ref: Extract<NodeRef, { kind: 'name' }>, c: Ctx): NodeInfo {
  const name = normName(ref.name);
  if (!name) return missingNode(c, ref, '(tyhjä nimi)', 'Nimi puuttuu.');
  const code = t9Code(name);
  const steps = t9Trace(name);
  const persons = personsByName(c.model, name);
  const ident = c.model.identifiers.find((i) => normName(i.name) === name);
  const facts: Fact[] = [
    { label: 'T9-koodi', value: code ? `${code} (${steps})` : 'ei koodattavissa T9:llä', layer: 'matemaattinen' },
  ];
  if (code) facts.push({ label: 'Huomio', value: `T9-koodi ${code} on nimen ominaisuus, ei henkilön.`, layer: 'matemaattinen' });
  facts.push({ label: 'Henkilöitä tällä nimellä', value: String(persons.length), layer: 'symbolinen' });
  if (ident)
    facts.push({
      label: 'Lähtötunniste',
      value: `ilmoitettu koodi ${ident.code} (${ident.reportedBy})`,
      layer: 'symbolinen',
    });
  if (!persons.length) c.notes.push('Nimellä ei ole henkilöitä tarinassa.');
  if (!code) c.notes.push(`Nimeä ${name} ei voi koodata T9:llä.`);
  const node = nodeInfo(ref, name, 'nimi · tarinakerros · sama nimi ei tarkoita samaa henkilöä', facts);
  if (!c.full) return node;

  if (code) addCodeEdgeForName(c, name, `nimen T9-koodi ${code}`);
  if (persons.length >= 2)
    add(c, { kind: 'homonyms', name }, {
      layer: 'symbolinen',
      group: GROUPS.homonyms,
      relation: `samannimiset ${name}: ${persons.length} eri henkilöä`,
      trace: `Tarinamallissa ${persons.length} henkilöä, joiden nimi on ${name} (${persons.map((p) => p.id).join(', ')}).`,
    });
  for (const p of persons)
    add(c, { kind: 'person', personId: p.id }, {
      layer: 'symbolinen',
      group: GROUPS.persons,
      relation: `henkilö ${personLabel(c.model, p)}`,
      trace: `Tarinamallin henkilö "${p.id}" (nimi ${name}${p.homonymOrdinal != null ? `, samannimisten järjestys ${p.homonymOrdinal}/${persons.length}` : ''}). Sama nimi ei tarkoita samaa henkilöä.`,
    });
  for (const g of c.model.glosses)
    if (g.name != null && normName(g.name) === name) addGlossEdge(c, g, GROUPS.glosses, `tulkinta: ${glossText(g)} (${glossContextLabel(c.model, g.context)})`);
  addPathEdges(
    c,
    pathsOfName(c.model, name).map((o) => o.path),
    (p) => `${p.title} · ${p.theme}: ${stepChain(p.steps)}`,
    (p) => `Polku ${p.id} sisältää nimen ${name} (askeleet ${p.steps.map((s, i) => (normName(s.name) === name ? i + 1 : 0)).filter(Boolean).join(', ')}).`,
  );
  return node;
}

function glossText(g: Gloss): string {
  return `${g.symbol} = ${g.meanings.join(', ') || '–'}`;
}

function addGlossEdge(c: Ctx, g: Gloss, group: string, relation: string): void {
  add(c, { kind: 'gloss', glossId: g.id }, {
    layer: 'symbolinen',
    group,
    relation,
    trace: `Tarinamallin tulkinta "${g.id}" (konteksti: ${glossContextLabel(c.model, g.context)}; lähde: ${g.source}). ${SYMBOLIC_NOTE}`,
  });
}

function addPathEdges(c: Ctx, paths: StoryPath[], relation: (p: StoryPath) => string, trace: (p: StoryPath) => string): void {
  const seen = new Set<string>();
  for (const p of paths) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    add(c, { kind: 'path', pathId: p.id }, { layer: 'symbolinen', group: GROUPS.paths, relation: relation(p), trace: trace(p) });
  }
}

function expandCode(ref: Extract<NodeRef, { kind: 'code' }>, c: Ctx): NodeInfo {
  const code = ref.code;
  if (!/^\d+$/.test(code)) return missingNode(c, ref, code || '(tyhjä koodi)', `"${code}" ei ole numerojono.`);
  const L = code.length;
  const hits = codeHits(c.env.digits, code);
  const k = hits.length;
  const expected = expectedHits(c.N, L);
  const names = namesForCode(c.model, code);
  const amb = t9Ambiguity(code);
  const facts: Fact[] = [
    { label: 'Pituus', value: `${L} numeroa`, layer: 'matemaattinen' },
    { label: 'Osumia aineistossa', value: `${fmtIndex(k)} (kaikki alkukohdat, myös päällekkäiset)`, layer: 'matemaattinen' },
    {
      label: 'Odotettu määrä',
      value: `(N − L + 1) / 10^L = (${fmtIndex(c.N)} − ${L} + 1) / 10^${L} ≈ ${fmtExp(expected)}`,
      layer: 'matemaattinen',
    },
    {
      label: 'T9-monitulkintaisuus',
      value: `${amb} kirjainjonoa tuottaa saman koodin (esim. ${t9Readings(code, 4).join(', ')})`,
      layer: 'matemaattinen',
    },
  ];
  for (const name of names) facts.push({ label: 'Nimi', value: `T9(${name}) = ${code}`, layer: 'matemaattinen' });
  if (!c.N) c.notes.push('Aineistoa ei ole ladattu, joten osumia ei voi listata.');
  const title = names.length ? `${names.join(' / ')} ${code}` : code;
  const node = nodeInfo(ref, title, `koodi · π-data · ${L} numeroa`, facts);
  if (!c.full) return node;

  // Numeroportit suunnassa.
  const order = [...Array(L).keys()];
  if (c.dir === '432') order.reverse();
  for (const i of order)
    addDir(c, { kind: 'digit', code, index: i }, c.dir, 'koodi', {
      layer: 'matemaattinen',
      group: GROUPS.gates,
      relation: `portti ${i + 1}/${L}: ${code[i]}`,
      trace: `Koodin ${code} numero paikassa ${i + 1}/${L} on ${code[i]}.`,
    });

  addNameEdgesForCode(c, code);

  // Tulkinnat: ensin tämän koodin kontekstissa, sitten koodin numerojono symbolina.
  const ctxGlosses = c.model.glosses.filter((g) => g.context.kind === 'koodi' && g.context.code === code);
  const symGlosses = c.model.glosses.filter((g) => g.symbol === code && !ctxGlosses.includes(g));
  for (const g of ctxGlosses) addGlossEdge(c, g, GROUPS.glosses, `tulkinta tässä koodissa: ${glossText(g)}`);
  for (const g of symGlosses)
    addGlossEdge(c, g, GROUPS.glosses, `numerojonon ${code} tulkinta (${glossContextLabel(c.model, g.context)}): ${glossText(g)}`);

  if (!k) {
    c.notes.push(`Koodilla ${code} ei ole osumia aineistossa (odotus ${fmtExp(expected)}).`);
    return node;
  }

  // Lähin osuma ankkuriin (ankkuri itse ei ole oma naapurinsa).
  const a = c.env.anchor;
  const others = code === a.code ? Array.from(hits).filter((n) => n !== a.n) : hits;
  const ni = nearestIndex(others, a.n);
  if (ni >= 0) {
    const n = others[ni];
    const d = n - a.n;
    addHit(c, code, n, {
      layer: 'matemaattinen',
      group: GROUPS.nearestAnchor,
      relation: `lähin osuma ankkuriin ${normName(a.label)} @${fmtIndex(a.n)}: @${fmtIndex(n)} (Δn ${fmtSignedIndex(d)})`,
      trace: `nearestIndex(osumat(${code}), ${a.n}) → ${n}; Δn = ${n} − ${a.n} = ${d}. ${hitTrace(code, n)}`,
      metrics: { n, Δn: d },
    });
  }

  // Kaikki osumat suunnassa, rajattuna.
  const group = GROUPS.allHits(k);
  const shown = Math.min(k, c.hitLimit);
  for (let j = 0; j < shown; j++) {
    const idx = c.dir === '234' ? j : k - 1 - j;
    const n = hits[idx];
    addHit(
      c,
      code,
      n,
      {
        layer: 'matemaattinen',
        group,
        relation: `osuma ${idx + 1}/${k} @${fmtIndex(n)}`,
        trace: `findAll("${code}") → ${idx + 1}. osuma nousevassa järjestyksessä. ${hitTrace(code, n)}`,
        metrics: { n, Δn: n - a.n },
      },
      { dir: c.dir, domain: 'pi-indeksi' },
    );
  }
  if (shown < k) c.truncated.push({ group, shown, total: k });
  return node;
}

function expandDigit(ref: Extract<NodeRef, { kind: 'digit' }>, c: Ctx): NodeInfo {
  const { code, index } = ref;
  if (!/^\d+$/.test(code) || !Number.isInteger(index) || index < 0 || index >= code.length)
    return missingNode(c, ref, `${code}#${index}`, `Koodissa "${code}" ei ole paikkaa ${index + 1}.`);
  const L = code.length;
  const d = code[index];
  const facts: Fact[] = [
    { label: 'Numero', value: d, layer: 'matemaattinen' },
    { label: 'Paikka', value: `${index + 1}/${L}`, layer: 'matemaattinen' },
    { label: 'Koodi', value: code, layer: 'matemaattinen' },
  ];
  const node = nodeInfo(ref, `${d} (${index + 1}/${L} koodissa ${code})`, 'numeroportti · π-data', facts);
  if (!c.full) return node;

  const glosses = glossesFor(c.model, d, { kind: 'koodi', code });
  for (const { gloss, match } of glosses) {
    const ctxLabel = glossContextLabel(c.model, gloss.context);
    const relation =
      match === 'sama-konteksti'
        ? `tulkinta tässä koodissa: ${glossText(gloss)}`
        : match === 'tarina'
          ? `käyttäjän tarinan yleistulkinta: ${glossText(gloss)}`
          : `tulkinta toisessa kontekstissa (${ctxLabel}): ${glossText(gloss)}`;
    addGlossEdge(c, gloss, GROUPS.glosses, relation);
  }
  if (!glosses.length) c.notes.push(`Numerolle ${d} ei ole tulkintoja tarinassa.`);

  add(c, { kind: 'code', code }, {
    layer: 'matemaattinen',
    group: GROUPS.code,
    relation: `koodi ${code}`,
    trace: `Numero ${d} on koodin ${code} paikassa ${index + 1}/${L}.`,
  });

  const order = [...Array(L).keys()];
  if (c.dir === '432') order.reverse();
  const pos = order.indexOf(index);
  for (const j of order) {
    if (j === index) continue;
    const isNext = order.indexOf(j) === pos + 1;
    addDir(c, { kind: 'digit', code, index: j }, c.dir, 'koodi', {
      layer: 'matemaattinen',
      group: GROUPS.gates,
      relation: `${isNext ? 'seuraava portti' : 'portti'} ${j + 1}/${L}: ${code[j]}`,
      trace: `Koodin ${code} numero paikassa ${j + 1}/${L} on ${code[j]}.`,
    });
  }
  return node;
}

function expandHit(ref: Extract<NodeRef, { kind: 'hit' }>, c: Ctx): NodeInfo {
  const { code, n } = ref;
  const digits = c.env.digits;
  if (!/^\d+$/.test(code) || !Number.isInteger(n))
    return missingNode(c, ref, `${code} @${n}`, `Virheellinen osumaviite "${code}@${n}".`);
  const L = code.length;
  const ok = verifyHit(digits, code, n);
  const found = n >= 1 ? digits.slice(n - 1, n - 1 + L) : '';
  const a = c.env.anchor;
  const title = `${code} @${fmtIndex(n)}`;
  const check: Fact = {
    label: 'Tarkistus lähdeaineistosta',
    value: ok ? `${range(n, L)} = "${found}" ✓` : `${range(n, L)} = "${found}" ✗ (odotettiin "${code}")`,
    layer: 'matemaattinen',
    verified: ok,
  };
  if (!ok) {
    c.notes.push(
      c.N
        ? `Osumaa ${code} @${fmtIndex(n)} ei löydy lähdeaineistosta: kohdassa on "${found}".`
        : 'Aineistoa ei ole ladattu, joten osumaa ei voi tarkistaa.',
    );
    const node = nodeInfo(ref, title, 'osuma · EI löydy lähdeaineistosta', [check], { missing: true });
    if (!c.full) return node;
    add(c, { kind: 'code', code }, { layer: 'matemaattinen', group: GROUPS.code, relation: `koodi ${code}`, trace: `Viitteen koodi ${code}.` });
    if (n >= 1 && n <= c.N)
      add(c, { kind: 'position', n }, {
        layer: 'matemaattinen',
        group: GROUPS.position,
        relation: 'palaa π-indeksiin',
        trace: `Kohta n = ${n} on aineistossa (1 ≤ n ≤ ${c.N}).`,
        verified: true,
      });
    return node;
  }

  const hits = codeHits(digits, code);
  const idx = lowerBound(hits, n);
  const p = mapIndex(n);
  const bits = faceBits(p);
  const v = vogel(n);
  const kStar = localParastichyK(n);
  const phi = Math.atan2(p.y, p.x);
  const ctxSlice = sliceContext(digits, n, L, 5, 5);
  const off = n - ctxSlice.start;
  const names = namesForCode(c.model, code);
  const facts: Fact[] = [
    check,
    { label: 'Osuma', value: `${fmtIndex(idx + 1)}/${fmtIndex(hits.length)} koodin ${code} osumista (nouseva n)`, layer: 'matemaattinen' },
    {
      label: 'Konteksti',
      value: `${ctxSlice.start}…${ctxSlice.end}: ${ctxSlice.text.slice(0, off)}[${ctxSlice.text.slice(off, off + L)}]${ctxSlice.text.slice(off + L)}`,
      layer: 'matemaattinen',
    },
    {
      label: 'Δn ankkuriin',
      value:
        code === a.code && n === a.n
          ? '±0 (tämä on lähtöankkuri)'
          : `${fmtSignedIndex(n - a.n)} (ankkuri ${normName(a.label)} ${a.code} @${fmtIndex(a.n)})`,
      layer: 'matemaattinen',
    },
    {
      label: '3D-piste (mapIndex)',
      value: `(${p.x.toFixed(6)}, ${p.y.toFixed(6)}, ${p.z.toFixed(6)}) · ${FORMULA_VERSION}`,
      layer: 'geometrinen',
    },
    { label: 'Oktaedrin pinta', value: faceName(bits), layer: 'geometrinen' },
    { label: 'Atsimuutti φ (+Z-akselin ympäri)', value: `${((phi * 180) / Math.PI).toFixed(4)}°`, layer: 'geometrinen' },
    {
      label: 'Spiraalipiste (vogel)',
      value: `(${v.x.toFixed(3)}, ${v.y.toFixed(3)}), r = √n = ${Math.sqrt(n).toFixed(3)}`,
      layer: 'geometrinen',
    },
    {
      label: 'Spiraalin paikallinen k*',
      value: `k* = ${kStar} (F_${kStar} = ${FIB[kStar]}, √(5n) ≈ ${Math.sqrt(5 * n).toFixed(1)})`,
      layer: 'geometrinen',
    },
  ];
  if (names.length) facts.push({ label: 'Nimet', value: names.map((x) => `T9(${x}) = ${code}`).join(', '), layer: 'matemaattinen' });
  const node = nodeInfo(ref, title, `osuma · ${names.length ? names.join(' / ') + ' · ' : ''}tarkistettu lähdeaineistosta`, facts, {
    piPosition: { n, code },
  });
  if (!c.full) return node;

  // Koodi.
  add(c, { kind: 'code', code }, {
    layer: 'matemaattinen',
    group: GROUPS.code,
    relation: `koodi ${code}${names.length ? ` (${names.join(' / ')})` : ''}`,
    trace: `Osuman koodi: ${hitTrace(code, n)}`,
  });

  // Saman koodin seuraavat / edelliset osumat suunnassa.
  for (let j = 1; j <= SAME_CODE_NEIGHBORS; j++) {
    const at = c.dir === '234' ? idx + j : idx - j;
    if (at < 0 || at >= hits.length) break;
    const m = hits[at];
    addHit(
      c,
      code,
      m,
      {
        layer: 'matemaattinen',
        group: GROUPS.sameCode,
        relation: `${j}. ${c.dir === '234' ? 'seuraava' : 'edellinen'} osuma @${fmtIndex(m)} (Δn ${fmtSignedIndex(m - n)})`,
        trace: `findAll("${code}"): osuma ${at + 1}/${hits.length}, Δn = ${m} − ${n} = ${m - n}. ${hitTrace(code, m)}`,
        metrics: { n: m, Δn: m - n },
      },
      { dir: c.dir, domain: 'pi-indeksi' },
    );
  }
  if (c.dir === '234' && idx === hits.length - 1) c.notes.push(`Tämä on koodin ${code} viimeinen osuma aineistossa.`);
  if (c.dir === '432' && idx === 0) c.notes.push(`Tämä on koodin ${code} ensimmäinen osuma aineistossa.`);

  // Viitekoodien lähimmät osumat suunnassa.
  for (const r of c.refs) {
    if (r.code === code) continue; // saman koodin osumat ovat jo omassa ryhmässään
    const arr = codeHits(digits, r.code);
    const j = c.dir === '234' ? lowerBound(arr, n + 1) : lowerBound(arr, n) - 1;
    if (j < 0 || j >= arr.length) {
      c.notes.push(`Viitekoodilla ${r.name} ${r.code} ei ole osumaa suuntaan ${c.dir} kohdasta ${fmtIndex(n)}.`);
      continue;
    }
    const m = arr[j];
    addHit(
      c,
      r.code,
      m,
      {
        layer: 'matemaattinen',
        group: GROUPS.refNearest,
        relation: `lähin ${r.name} ${r.code} @${fmtIndex(m)} (Δn ${fmtSignedIndex(m - n)})`,
        trace: `${c.dir === '234' ? `pienin n' > ${n}` : `suurin n' < ${n}`} osumista findAll("${r.code}") → n' = ${m}; Δn = ${m} − ${n} = ${m - n}. ${hitTrace(r.code, m)}`,
        metrics: { n: m, Δn: m - n },
      },
      { dir: c.dir, domain: 'pi-indeksi' },
    );
  }

  // Fibonacci-naapurit spiraalissa.
  const pool = refPool(digits, c.refs);
  for (let k = Math.max(2, kStar - FIB_K_BELOW); k <= kStar + FIB_K_ABOVE && k < FIB.length; k++) {
    const F = FIB[k];
    const t = c.dir === '234' ? n + F : n - F;
    const expr = `${n} ${c.dir === '234' ? '+' : '−'} F_${k} = ${n} ${c.dir === '234' ? '+' : '−'} ${F} = ${t}`;
    if (t < 1 || t > c.N) {
      c.notes.push(`Fibonacci-naapuri ${expr} on aineiston ulkopuolella.`);
      continue;
    }
    const base = `Vogelin spiraali (${FORMULA_VERSION}): k* = localParastichyK(${n}) = ${kStar}; k = k* ${k - kStar >= 0 ? '+' : '−'} ${Math.abs(k - kStar)}; ${expr}. ${MAPPING_NOTE}`;
    const starts = c.refs.filter((r) => verifyHit(digits, r.code, t));
    const metrics = { k, F_k: F, Δn: t - n };
    const dirSpec = { dir: c.dir, domain: 'spiraali' as const };
    if (starts.length) {
      const r = starts[0];
      const extra = starts.length > 1 ? ` Samasta kohdasta alkavat myös: ${starts.slice(1).map((x) => `${x.name} ${x.code}`).join(', ')}.` : '';
      addHit(
        c,
        r.code,
        t,
        {
          layer: 'geometrinen',
          group: GROUPS.fib,
          relation: `F_${k} = ${F}: ${r.name} ${r.code} alkaa kohdasta ${fmtIndex(t)}`,
          trace: `${base} ${hitTrace(r.code, t)}${extra}`,
          metrics,
        },
        dirSpec,
      );
    } else
      addDir(c, { kind: 'position', n: t }, c.dir, 'spiraali', {
        layer: 'geometrinen',
        group: GROUPS.fib,
        relation: `F_${k} = ${F}: kohta ${fmtIndex(t)}`,
        trace: `${base} Kohdasta ${t} ei ala viitekoodin osumaa.`,
        verified: true,
        metrics,
      });
  }

  // 3D-lähimmät viitekoodien osumat (chord). Ei suuntaa.
  const top: { h: RefHit; d3: number }[] = [];
  for (const h of pool) {
    if (h.code === code && h.n === n) continue;
    const d3 = chordDistance(p, h.p);
    if (top.length === NEAREST_3D && d3 >= top[top.length - 1].d3) continue;
    top.push({ h, d3 });
    top.sort((x, y) => x.d3 - y.d3 || Math.abs(x.h.n - n) - Math.abs(y.h.n - n) || x.h.n - y.h.n || (x.h.code < y.h.code ? -1 : 1));
    if (top.length > NEAREST_3D) top.pop();
  }
  for (const { h, d3 } of top) {
    const rel = faceRelation(bits, h.face);
    addHit(c, h.code, h.n, {
      layer: 'geometrinen',
      group: GROUPS.near3d,
      relation: `${h.name} ${h.code} @${fmtIndex(h.n)} · d3 = ${d3.toFixed(6)} · pinta: ${rel}`,
      trace: `chord |mapIndex(${n}) − mapIndex(${h.n})| = ${d3.toFixed(9)} (${FORMULA_VERSION}); pinnat ${faceName(bits)} ja ${faceName(h.face)}: ${rel}. Suora 3D-etäisyys, ei pintaa pitkin. Haettu kaikista viitekoodien osumista (${pool.length}). ${MAPPING_NOTE} ${hitTrace(h.code, h.n)}`,
      metrics: { d3: Number(d3.toFixed(9)), Δn: h.n - n },
    });
  }

  // Oktaedrin atsimuuttinaapuri samalla pinnalla.
  if (Math.abs(p.x) + Math.abs(p.y) < 1e-12) c.notes.push('Piste on navalla: atsimuuttia ei ole määritelty.');
  else {
    let best: RefHit | null = null;
    let bestD = Infinity;
    for (const h of pool) {
      if (h.face !== bits || (h.code === code && h.n === n)) continue;
      if (Math.abs(h.p.x) + Math.abs(h.p.y) < 1e-12) continue;
      const dphi = c.dir === '234' ? normAngle(h.phi - phi) : normAngle(phi - h.phi);
      if (dphi <= 0 || dphi >= Math.PI) continue;
      if (dphi < bestD || (dphi === bestD && best && h.n < best.n)) {
        best = h;
        bestD = dphi;
      }
    }
    if (best) {
      const deg = (bestD * 180) / Math.PI;
      addHit(
        c,
        best.code,
        best.n,
        {
          layer: 'geometrinen',
          group: GROUPS.octa,
          relation: `${best.name} ${best.code} @${fmtIndex(best.n)} (Δφ ${deg.toFixed(4)}°)`,
          trace: `Pinnalla ${faceName(bits)} pienin Δφ ∈ (0°, 180°) ${c.dir === '234' ? 'vastapäivään' : 'myötäpäivään'}: φ = atan2(y, x) mapIndexistä (${FORMULA_VERSION}); φ(${n}) = ${((phi * 180) / Math.PI).toFixed(4)}°, φ(${best.n}) = ${((best.phi * 180) / Math.PI).toFixed(4)}°. ${MAPPING_NOTE} ${hitTrace(best.code, best.n)}`,
          metrics: { 'Δφ°': Number(deg.toFixed(6)), Δn: best.n - n },
        },
        { dir: c.dir, domain: 'oktaedri' },
      );
    } else c.notes.push(`Pinnalla ${faceName(bits)} ei ole viitekoodin osumaa suuntaan ${c.dir} (${DIRECTION_SEMANTICS.oktaedri[c.dir]}).`);
  }

  // Takaisin π-indeksiin.
  add(c, { kind: 'position', n }, {
    layer: 'matemaattinen',
    group: GROUPS.position,
    relation: 'palaa π-indeksiin',
    trace: `Osuman alkukohta n = ${n}.`,
    verified: true,
  });

  addNameEdgesForCode(c, code);
  return node;
}

function expandPosition(ref: Extract<NodeRef, { kind: 'position' }>, c: Ctx): NodeInfo {
  const n = ref.n;
  if (!Number.isInteger(n) || n < 1 || n > c.N)
    return missingNode(c, ref, `π-indeksi @${n}`, c.N ? `Kohta ${n} on aineiston ulkopuolella (1…${c.N}).` : 'Aineistoa ei ole ladattu.');
  const digits = c.env.digits;
  const d = digits[n - 1];
  const s = sliceContext(digits, n, 1, 5, 5);
  const off = n - s.start;
  const facts: Fact[] = [
    { label: 'Numero', value: `digits[${n}] = ${d}`, layer: 'matemaattinen', verified: true },
    {
      label: 'Konteksti n−5…n+5',
      value: `${s.start}…${s.end}: ${s.text.slice(0, off)}[${d}]${s.text.slice(off + 1)}`,
      layer: 'matemaattinen',
    },
  ];
  const node = nodeInfo(ref, `π-indeksi @${fmtIndex(n)}`, `kohta · numero ${d}`, facts, { piPosition: { n, code: null } });
  if (!c.full) return node;

  for (const r of c.refs) {
    const L = r.code.length;
    for (let st = Math.max(1, n - L + 1); st <= n; st++) {
      if (!verifyHit(digits, r.code, st)) continue;
      addHit(c, r.code, st, {
        layer: 'matemaattinen',
        group: GROUPS.atPosition,
        relation:
          st === n
            ? `${r.name} ${r.code} alkaa tästä kohdasta`
            : `${r.name} ${r.code} @${fmtIndex(st)} peittää kohdan (merkki ${n - st + 1}/${L})`,
        trace: `${hitTrace(r.code, st)} Kohta ${n} on välillä ${st}…${st + L - 1}.`,
        metrics: { n: st, Δn: st - n },
      });
    }
  }

  const steps: [Direction, number][] = [
    [c.dir, c.dir === '234' ? n + 1 : n - 1],
    [opposite(c.dir), c.dir === '234' ? n - 1 : n + 1],
  ];
  for (const [dd, t] of steps) {
    if (t < 1 || t > c.N) continue;
    addDir(c, { kind: 'position', n: t }, dd, 'pi-indeksi', {
      layer: 'matemaattinen',
      group: GROUPS.adjacent,
      relation: `${t > n ? 'seuraava' : 'edellinen'} kohta @${fmtIndex(t)}`,
      trace: `n = ${n} ${t > n ? '+' : '−'} 1 = ${t}; digits[${t}] = ${digits[t - 1]}.`,
      verified: true,
      metrics: { Δn: t - n },
    });
  }
  return node;
}

function expandGloss(ref: Extract<NodeRef, { kind: 'gloss' }>, c: Ctx): NodeInfo {
  const g = getGloss(c.model, ref.glossId);
  if (!g) return missingNode(c, ref, `${ref.glossId} (poistettu)`, `Tulkintaa "${ref.glossId}" ei ole tarinassa.`);
  const ctxLabel = glossContextLabel(c.model, g.context);
  const facts: Fact[] = [
    { label: 'Symboli', value: g.symbol, layer: 'symbolinen' },
    { label: 'Merkitykset', value: g.meanings.join(', ') || '–', layer: 'symbolinen' },
    { label: 'Konteksti', value: ctxLabel, layer: 'symbolinen' },
    { label: 'Lähde', value: g.source, layer: 'symbolinen' },
  ];
  if (g.note) facts.push({ label: 'Huomio', value: g.note, layer: 'symbolinen' });
  c.notes.push(SYMBOLIC_NOTE);
  const node = nodeInfo(ref, glossText(g), `tulkinta · ${ctxLabel} · käyttäjän tulkinta`, facts);
  if (!c.full) return node;

  if (g.personId != null) {
    const p = getPerson(c.model, g.personId);
    if (p)
      add(c, { kind: 'person', personId: p.id }, {
        layer: 'symbolinen',
        group: GROUPS.persons,
        relation: `tulkinnan henkilö ${personLabel(c.model, p)}`,
        trace: `Tulkinta "${g.id}" viittaa henkilöön "${p.id}" kontekstissa ${ctxLabel}. ${SYMBOLIC_NOTE}`,
      });
    else c.notes.push(`Tulkinnan henkilö "${g.personId}" puuttuu (poistettu).`);
  }
  if (g.name != null && normName(g.name))
    add(c, { kind: 'name', name: normName(g.name) }, {
      layer: 'symbolinen',
      group: GROUPS.names,
      relation: `tulkinnan nimi ${normName(g.name)}`,
      trace: `Tulkinta "${g.id}" viittaa nimeen ${normName(g.name)} kontekstissa ${ctxLabel}. ${SYMBOLIC_NOTE}`,
    });

  if (g.context.kind === 'koodi')
    add(c, { kind: 'code', code: g.context.code }, {
      layer: 'symbolinen',
      group: GROUPS.glossContext,
      relation: `tulkinnan konteksti: koodi ${g.context.code}`,
      trace: `Käyttäjä on sijoittanut tulkinnan "${g.id}" koodin ${g.context.code} sisälle. Konteksti on käyttäjän valinta.`,
    });
  else if (g.context.kind === 'polku') {
    const path = getPath(c.model, g.context.pathId);
    if (path)
      add(c, { kind: 'path', pathId: path.id }, {
        layer: 'symbolinen',
        group: GROUPS.glossContext,
        relation: `tulkinnan konteksti: ${path.title} · ${path.theme}`,
        trace: `Käyttäjä on sijoittanut tulkinnan "${g.id}" polun ${path.id} sisälle.`,
      });
    else c.notes.push(`Tulkinnan kontekstipolku "${g.context.pathId}" puuttuu (poistettu).`);
  }

  for (const { gloss, match } of glossesFor(c.model, g.symbol, g.context)) {
    if (gloss.id === g.id) continue;
    const l = glossContextLabel(c.model, gloss.context);
    addGlossEdge(
      c,
      gloss,
      GROUPS.otherGlosses,
      `${match === 'sama-konteksti' ? 'sama konteksti' : match === 'tarina' ? 'tarinan yleistulkinta' : l}: ${glossText(gloss)}`,
    );
  }
  return node;
}

function eventTime(e: MatrixEvent): number | null {
  const t = Date.parse(e.date);
  return Number.isFinite(t) ? t : null;
}

/** Tapahtumat aikajärjestyksessä suunnassa; päiväämättömät aina viimeisinä. */
function eventsInDirection(events: MatrixEvent[], dir: Direction): MatrixEvent[] {
  const known = events.filter((e) => eventTime(e) !== null);
  const unknown = events.filter((e) => eventTime(e) === null).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  known.sort((a, b) => eventTime(a)! - eventTime(b)! || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (dir === '432') known.reverse();
  return [...known, ...unknown];
}

function stepTarget(c: Ctx, s: PathStep): NodeRef {
  if (s.personId != null) {
    if (getPerson(c.model, s.personId)) return { kind: 'person', personId: s.personId };
    c.notes.push(`Askeleen henkilö "${s.personId}" puuttuu (poistettu); avataan nimi ${normName(s.name)}.`);
  }
  return { kind: 'name', name: normName(s.name) };
}

function stepName(c: Ctx, s: PathStep): string {
  return s.personId != null && getPerson(c.model, s.personId) ? personLabel(c.model, s.personId) : normName(s.name);
}

/** Polkujen tunnukset (määrittelyjärjestyksessä), joilla henkilö esiintyy. */
function pathIdsOfPerson(model: StoryModel, personId: string): string[] {
  const ids: string[] = [];
  for (const o of pathsOfPerson(model, personId)) if (!ids.includes(o.path.id)) ids.push(o.path.id);
  return ids;
}

function addContinuation(c: Ctx, path: StoryPath, index: number, label: string): void {
  const cont = continuation(path, index, c.dir);
  if (!cont.length) {
    c.notes.push(
      `${path.title}: ei jatkoa suuntaan ${c.dir} (${label} on polun ${c.dir === '234' ? 'viimeinen' : 'ensimmäinen'} askel).`,
    );
    return;
  }
  const chain: string[] = [];
  cont.forEach((s) => {
    chain.push(normName(s.name));
    const j = path.steps.indexOf(s);
    addDir(c, stepTarget(c, s), c.dir, 'tarina', {
      layer: 'symbolinen',
      group: GROUPS.continuation(c.dir),
      relation: `jatko ${pathPhrase(path)}: → ${chain.join(' → ')}`,
      trace: `Polku ${path.id}: askel ${index + 1} → askel ${j + 1}/${path.steps.length} (${stepName(c, s)}, symboli ${s.symbol}). Polun järjestys on käyttäjän määrittelemä.`,
    });
  });
}

function expandPerson(ref: Extract<NodeRef, { kind: 'person' }>, c: Ctx): NodeInfo {
  const p = getPerson(c.model, ref.personId);
  if (!p) return missingNode(c, ref, `${ref.personId} (poistettu)`, `Henkilöä "${ref.personId}" ei ole tarinassa.`);
  const label = personLabel(c.model, p);
  const name = normName(p.name);
  const same = personsByName(c.model, name);
  const facts: Fact[] = [
    { label: 'Nimi', value: name, layer: 'symbolinen' },
    { label: 'Näyttönimi', value: label, layer: 'symbolinen' },
  ];
  if (p.homonymOrdinal != null && same.length >= 2)
    facts.push({
      label: 'Järjestysnumero',
      value: `${p.homonymOrdinal}/${same.length} — samannimisten kronologinen järjestys (ei symbolinen numero)`,
      layer: 'ajallinen',
    });
  facts.push(
    { label: 'Roolit', value: p.roles.length ? p.roles.join(', ') : '–', layer: 'symbolinen' },
    { label: 'Kuvaus', value: p.description || '–', layer: 'symbolinen' },
    {
      label: 'Ajanjakso',
      value: p.period && (p.period.start || p.period.end) ? `${p.period.start ?? '?'} – ${p.period.end ?? ''}`.trim() : 'ajanjakso ei tiedossa',
      layer: 'ajallinen',
    },
    { label: 'Lähde', value: p.source, layer: 'symbolinen' },
  );
  const subtitle =
    p.homonymOrdinal != null && same.length >= 2
      ? `henkilö · samannimisistä ${ordinalWord(p.homonymOrdinal)} (kronologinen)`
      : 'henkilö · tarinakerros';
  const node = nodeInfo(ref, label, subtitle, facts);
  if (!c.full) return node;

  // Polut ja jatko suunnassa.
  const occ = pathsOfPerson(c.model, p.id);
  addPathEdges(
    c,
    occ.map((o) => o.path),
    (path) => `${path.title} · ${path.theme}: ${stepChain(path.steps)}`,
    (path) =>
      `Polku ${path.id}: henkilö "${p.id}" on askel ${occ
        .filter((o) => o.path.id === path.id)
        .map((o) => `${o.index + 1}/${path.steps.length}`)
        .join(', ')} (määrittelyjärjestys). Lähde: ${path.source}.`,
  );
  for (const o of occ) addContinuation(c, o.path, o.index, label);
  if (!occ.length) c.notes.push(`${label} ei ole millään polulla.`);

  const ids = pathIdsOfPerson(c.model, p.id);
  if (ids.length >= 2)
    add(c, { kind: 'junction', personId: p.id, pathIds: ids }, {
      layer: 'symbolinen',
      group: GROUPS.junction,
      relation: `yhdistä ${ids.map((id) => getPath(c.model, id)!.title).join(' + ')} henkilössä ${label}`,
      trace: `Henkilö "${p.id}" esiintyy poluilla ${ids.join(', ')}. Yhdistys näyttää haarat; alkuperäiset polut säilyvät.`,
    });

  // Nimi ja samannimiset.
  add(c, { kind: 'name', name }, {
    layer: 'symbolinen',
    group: GROUPS.names,
    relation: `nimi ${name}`,
    trace: `Henkilön "${p.id}" nimi on ${name}. Nimi ei yksilöi henkilöä.`,
  });
  if (same.length >= 2)
    add(c, { kind: 'homonyms', name }, {
      layer: 'symbolinen',
      group: GROUPS.homonyms,
      relation: `samannimiset ${name} (${same.length})`,
      trace: `Tarinamallissa ${same.length} henkilöä nimellä ${name}: ${same.map((x) => x.id).join(', ')}.`,
    });

  // Suhteet.
  for (const r of c.model.relations) {
    if (r.from !== p.id && r.to !== p.id) continue;
    const otherId = r.from === p.id ? r.to : r.from;
    const other = getPerson(c.model, otherId);
    if (!other) {
      c.notes.push(`Suhteen "${r.id}" toinen henkilö "${otherId}" puuttuu (poistettu).`);
      continue;
    }
    const fromL = personLabel(c.model, r.from);
    const toL = personLabel(c.model, r.to);
    add(c, { kind: 'person', personId: other.id }, {
      layer: 'symbolinen',
      group: GROUPS.relations,
      relation: `${fromL} on henkilön ${toL} ${r.kind}`,
      trace: `Tarinamallin suhde "${r.id}" (${r.from} → ${r.to}, laji "${r.kind}", lähde ${r.source}).${r.note ? ` ${r.note}` : ''}`,
    });
  }

  // Tapahtumat ajassa.
  const evs = eventsInDirection(
    c.env.events.filter((e) => e.personIds?.includes(p.id)),
    c.dir,
  );
  for (const e of evs)
    addDir(c, { kind: 'event', eventId: e.id }, c.dir, 'aika', {
      layer: 'ajallinen',
      group: GROUPS.events,
      relation: `${e.date} · ${e.title}`,
      trace: `Käyttäjän tapahtuma "${e.id}" (päivämäärä ${e.date}${eventTime(e) === null ? ', ei tulkittavissa: järjestetty viimeiseksi' : ''}); henkilö "${p.id}" on tapahtuman henkilöissä.`,
    });

  // Tulkinnat, jotka viittaavat henkilöön.
  for (const g of c.model.glosses)
    if (g.personId === p.id) addGlossEdge(c, g, GROUPS.glosses, `tulkinta: ${glossText(g)} (${glossContextLabel(c.model, g.context)})`);

  addCodeEdgeForName(c, name, 'nimen T9-koodi (sama kaikille samannimisille)');
  return node;
}

function expandHomonyms(ref: Extract<NodeRef, { kind: 'homonyms' }>, c: Ctx): NodeInfo {
  const name = normName(ref.name);
  const chron = homonymChronology(c.model, name);
  if (!chron.persons.length) return missingNode(c, ref, `${name} · samannimiset`, `Nimellä ${name} ei ole henkilöitä tarinassa.`);
  const facts: Fact[] = [
    { label: 'Henkilöitä', value: String(chron.persons.length), layer: 'symbolinen' },
    { label: 'Kronologian peruste', value: CHRONOLOGY_LABELS[chron.basis], layer: 'ajallinen' },
    { label: 'Huomio', value: 'Sama nimi ja sama T9-koodi eivät tee henkilöistä samaa henkilöä.', layer: 'symbolinen' },
  ];
  if (chron.persons.length === 1) c.notes.push(`Nimellä ${name} on vain yksi henkilö.`);
  const node = nodeInfo(ref, `${name} · samannimiset (${chron.persons.length})`, 'samannimisten kronologinen verkko', facts);
  if (!c.full) return node;

  const ordered = c.dir === '234' ? chron.persons : [...chron.persons].reverse();
  const basisTrace = `Kronologian peruste: ${CHRONOLOGY_LABELS[chron.basis]}.`;
  ordered.forEach((p, i) =>
    addDir(c, { kind: 'person', personId: p.id }, c.dir, 'aika', {
      layer: 'ajallinen',
      group: GROUPS.homonymPersons,
      relation: `${i + 1}. ${personLabel(c.model, p)}`,
      trace: `Henkilö "${p.id}" (järjestysnumero ${p.homonymOrdinal ?? '–'}, ajanjakso ${p.period?.start ?? 'ei tiedossa'}). ${basisTrace}`,
    }),
  );
  for (let i = 1; i < ordered.length; i++) {
    const a = ordered[i - 1];
    const b = ordered[i];
    addDir(c, { kind: 'person', personId: b.id }, c.dir, 'aika', {
      layer: 'ajallinen',
      group: GROUPS.chronology,
      relation: `${personLabel(c.model, a)} → ${personLabel(c.model, b)} (kronologinen järjestys)`,
      trace: `"${a.id}" → "${b.id}". ${basisTrace}`,
    });
  }
  addCodeEdgeForName(c, name, 'nimen T9-koodi (sama kaikille samannimisille)');
  return node;
}

function expandPath(ref: Extract<NodeRef, { kind: 'path' }>, c: Ctx): NodeInfo {
  const path = getPath(c.model, ref.pathId);
  if (!path) return missingNode(c, ref, `${ref.pathId} (poistettu)`, `Polkua "${ref.pathId}" ei ole tarinassa.`);
  const s = symbolString(path, c.dir);
  const match = c.refs.find((r) => r.code === s) ?? null;
  const matchText = match
    ? `symbolinen numerojono ${s} = ${genitive(match.name)} T9-koodi (merkkijonojen yhtäläisyys käyttäjän antamien numeroiden ja koodin välillä, ei π-havainto)`
    : null;
  const facts: Fact[] = [
    { label: 'Teema', value: path.theme || '–', layer: 'symbolinen' },
    { label: 'Huomio', value: path.note || '–', layer: 'symbolinen' },
    {
      label: 'Hypoteesin ajoitus',
      value: `${HYPOTHESIS_LABELS[path.hypothesis.timing]}${path.hypothesis.note ? ` — ${path.hypothesis.note}` : ''}`,
      layer: 'symbolinen',
    },
    { label: `Symbolinen numerojono (${c.dir})`, value: s || '–', layer: 'symbolinen' },
    { label: `Symbolinen numerojono (${opposite(c.dir)})`, value: symbolString(path, opposite(c.dir)) || '–', layer: 'symbolinen' },
    { label: 'Lähde', value: path.source, layer: 'symbolinen' },
  ];
  if (matchText) facts.push({ label: 'Merkkijonon yhtäläisyys', value: matchText, layer: 'symbolinen' });
  const node = nodeInfo(ref, `${path.title} · ${path.theme}`, `polku · ${path.steps.length} askelta · ${HYPOTHESIS_LABELS[path.hypothesis.timing]}`, facts);
  if (!c.full) return node;

  const steps = stepsInDirection(path, c.dir);
  steps.forEach((st, i) => {
    const j = path.steps.indexOf(st);
    addDir(c, stepTarget(c, st), c.dir, 'tarina', {
      layer: 'symbolinen',
      group: GROUPS.steps(c.dir),
      relation: `${i + 1}. ${normName(st.name)} (${st.symbol})${st.stage ? ` · ${st.stage}` : ''}`,
      trace: `Polku ${path.id}, määrittelyjärjestyksen askel ${j + 1}/${path.steps.length}: ${stepName(c, st)}${st.personId ? ` (henkilö "${st.personId}")` : ' (vain nimi)'}, symboli ${st.symbol}. Symboli on käyttäjän antama, ei henkilön järjestysnumero.`,
    });
  });

  if (match && matchText)
    add(c, { kind: 'code', code: match.code }, {
      layer: 'symbolinen',
      group: GROUPS.symbolMatch,
      relation: matchText,
      trace: `symbolString(${path.id}, '${c.dir}') = "${s}"; ${t9Trace(match.name)}. Merkkijonot ovat samat; tämä ei ole π-aineistosta tehty havainto.${path.note ? ` Polun huomio: ${path.note}` : ''}`,
    });

  // Yhdistettävät polut yhteisten henkilöiden kautta.
  const seen = new Set<string>();
  for (const st of path.steps) {
    if (st.personId == null || seen.has(st.personId) || !getPerson(c.model, st.personId)) continue;
    seen.add(st.personId);
    const ids = pathIdsOfPerson(c.model, st.personId);
    if (ids.length < 2) continue;
    const label = personLabel(c.model, st.personId);
    add(c, { kind: 'junction', personId: st.personId, pathIds: ids }, {
      layer: 'symbolinen',
      group: GROUPS.junction,
      relation: `yhdistä ${ids.map((id) => getPath(c.model, id)!.title).join(' + ')} henkilössä ${label}`,
      trace: `Henkilö "${st.personId}" esiintyy poluilla ${ids.join(', ')}. Alkuperäiset polut säilyvät.`,
    });
  }
  return node;
}

function expandJunction(ref: Extract<NodeRef, { kind: 'junction' }>, c: Ctx): NodeInfo {
  const p = getPerson(c.model, ref.personId);
  if (!p) return missingNode(c, ref, `${ref.personId} (poistettu)`, `Yhdistyksen henkilöä "${ref.personId}" ei ole tarinassa.`);
  const label = personLabel(c.model, p);
  const j = junction(c.model, p.id, ref.pathIds, c.dir);
  for (const id of j.missing) c.notes.push(`Polkua "${id}" ei ole, tai ${label} ei ole sillä.`);
  const titles = [...new Set(j.branches.map((b) => b.path.title))];
  const facts: Fact[] = [
    { label: 'Henkilö', value: label, layer: 'symbolinen' },
    { label: 'Haaroja', value: String(j.branches.length), layer: 'symbolinen' },
    { label: 'Huomio', value: 'Alkuperäiset polut säilyvät muuttumattomina.', layer: 'symbolinen' },
  ];
  if (!j.branches.length) {
    c.notes.push(`${label} ei ole yhdelläkään annetuista poluista.`);
    return nodeInfo(ref, `Yhdistys: ${label}`, 'polkujen yhdistys · ei haaroja', facts, { missing: true });
  }
  const node = nodeInfo(ref, `Yhdistys: ${label}`, `polkujen yhdistys · ${titles.join(' + ')}`, facts);
  if (!c.full) return node;

  add(c, { kind: 'person', personId: p.id }, {
    layer: 'symbolinen',
    group: GROUPS.persons,
    relation: `yhdistävä henkilö ${label}`,
    trace: `Henkilö "${p.id}" on kaikilla haaroilla.`,
  });
  for (const b of j.branches) {
    add(c, { kind: 'path', pathId: b.path.id }, {
      layer: 'symbolinen',
      group: GROUPS.branches,
      relation: `${b.path.title} · ${b.path.theme}: ${stepChain(b.path.steps)}`,
      trace: `Polku ${b.path.id} säilyy sellaisenaan; ${label} on askel ${b.index + 1}/${b.path.steps.length}.`,
    });
    b.before.forEach((st, t) => {
      const k = b.path.steps.indexOf(st);
      addDir(c, stepTarget(c, st), c.dir, 'tarina', {
        layer: 'symbolinen',
        group: GROUPS.leading(c.dir),
        relation: `edeltävä askel ${pathPhrase(b.path)}: ${stepChain(b.before.slice(t))} → ${label}`,
        trace: `Polku ${b.path.id}: askel ${k + 1} johtaa askeleeseen ${b.index + 1} (${label}).`,
      });
    });
    const chain: string[] = [];
    b.after.forEach((st) => {
      chain.push(normName(st.name));
      const k = b.path.steps.indexOf(st);
      addDir(c, stepTarget(c, st), c.dir, 'tarina', {
        layer: 'symbolinen',
        group: GROUPS.continuation(c.dir),
        relation: `jatko ${pathPhrase(b.path)}: → ${chain.join(' → ')}`,
        trace: `Polku ${b.path.id}: askel ${b.index + 1} → askel ${k + 1}/${b.path.steps.length} (${stepName(c, st)}).`,
      });
    });
    if (!b.after.length) c.notes.push(`${b.path.title}: ei jatkoa suuntaan ${c.dir} henkilöstä ${label}.`);
  }
  return node;
}

function expandEvent(ref: Extract<NodeRef, { kind: 'event' }>, c: Ctx): NodeInfo {
  const e = c.env.events.find((x) => x.id === ref.eventId);
  if (!e) return missingNode(c, ref, `${ref.eventId} (poistettu)`, `Tapahtumaa "${ref.eventId}" ei ole.`);
  const facts: Fact[] = [
    { label: 'Päivämäärä', value: e.date || '–', layer: 'ajallinen' },
    { label: 'Huomio', value: e.note || '–', layer: 'symbolinen' },
  ];
  if (eventTime(e) === null) c.notes.push(`Tapahtuman päivämäärää "${e.date}" ei voi tulkita; se ei ole aikajärjestyksessä.`);
  const node = nodeInfo(ref, e.title, `tapahtuma · ${e.date}`, facts);
  if (!c.full) return node;

  for (const pid of e.personIds ?? []) {
    const p = getPerson(c.model, pid);
    if (!p) {
      c.notes.push(`Tapahtuman henkilö "${pid}" puuttuu (poistettu).`);
      continue;
    }
    add(c, { kind: 'person', personId: p.id }, {
      layer: 'symbolinen',
      group: GROUPS.persons,
      relation: `henkilö ${personLabel(c.model, p)}`,
      trace: `Käyttäjä on liittänyt tapahtuman "${e.id}" henkilön "${p.id}" aikajanaan.`,
    });
  }

  for (const key of e.linkedHits) {
    const i = key.lastIndexOf('@');
    const n = i >= 0 ? Number(key.slice(i + 1)) : NaN;
    const termId = i >= 0 ? key.slice(0, i) : key;
    if (!Number.isInteger(n) || n < 1 || n > c.N) {
      c.notes.push(`Linkitettyä osumaa "${key}" ei voi avata: kohta ei ole aineistossa.`);
      continue;
    }
    add(c, { kind: 'position', n }, {
      layer: 'matemaattinen',
      group: GROUPS.linkedHits,
      relation: `käyttäjän linkittämä osuma ${termId} @${fmtIndex(n)}`,
      trace: `käyttäjän linkki "${key}" (hakutermi "${termId}"; termin koodi ei ole matriisin tiedossa, joten linkki avataan π-indeksinä ${n}).`,
      verified: true,
    });
  }

  const sorted = eventsInDirection(
    c.env.events.filter((x) => eventTime(x) !== null),
    '234',
  );
  const at = sorted.findIndex((x) => x.id === e.id);
  if (at >= 0) {
    const nextIn: [Direction, MatrixEvent | undefined][] = [
      ['234', sorted[at + 1]],
      ['432', sorted[at - 1]],
    ];
    if (c.dir === '432') nextIn.reverse();
    for (const [dd, other] of nextIn) {
      if (!other) continue;
      addDir(c, { kind: 'event', eventId: other.id }, dd, 'aika', {
        layer: 'ajallinen',
        group: GROUPS.eventOrder,
        relation: `${dd === '234' ? 'seuraava' : 'edellinen'} tapahtuma: ${other.date} · ${other.title}`,
        trace: `Tapahtumat päivämäärän mukaan: "${e.id}" (${e.date}) ${dd === '234' ? '→' : '←'} "${other.id}" (${other.date}).`,
      });
    }
  }
  return node;
}

// ------------------------------------------------------------------ julkinen rajapinta

function run(ref: NodeRef, env: MatrixEnv, full: boolean, hitLimit: number): Expansion {
  const c: Ctx = {
    env,
    model: env.story,
    dir: env.direction,
    from: ref,
    N: env.digits.length,
    full,
    hitLimit,
    edges: [],
    notes: [],
    truncated: [],
    refs: referenceCodes(env.story),
  };
  let node: NodeInfo;
  switch (ref.kind) {
    case 'root':
      node = expandRoot(ref, c);
      break;
    case 'name':
      node = expandName(ref, c);
      break;
    case 'code':
      node = expandCode(ref, c);
      break;
    case 'digit':
      node = expandDigit(ref, c);
      break;
    case 'hit':
      node = expandHit(ref, c);
      break;
    case 'position':
      node = expandPosition(ref, c);
      break;
    case 'gloss':
      node = expandGloss(ref, c);
      break;
    case 'person':
      node = expandPerson(ref, c);
      break;
    case 'homonyms':
      node = expandHomonyms(ref, c);
      break;
    case 'path':
      node = expandPath(ref, c);
      break;
    case 'junction':
      node = expandJunction(ref, c);
      break;
    case 'event':
      node = expandEvent(ref, c);
      break;
    default: {
      const k = (ref as { kind?: unknown }).kind;
      node = missingNode(c, ref, String(k), `Tuntematon solmutyyppi "${String(k)}".`);
    }
  }
  return { node, edges: c.edges, truncated: c.truncated, notes: [...new Set(c.notes)] };
}

/** Solmun tiedot ilman särmiä (murupolku, otsikot). */
export function describe(ref: NodeRef, env: MatrixEnv): NodeInfo {
  return run(ref, env, false, 0).node;
}

/** Solmun tiedot ja kaikki siitä lähtevät särmät. `hitLimit` rajaa koodisolmun osumalistan (oletus 5000). */
export function expand(ref: NodeRef, env: MatrixEnv, opts: { hitLimit?: number } = {}): Expansion {
  const lim = opts.hitLimit;
  const hitLimit = lim != null && Number.isFinite(lim) && lim >= 0 ? Math.floor(lim) : DEFAULT_HIT_LIMIT;
  return run(ref, env, true, hitLimit);
}
