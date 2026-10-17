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
import { createSeedStory, TASK_TIMING, TASK_TIMING_NOTE } from '../core/matrix/seed';
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
import { HYPOTHESIS_LABELS, MAX_DEPTH, MATRIX_VERSION, nodeKey, normName, parseNodeKey, realmOf } from '../core/matrix/types';
import { benjaminiHochberg, classify, fmtP, type Verdict, type VerdictInfo } from '../core/stats';

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

/** Yhden reittikysymyksen (kanoninen avain) ajohistoria: ensimmäisen ajon aika ja ajojen määrä. */
export interface RouteQuestionStat {
  first: string;
  count: number;
}

/**
 * Pysyvä, rajaamaton hakemisto kaikista reittitestiajoista. `routeRuns` rajataan tallennettaessa (RUNS_PERSIST),
 * mutta ajoitussääntö ja monivertailun m lasketaan tästä, joten vanhat ajot eivät unohdu.
 */
export interface RouteRunIndex {
  /** Kanoninen kysymysavain (routeQuestionKey) → ensimmäinen ajo ja ajojen määrä. */
  questions: Record<string, RouteQuestionStat>;
  /** Kaikkien reittitestiajojen määrä. */
  total: number;
}

/** Reittitestin lomake. Pidetään storessa, jotta se säilyy, kun Reitit-sivulta poistutaan ja palataan. */
export interface RouteTestForm {
  sourceId: string;
  excluded: string[];
  extra: NamedCode[];
  order: RouteOrder;
  R: number;
  seedText: string;
  strings: number;
  hyp: string;
}

/** Käynnissä oleva reittitesti (vain muistissa). */
export interface RouteTestRunning {
  done: number;
  total: number;
  startedAt: string;
  /** Ajon reitti ja parametrit tekstinä, koska lomaketta voi muuttaa ajon aikana. */
  label: string;
}

/** Reittitestin käyttöliittymätila storessa (ei tallenneta laitteelle). */
export interface RouteTestUi {
  form: RouteTestForm;
  running: RouteTestRunning | null;
  error: string | null;
  /** Viimeisimmän ajon nollamallin arvot histogrammia varten. */
  last: { id: string; nullValues: Float64Array } | null;
  selected: string | null;
}

export function initialRouteTestUi(): RouteTestUi {
  return {
    form: { sourceId: 'first', excluded: [], extra: [], order: 'mikä-tahansa', R: 1000, seedText: '20261016', strings: 0, hyp: '' },
    running: null,
    error: null,
    last: null,
    selected: null,
  };
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
  /** Kaikkien ajojen rajaamaton hakemisto (ajoitussääntö ja monivertailu). */
  runIndex: RouteRunIndex;
  /** Lisäkenttä tehtävänannon listaan: reittihypoteesien lukitukset (tarvitaan ajoituksen todentamiseen). */
  locks: RouteLock[];
  view: MatrixViewMode;
  sub: MatrixSub;
  /** Reittitestin lomake ja käynnissä oleva ajo (vain muistissa). */
  routeTest: RouteTestUi;
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
    runIndex: emptyRunIndex(),
    locks: [],
    view: 'verkko',
    sub: null,
    routeTest: initialRouteTestUi(),
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
  /** Rajaamaton ajohakemisto. Puuttuu vanhasta tallennuksesta: rakennetaan silloin tallennetuista ajoista. */
  runIndex: RouteRunIndex;
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
    runIndex: m.runIndex,
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

const sameCodeSet = (a: readonly string[], b: readonly string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

/**
 * Polun ajoitus lukituksia vasten (lataus ja JSON-tuonti). Tehtävänannon polku on aina 'löydön-jälkeen'
 * (TASK_TIMING). 'ennen-löydöstä' säilyy vain, jos tiiviste vastaa tämän laitteen lukitusta, joka koskee samoja
 * koodeja; muuten 'ei-tiedossa' ja syy kirjataan `dropped`-listaan.
 */
function checkPathTiming(p: StoryPath, locks: readonly Pick<RouteLock, 'hash' | 'codes'>[], dropped: string[]): StoryPath {
  const h = p.hypothesis;
  if (p.source === 'tehtävänanto') {
    if (h.timing === 'löydön-jälkeen') return p;
    if (h.timing === 'ennen-löydöstä')
      dropped.push(
        `Polku ”${p.title}”: tehtävänannon polku ei voi olla ”${HYPOTHESIS_LABELS['ennen-löydöstä']}”, joten se merkitään ”${HYPOTHESIS_LABELS['löydön-jälkeen']}”.`,
      );
    return { ...p, hypothesis: { ...TASK_TIMING } };
  }
  if (h.timing !== 'ennen-löydöstä') return p;
  const codes = routeCodesFromPath(p).map((c) => c.code);
  if (locks.some((l) => l.hash === h.lockHash && sameCodeSet(l.codes, codes))) return p;
  dropped.push(
    `Polku ”${p.title}”: ajoitus ”${HYPOTHESIS_LABELS['ennen-löydöstä']}” muutettiin muotoon ”${HYPOTHESIS_LABELS['ei-tiedossa']}”, ` +
      `koska tiivistettä ${(h.lockHash ?? '').slice(0, 12)}… vastaavaa samojen koodien lukitusta ei ole tällä laitteella.`,
  );
  return {
    ...p,
    hypothesis: {
      timing: 'ei-tiedossa',
      statedAt: h.statedAt,
      lockHash: null,
      note: `${h.note ? `${h.note} ` : ''}(Ajoitus ”ennen löydöstä” hylättiin: ei vastaavaa lukitusta tällä laitteella.)`.trim(),
    },
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
 *
 * Polun ajoitus ”ennen löydöstä” hyväksytään vain, jos sen tiiviste vastaa jotakin `locks`-listan lukitusta
 * (tämän laitteen lukitukset). Ilman lukituksia jokainen tällainen väite muutetaan muotoon 'ei-tiedossa'.
 */
export function sanitizeStory(
  raw: unknown,
  locks: readonly Pick<RouteLock, 'hash' | 'codes'>[] = [],
): { story: StoryModel | null; dropped: string[] } {
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
    paths: [],
  };
  story.paths = sanitizeList(raw.paths, sanitizePath, 'Polut', dropped).map((p) => checkPathTiming(p, locks, dropped));
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

/**
 * Lukitus ladattaessa. Tiivisteen on oltava SHA-256-muotoa (64 heksamerkkiä); sisältöä ei lasketa uudelleen, koska
 * lukitus on tämän laitteen oma kirjaus (käyttöliittymä: ”lukittu tällä laitteella”).
 */
function sanitizeLock(x: unknown): RouteLock | null {
  if (!isObj(x) || !isStr(x.id) || !isStr(x.createdAt) || !isStr(x.hash) || !isStr(x.text)) return null;
  if (!/^[0-9a-f]{64}$/.test(x.hash)) return null;
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

/** Ajohakemisto ladattaessa. Avaimet muutetaan kanonisiksi (routeQuestionKey); virheelliset ohitetaan. */
function sanitizeRunIndex(x: unknown): RouteRunIndex {
  const out = emptyRunIndex();
  if (!isObj(x)) return out;
  if (isObj(x.questions)) {
    for (const [k, v] of Object.entries(x.questions)) {
      if (!isObj(v) || !isStr(v.first) || !isNum(v.count) || v.count < 1) continue;
      let key: string | null = null;
      try {
        const q = JSON.parse(k) as unknown;
        if (Array.isArray(q) && Array.isArray(q[0]) && q[0].every(isStr) && ORDERS.includes(q[1] as RouteOrder) && isStr(q[2]))
          key = routeQuestionKey(q[0] as string[], q[1] as RouteOrder, q[2] || null);
      } catch {
        key = null;
      }
      if (!key) continue;
      const prev = out.questions[key];
      out.questions[key] = prev
        ? { first: prev.first <= v.first ? prev.first : v.first, count: prev.count + Math.floor(v.count) }
        : { first: v.first, count: Math.floor(v.count) };
    }
  }
  out.total = isNum(x.total) && x.total > 0 ? Math.floor(x.total) : 0;
  return out;
}

/** Tallennettu hakemisto ja tallennetut ajot yhteen: jokainen tallennettu ajo on hakemistossa vähintään kerran. */
export function mergeRunIndex(stored: RouteRunIndex, runs: readonly Pick<RouteRunSummary, 'codes' | 'order' | 'datasetSha' | 'ts'>[]): RouteRunIndex {
  const fromRuns = buildRunIndex(runs);
  const questions: Record<string, RouteQuestionStat> = { ...stored.questions };
  for (const [k, v] of Object.entries(fromRuns.questions)) {
    const s = questions[k];
    questions[k] = s ? { first: s.first <= v.first ? s.first : v.first, count: Math.max(s.count, v.count) } : v;
  }
  const sum = Object.values(questions).reduce((a, v) => a + v.count, 0);
  return { questions, total: Math.max(stored.total, sum) };
}

/**
 * Tallennettujen ajojen ajoitus ladattaessa: 'ennen-löydöstä' säilyy vain, jos (1) tiivistettä vastaava saman
 * kysymyksen lukitus on tällä laitteella ja se tehtiin ennen ajoa, (2) ajo oli koodijoukon ensimmäinen ja (3) reitti
 * ei tule tehtävänannosta. Luokitus lasketaan aina uudelleen (classifyRouteRun). Palauttaa muutettujen määrän.
 */
function recheckRuns(
  runs: RouteRunSummary[],
  locks: readonly RouteLock[],
  index: RouteRunIndex,
  story: StoryModel,
): { runs: RouteRunSummary[]; changed: number } {
  let changed = 0;
  const out = runs.map((r0) => {
    let r = r0;
    if (r.timing === 'ennen-löydöstä') {
      const key = routeQuestionKey(r.codes, r.order, r.datasetSha);
      const lock = locks.find((l) => l.hash === r.lockHash && l.createdAt < r.ts && routeQuestionKey(l.codes, l.order, l.datasetSha) === key);
      const first = familyExposure(index, r.codes, r.datasetSha).first;
      const task = taskDerivedReason(r.codes, story);
      let timing: HypothesisTiming | null = null;
      let why = '';
      if (!lock) {
        timing = 'ei-tiedossa';
        why = 'vastaavaa saman kysymyksen lukitusta ei löytynyt tältä laitteelta';
      } else if (task) {
        timing = 'löydön-jälkeen';
        why = task;
      } else if (first && first < r.ts) {
        timing = 'löydön-jälkeen';
        why = `ajo ei ollut koodijoukon ensimmäinen (ensimmäinen ${isoShort(first)}); lukitus kattaa vain ensimmäisen ajon`;
      }
      if (timing) {
        changed++;
        r = {
          ...r,
          timing,
          lockId: null,
          lockHash: null,
          timingReason: `Tallennettu ajoitus ”${HYPOTHESIS_LABELS['ennen-löydöstä']}” hylättiin ladattaessa: ${why}`,
        };
      }
    }
    const verdict = classifyRouteRun(r).verdict;
    return verdict === r.verdict ? r : { ...r, verdict };
  });
  return { runs: out, changed };
}

/** Tallennetun reitin ajoitus ladattaessa: 'ennen-löydöstä' vain, jos tiiviste vastaa samojen koodien lukitusta. */
function recheckSavedRoute(r: SavedRoute, locks: readonly RouteLock[], story: StoryModel): SavedRoute | null {
  if (r.hypothesis.timing !== 'ennen-löydöstä') return null;
  const codes = routeCodesFromTrail(r.trail, story).map((c) => c.code);
  const ok = locks.some((l) => l.hash === r.hypothesis.lockHash && lockMatchesCodes(l, codes));
  const task = taskDerivedReason(codes, story);
  if (ok && !task) return null;
  const why = ok && task ? task : 'ei vastaavaa samojen koodien lukitusta tällä laitteella.';
  return {
    ...r,
    hypothesis: {
      ...r.hypothesis,
      timing: ok ? 'löydön-jälkeen' : 'ei-tiedossa',
      lockHash: null,
      note: `${r.hypothesis.note ? `${r.hypothesis.note} ` : ''}(Ajoitus ”ennen löydöstä” hylättiin ladattaessa: ${why})`,
    },
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
    // Lukitukset ensin: tarinan polkujen, tallennettujen reittien ja ajojen ajoitus tarkistetaan niitä vasten.
    const locks = sanitizeList(raw.locks, sanitizeLock, 'Reittihypoteesien lukitukset', warnings);
    let story = base.story;
    if (raw.story !== undefined) {
      const r = sanitizeStory(raw.story, locks);
      if (r.story) {
        story = r.story;
        warnings.push(...r.dropped.map((d) => `Tallennettu tarina: ${d}`));
      } else warnings.push(`Tallennettua tarinaa ei voitu lukea (${r.dropped.join(' ')}); käytetään testitapauksen siemendataa.`);
    }
    const t = deserializeTrail(raw.trail);
    if (t.cut && raw.trail !== undefined) warnings.push(`Tallennettu reitti katkaistiin ${t.trail.length} askeleeseen virheellisen askeleen kohdalta.`);
    const visited = strArr(raw.visited).slice(-VISITED_PERSIST);
    let savedChanged = 0;
    const saved = sanitizeList(raw.saved, sanitizeSavedRoute, 'Tallennetut reitit', warnings).map((r) => {
      const fixed = recheckSavedRoute(r, locks, story);
      if (fixed) savedChanged++;
      return fixed ?? r;
    });
    if (savedChanged)
      warnings.push(`Tallennetut reitit: ${savedChanged} reitin ajoitus ”${HYPOTHESIS_LABELS['ennen-löydöstä']}” hylättiin (ei vastaavaa lukitusta tai tehtävänannon reitti).`);
    const storedRuns = sanitizeList(raw.routeRuns, sanitizeRun, 'Reittitestit', warnings).slice(-RUNS_PERSIST);
    // Vanha tallennus ilman hakemistoa: hakemisto rakennetaan tallennetuista ajoista (vanhemmat ajot on jo rajattu pois).
    const runIndex = mergeRunIndex(sanitizeRunIndex(raw.runIndex), storedRuns);
    const rc = recheckRuns(storedRuns, locks, runIndex, story);
    if (rc.changed)
      warnings.push(
        `Reittitestit: ${rc.changed} ajon ajoitus ”${HYPOTHESIS_LABELS['ennen-löydöstä']}” hylättiin (ei vastaavaa lukitusta, ei koodijoukon ensimmäinen ajo tai tehtävänannon reitti).`,
      );
    return {
      state: {
        ...base,
        story,
        trail: t.trail,
        direction: raw.direction === '432' ? '432' : '234',
        saved,
        log: sanitizeList(raw.log, sanitizeLogEntry, 'Matriisin loki', warnings).slice(-LOG_PERSIST),
        visited: visited.length ? visited : ['root'],
        routeRuns: rc.runs,
        runIndex,
        locks,
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

/**
 * Reittikysymyksen kanoninen muoto: sama testisuure → sama kysymys.
 * - 'mikä-tahansa': lyhin ikkuna ei riipu koodien järjestyksestä, joten koodit lajitellaan.
 * - '432' koodeille c₁ … c_k on sama ehto kuin '234' käänteisille koodeille c_k … c₁.
 */
export function canonicalQuestion(codes: readonly string[], order: RouteOrder): { codes: string[]; order: RouteOrder } {
  if (order === 'mikä-tahansa') return { codes: [...codes].sort(), order };
  if (order === '432') return { codes: [...codes].reverse(), order: '234' };
  return { codes: [...codes], order };
}

/**
 * Reittikysymyksen identiteetti: kanoniset koodit, järjestysehto ja aineisto (SHA-256). R, siemen ja jonot eivät
 * muuta kysymystä.
 */
export function routeQuestionKey(codes: readonly string[], order: RouteOrder, datasetSha: string | null): string {
  const q = canonicalQuestion(codes, order);
  return JSON.stringify([q.codes, q.order, datasetSha ?? '']);
}

/**
 * Koodijoukko (monijoukko) ja aineisto. Saman koodijoukon kaikki järjestysvariantit kuuluvat samaan perheeseen:
 * yhden variantin tuloksen näkeminen kertoo myös muista, joten mikä tahansa perheen ajo on aiempi altistus.
 */
export function routeFamilyKey(codes: readonly string[], datasetSha: string | null): string {
  return JSON.stringify([[...codes].sort(), datasetSha ?? '']);
}

function familyOfQuestionKey(key: string): string | null {
  try {
    const q = JSON.parse(key) as unknown;
    return Array.isArray(q) && Array.isArray(q[0]) ? routeFamilyKey(q[0] as string[], (q[2] as string) || null) : null;
  } catch {
    return null;
  }
}

export function emptyRunIndex(): RouteRunIndex {
  return { questions: {}, total: 0 };
}

/** Uusi ajo hakemistoon (palauttaa uuden olion). */
export function addRunToIndex(index: RouteRunIndex, run: Pick<RouteRunSummary, 'codes' | 'order' | 'datasetSha' | 'ts'>): RouteRunIndex {
  const key = routeQuestionKey(run.codes, run.order, run.datasetSha);
  const prev = index.questions[key];
  return {
    questions: {
      ...index.questions,
      [key]: prev ? { first: prev.first <= run.ts ? prev.first : run.ts, count: prev.count + 1 } : { first: run.ts, count: 1 },
    },
    total: index.total + 1,
  };
}

export function buildRunIndex(runs: readonly Pick<RouteRunSummary, 'codes' | 'order' | 'datasetSha' | 'ts'>[]): RouteRunIndex {
  const questions: Record<string, RouteQuestionStat> = {};
  for (const r of runs) {
    const key = routeQuestionKey(r.codes, r.order, r.datasetSha);
    const prev = questions[key];
    questions[key] = prev ? { first: prev.first <= r.ts ? prev.first : r.ts, count: prev.count + 1 } : { first: r.ts, count: 1 };
  }
  return { questions, total: runs.length };
}

/** Koodijoukon altistus: kaikkien järjestysvarianttien ajot, saman kysymyksen ajot ja ensimmäisen ajon aika. */
export function familyExposure(
  index: RouteRunIndex,
  codes: readonly string[],
  datasetSha: string | null,
  order: RouteOrder = 'mikä-tahansa',
): { count: number; same: number; first: string | null } {
  const fam = routeFamilyKey(codes, datasetSha);
  const own = routeQuestionKey(codes, order, datasetSha);
  let count = 0;
  let same = 0;
  let first: string | null = null;
  for (const [k, v] of Object.entries(index.questions)) {
    if (familyOfQuestionKey(k) !== fam) continue;
    count += v.count;
    if (k === own) same += v.count;
    if (first === null || v.first < first) first = v.first;
  }
  return { count, same, first };
}

/** Rajatut ajot: hakemiston ja aiempien ajojen lista käyvät molemmat (testit käyttävät listaa). */
export type RouteHistory = RouteRunIndex | readonly Pick<RouteRunSummary, 'codes' | 'order' | 'datasetSha' | 'ts'>[];
const asIndex = (h: RouteHistory): RouteRunIndex => ('questions' in h ? h : buildRunIndex(h));

/**
 * BH-q tallennetuille p-arvoille, kun ajoja on yhteensä `total` (m = total). Vanhojen, tallennuksesta rajattujen
 * ajojen p-arvoja ei enää ole; ne oletetaan arvoiksi 1, jolloin q-arvot eivät aliarvioidu (BH on monotoninen).
 */
export function routeBH(ps: number[], total: number): number[] {
  const missing = Math.max(0, total - ps.length);
  return benjaminiHochberg([...ps, ...new Array<number>(missing).fill(1)]).slice(0, ps.length);
}

/** Lukituksen kanoninen sisältö SHA-256:ta varten (avaimet aakkosjärjestyksessä + aikaleima). Kysymys kanonisena. */
export function canonicalRouteLock(text: string, codes: string[], order: RouteOrder, datasetSha: string | null, createdAt: string): string {
  const q = canonicalQuestion(codes, order);
  return `${JSON.stringify([
    ['codes', q.codes],
    ['datasetSha', datasetSha ?? ''],
    ['order', q.order],
    ['text', text],
    ['version', MATRIX_VERSION],
  ])}\n${createdAt}`;
}

/** Saman kysymyksen ensimmäinen lukitus (kanoninen avain). Ensimmäinen lukitus on se, joka ratkaisee ajoituksen. */
export function lockForQuestion<L extends Pick<RouteLock, 'codes' | 'order' | 'datasetSha' | 'createdAt'>>(
  locks: readonly L[],
  codes: readonly string[],
  order: RouteOrder,
  datasetSha: string | null,
): L | null {
  const key = routeQuestionKey(codes, order, datasetSha);
  let best: L | null = null;
  for (const l of locks) if (routeQuestionKey(l.codes, l.order, l.datasetSha) === key && (!best || l.createdAt < best.createdAt)) best = l;
  return best;
}

// ------------------------------------------------------------------ tehtävänannon reitit (alkuperä)

/** Tehtävänannosta johdetut koodijoukot: ensimmäinen reittitesti, testireitin murupolku ja tehtävänannon polut. */
export function taskRouteFamilies(story: StoryModel): { codes: string[]; label: string }[] {
  const out: { codes: string[]; label: string }[] = [
    { codes: firstRouteCodes().map((c) => c.code), label: `ensimmäinen reittitesti ${FIRST_ROUTE_NAMES.join(' → ')}` },
    { codes: uniqueCodes(['MAX', 'HANNA'].map((n) => namedCode(n))).map((c) => c.code), label: 'testireitti MAX (629) → 2 → HANNA → HANNA III' },
  ];
  const paths = [...createSeedStory().paths, ...story.paths.filter((p) => p.source === 'tehtävänanto')];
  for (const p of paths) out.push({ codes: routeCodesFromPath(p).map((c) => c.code), label: `${p.title}: ${p.steps.map((s) => s.name).join(' → ')}` });
  return out.filter((f) => f.codes.length > 0);
}

/**
 * Jos reitti tulee tehtävänannosta (lähde `sourceLabel` tai sama koodijoukko kuin tehtävänannon reitillä), syy sille,
 * miksi ajoitus on aina 'löydön-jälkeen'. Muuten null.
 */
export function taskDerivedReason(codes: readonly string[], story: StoryModel, sourceLabel: string | null = null): string | null {
  const label = sourceLabel ?? taskRouteFamilies(story).find((f) => sameCodeSet(f.codes, codes))?.label ?? null;
  return label ? `Reitti tulee tehtävänannosta (${label}). ${TASK_TIMING_NOTE}` : null;
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
 * Seuraavan ajon hypoteesin ajoitus. Sama periaate kuin Testit-välilehden esirekisteröinnissä, tiukennettuna:
 * - 'ennen-löydöstä' (vahvistava) vain, jos saman kysymyksen (kanoninen avain) lukitus on olemassa eikä samaa
 *   koodijoukkoa ole ajettu kertaakaan millään järjestyksellä. Lukitus kattaa siis vain ensimmäisen ajonsa;
 *   myöhemmät ajot (eri siemen tai R) ovat 'löydön-jälkeen'.
 * - Tehtävänannosta johdettu reitti (`taskReason`) on aina 'löydön-jälkeen'.
 * - Muuten 'löydön-jälkeen' (koodijoukko on jo nähty) tai 'ei-tiedossa' (ei lukitusta eikä aiempia ajoja).
 * Lukitus on tämän laitteen oma kirjaus, joten syy kertoo sen ("lukittiin tällä laitteella").
 */
export function evaluateRouteTiming(
  lock: Pick<RouteLock, 'codes' | 'order' | 'datasetSha' | 'createdAt' | 'hash'> | null,
  history: RouteHistory,
  codes: string[],
  order: RouteOrder,
  datasetSha: string | null,
  taskReason: string | null = null,
): TimingVerdict {
  const index = asIndex(history);
  const key = routeQuestionKey(codes, order, datasetSha);
  const exp = familyExposure(index, codes, datasetSha, order);
  const usable = lock && routeQuestionKey(lock.codes, lock.order, lock.datasetSha) === key ? lock : null;
  const variants = exp.count > exp.same ? `, joista ${exp.count - exp.same} muulla järjestysehdolla tai koodien järjestyksellä` : '';
  const seen = exp.first ? `Sama koodijoukko on ajettu ${exp.count} kertaa${variants} (ensimmäinen ${isoShort(exp.first)}).` : '';
  if (taskReason)
    return { timing: 'löydön-jälkeen', reason: [taskReason, seen].filter(Boolean).join(' '), preregistered: false };
  if (usable) {
    const locked = `Hypoteesi lukittiin tällä laitteella ${isoShort(usable.createdAt)} (SHA-256 ${usable.hash.slice(0, 12)}…)`;
    if (!exp.first)
      return {
        timing: 'ennen-löydöstä',
        reason: `${locked} ennen yhtäkään saman koodijoukon reittitestiä. Vain lukituksen jälkeinen ensimmäinen ajo on vahvistava; myöhemmät ajot (eri siemen tai R) ovat eksploratiivisia.`,
        preregistered: true,
      };
    if (exp.first < usable.createdAt)
      return {
        timing: 'löydön-jälkeen',
        reason:
          `Sama koodijoukko (${codes.join(' → ')}) ajettiin jo ennen lukitusta. ${seen} ` +
          'Lukitus tehtiin tuloksen näkemisen jälkeen, joten se ei ole ennakkoon tehty.',
        preregistered: false,
      };
    return {
      timing: 'löydön-jälkeen',
      reason: `${locked}, mutta lukituksen jälkeen koodijoukko on jo ajettu. ${seen} Lukitus kattaa vain ensimmäisen ajon, joten uusi ajo on eksploratiivinen.`,
      preregistered: false,
    };
  }
  const note = lock ? ' Valittu lukitus koskee eri kysymystä (koodit tai järjestys eroavat).' : '';
  if (exp.first)
    return {
      timing: 'löydön-jälkeen',
      reason: `${seen} Hypoteesia ei lukittu ennen ensimmäistä ajoa.${note}`,
      preregistered: false,
    };
  return {
    timing: 'ei-tiedossa',
    reason: `Hypoteesia ei lukittu ennen ajoa, joten sen ajoitusta suhteessa löytöihin ei voi todentaa.${note}`,
    preregistered: false,
  };
}

/**
 * Reittitestin luokitus. Ennalta lukittu p ≤ α (”lukittu-alle-alfa”) vaatii, että myös Wilsonin 95 %:n välin
 * yläraja on ≤ α. Jos väli ylittää α:n, Monte Carlo -tulos on epävarma eikä vahvistava.
 */
export function classifyRouteRun(
  r: Pick<RouteRunSummary, 'pValue' | 'pHigh' | 'alpha' | 'timing' | 'lockHash'>,
): VerdictInfo & { inconclusive: boolean } {
  const prereg = r.timing === 'ennen-löydöstä' && !!r.lockHash;
  if (prereg && r.pValue <= r.alpha && !(r.pHigh <= r.alpha))
    return {
      verdict: 'eksploratiivinen',
      title: 'Ennalta lukittu, Monte Carlo ei ratkaise',
      text:
        `p = ${fmtP(r.pValue)} ≤ α = ${r.alpha}, mutta Wilsonin 95 %:n välin yläraja ${fmtP(r.pHigh)} ylittää α:n. ` +
        'Monte Carlo -tulos on epävarma, joten se ei ole vahvistava. Lukitus kattoi vain tämän ajon: uusi ajo samalla ' +
        'kysymyksellä (esim. suuremmalla R:llä) on eksploratiivinen.',
      inconclusive: true,
    };
  const v = classify(r.pValue, r.alpha, prereg);
  if (v.verdict === 'eksploratiivinen' && r.timing === 'löydön-jälkeen')
    return {
      ...v,
      text: `p = ${fmtP(r.pValue)} ≤ α = ${r.alpha}, mutta hypoteesi on muodostettu löydön jälkeen (ks. ajoitus). Tulos on vihje jatkotutkimukselle, ei vahvistus.`,
      inconclusive: false,
    };
  return { ...v, inconclusive: false };
}

/**
 * Koskeeko lukituksen kanoninen kysymys täsmälleen näitä reitin koodeja reitin järjestyksessä jollakin
 * järjestysehdolla (esim. lukitus [IDA, MAX] '432' = reitti MAX → IDA '234').
 */
export function lockMatchesCodes(lock: Pick<RouteLock, 'codes' | 'order' | 'datasetSha'>, codes: readonly string[]): boolean {
  const key = routeQuestionKey(lock.codes, lock.order, lock.datasetSha);
  return ORDERS.some((o) => routeQuestionKey(codes, o, lock.datasetSha) === key);
}

/** Tallennettavan reitin konteksti: murupolku, tarina (koodit) ja loki (solmujen ensimmäiset avaukset). */
export interface SaveRouteContext {
  trail: TrailStep[];
  story: StoryModel;
  log: readonly MatrixLogEntry[];
}

const KEY_CHAR = /[\w@#:+\-ÅÄÖåäö]/;

/** Mainitaanko solmuavain tekstissä kokonaisena (ei toisen avaimen osana, esim. code:62 ≠ code:629). */
function mentionsKey(text: string, key: string): boolean {
  for (let i = text.indexOf(key); i >= 0; i = text.indexOf(key, i + 1)) {
    const before = i > 0 ? text[i - 1] : '';
    const after = text[i + key.length] ?? '';
    if (!KEY_CHAR.test(before) && !KEY_CHAR.test(after)) return true;
  }
  return false;
}

/** Solmun ensimmäinen lokimerkintä (avaus tai maininta). null = ei merkintää (ei avattu tai loki rajattu). */
export function firstLogTouch(log: readonly MatrixLogEntry[], key: string): string | null {
  let first: string | null = null;
  for (const e of log) if ((e.ref === key || mentionsKey(e.text, key)) && (first === null || e.ts < first)) first = e.ts;
  return first;
}

/**
 * Kelpaako lukitus tallennettavan reitin ”ennen löydöstä” -perusteeksi:
 * 1. lukituksen kanoninen kysymys koskee täsmälleen reitin koodeja (routeCodesFromTrail) reitin järjestyksessä,
 * 2. reitti ei tule tehtävänannosta,
 * 3. samaa koodijoukkoa ei ajettu ennen lukitusta (myöhemmät ajot sallitaan: hypoteesi oli jo lukittu),
 * 4. lukitus tehtiin ennen reitin jokaisen π-solmun ensimmäistä lokimerkintää (juuri = yhteinen lähtöankkuri, ei mukana).
 */
export function lockFitsRoute(lock: RouteLock, history: RouteHistory, ctx: SaveRouteContext): { ok: boolean; reason: string } {
  const codes = routeCodesFromTrail(ctx.trail, ctx.story).map((c) => c.code);
  if (!lockMatchesCodes(lock, codes))
    return {
      ok: false,
      reason: `Lukitus koskee eri kysymystä (${lock.names.join(' → ')}, järjestys ${lock.order}) kuin tallennettava reitti (koodit ${codes.join(' → ') || 'ei koodeja'}).`,
    };
  const task = taskDerivedReason(codes, ctx.story);
  if (task) return { ok: false, reason: task };
  const exp = familyExposure(asIndex(history), lock.codes, lock.datasetSha, lock.order);
  if (exp.first && exp.first < lock.createdAt)
    return { ok: false, reason: `Sama koodijoukko ajettiin reittitestinä ennen lukitusta (ensimmäinen ${isoShort(exp.first)}).` };
  for (const st of ctx.trail.slice(1)) {
    if (realmOf(st.ref) !== 'pi') continue;
    const key = nodeKey(st.ref);
    const t = firstLogTouch(ctx.log, key);
    if (!t) return { ok: false, reason: `Solmun ${key} ensimmäistä avausta ei löydy lokista, joten lukituksen ei voida todeta edeltävän sitä.` };
    if (t < lock.createdAt) return { ok: false, reason: `Solmu ${key} avattiin ${isoShort(t)}, ennen lukitusta (${isoShort(lock.createdAt)}).` };
  }
  return { ok: true, reason: `Lukitus ${isoShort(lock.createdAt)} koskee reitin koodeja ja tehtiin ennen reitin π-solmujen avaamista.` };
}

/**
 * Tallennettavan reitin hypoteesitieto. 'ennen-löydöstä' hyväksytään vain lukituksella, joka kelpaa juuri tälle
 * reitille (lockFitsRoute); muuten pyyntö muutetaan muotoon 'löydön-jälkeen' ja syy kerrotaan. Tehtävänannosta
 * johdettu reitti on aina 'löydön-jälkeen'.
 */
export function savedRouteHypothesis(
  requested: HypothesisTiming,
  lock: RouteLock | null,
  history: RouteHistory,
  nowIso: string,
  ctx: SaveRouteContext,
): { meta: HypothesisMeta; downgraded: string | null } {
  const later = HYPOTHESIS_LABELS['löydön-jälkeen'].toLowerCase();
  if (requested === 'ennen-löydöstä') {
    const fit = lock ? lockFitsRoute(lock, history, ctx) : null;
    if (lock && fit?.ok)
      return {
        meta: { timing: 'ennen-löydöstä', statedAt: lock.createdAt, lockHash: lock.hash, note: `Lukittu hypoteesi (tällä laitteella): ${lock.text}` },
        downgraded: null,
      };
    const why = fit
      ? fit.reason
      : 'Valittuna ei ole lukittua hypoteesia. Lukitse hypoteesi Reitit-sivulla ennen reitin avaamista ja ennen saman koodijoukon ensimmäistä ajoa.';
    return {
      meta: { timing: 'löydön-jälkeen', statedAt: nowIso, lockHash: null, note: why },
      downgraded: `”${HYPOTHESIS_LABELS['ennen-löydöstä']}” edellyttää tämän reitin koodien SHA-256-lukitusta ennen reitin avaamista ja ensimmäistä ajoa. ${why} Reitti merkitään: ${later}.`,
    };
  }
  if (requested === 'ei-tiedossa') {
    const task = taskDerivedReason(
      routeCodesFromTrail(ctx.trail, ctx.story).map((c) => c.code),
      ctx.story,
    );
    if (task)
      return {
        meta: { timing: 'löydön-jälkeen', statedAt: nowIso, lockHash: null, note: task },
        downgraded: `${task} Reitti merkitään: ${later}.`,
      };
  }
  return { meta: { timing: requested, statedAt: nowIso, lockHash: null, note: '' }, downgraded: null };
}

/**
 * Polun lähde ja ajoitus tallennettaessa. Uusi polku: käyttäjän, 'ei-tiedossa'. Jos olemassa olevan polun askeleita
 * muutetaan, polku on käyttäjän muokkaama ja muodostettu löydön jälkeen ("muokattu"). Pelkkä otsikon, teeman tai
 * huomion muutos säilyttää lähteen ja ajoituksen.
 */
export function editedPathMeta(initial: StoryPath | null, steps: readonly PathStep[], nowIso: string): Pick<StoryPath, 'source' | 'hypothesis'> {
  if (!initial)
    return {
      source: 'käyttäjä',
      hypothesis: { timing: 'ei-tiedossa', statedAt: nowIso, lockHash: null, note: 'Käyttäjän lisäämä polku; ajoitusta suhteessa π-löytöihin ei ole lukittu.' },
    };
  const same =
    initial.steps.length === steps.length &&
    initial.steps.every((s, i) => s.name === steps[i].name && s.personId === steps[i].personId && s.symbol === steps[i].symbol && s.stage === steps[i].stage);
  if (same) return { source: initial.source, hypothesis: initial.hypothesis };
  return {
    source: 'käyttäjä',
    hypothesis: {
      timing: 'löydön-jälkeen',
      statedAt: nowIso,
      lockHash: null,
      note:
        `Muokattu ${isoShort(nowIso)}: askeleita muutettiin (alkuperäinen lähde ${initial.source}, ajoitus ` +
        `”${HYPOTHESIS_LABELS[initial.hypothesis.timing]}”). Muokattu polku on muodostettu löydön jälkeen.`,
    },
  };
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
  const lockHash = meta.timing.preregistered && meta.lock ? meta.lock.hash : null;
  const verdict = classifyRouteRun({ pValue: res.pValue, pHigh: res.pHigh, alpha: ROUTE_ALPHA, timing: meta.timing.timing, lockHash }).verdict;
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
    lockHash,
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
