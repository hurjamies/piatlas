// Tarinamatriisin sovellustila: tyypit ja puhtaat apufunktiot. Määrittely: docs/MATRIISI.md.
// Tämä tiedosto ei tuo Reactia eikä storea, joten sen voi testata node-ympäristössä
// (tests/matrix-state.test.ts). Tilaa muuttavat toiminnot ovat tiedostossa matrix-actions.ts.
//
// Kaksi kerrosta pidetään erillään myös tallennuksessa: tarinamalli (`story`) on käyttäjän symbolista tietoa,
// ja reitin π-kerroksen faktat (`mathFacts`) tarkistetaan aina uudelleen lähdeaineistosta.

import { digitsAt } from '../core/digits';
import { expand, fmtIndex, GROUPS } from '../core/matrix/expand';
import { codeHits, expectedHits, verifyHit } from '../core/matrix/hits';
import type { JumpResult } from '../core/matrix/jumps';
import type { Op369Report } from '../core/matrix/ops369';
import { t9Code } from '../core/matrix/refs';
import type { RouteOrder, RouteTestResult } from '../core/matrix/route-test';
import { createSeedStory } from '../core/matrix/seed';
import { getPerson, personLabel } from '../core/matrix/story';
import { openEdge, rootTrail } from '../core/matrix/trail';
import type {
  Direction,
  Gloss,
  GlossContext,
  HypothesisMeta,
  HypothesisTiming,
  Identifier,
  Layer,
  MatrixEnv,
  MatrixEvent,
  MatrixLogEntry,
  MatrixLogKind,
  PathStep,
  Person,
  Relation,
  SavedRoute,
  StoryModel,
  StoryPath,
  StorySource,
  TrailStep,
} from '../core/matrix/types';
import { HYPOTHESIS_LABELS, MAX_DEPTH, MATRIX_VERSION, nodeKey, normName, parseNodeKey } from '../core/matrix/types';
import { classify, type Verdict } from '../core/stats';

// ------------------------------------------------------------------ tyypit

export type MatrixViewMode = 'verkko' | 'lista';
export type MatrixSub = null | 'tarina' | 'reitit' | 'loki';

/** Reittitestin hypoteesin lukitus (SHA-256). Vastaa Testit-välilehden esirekisteröintiä. */
export interface RouteLock {
  id: string;
  createdAt: string;
  text: string;
  codes: string[];
  names: string[];
  order: RouteOrder;
  datasetSha: string | null;
  /** SHA-256 kanonisesta sisällöstä (canonicalRouteLock) + aikaleimasta. */
  hash: string;
  /** Arvio lukitushetkellä: 'ennen-löydöstä' vain, jos samaa kysymystä ei ollut vielä ajettu. */
  timing: HypothesisTiming;
  reason: string;
}

/** Reittitestin tiivistelmä lokiin ja tallennukseen (ilman nollamallin raakadataa). +∞ tallennetaan null-arvona. */
export interface RouteRunSummary {
  id: string;
  ts: string;
  version: string;
  codes: string[];
  names: string[];
  order: RouteOrder;
  R: number;
  seed: number;
  seedText: string;
  randomStrings: number;
  N: number;
  datasetSha: string | null;
  counts: number[];
  expected: number[];
  lens: number[];
  /** Havaittu lyhin ikkuna; null = valinta mahdoton. */
  span: number | null;
  picks: number[] | null;
  picksVerified: boolean[] | null;
  pValue: number;
  pLow: number;
  pHigh: number;
  shareGreater: number;
  nullMedian: number | null;
  nullQ05: number | null;
  nullQ95: number | null;
  impossibleNull: number;
  randomShareLE: number | null;
  alpha: number;
  verdict: Verdict;
  timing: HypothesisTiming;
  timingReason: string;
  lockId: string | null;
  lockHash: string | null;
  definition: string;
  durationMs: number;
}

export interface MatrixState {
  story: StoryModel;
  trail: TrailStep[];
  direction: Direction;
  saved: SavedRoute[];
  log: MatrixLogEntry[];
  /** Avatut solmuavaimet, viimeksi avattu viimeisenä. */
  visited: string[];
  last369: Op369Report | null;
  lastJump: JumpResult | null;
  routeRuns: RouteRunSummary[];
  /** Lisäkenttä tehtävänannon listaan: reittihypoteesien lukitukset (tarvitaan ajoituksen todentamiseen). */
  locks: RouteLock[];
  view: MatrixViewMode;
  sub: MatrixSub;
}

export const LOG_PERSIST = 500;
export const LOG_MEMORY = 2000;
export const VISITED_PERSIST = 2000;
export const VISITED_MEMORY = 4000;
export const RUNS_PERSIST = 300;
/** Reittitestin merkitsevyystaso (sama oletus kuin Testit-välilehdellä). */
export const ROUTE_ALPHA = 0.05;

/** Ensimmäinen reittitesti (docs/MATRIISI.md §7): MAX, HANNA, SALLA, IDA. */
export const FIRST_ROUTE_NAMES = ['MAX', 'HANNA', 'SALLA', 'IDA'] as const;

export function initialMatrixState(): MatrixState {
  return {
    story: createSeedStory(),
    trail: rootTrail(),
    direction: '234',
    saved: [],
    log: [],
    visited: ['root'],
    last369: null,
    lastJump: null,
    routeRuns: [],
    locks: [],
    view: 'verkko',
    sub: null,
  };
}

/** Matriisin ympäristö sovelluksen tilasta. Ankkuri on sama kuin muissa näkymissä. */
export function matrixEnvOf(
  app: { digits: string; anchor: { code: string; n: number; label: string }; events: MatrixEvent[] },
  m: Pick<MatrixState, 'story' | 'direction'>,
): MatrixEnv {
  return {
    digits: app.digits,
    story: m.story,
    anchor: { code: app.anchor.code, n: app.anchor.n, label: app.anchor.label },
    direction: m.direction,
    events: app.events,
  };
}

// ------------------------------------------------------------------ tallennusmuoto

export interface PersistedStep {
  key: string;
  via: TrailStep['via'];
}

export type PersistedRoute = Omit<SavedRoute, 'trail'> & { trail: PersistedStep[] };

export interface PersistedMatrix {
  v: 1;
  story: StoryModel;
  trail: PersistedStep[];
  direction: Direction;
  saved: PersistedRoute[];
  log: MatrixLogEntry[];
  visited: string[];
  routeRuns: RouteRunSummary[];
  locks: RouteLock[];
  view: MatrixViewMode;
}

export function serializeTrail(trail: TrailStep[]): PersistedStep[] {
  return trail.map((s) => ({ key: nodeKey(s.ref), via: s.via ? { ...s.via } : null }));
}

export function serializeMatrix(m: MatrixState): PersistedMatrix {
  return {
    v: 1,
    story: m.story,
    trail: serializeTrail(m.trail),
    direction: m.direction,
    saved: m.saved.map((r) => ({ ...r, trail: serializeTrail(r.trail) })),
    log: m.log.slice(-LOG_PERSIST),
    visited: m.visited.slice(-VISITED_PERSIST),
    routeRuns: m.routeRuns.slice(-RUNS_PERSIST),
    locks: m.locks,
    view: m.view,
  };
}

// ------------------------------------------------------------------ tarkistimet (lataus ja tuonti)

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const str = (x: unknown, d = ''): string => (typeof x === 'string' ? x : d);
const strOrNull = (x: unknown): string | null => (typeof x === 'string' ? x : null);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const strArr = (x: unknown): string[] => (Array.isArray(x) ? x.filter(isStr) : []);
const source = (x: unknown): StorySource => (x === 'tehtävänanto' ? 'tehtävänanto' : 'käyttäjä');

const LAYERS: readonly Layer[] = ['matemaattinen', 'geometrinen', 'ajallinen', 'symbolinen'];
const TIMINGS: readonly HypothesisTiming[] = ['ennen-löydöstä', 'löydön-jälkeen', 'ei-tiedossa'];
const LOG_KINDS: readonly MatrixLogKind[] = ['avaus', 'suunta', '369', 'hyppy', 'tallennus', 'vertailu', 'tarkistus', 'tarina'];
const ORDERS: readonly RouteOrder[] = ['mikä-tahansa', '234', '432'];
const VERDICTS: readonly Verdict[] = ['ei-poikkeamaa', 'eksploratiivinen', 'lukittu-alle-alfa'];

function sanitizeIdentifier(x: unknown): Identifier | null {
  if (!isObj(x) || !isStr(x.name) || !normName(x.name) || !isStr(x.code)) return null;
  return {
    name: x.name,
    code: x.code,
    encoding: 'T9',
    reportedPositions: Array.isArray(x.reportedPositions)
      ? x.reportedPositions.filter((n): n is number => Number.isInteger(n) && (n as number) >= 1)
      : [],
    reportedBy: str(x.reportedBy),
  };
}

function sanitizePerson(x: unknown): Person | null {
  if (!isObj(x) || !isStr(x.id) || !x.id || !isStr(x.name)) return null;
  const ord = x.homonymOrdinal;
  let period: Person['period'] = null;
  if (isObj(x.period)) period = { start: strOrNull(x.period.start), end: strOrNull(x.period.end) };
  return {
    id: x.id,
    name: x.name,
    homonymOrdinal: typeof ord === 'number' && Number.isFinite(ord) ? ord : null,
    description: str(x.description),
    roles: strArr(x.roles),
    period,
    source: source(x.source),
    createdAt: str(x.createdAt),
  };
}

function sanitizeRelation(x: unknown): Relation | null {
  if (!isObj(x) || !isStr(x.id) || !x.id || !isStr(x.from) || !isStr(x.to)) return null;
  return { id: x.id, from: x.from, to: x.to, kind: str(x.kind), note: str(x.note), source: source(x.source) };
}

function sanitizeContext(x: unknown): GlossContext | null {
  if (!isObj(x)) return null;
  if (x.kind === 'tarina') return { kind: 'tarina' };
  if (x.kind === 'koodi' && isStr(x.code)) return { kind: 'koodi', code: x.code };
  if (x.kind === 'polku' && isStr(x.pathId)) return { kind: 'polku', pathId: x.pathId };
  return null;
}

function sanitizeGloss(x: unknown): Gloss | null {
  if (!isObj(x) || !isStr(x.id) || !x.id || !isStr(x.symbol)) return null;
  const context = sanitizeContext(x.context);
  if (!context) return null;
  return {
    id: x.id,
    symbol: x.symbol,
    meanings: strArr(x.meanings),
    context,
    personId: strOrNull(x.personId),
    name: strOrNull(x.name),
    note: str(x.note),
    source: source(x.source),
    createdAt: str(x.createdAt),
  };
}

function sanitizeStep(x: unknown): PathStep | null {
  if (!isObj(x) || !isStr(x.name)) return null;
  return { name: x.name, personId: strOrNull(x.personId), symbol: str(x.symbol), stage: str(x.stage) };
}

function sanitizeHypothesis(x: unknown): HypothesisMeta {
  if (!isObj(x)) return { timing: 'ei-tiedossa', statedAt: null, lockHash: null, note: '' };
  const timing = TIMINGS.includes(x.timing as HypothesisTiming) ? (x.timing as HypothesisTiming) : 'ei-tiedossa';
  const lockHash = strOrNull(x.lockHash);
  // 'ennen-löydöstä' ilman tiivistettä ei ole todennettavissa → ei-tiedossa.
  return {
    timing: timing === 'ennen-löydöstä' && !lockHash ? 'ei-tiedossa' : timing,
    statedAt: strOrNull(x.statedAt),
    lockHash,
    note: str(x.note),
  };
}

function sanitizePath(x: unknown): StoryPath | null {
  if (!isObj(x) || !isStr(x.id) || !x.id || !Array.isArray(x.steps)) return null;
  const steps = x.steps.map(sanitizeStep);
  if (steps.some((s) => s === null)) return null;
  return {
    id: x.id,
    title: str(x.title, x.id),
    theme: str(x.theme),
    steps: steps as PathStep[],
    note: str(x.note),
    source: source(x.source),
    hypothesis: sanitizeHypothesis(x.hypothesis),
    createdAt: str(x.createdAt),
  };
}

function sanitizeList<T>(raw: unknown, f: (x: unknown) => T | null, label: string, dropped: string[]): T[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    dropped.push(`${label}: kenttä ei ollut lista, joten se ohitettiin.`);
    return [];
  }
  const out: T[] = [];
  let bad = 0;
  for (const x of raw) {
    const v = f(x);
    if (v) out.push(v);
    else bad++;
  }
  if (bad) dropped.push(`${label}: ${bad} virheellistä kohdetta ohitettiin.`);
  return out;
}

/**
 * Tarinamallin rakenteellinen tarkistus (lataus ja JSON-tuonti). Palauttaa null, jos syöte ei ole tarinamalli
 * lainkaan (ei olio tai versio ≠ 1). Muuten virheelliset kohteet ohitetaan yksitellen ja ilmoitetaan, jotta
 * käyttäjän muut tiedot säilyvät. Sisällöllinen eheys tarkistetaan erikseen (story.ts: validateStory).
 */
export function sanitizeStory(raw: unknown): { story: StoryModel | null; dropped: string[] } {
  const dropped: string[] = [];
  if (!isObj(raw)) return { story: null, dropped: ['Tarinamalli puuttuu tai ei ole JSON-olio.'] };
  if (raw.version !== 1) return { story: null, dropped: [`Tuntematon tarinamallin versio ${JSON.stringify(raw.version)} (odotettiin 1).`] };
  const story: StoryModel = {
    version: 1,
    seedVersion: str(raw.seedVersion),
    identifiers: sanitizeList(raw.identifiers, sanitizeIdentifier, 'Lähtötunnisteet', dropped),
    persons: sanitizeList(raw.persons, sanitizePerson, 'Henkilöt', dropped),
    relations: sanitizeList(raw.relations, sanitizeRelation, 'Suhteet', dropped),
    glosses: sanitizeList(raw.glosses, sanitizeGloss, 'Tulkinnat', dropped),
    paths: sanitizeList(raw.paths, sanitizePath, 'Polut', dropped),
  };
  return { story, dropped };
}

function sanitizeVia(x: unknown): TrailStep['via'] | undefined {
  if (x === null) return null;
  if (!isObj(x) || !LAYERS.includes(x.layer as Layer)) return undefined;
  return {
    relation: str(x.relation),
    layer: x.layer as Layer,
    crossesRealm: x.crossesRealm === true,
    trace: str(x.trace),
    group: str(x.group),
  };
}

/**
 * Tallennettu reitti takaisin askeliksi. Ensimmäisen askeleen on oltava juuri; ensimmäinen virheellinen askel
 * katkaisee reitin (alku säilyy). Palauttaa aina vähintään juuren.
 */
export function deserializeTrail(raw: unknown): { trail: TrailStep[]; cut: boolean } {
  if (!Array.isArray(raw) || !raw.length) return { trail: rootTrail(), cut: raw !== undefined };
  const out: TrailStep[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.length && out.length < MAX_DEPTH; i++) {
    const s = raw[i];
    if (!isObj(s) || !isStr(s.key)) break;
    const ref = parseNodeKey(s.key);
    if (!ref) break;
    if (i === 0) {
      if (ref.kind !== 'root') break;
      out.push({ ref, via: null });
      seen.add('root');
      continue;
    }
    const via = sanitizeVia(s.via);
    const key = nodeKey(ref);
    if (!via || seen.has(key)) break;
    seen.add(key);
    out.push({ ref, via });
  }
  if (!out.length) return { trail: rootTrail(), cut: true };
  return { trail: out, cut: out.length !== raw.length };
}

function sanitizeLogEntry(x: unknown): MatrixLogEntry | null {
  if (!isObj(x) || !isStr(x.ts) || !isStr(x.text) || !LOG_KINDS.includes(x.kind as MatrixLogKind)) return null;
  return { ts: x.ts, kind: x.kind as MatrixLogKind, text: x.text, ...(isStr(x.ref) ? { ref: x.ref } : {}) };
}

function sanitizeSavedRoute(x: unknown): SavedRoute | null {
  if (!isObj(x) || !isStr(x.id) || !isStr(x.title)) return null;
  const { trail } = deserializeTrail(x.trail);
  return {
    id: x.id,
    title: x.title,
    createdAt: str(x.createdAt),
    trail,
    direction: x.direction === '432' ? '432' : '234',
    interpretation: str(x.interpretation),
    hypothesis: sanitizeHypothesis(x.hypothesis),
    mathFacts: strArr(x.mathFacts),
    crossings: Array.isArray(x.crossings) ? x.crossings.filter((n): n is number => Number.isInteger(n)) : [],
    matrixVersion: str(x.matrixVersion, MATRIX_VERSION),
  };
}

const numOrNull = (x: unknown): number | null => (isNum(x) ? x : null);
const numArr = (x: unknown): number[] => (Array.isArray(x) ? x.filter(isNum) : []);

function sanitizeRun(x: unknown): RouteRunSummary | null {
  if (!isObj(x) || !isStr(x.id) || !isStr(x.ts) || !Array.isArray(x.codes) || !isNum(x.pValue)) return null;
  const order = ORDERS.includes(x.order as RouteOrder) ? (x.order as RouteOrder) : null;
  if (!order) return null;
  return {
    id: x.id,
    ts: x.ts,
    version: str(x.version),
    codes: strArr(x.codes),
    names: strArr(x.names),
    order,
    R: isNum(x.R) ? x.R : 0,
    seed: isNum(x.seed) ? x.seed : 0,
    seedText: str(x.seedText),
    randomStrings: isNum(x.randomStrings) ? x.randomStrings : 0,
    N: isNum(x.N) ? x.N : 0,
    datasetSha: strOrNull(x.datasetSha),
    counts: numArr(x.counts),
    expected: numArr(x.expected),
    lens: numArr(x.lens),
    span: numOrNull(x.span),
    picks: Array.isArray(x.picks) ? numArr(x.picks) : null,
    picksVerified: Array.isArray(x.picksVerified) ? x.picksVerified.map((b) => b === true) : null,
    pValue: x.pValue,
    pLow: isNum(x.pLow) ? x.pLow : NaN,
    pHigh: isNum(x.pHigh) ? x.pHigh : NaN,
    shareGreater: isNum(x.shareGreater) ? x.shareGreater : NaN,
    nullMedian: numOrNull(x.nullMedian),
    nullQ05: numOrNull(x.nullQ05),
    nullQ95: numOrNull(x.nullQ95),
    impossibleNull: isNum(x.impossibleNull) ? x.impossibleNull : 0,
    randomShareLE: numOrNull(x.randomShareLE),
    alpha: isNum(x.alpha) ? x.alpha : ROUTE_ALPHA,
    verdict: VERDICTS.includes(x.verdict as Verdict) ? (x.verdict as Verdict) : 'eksploratiivinen',
    timing: TIMINGS.includes(x.timing as HypothesisTiming) ? (x.timing as HypothesisTiming) : 'ei-tiedossa',
    timingReason: str(x.timingReason),
    lockId: strOrNull(x.lockId),
    lockHash: strOrNull(x.lockHash),
    definition: str(x.definition),
    durationMs: isNum(x.durationMs) ? x.durationMs : 0,
  };
}

function sanitizeLock(x: unknown): RouteLock | null {
  if (!isObj(x) || !isStr(x.id) || !isStr(x.createdAt) || !isStr(x.hash) || !isStr(x.text)) return null;
  const order = ORDERS.includes(x.order as RouteOrder) ? (x.order as RouteOrder) : null;
  if (!order) return null;
  return {
    id: x.id,
    createdAt: x.createdAt,
    text: x.text,
    codes: strArr(x.codes),
    names: strArr(x.names),
    order,
    datasetSha: strOrNull(x.datasetSha),
    hash: x.hash,
    timing: TIMINGS.includes(x.timing as HypothesisTiming) ? (x.timing as HypothesisTiming) : 'ei-tiedossa',
    reason: str(x.reason),
  };
}

/**
 * Tallennettu matriisitila takaisin. Ei koskaan heitä poikkeusta: puuttuva tai virheellinen data korvataan
 * oletuksilla (tarina: testitapauksen siemendata). Käyttäjän tallentamaa tarinaa ei korvata siemenellä, jos se
 * on rakenteeltaan tarinamalli; vain virheelliset kohteet ohitetaan ja ilmoitetaan `warnings`-listassa.
 */
export function deserializeMatrix(raw: unknown): { state: MatrixState; warnings: string[] } {
  const base = initialMatrixState();
  const warnings: string[] = [];
  if (raw === undefined || raw === null) return { state: base, warnings };
  if (!isObj(raw)) return { state: base, warnings: ['Tallennettu matriisitila oli virheellinen; käytetään oletuksia ja testitapauksen siemendataa.'] };
  try {
    let story = base.story;
    if (raw.story !== undefined) {
      const r = sanitizeStory(raw.story);
      if (r.story) {
        story = r.story;
        warnings.push(...r.dropped.map((d) => `Tallennettu tarina: ${d}`));
      } else warnings.push(`Tallennettua tarinaa ei voitu lukea (${r.dropped.join(' ')}); käytetään testitapauksen siemendataa.`);
    }
    const t = deserializeTrail(raw.trail);
    if (t.cut && raw.trail !== undefined) warnings.push(`Tallennettu reitti katkaistiin ${t.trail.length} askeleeseen virheellisen askeleen kohdalta.`);
    const visited = strArr(raw.visited).slice(-VISITED_PERSIST);
    return {
      state: {
        ...base,
        story,
        trail: t.trail,
        direction: raw.direction === '432' ? '432' : '234',
        saved: sanitizeList(raw.saved, sanitizeSavedRoute, 'Tallennetut reitit', warnings),
        log: sanitizeList(raw.log, sanitizeLogEntry, 'Matriisin loki', warnings).slice(-LOG_PERSIST),
        visited: visited.length ? visited : ['root'],
        routeRuns: sanitizeList(raw.routeRuns, sanitizeRun, 'Reittitestit', warnings).slice(-RUNS_PERSIST),
        locks: sanitizeList(raw.locks, sanitizeLock, 'Reittihypoteesien lukitukset', warnings),
        view: raw.view === 'lista' ? 'lista' : 'verkko',
      },
      warnings,
    };
  } catch (e) {
    return { state: base, warnings: [`Matriisitilan lataus epäonnistui (${e instanceof Error ? e.message : String(e)}); käytetään oletuksia.`] };
  }
}

// ------------------------------------------------------------------ reitin π-faktat

function digitRange(n: number, L: number): string {
  return L <= 1 ? fmtIndex(n) : `${fmtIndex(n)}–${fmtIndex(n + L - 1)}`;
}

/** Yhden osuman tarkistus muodossa "42662 @858 610 ✓ digits 858 610–858 614 = 42662". */
export function hitFact(digits: string, code: string, n: number): string {
  const L = code.length;
  const found = Number.isInteger(n) && n >= 1 ? digitsAt(digits, n, L) : '';
  const ok = verifyHit(digits, code, n);
  return `${code} @${fmtIndex(n)} ${ok ? '✓' : '✗'} digits ${digitRange(n, L)} = ${found || '–'}${ok ? '' : ` ≠ ${code}`}`;
}

function fmtExpectedPlain(x: number): string {
  if (!Number.isFinite(x)) return '–';
  if (x >= 100) return fmtIndex(x);
  if (x >= 1) return x.toFixed(1).replace('.', ',');
  return String(Number(x.toPrecision(2))).replace('.', ',');
}

/**
 * Reitin π-kerroksen faktat tarkistettuina lähdeaineistosta tallennushetkellä: jokainen osuma, koodi, numero
 * ja kohta sekä nimien T9-koodit. Tarinakerroksen solmuista ei tuoteta matemaattisia faktoja.
 */
export function routeMathFacts(
  trail: TrailStep[],
  digits: string,
  anchor: { code: string; n: number; label: string },
  story: StoryModel,
): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    if (!out.includes(s)) out.push(s);
  };
  const N = digits.length;
  for (const st of trail) {
    const r = st.ref;
    switch (r.kind) {
      case 'root':
        push(`Lähtöankkuri ${normName(anchor.label)}: ${hitFact(digits, anchor.code, anchor.n)}`);
        break;
      case 'hit':
        push(hitFact(digits, r.code, r.n));
        break;
      case 'code': {
        if (!/^\d+$/.test(r.code)) {
          push(`koodi "${r.code}" ✗ ei numerojono`);
          break;
        }
        const k = codeHits(digits, r.code).length;
        push(`koodi ${r.code}: ${fmtIndex(k)} osumaa aineistossa (N = ${fmtIndex(N)}, odotus ${fmtExpectedPlain(expectedHits(N, r.code.length))}) ✓ laskettu`);
        break;
      }
      case 'digit': {
        const d = r.code[r.index];
        push(
          d != null && /^\d$/.test(d)
            ? `numero ${d} = koodin ${r.code} paikka ${r.index + 1}/${r.code.length} ✓`
            : `koodin ${r.code} paikka ${r.index + 1} ✗ puuttuu`,
        );
        break;
      }
      case 'position':
        push(
          Number.isInteger(r.n) && r.n >= 1 && r.n <= N
            ? `π-indeksi @${fmtIndex(r.n)} ✓ digits ${fmtIndex(r.n)} = ${digits[r.n - 1]}`
            : `π-indeksi @${fmtIndex(r.n)} ✗ aineiston ulkopuolella (1 … ${fmtIndex(N)})`,
        );
        break;
      case 'name':
      case 'homonyms': {
        const code = t9Code(r.name);
        if (code) push(`T9(${normName(r.name)}) = ${code} ✓ (koodi on nimen ominaisuus)`);
        break;
      }
      case 'person': {
        const p = getPerson(story, r.personId);
        const code = p ? t9Code(p.name) : null;
        if (p && code) push(`T9(${normName(p.name)}) = ${code} ✓ (henkilön ${personLabel(story, p)} nimen koodi, ei henkilön tunniste)`);
        break;
      }
      default:
        break;
    }
  }
  return out;
}

// ------------------------------------------------------------------ hypoteesin ajoitus

/** Reittikysymyksen identiteetti: koodit järjestyksessä, järjestysehto ja aineisto. R, siemen ja jonot eivät muuta kysymystä. */
export function routeQuestionKey(codes: string[], order: RouteOrder, datasetSha: string | null): string {
  return JSON.stringify([codes, order, datasetSha ?? '']);
}

/** Lukituksen kanoninen sisältö SHA-256:ta varten (avaimet aakkosjärjestyksessä + aikaleima). */
export function canonicalRouteLock(text: string, codes: string[], order: RouteOrder, datasetSha: string | null, createdAt: string): string {
  return `${JSON.stringify([
    ['codes', codes],
    ['datasetSha', datasetSha ?? ''],
    ['order', order],
    ['text', text],
    ['version', MATRIX_VERSION],
  ])}\n${createdAt}`;
}

/** ISO-aikaleima luettavaksi ilman kieliasetusta: "2026-10-16 16:39:22 UTC". */
export function isoShort(ts: string): string {
  return /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(ts) ? `${ts.slice(0, 10)} ${ts.slice(11, 19)} UTC` : ts;
}

export interface TimingVerdict {
  timing: HypothesisTiming;
  reason: string;
  preregistered: boolean;
}

/**
 * Sama sääntö kuin Testit-välilehden esirekisteröinnissä: 'ennen-löydöstä' vain, jos hypoteesi lukittiin ennen
 * kuin samaa reittikysymystä (koodit + järjestys + aineisto) oli ajettu kertaakaan. Muuten 'löydön-jälkeen'
 * (kysymys on jo nähty) tai 'ei-tiedossa' (ei lukitusta eikä aiempia ajoja).
 */
export function evaluateRouteTiming(
  lock: Pick<RouteLock, 'codes' | 'order' | 'datasetSha' | 'createdAt' | 'hash'> | null,
  runs: Pick<RouteRunSummary, 'codes' | 'order' | 'datasetSha' | 'ts'>[],
  codes: string[],
  order: RouteOrder,
  datasetSha: string | null,
): TimingVerdict {
  const key = routeQuestionKey(codes, order, datasetSha);
  const same = runs.filter((r) => routeQuestionKey(r.codes, r.order, r.datasetSha) === key);
  const usable = lock && routeQuestionKey(lock.codes, lock.order, lock.datasetSha) === key ? lock : null;
  if (usable) {
    const before = same.filter((r) => r.ts < usable.createdAt);
    if (!before.length)
      return {
        timing: 'ennen-löydöstä',
        reason: `Hypoteesi lukittiin ${isoShort(usable.createdAt)} (SHA-256 ${usable.hash.slice(0, 12)}…) ennen yhtäkään saman reittikysymyksen ajoa.`,
        preregistered: true,
      };
    return {
      timing: 'löydön-jälkeen',
      reason:
        `Sama reittikysymys (koodit ${codes.join(' → ')}, järjestys ${order}) ajettiin jo ${before.length} kertaa ennen lukitusta ` +
        `(ensimmäinen ${isoShort(before[0].ts)}). Lukitus tehtiin tuloksen näkemisen jälkeen, joten se ei ole ennakkoon tehty.`,
      preregistered: false,
    };
  }
  const note = lock ? ' Valittu lukitus koskee eri kysymystä (koodit tai järjestys eroavat).' : '';
  if (same.length)
    return {
      timing: 'löydön-jälkeen',
      reason: `Sama reittikysymys on jo ajettu ${same.length} kertaa, eikä hypoteesia lukittu ennen ensimmäistä ajoa.${note}`,
      preregistered: false,
    };
  return {
    timing: 'ei-tiedossa',
    reason: `Hypoteesia ei lukittu ennen ajoa, joten sen ajoitusta suhteessa löytöihin ei voi todentaa.${note}`,
    preregistered: false,
  };
}

/**
 * Tallennettavan reitin hypoteesitieto. 'ennen-löydöstä' hyväksytään vain voimassa olevalla lukituksella
 * (evaluateRouteTiming antaa 'ennen-löydöstä'); muuten pyyntö muutetaan muotoon 'löydön-jälkeen' ja syy kerrotaan.
 */
export function savedRouteHypothesis(
  requested: HypothesisTiming,
  lock: RouteLock | null,
  runs: RouteRunSummary[],
  nowIso: string,
): { meta: HypothesisMeta; downgraded: string | null } {
  if (requested === 'ennen-löydöstä') {
    const v = lock ? evaluateRouteTiming(lock, runs, lock.codes, lock.order, lock.datasetSha) : null;
    if (lock && v?.preregistered)
      return {
        meta: { timing: 'ennen-löydöstä', statedAt: lock.createdAt, lockHash: lock.hash, note: `Lukittu hypoteesi: ${lock.text}` },
        downgraded: null,
      };
    const why = lock
      ? v!.reason
      : 'Valittuna ei ole lukittua hypoteesia. Lukitse hypoteesi Reitit-sivulla ennen saman reittikysymyksen ensimmäistä ajoa.';
    return {
      meta: { timing: 'löydön-jälkeen', statedAt: nowIso, lockHash: null, note: why },
      downgraded: `”${HYPOTHESIS_LABELS['ennen-löydöstä']}” edellyttää SHA-256-lukitusta ennen ensimmäistä ajoa. ${why} Reitti merkitään: ${HYPOTHESIS_LABELS['löydön-jälkeen'].toLowerCase()}.`,
    };
  }
  return { meta: { timing: requested, statedAt: nowIso, lockHash: null, note: '' }, downgraded: null };
}

// ------------------------------------------------------------------ reitin koodit

export interface NamedCode {
  name: string;
  code: string;
}

/** Nimi tai numerojono koodiksi: numerot sellaisenaan (RAW), muuten T9. null, jos ei koodattavissa. */
export function namedCode(input: string): NamedCode | null {
  const s = input.trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return { name: s, code: s };
  const code = t9Code(s);
  return code ? { name: normName(s), code } : null;
}

function uniqueCodes(list: (NamedCode | null)[]): NamedCode[] {
  const out: NamedCode[] = [];
  for (const c of list) if (c && !out.some((x) => x.code === c.code)) out.push(c);
  return out;
}

/** Reitin solmuista koodit järjestyksessä (nimet T9:llä, koodit ja osumat sellaisenaan). Sama koodi kerran. */
export function routeCodesFromTrail(trail: TrailStep[], story: StoryModel): NamedCode[] {
  const names = new Map<string, string>();
  for (const id of story.identifiers) {
    const c = t9Code(id.name);
    if (c && !names.has(c)) names.set(c, normName(id.name));
  }
  for (const p of story.persons) {
    const c = t9Code(p.name);
    if (c && !names.has(c)) names.set(c, normName(p.name));
  }
  return uniqueCodes(
    trail.map(({ ref }) => {
      switch (ref.kind) {
        case 'name':
        case 'homonyms':
          return namedCode(ref.name);
        case 'person': {
          const p = getPerson(story, ref.personId);
          return p ? namedCode(p.name) : null;
        }
        case 'code':
        case 'hit':
          return { name: names.get(ref.code) ?? ref.code, code: ref.code };
        default:
          return null;
      }
    }),
  );
}

export function routeCodesFromPath(path: StoryPath): NamedCode[] {
  return uniqueCodes(path.steps.map((s) => namedCode(s.name)));
}

export function firstRouteCodes(): NamedCode[] {
  return uniqueCodes(FIRST_ROUTE_NAMES.map((n) => namedCode(n)));
}

// ------------------------------------------------------------------ reittitestin tiivistelmä

const finiteOrNull = (x: number): number | null => (Number.isFinite(x) ? x : null);

export function summarizeRouteRun(
  res: RouteTestResult,
  meta: {
    id: string;
    ts: string;
    names: string[];
    seedText: string;
    datasetSha: string | null;
    digits: string;
    timing: TimingVerdict;
    lock: RouteLock | null;
  },
): RouteRunSummary {
  const p = res.params;
  const picks = res.observed ? res.observed.picks.slice() : null;
  const verdict = classify(res.pValue, ROUTE_ALPHA, meta.timing.preregistered).verdict;
  return {
    id: meta.id,
    ts: meta.ts,
    version: res.version,
    codes: [...p.codes],
    names: [...meta.names],
    order: p.order,
    R: p.R,
    seed: p.seed,
    seedText: meta.seedText,
    randomStrings: p.randomStrings ?? 0,
    N: p.N,
    datasetSha: meta.datasetSha,
    counts: [...p.counts],
    expected: p.lens.map((L) => expectedHits(p.N, L)),
    lens: [...p.lens],
    span: res.observed ? finiteOrNull(res.observed.span) : null,
    picks,
    picksVerified: picks ? picks.map((n, i) => verifyHit(meta.digits, p.codes[i], n)) : null,
    pValue: res.pValue,
    pLow: res.pLow,
    pHigh: res.pHigh,
    shareGreater: res.shareGreater,
    nullMedian: finiteOrNull(res.nullMedian),
    nullQ05: finiteOrNull(res.nullQ05),
    nullQ95: finiteOrNull(res.nullQ95),
    impossibleNull: res.impossibleNull,
    randomShareLE: res.randomStrings ? res.randomStrings.shareLE : null,
    alpha: ROUTE_ALPHA,
    verdict,
    timing: meta.timing.timing,
    timingReason: meta.timing.reason,
    lockId: meta.timing.preregistered && meta.lock ? meta.lock.id : null,
    lockHash: meta.timing.preregistered && meta.lock ? meta.lock.hash : null,
    definition: res.definition,
    durationMs: res.durationMs,
  };
}

// ------------------------------------------------------------------ osumasta matriisiin

/** Ryhmä askeleelle, jolle juuresta ei ole suoraa särmää (hakutermin osuma avattiin toisesta näkymästä). */
export const OPENED_FROM_HIT_GROUP = 'Avattu osumasta';

/**
 * Reitti juuri → koodi → osuma todellisia expand()-särmiä pitkin. Jos juuresta ei ole särmää koodiin (koodi ei ole
 * lähtötunniste), koodiaskel merkitään näkyvästi avatuksi osumasta (`direct = false`). Osuma tarkistetaan aina.
 */
export function trailToHit(env: MatrixEnv, code: string, n: number, sourceLabel: string): { trail: TrailStep[]; direct: boolean } {
  let trail = rootTrail();
  let direct = true;
  const rootEdges = expand({ kind: 'root' }, env, { hitLimit: 0 }).edges;
  const toCode = rootEdges.filter((e) => e.to.kind === 'code' && e.to.code === code);
  const ce = toCode.find((e) => e.group === GROUPS.identifierCodes) ?? toCode[0];
  if (ce) trail = openEdge(trail, ce).trail;
  else {
    direct = false;
    trail = [
      ...trail,
      {
        ref: { kind: 'code', code },
        via: {
          relation: `avattu osumasta: hakutermi ${sourceLabel}`,
          layer: 'matemaattinen',
          crossesRealm: false,
          trace: `Käyttäjä avasi koodin ${code} hakutermin ${sourceLabel} osumasta. Juuresta ei ole särmää tähän koodiin, koska se ei ole lähtötunniste.`,
          group: OPENED_FROM_HIT_GROUP,
        },
      },
    ];
  }
  const hitEdges = expand({ kind: 'code', code }, env).edges.filter((e) => e.to.kind === 'hit' && e.to.code === code && e.to.n === n);
  const he = hitEdges.find((e) => e.group.startsWith('Kaikki osumat')) ?? hitEdges[0];
  if (he) trail = openEdge(trail, he).trail;
  else {
    direct = false;
    const ok = verifyHit(env.digits, code, n);
    trail = [
      ...trail,
      {
        ref: { kind: 'hit', code, n },
        via: {
          relation: `osuma @${fmtIndex(n)} (avattu osumasta)`,
          layer: 'matemaattinen',
          crossesRealm: false,
          trace: `${hitFact(env.digits, code, n)}. Osuma ei ollut koodisolmun näytetyssä osumalistassa${ok ? '' : ', eikä se täsmää lähdeaineistoon'}.`,
          group: OPENED_FROM_HIT_GROUP,
        },
      },
    ];
  }
  return { trail, direct };
}
