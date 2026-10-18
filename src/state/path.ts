// Path Discovery -tila (docs/POLKUHAKU.md): tyypit ja puhtaat apufunktiot. Tämä tiedosto ei tuo Reactia eikä storea,
// joten sen voi testata node-ympäristössä (tests/path-state.test.ts). Tilaa muuttavat toiminnot ovat tiedostossa
// path-actions.ts. Laskenta tehdään ydinkirjastolla (src/core/path); tässä ei ole omaa hakua eikä tilastoa.
//
// Kolme osaa pidetään erillään myös tallennuksessa:
//  - laskettu piin rakenne: reitit, numerot, indeksit, säännöt ja tarkistukset (ydinkirjaston tulos sellaisenaan)
//  - käyttäjän symbolinen tulkinta: lähtö- ja tavoitetekstit sekä tunnisteiden nimet (eivät vaikuta hakuun)
//  - testattu ennustetulos: sokkotestin tulos samoilla polkuhaun parametreilla, tai "ei testattu"
//
// Lukitus: jokainen ajo saa kanonisen kyselyn SHA-256-tiivisteen, joka lasketaan ja tallennetaan ennen moottorikutsua.
// Eksploratiivisuus: kyselyn (lähtö- ja tavoitekoodit) ensimmäinen nähty tulos lukitsee sen asetukset (parametrit ja
// tunnetut välisolmut). Myöhempi ajo samalle kyselylle eri asetuksilla on "eksploratiivinen (parametrit muutettu
// tulosten näkemisen jälkeen)". Sama periaate koskee satunnaisvertailua (R, jonot, siemen) ja sokkotestiä.

import type { DateFormat } from '../core/encodings';
import type { StoryModel } from '../core/matrix/types';
import { normName } from '../core/matrix/types';
import { blindItemsFromEvents, blindItemsFromStory, isoDatePart, planBlindFolds } from '../core/path/blind';
import type { BlindRunResult } from '../core/path/blind';
import { canonicalParams, stableStringify } from '../core/path/canonical';
import type { IdentifierContext } from '../core/path/identifiers';
import { encodeIdentifier, identifiersForTimeRange, isValidIsoDate, ROLE_ORDER, storyNames } from '../core/path/identifiers';
import { RULE_ORDER } from '../core/path/rules';
import { bestRouteCost } from '../core/path/score';
import { validatePathParams } from '../core/path/search';
import type {
  BlindItem,
  BlindItemKind,
  BlindParams,
  BlindResult,
  IdentifierKind,
  IdentifierRole,
  NullComparison,
  PathCost,
  PathIdentifier,
  PathNode,
  PathParams,
  PathQuery,
  PathRoute,
  PathRuleId,
  PathScore,
  PathStep,
  SearchFailure,
  SearchMode,
  SearchOutcome,
} from '../core/path/types';
import { BLIND_VERSION, DEFAULT_PATH_PARAMS, PATH_VERSION, PATHSCORE_VERSION } from '../core/path/types';
import { benjaminiHochberg } from '../core/stats';

// ------------------------------------------------------------------ tyypit

/** Polkuhaun lomake. Tallentuu laitteelle (tarinatiedot pysyvät paikallisina). */
export interface PathForm {
  startText: string;
  goalText: string;
  identifiers: PathIdentifier[];
  timeRange: { from: string | null; to: string | null } | null;
  params: PathParams;
  /** Viimeksi valittu hakutila (näytetty lukitustiiviste lasketaan tälle tilalle). */
  mode: SearchMode;
}

export interface NullForm {
  /** Tasajakauman replikaatit R (50 / 200 / 1000). */
  R: number;
  /** Satunnaisjonot S (0 / 5 / 20). */
  randomStrings: number;
  seedText: string;
}

export interface BlindForm {
  kind: BlindItemKind;
  decoys: number;
  seedText: string;
  /** Piittömän mallin satunnaisjonot (0 / 2 / 5 / 10). */
  randomStrings: number;
  dateFormat: DateFormat;
}

/**
 * Ajon tila. Haku: käynnissä → löytyi | ei-löytynyt | virhe | keskeytetty. Satunnaisvertailu ja sokkotesti:
 * käynnissä → valmis | virhe | keskeytetty.
 */
export type PathRunStatus = 'käynnissä' | 'löytyi' | 'ei-löytynyt' | 'valmis' | 'virhe' | 'keskeytetty';

/** Polkuhaun tai satunnaisvertailun tiivistelmä (loki ja monivertailu). Tallentuu laitteelle. */
export interface PathRunSummary {
  id: string;
  /** Lukitushetki: tiiviste laskettiin ja ajo kirjattiin ennen moottorikutsua. */
  ts: string;
  finishedAt: string | null;
  kind: 'haku' | 'vertailu';
  mode: SearchMode;
  use369: boolean;
  status: PathRunStatus;
  /** Reittien määrä (haku) tai vertailun kohteena olleen haun reittien määrä. */
  routes: number;
  bestCost: PathCost | null;
  fingerprint: string | null;
  /** SHA-256: haku = canonicalQuery(kysely, parametrit, tila); vertailu = haun tiiviste + R, jonot ja siemen. */
  hash: string;
  /** Kyselyn identiteetti (lähtö- ja tavoitekoodit); vertailulle haun tiiviste. */
  queryKey: string;
  /** Asetukset (parametrit ja tunnetut koodit; vertailulle R, jonot ja siemen). */
  configKey: string;
  exploratory: boolean;
  exploratoryReason: string | null;
  /** Syiden määrä (SearchOutcome.reasons + failures). */
  reasons: number;
  /** Lyhyt kuvaus: "HANNA → IDA". Käyttäjän nimet (symbolinen), koodit näkyvät tiivisteessä. */
  label: string;
  datasetSha: string | null;
  ms: number | null;
  /** Vertailu: replikaatit, jonot, siemen ja vertailtu haku. */
  nullSpec: { R: number; S: number; seed: number; seedText: string; searchRunId: string | null } | null;
  /** Vertailu: suurin mallien p-arvoista (varovainen), null jos ei ajettu. */
  pValue: number | null;
  reproducible: boolean | null;
  error: string | null;
}

/** Ajojen määrät (rajaamattomat laskurit monivertailua varten; ajolista rajataan tallennettaessa). */
export interface PathCounts {
  searches: number;
  nulls: number;
  blinds: number;
}

/** Eksploratiivisuuden hakemisto: kysely → ensimmäinen nähty tulos ja sitä ennen lukitut asetukset. */
export interface ExploreEntry {
  firstSeen: string | null;
  seenConfig: string | null;
  locked: string[];
}
export type ExploreIndex = Record<string, ExploreEntry>;

export interface PathIndexes {
  searches: ExploreIndex;
  nulls: ExploreIndex;
  blinds: ExploreIndex;
}

/** Satunnaisvertailun tulos (muistissa) ja sen ajo. */
export interface PathNullState {
  runId: string;
  hash: string;
  spec: { R: number; S: number; seed: number; seedText: string };
  nulls: NullComparison[];
  reproducible: boolean;
  notes: string[];
  fingerprint: string;
  durationMs: number;
  exploratory: boolean;
  exploratoryReason: string | null;
}

/** Näytetty tulos (muistissa): tuore ajo tai avattu tallennettu tulos. */
export interface PathCurrent {
  runId: string;
  source: 'ajo' | 'tallennettu';
  savedId: string | null;
  ts: string;
  query: PathQuery;
  params: PathParams;
  mode: SearchMode;
  hash: string;
  /** Moottorin kanoninen kysely vastasi lukittua (sama merkkijono, josta tiiviste laskettiin). */
  hashMatches: boolean | null;
  exploratory: boolean;
  exploratoryReason: string | null;
  outcome: SearchOutcome;
  scores: PathScore[];
  null: PathNullState | null;
}

/** Tallennetun tuloksen Path Score ilman pitkiä tekstejä (määritelmä ja vastuuvapaus ovat vakioita). */
export interface CompactScore {
  total: number | null;
  rarity: number | null;
  length: number;
  branching: number;
  transforms: number;
  structure: { geometric: number; numeric: number };
  reproducible: boolean | null;
}

/** Viittaus sokkotestiin, joka oli tallennushetkellä uusin samoilla polkuhaun parametreilla. */
export interface BlindRef {
  id: string;
  ts: string;
  hash: string;
  verdict: string;
  hitsAt1: number;
  folds: number;
  pVsRandom: number;
}

/** Tallennettu polkuhaun tulos. Tallentuu laitteelle. */
export interface SavedPathResult {
  id: string;
  title: string;
  createdAt: string;
  version: string;
  scoreVersion: string;
  runId: string;
  runTs: string;
  // käyttäjän symbolinen tulkinta
  startText: string;
  goalText: string;
  identifiers: PathIdentifier[];
  timeRange: PathForm['timeRange'];
  // laskettu piin rakenne
  params: PathParams;
  mode: SearchMode;
  hash: string;
  fingerprint: string;
  status: SearchOutcome['status'];
  routes: PathRoute[];
  reasons: string[];
  failures: SearchFailure[];
  vocabulary: SearchOutcome['vocabulary'];
  sourceLabel: string;
  datasetSha: string | null;
  exploratory: boolean;
  exploratoryReason: string | null;
  scores: CompactScore[];
  nulls: NullComparison[];
  nullHash: string | null;
  reproducible: boolean | null;
  // testattu ennustetulos
  blindRef: BlindRef | null;
}

/** Sokkotestin kierros tallennettuna (piilotettu kohde, konteksti, sijoitus ja satunnaisjonojen sijoitukset). */
export interface BlindFoldRecord {
  hiddenLabel: string;
  group: string;
  contextLabels: string[];
  candidates: number;
  rankPi: number;
  correct: boolean;
  topLabel: string;
  rankRandomStrings: number[];
  notes: string[];
}

/** Sokkotestin ajo. Kaikki ajot tallennetaan, myös epäonnistuneet ja keskeytetyt. */
export interface BlindRunRecord {
  id: string;
  ts: string;
  finishedAt: string | null;
  version: string;
  status: 'käynnissä' | 'valmis' | 'virhe' | 'keskeytetty';
  error: string | null;
  /** SHA-256 kanonisesta kuvauksesta (canonicalBlind: parametrit ja kohteiden koodit), laskettu ennen ajoa. */
  hash: string;
  queryKey: string;
  configKey: string;
  exploratory: boolean;
  exploratoryReason: string | null;
  params: BlindParams;
  seedText: string;
  items: number;
  folds: BlindFoldRecord[];
  skipped: { label: string; reason: string }[];
  summary: BlindResult['summary'] | null;
  notes: string[];
  pMethod: string | null;
  randomStringRuns: { label: string; hitsAt1: number; meanRank: number }[];
  piBeatsRandomStrings: boolean | null;
  fingerprint: string | null;
  durationMs: number | null;
  sourceLabel: string;
  datasetSha: string | null;
}

/** Käynnissä oleva moottorityö (vain muistissa). Yksi kerrallaan: haku, vertailu tai sokkotesti. */
export interface PathJob {
  kind: 'haku' | 'vertailu' | 'sokkotesti';
  runId: string;
  label: string;
  done: number;
  total: number;
  startedAt: string;
  cancelRequested: boolean;
}

export interface PathState {
  form: PathForm;
  nullForm: NullForm;
  blindForm: BlindForm;
  runs: PathRunSummary[];
  counts: PathCounts;
  index: PathIndexes;
  saved: SavedPathResult[];
  blindRuns: BlindRunRecord[];
  // vain muistissa
  current: PathCurrent | null;
  selectedBlind: string | null;
  running: PathJob | null;
  error: string | null;
  blindError: string | null;
}

/** Reitin näyttö muissa näkymissä (spiraali, atlas/verkko, 3D). Vain muistissa (AppState.pathOverlay). */
export interface PathOverlay {
  label: string;
  points: { n: number; code: string; label: string }[];
}

export const PATH_RUNS_PERSIST = 300;
export const PATH_SAVED_PERSIST = 100;
export const BLIND_RUNS_PERSIST = 200;
/** Monivertailun merkitsevyystaso (sama kuin reittitesteissä). */
export const PATH_ALPHA = 0.05;

export const EXPLORATORY_LABEL = 'eksploratiivinen (parametrit muutettu tulosten näkemisen jälkeen)';

export const NULL_R_OPTIONS = [50, 200, 1000] as const;
export const NULL_S_OPTIONS = [0, 5, 20] as const;
export const BLIND_S_OPTIONS = [0, 2, 5, 10] as const;

export const IDENTIFIER_KINDS: readonly IdentifierKind[] = ['nimi', 'sana', 'numerojono', 'päivämäärä', 'henkilö', 'tapahtuma'];
export const DATE_FORMATS: readonly DateFormat[] = ['DDMMYYYY', 'YYYYMMDD', 'DDMMYY', 'MMDD', 'DDMM'];
const ORIGINS: readonly PathIdentifier['origin'][] = ['käyttäjä', 'teksti', 'tarina', 'tapahtumat'];
const MODES: readonly SearchMode[] = ['kaksisuuntainen', '234', '432'];

export function initialPathForm(): PathForm {
  return {
    startText: '',
    goalText: '',
    identifiers: [],
    timeRange: null,
    params: clonePathParams(DEFAULT_PATH_PARAMS),
    mode: 'kaksisuuntainen',
  };
}

export function initialPathState(): PathState {
  return {
    form: initialPathForm(),
    nullForm: { R: 50, randomStrings: 0, seedText: '20261018' },
    blindForm: { kind: 'polun-askel', decoys: 9, seedText: '20261018', randomStrings: 2, dateFormat: 'DDMMYYYY' },
    runs: [],
    counts: { searches: 0, nulls: 0, blinds: 0 },
    index: { searches: {}, nulls: {}, blinds: {} },
    saved: [],
    blindRuns: [],
    current: null,
    selectedBlind: null,
    running: null,
    error: null,
    blindError: null,
  };
}

export function clonePathParams(p: PathParams): PathParams {
  return { ...p, rules: [...p.rules] };
}

// ------------------------------------------------------------------ kysely, avaimet ja tiivisteet

export function pathQueryOf(form: Pick<PathForm, 'startText' | 'goalText' | 'identifiers' | 'timeRange'>): PathQuery {
  return {
    startText: form.startText,
    goalText: form.goalText,
    identifiers: form.identifiers.map((i) => ({ ...i })),
    timeRange: form.timeRange ? { ...form.timeRange } : null,
  };
}

const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Koodit rooleittain aikarajauksen jälkeen (koodausvirheelliset pois), järjestettyinä. Sama kuin canonicalQuery. */
export function codesByRole(query: PathQuery): Record<IdentifierRole, string[]> {
  const { identifiers } = identifiersForTimeRange(query.identifiers ?? [], null, query.timeRange ?? null);
  const out: Record<IdentifierRole, string[]> = { lähtö: [], tavoite: [], tunnettu: [] };
  for (const id of identifiers) {
    const e = encodeIdentifier(id);
    if (e.ok && ROLE_ORDER.includes(id.role) && !out[id.role].includes(e.code)) out[id.role].push(e.code);
  }
  for (const r of ROLE_ORDER) out[r].sort(cmpStr);
  return out;
}

/** Kyselyn identiteetti eksploratiivisuutta varten: lähtö- ja tavoitekoodit (mitä kysytään). */
export function pathQueryKey(query: PathQuery): string {
  const c = codesByRole(query);
  return stableStringify({ lähtö: c.lähtö, tavoite: c.tavoite });
}

/** Asetukset: haun parametrit (kanonisina) ja tunnetut välisolmut. Hakutila ei ole asetus (jokainen ajo lasketaan). */
export function pathConfigKey(query: PathQuery, params: PathParams): string {
  return stableStringify({ parametrit: canonicalParams(params), tunnetut: codesByRole(query).tunnettu });
}

/** Satunnaisvertailun asetukset. */
export function nullConfigKey(spec: { R: number; S: number; seed: number }): string {
  return stableStringify({ R: spec.R, jonot: spec.S, siemen: spec.seed });
}

/** Satunnaisvertailun kanoninen kuvaus SHA-256:ta varten: vertailtava haku (tiiviste) ja nollamallien asetukset. */
export function canonicalNull(searchHash: string, spec: { R: number; S: number; seed: number }): string {
  return stableStringify({ versio: PATHSCORE_VERSION, haku: searchHash, R: spec.R, jonot: spec.S, siemen: spec.seed });
}

/** Polkuhaun parametrien avain (sokkotestin ja haun vertailuun: "samat parametrit"). */
export function pathParamsKey(params: PathParams): string {
  return stableStringify(canonicalParams(params));
}

/** Parametrien erot oletuksista luettavina riveinä (lokiin ja raporttiin), tyhjä = oletukset. */
export function paramsChangeFromDefaults(params: PathParams): string[] {
  return describeConfigChange(pathParamsKey(DEFAULT_PATH_PARAMS), pathParamsKey(params));
}

/** Sokkotestin kohdejoukon identiteetti (tyyppi, muoto ja kohteiden koodit). */
export function blindQueryKey(items: readonly BlindItem[], kind: BlindItemKind, dateFormat: DateFormat): string {
  const list = items
    .filter((i) => i && i.kind === kind)
    .map((i) => [i.id, i.code, i.group])
    .sort((a, b) => cmpStr(a.join('|'), b.join('|')));
  return stableStringify({ tyyppi: kind, muoto: kind === 'tapahtuma' ? dateFormat : null, kohteet: list });
}

/** Sokkotestin asetukset: harhauttimet, siemen, satunnaisjonot ja polkuhaun parametrit. */
export function blindConfigKey(params: BlindParams): string {
  return stableStringify({ D: params.decoys, siemen: params.seed, jonot: params.randomStrings, parametrit: canonicalParams(params.path) });
}

// ------------------------------------------------------------------ eksploratiivisuus

const SEEN: readonly PathRunStatus[] = ['löytyi', 'ei-löytynyt', 'valmis'];
/** Onko ajon tulos nähty (virhe- ja keskeytetyt ajot eivät näyttäneet tulosta). */
export const isSeenStatus = (s: PathRunStatus): boolean => SEEN.includes(s);

function fmtVal(v: unknown): string {
  if (v === null || v === undefined) return '–';
  if (Array.isArray(v)) return v.length ? v.map(fmtVal).join(', ') : '–';
  if (typeof v === 'number') return String(v).replace('.', ',');
  if (typeof v === 'object') return stableStringify(v);
  return String(v);
}

/** Kahden asetusavaimen erot luettavina riveinä, esim. "use369: false → true". */
export function describeConfigChange(fromKey: string | null, toKey: string): string[] {
  let a: unknown = null;
  let b: unknown = null;
  try {
    a = fromKey ? JSON.parse(fromKey) : null;
    b = JSON.parse(toKey);
  } catch {
    return [];
  }
  const out: string[] = [];
  const walk = (x: unknown, y: unknown, label: string) => {
    const isO = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
    if (isO(x) && isO(y)) {
      const keys = [...new Set([...Object.keys(x), ...Object.keys(y)])].sort(cmpStr);
      for (const k of keys) walk(x[k], y[k], k === 'parametrit' ? label : label ? `${label}.${k}` : k);
      return;
    }
    if (stableStringify(x ?? null) !== stableStringify(y ?? null)) out.push(`${label || 'asetukset'}: ${fmtVal(x)} → ${fmtVal(y)}`);
  };
  walk(a, b, '');
  return out;
}

export interface ExploreVerdict {
  exploratory: boolean;
  reason: string | null;
}

/**
 * Onko uusi ajo eksploratiivinen? Kyselyn ensimmäinen nähty tulos lukitsee asetukset, jotka oli valittu siihen
 * mennessä (myös keskeytettyjen ajojen asetukset). Muut asetukset ovat tulosten näkemisen jälkeen valittuja.
 */
export function exploreVerdict(index: ExploreIndex, key: string, config: string, what = 'Sama kysely'): ExploreVerdict {
  const e = index[key];
  if (!e || !e.firstSeen || e.locked.includes(config)) return { exploratory: false, reason: null };
  const changes = describeConfigChange(e.seenConfig ?? e.locked[0] ?? null, config);
  return {
    exploratory: true,
    reason:
      `${EXPLORATORY_LABEL}: ${what} ajettiin ensin ${isoShortPath(e.firstSeen)} ja sen tulos nähtiin muilla asetuksilla` +
      (changes.length ? `; muuttui: ${changes.join('; ')}` : '') +
      '. Tulos on vihje jatkotutkimukselle, ei vahvistus.',
  };
}

/** Ajon aloitus hakemistoon: ennen ensimmäistä nähtyä tulosta valitut asetukset lukitaan. Palauttaa uuden olion. */
export function exploreStart(index: ExploreIndex, key: string, config: string): ExploreIndex {
  const e = index[key] ?? { firstSeen: null, seenConfig: null, locked: [] };
  if (e.firstSeen || e.locked.includes(config)) return index[key] ? index : { ...index, [key]: e };
  return { ...index, [key]: { ...e, locked: [...e.locked, config] } };
}

/** Ajon tulos nähtiin: ensimmäinen nähty tulos kirjataan (aika ja asetukset). Palauttaa uuden olion. */
export function exploreSeen(index: ExploreIndex, key: string, config: string, ts: string): ExploreIndex {
  const e = index[key] ?? { firstSeen: null, seenConfig: null, locked: [config] };
  if (e.firstSeen) return index;
  return { ...index, [key]: { firstSeen: ts, seenConfig: config, locked: e.locked.includes(config) ? e.locked : [...e.locked, config] } };
}

export function isoShortPath(ts: string): string {
  return /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(ts) ? `${ts.slice(0, 10)} ${ts.slice(11, 19)} UTC` : ts;
}

// ------------------------------------------------------------------ ajot ja yksi työ kerrallaan

/**
 * Onko jokin matriisin moottorityö käynnissä (polkuhaku, satunnaisvertailu, sokkotesti tai reittitesti)?
 * Palauttaa syyn suomeksi tai null. Vain yksi työ kerrallaan.
 */
export function matrixJobBusy(m: {
  path: { running: Pick<PathJob, 'kind' | 'label'> | null };
  routeTest: { running: { label: string } | null };
}): string | null {
  const p = m.path.running;
  if (p) {
    const what = p.kind === 'haku' ? 'Polkuhaku' : p.kind === 'vertailu' ? 'Satunnaisvertailu' : 'Sokkotesti';
    return `${what} on käynnissä (${p.label}). Odota sen valmistumista tai keskeytä se ensin.`;
  }
  if (m.routeTest.running) return `Reittitesti on käynnissä (${m.routeTest.running.label}). Odota sen valmistumista tai keskeytä se ensin.`;
  return null;
}

/** Kyselyn lyhyt kuvaus: lähtönimet → tavoitenimet (käyttäjän nimet). */
export function queryLabel(query: PathQuery): string {
  const names = (role: IdentifierRole) => {
    const out: string[] = [];
    for (const i of query.identifiers ?? []) {
      if (i.role !== role) continue;
      const l = (i.label || i.value || i.id).trim();
      if (l && !out.includes(l)) out.push(l);
    }
    return out.length ? out.join(', ') : '–';
  };
  return `${names('lähtö')} → ${names('tavoite')}`;
}

/** Uusi hakuajo ennen moottorikutsua: tila 'käynnissä', tiiviste ja eksploratiivisuus valmiina. */
export function beginSearchRun(meta: {
  id: string;
  ts: string;
  query: PathQuery;
  params: PathParams;
  mode: SearchMode;
  hash: string;
  datasetSha: string | null;
  verdict: ExploreVerdict;
}): PathRunSummary {
  return {
    id: meta.id,
    ts: meta.ts,
    finishedAt: null,
    kind: 'haku',
    mode: meta.mode,
    use369: !!meta.params.use369,
    status: 'käynnissä',
    routes: 0,
    bestCost: null,
    fingerprint: null,
    hash: meta.hash,
    queryKey: pathQueryKey(meta.query),
    configKey: pathConfigKey(meta.query, meta.params),
    exploratory: meta.verdict.exploratory,
    exploratoryReason: meta.verdict.reason,
    reasons: 0,
    label: queryLabel(meta.query),
    datasetSha: meta.datasetSha,
    ms: null,
    nullSpec: null,
    pValue: null,
    reproducible: null,
    error: null,
  };
}

/** Valmis hakuajo moottorin tuloksesta. */
export function finishSearchRun(run: PathRunSummary, outcome: SearchOutcome, finishedAt: string): PathRunSummary {
  return {
    ...run,
    finishedAt,
    status: outcome.status,
    routes: outcome.routes.length,
    bestCost: bestRouteCost(outcome),
    fingerprint: outcome.resultFingerprint,
    reasons: outcome.reasons.length + outcome.failures.length,
    ms: outcome.ms,
  };
}

/** Epäonnistunut tai keskeytetty ajo (kirjataan aina). */
export function failRun<T extends { status: string; finishedAt: string | null; error: string | null }>(run: T, error: string, finishedAt: string): T {
  const cancelled = /keskeytetty/i.test(error);
  return { ...run, status: cancelled ? 'keskeytetty' : 'virhe', finishedAt, error };
}

/**
 * Benjamini–Hochberg-q tallennetuille p-arvoille, kun testejä on yhteensä `total` (m). Puuttuvat (rajatut tai
 * p-arvottomat) oletetaan arvoiksi 1, jolloin q-arvot eivät aliarvioidu.
 */
export function pathBH(ps: number[], total: number): number[] {
  const missing = Math.max(0, total - ps.length);
  return benjaminiHochberg([...ps, ...new Array<number>(missing).fill(1)]).slice(0, ps.length);
}

/** Monivertailun m: kaikki polkuhaut, satunnaisvertailut ja sokkotestit (rajaamattomat laskurit). */
export function pathTestsTotal(c: PathCounts): number {
  return c.searches + c.nulls + c.blinds;
}

// ------------------------------------------------------------------ reitti muihin näkymiin

/** Reitin solmut näkymien päällyskerrokseksi (spiraali, atlas/verkko, 3D). Virheelliset kohdat ohitetaan. */
export function pathOverlayFromRoute(route: Pick<PathRoute, 'nodes' | 'cost'>, index: number): PathOverlay {
  const points = (route.nodes ?? [])
    .filter((nd) => Number.isInteger(nd.n) && nd.n >= 1 && /^\d+$/.test(nd.code))
    .map((nd) => ({ n: nd.n, code: nd.code, label: nd.labels.length ? nd.labels.join(' / ') : nd.code }));
  const names = points.map((p) => p.label).join(' → ');
  const edges = route.cost?.edges ?? Math.max(0, points.length - 1);
  return { label: `Reitti ${index + 1}: ${names} (${edges} ${edges === 1 ? 'askel' : 'askelta'})`, points };
}

// ------------------------------------------------------------------ tunnisteet

const slug = (s: string) => normName(s).replace(/\s+/g, '-') || s;

/** Uusi käyttäjän tunniste. id on deterministinen roolista, tyypistä ja arvosta (sama tunniste ei tuplaannu). */
export function makeIdentifier(
  role: IdentifierRole,
  kind: IdentifierKind,
  value: string,
  extra: { label?: string; dateFormat?: DateFormat; personId?: string | null; eventId?: string | null; origin?: PathIdentifier['origin'] } = {},
): PathIdentifier {
  const v = value.trim();
  const isDate = kind === 'päivämäärä' || kind === 'tapahtuma';
  const label = (extra.label ?? (kind === 'nimi' || kind === 'henkilö' || kind === 'sana' ? normName(v) : v)).trim() || v;
  return {
    id: `${extra.origin ?? 'käyttäjä'}:${role}:${kind}:${extra.eventId ?? extra.personId ?? slug(v)}${isDate ? `:${extra.dateFormat ?? 'DDMMYYYY'}` : ''}`,
    role,
    kind,
    label,
    value: v,
    ...(isDate ? { dateFormat: extra.dateFormat ?? 'DDMMYYYY' } : {}),
    personId: extra.personId ?? null,
    eventId: extra.eventId ?? null,
    origin: extra.origin ?? 'käyttäjä',
  };
}

/** Lisää tunnisteet listaan; sama id tai sama rooli + koodi ohitetaan. Palauttaa uuden listan ja lisättyjen määrän. */
export function mergeIdentifiers(list: readonly PathIdentifier[], add: readonly PathIdentifier[]): { identifiers: PathIdentifier[]; added: PathIdentifier[] } {
  const out = [...list];
  const added: PathIdentifier[] = [];
  const key = (i: PathIdentifier) => {
    const e = encodeIdentifier(i);
    return e.ok ? `${i.role}|${e.code}` : `${i.role}|virhe|${i.id}`;
  };
  const keys = new Set(out.map(key));
  const ids = new Set(out.map((i) => i.id));
  for (const i of add) {
    const k = key(i);
    if (ids.has(i.id) || keys.has(k)) continue;
    out.push(i);
    added.push(i);
    ids.add(i.id);
    keys.add(k);
  }
  return { identifiers: out, added };
}

/**
 * Tarinan tunnetut nimet (lähtötunnisteet ja henkilöt) tunnetuiksi välisolmuiksi. Nimet, joiden koodi on jo jossakin
 * roolissa, ohitetaan. Henkilöksi merkitään, jos nimellä on täsmälleen yksi henkilö.
 */
export function storyKnownIdentifiers(story: StoryModel, existing: readonly PathIdentifier[]): PathIdentifier[] {
  const used = new Set<string>();
  for (const i of existing) {
    const e = encodeIdentifier(i);
    if (e.ok) used.add(e.code);
  }
  const out: PathIdentifier[] = [];
  for (const name of storyNames(story)) {
    const persons = story.persons.filter((p) => normName(p.name) === name);
    const id =
      persons.length === 1
        ? makeIdentifier('tunnettu', 'henkilö', name, { personId: persons[0].id, origin: 'tarina' })
        : makeIdentifier('tunnettu', 'nimi', name, { origin: 'tarina' });
    const e = encodeIdentifier(id);
    if (!e.ok || used.has(e.code)) continue;
    used.add(e.code);
    out.push(id);
  }
  return out;
}

/** Tunnisteet, joiden rooli on annettu (näyttö). */
export const identifiersOfRole = (ids: readonly PathIdentifier[], role: IdentifierRole) => ids.filter((i) => i.role === role);

// ------------------------------------------------------------------ sokkotestin kohteet

export interface BlindEventLike {
  id: string;
  title: string;
  date: string;
  personIds?: string[];
  linkedHits?: string[];
}

/** Sokkotestin kohteet valitulla tyypillä (polun askeleet tarinasta tai päivätyt tapahtumat). */
export function blindItemsFor(kind: BlindItemKind, story: StoryModel, events: readonly BlindEventLike[], dateFormat: DateFormat): BlindItem[] {
  return kind === 'polun-askel'
    ? blindItemsFromStory(story)
    : blindItemsFromEvents(
        events.map((e) => ({ id: e.id, title: e.title, date: e.date, personIds: e.personIds ?? [], linkedHits: e.linkedHits ?? [] })),
        dateFormat,
      );
}

export interface BlindItemStats {
  /** Lähteen kohteet (polun askeleet tai kaikki tapahtumat). */
  total: number;
  /** Kohteet, joista syntyy kierros (konteksti ja harhauttimet löytyvät). */
  usable: number;
  /** Ohitetut syineen (myös tapahtumat ilman kelvollista päivämäärää). */
  skipped: { label: string; reason: string }[];
  notes: string[];
}

/** Montako kohdetta on käyttökelpoisia, ja miksi muut ohitetaan (sama suunnittelu kuin ajossa, ei hakua). */
export function blindItemStats(
  kind: BlindItemKind,
  story: StoryModel,
  events: readonly BlindEventLike[],
  params: BlindParams,
  ctx: IdentifierContext | null,
): BlindItemStats {
  const items = blindItemsFor(kind, story, events, params.dateFormat);
  const skipped: BlindItemStats['skipped'] = [];
  let total = items.length;
  if (kind === 'tapahtuma') {
    total = events.length;
    for (const e of events) {
      if (!isoDatePart(e.date)) skipped.push({ label: (e.title || e.id).trim(), reason: 'Tapahtumalla ei ole kelvollista päivämäärää (VVVV-KK-PP).' });
    }
  }
  if (!items.length) return { total, usable: 0, skipped, notes: [] };
  try {
    const plan = planBlindFolds(items, { ...params, kind }, ctx);
    for (const s of plan.skipped) skipped.push({ label: s.label, reason: s.reason });
    return { total, usable: plan.plans.length, skipped, notes: plan.notes };
  } catch (e) {
    return { total, usable: 0, skipped, notes: [e instanceof Error ? e.message : String(e)] };
  }
}

/** Uusin valmis sokkotesti samoilla polkuhaun parametreilla (testattu ennustetulos), tai null ("ei testattu"). */
export function latestBlindFor(runs: readonly BlindRunRecord[], params: PathParams): BlindRunRecord | null {
  const key = pathParamsKey(params);
  let best: BlindRunRecord | null = null;
  for (const r of runs) {
    if (r.status !== 'valmis' || !r.summary) continue;
    if (pathParamsKey(r.params.path) !== key) continue;
    if (!best || r.ts > best.ts) best = r;
  }
  return best;
}

export function blindRefOf(r: BlindRunRecord | null): BlindRef | null {
  if (!r || !r.summary) return null;
  return { id: r.id, ts: r.ts, hash: r.hash, verdict: r.summary.verdict, hitsAt1: r.summary.hitsAt1, folds: r.summary.folds, pVsRandom: r.summary.pVsRandom };
}

/** Sokkotestin ajo ennen moottorikutsua. */
export function beginBlindRun(meta: {
  id: string;
  ts: string;
  hash: string;
  queryKey: string;
  configKey: string;
  verdict: ExploreVerdict;
  params: BlindParams;
  seedText: string;
  items: number;
  datasetSha: string | null;
}): BlindRunRecord {
  return {
    id: meta.id,
    ts: meta.ts,
    finishedAt: null,
    version: BLIND_VERSION,
    status: 'käynnissä',
    error: null,
    hash: meta.hash,
    queryKey: meta.queryKey,
    configKey: meta.configKey,
    exploratory: meta.verdict.exploratory,
    exploratoryReason: meta.verdict.reason,
    params: { ...meta.params, path: clonePathParams(meta.params.path) },
    seedText: meta.seedText,
    items: meta.items,
    folds: [],
    skipped: [],
    summary: null,
    notes: [],
    pMethod: null,
    randomStringRuns: [],
    piBeatsRandomStrings: null,
    fingerprint: null,
    durationMs: null,
    sourceLabel: '',
    datasetSha: meta.datasetSha,
  };
}

/** Valmis sokkotesti: kierrokset (oikein/väärin ja sijoitukset), yhteenveto, johtopäätös ja huomautukset. */
export function finishBlindRun(run: BlindRunRecord, res: BlindRunResult, finishedAt: string): BlindRunRecord {
  return {
    ...run,
    finishedAt,
    status: 'valmis',
    folds: res.folds.map((f) => ({
      hiddenLabel: f.hiddenLabel,
      group: f.group,
      contextLabels: [...f.contextLabels],
      candidates: f.candidates.length,
      rankPi: f.rankPi,
      correct: f.correct,
      topLabel: f.topLabel,
      rankRandomStrings: [...f.rankRandomStrings],
      notes: [...(f.notes ?? [])],
    })),
    skipped: res.skipped.map((s) => ({ label: s.label, reason: s.reason })),
    summary: { ...res.summary, randomStrings: res.summary.randomStrings ? { ...res.summary.randomStrings } : null },
    notes: [...(res.notes ?? [])],
    pMethod: res.pMethod ?? null,
    randomStringRuns: (res.randomStringRuns ?? []).map((r) => ({ ...r })),
    piBeatsRandomStrings: res.piBeatsRandomStrings ?? null,
    fingerprint: res.resultFingerprint ?? null,
    durationMs: res.durationMs,
    sourceLabel: res.sourceLabel ?? '',
  };
}

// ------------------------------------------------------------------ tallennettu tulos

export function compactScore(s: PathScore): CompactScore {
  return {
    total: s.total,
    rarity: s.rarity,
    length: s.length,
    branching: s.branching,
    transforms: s.transforms,
    structure: { ...s.structure },
    reproducible: s.reproducible,
  };
}

/** Näytetty tulos tallennettavaksi (kaikki kolme osaa erillään). */
export function savedFromCurrent(
  cur: PathCurrent,
  meta: { id: string; title: string; createdAt: string; datasetSha: string | null; blind: BlindRunRecord | null },
): SavedPathResult {
  const o = cur.outcome;
  return {
    id: meta.id,
    title: meta.title,
    createdAt: meta.createdAt,
    version: o.version || PATH_VERSION,
    scoreVersion: PATHSCORE_VERSION,
    runId: cur.runId,
    runTs: cur.ts,
    startText: cur.query.startText,
    goalText: cur.query.goalText,
    identifiers: cur.query.identifiers.map((i) => ({ ...i })),
    timeRange: cur.query.timeRange ? { ...cur.query.timeRange } : null,
    params: clonePathParams(cur.params),
    mode: cur.mode,
    hash: cur.hash,
    fingerprint: o.resultFingerprint,
    status: o.status,
    routes: o.routes,
    reasons: [...o.reasons],
    failures: o.failures.map((f) => ({ ...f })),
    vocabulary: o.vocabulary.map((v) => ({ ...v, labels: [...v.labels], roles: [...v.roles] })),
    sourceLabel: o.sourceLabel,
    datasetSha: meta.datasetSha,
    exploratory: cur.exploratory,
    exploratoryReason: cur.exploratoryReason,
    scores: cur.scores.map(compactScore),
    nulls: cur.null ? cur.null.nulls.map((n) => ({ ...n })) : [],
    nullHash: cur.null?.hash ?? null,
    reproducible: cur.null ? cur.null.reproducible : null,
    blindRef: blindRefOf(meta.blind),
  };
}

/** Tallennettu tulos takaisin näytettäväksi hakutulokseksi (saavutettuja solmuja ei tallenneta). */
export function outcomeFromSaved(s: SavedPathResult): SearchOutcome {
  return {
    version: s.version,
    mode: s.mode,
    status: s.status,
    routes: s.routes,
    reachedSample: [],
    failures: s.failures,
    reasons: s.reasons,
    forward: null,
    backward: null,
    vocabulary: s.vocabulary,
    params: s.params,
    canonical: '',
    resultFingerprint: s.fingerprint,
    sourceLabel: s.sourceLabel,
    ms: 0,
  };
}

// ------------------------------------------------------------------ tallennusmuoto

export interface PersistedPath {
  v: 1;
  form: PathForm;
  nullForm: NullForm;
  blindForm: BlindForm;
  runs: PathRunSummary[];
  counts: PathCounts;
  index: PathIndexes;
  saved: SavedPathResult[];
  blindRuns: BlindRunRecord[];
}

/** Tallennettava osa: lomakkeet, ajot, laskurit, hakemistot, tallennetut tulokset ja sokkotestit. Ei näytettyä tulosta. */
export function serializePath(p: PathState): PersistedPath {
  return {
    v: 1,
    form: p.form,
    nullForm: p.nullForm,
    blindForm: p.blindForm,
    runs: p.runs.slice(-PATH_RUNS_PERSIST),
    counts: p.counts,
    index: p.index,
    saved: p.saved.slice(-PATH_SAVED_PERSIST),
    blindRuns: p.blindRuns.slice(-BLIND_RUNS_PERSIST),
  };
}

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const str = (x: unknown, d = ''): string => (typeof x === 'string' ? x : d);
const strOrNull = (x: unknown): string | null => (typeof x === 'string' ? x : null);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const numOr = (x: unknown, d: number): number => (isNum(x) ? x : d);
const numOrNull = (x: unknown): number | null => (isNum(x) ? x : null);
const boolOrNull = (x: unknown): boolean | null => (x === true ? true : x === false ? false : null);
const strArr = (x: unknown): string[] => (Array.isArray(x) ? x.filter(isStr) : []);
const isInt = (x: unknown, min: number): x is number => typeof x === 'number' && Number.isInteger(x) && x >= min;
const HASH = /^[0-9a-f]{64}$/;

function list<T>(raw: unknown, f: (x: unknown) => T | null, label: string, warnings: string[]): T[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    warnings.push(`${label}: kenttä ei ollut lista, joten se ohitettiin.`);
    return [];
  }
  const out: T[] = [];
  let bad = 0;
  for (const x of raw) {
    const v = f(x);
    if (v) out.push(v);
    else bad++;
  }
  if (bad) warnings.push(`${label}: ${bad} virheellistä kohdetta ohitettiin.`);
  return out;
}

/** Polkuhaun parametrit: jokainen kenttä tarkistetaan erikseen; virheellinen kenttä korvataan oletuksella. */
export function sanitizePathParams(x: unknown): PathParams {
  const d = DEFAULT_PATH_PARAMS;
  if (!isObj(x)) return clonePathParams(d);
  const int = (v: unknown, def: number, min: number) => (isInt(v, min) ? v : def);
  const rules = Array.isArray(x.rules) ? (x.rules.filter((r) => RULE_ORDER.includes(r as PathRuleId)) as PathRuleId[]) : [...d.rules];
  const p: PathParams = {
    rules: [...new Set(rules)],
    use369: x.use369 === true,
    indexWindow: int(x.indexWindow, d.indexWindow, 0),
    fibKMin: int(x.fibKMin, d.fibKMin, 0),
    fibKMax: int(x.fibKMax, d.fibKMax, 0),
    nearestK: int(x.nearestK, d.nearestK, 0),
    chordMax: isNum(x.chordMax) && x.chordMax >= 0 ? x.chordMax : d.chordMax,
    minCodeLength: int(x.minCodeLength, d.minCodeLength, 1),
    maxHitsPerCode: int(x.maxHitsPerCode, d.maxHitsPerCode, 1),
    maxEdges: int(x.maxEdges, d.maxEdges, 1),
    budget: int(x.budget, d.budget, 1),
    maxRoutes: int(x.maxRoutes, d.maxRoutes, 1),
  };
  return validatePathParams(p).length ? clonePathParams(d) : p;
}

export function sanitizePathIdentifier(x: unknown): PathIdentifier | null {
  if (!isObj(x) || !isStr(x.id) || !x.id) return null;
  if (!ROLE_ORDER.includes(x.role as IdentifierRole) || !IDENTIFIER_KINDS.includes(x.kind as IdentifierKind)) return null;
  const kind = x.kind as IdentifierKind;
  const isDate = kind === 'päivämäärä' || kind === 'tapahtuma';
  return {
    id: x.id,
    role: x.role as IdentifierRole,
    kind,
    label: str(x.label),
    value: str(x.value),
    ...(isDate ? { dateFormat: DATE_FORMATS.includes(x.dateFormat as DateFormat) ? (x.dateFormat as DateFormat) : 'DDMMYYYY' } : {}),
    personId: strOrNull(x.personId),
    eventId: strOrNull(x.eventId),
    origin: ORIGINS.includes(x.origin as PathIdentifier['origin']) ? (x.origin as PathIdentifier['origin']) : 'käyttäjä',
  };
}

function sanitizeTimeRange(x: unknown): PathForm['timeRange'] {
  if (!isObj(x)) return null;
  const f = strOrNull(x.from);
  const t = strOrNull(x.to);
  const from = f && isValidIsoDate(f) ? f : null;
  const to = t && isValidIsoDate(t) ? t : null;
  return from || to ? { from, to } : null;
}

const mode = (x: unknown): SearchMode => (MODES.includes(x as SearchMode) ? (x as SearchMode) : 'kaksisuuntainen');

function sanitizeForm(x: unknown, warnings: string[]): PathForm {
  const base = initialPathForm();
  if (!isObj(x)) return base;
  return {
    startText: str(x.startText),
    goalText: str(x.goalText),
    identifiers: list(x.identifiers, sanitizePathIdentifier, 'Polkuhaun tunnisteet', warnings),
    timeRange: sanitizeTimeRange(x.timeRange),
    params: sanitizePathParams(x.params),
    mode: mode(x.mode),
  };
}

function sanitizeNullForm(x: unknown): NullForm {
  const d = initialPathState().nullForm;
  if (!isObj(x)) return d;
  return {
    R: (NULL_R_OPTIONS as readonly number[]).includes(x.R as number) ? (x.R as number) : d.R,
    randomStrings: (NULL_S_OPTIONS as readonly number[]).includes(x.randomStrings as number) ? (x.randomStrings as number) : d.randomStrings,
    seedText: isStr(x.seedText) && x.seedText.trim() ? x.seedText : d.seedText,
  };
}

function sanitizeBlindForm(x: unknown): BlindForm {
  const d = initialPathState().blindForm;
  if (!isObj(x)) return d;
  return {
    kind: x.kind === 'tapahtuma' ? 'tapahtuma' : 'polun-askel',
    decoys: isInt(x.decoys, 1) && x.decoys <= 99 ? x.decoys : d.decoys,
    seedText: isStr(x.seedText) && x.seedText.trim() ? x.seedText : d.seedText,
    randomStrings: (BLIND_S_OPTIONS as readonly number[]).includes(x.randomStrings as number) ? (x.randomStrings as number) : d.randomStrings,
    dateFormat: DATE_FORMATS.includes(x.dateFormat as DateFormat) ? (x.dateFormat as DateFormat) : d.dateFormat,
  };
}

function sanitizeCost(x: unknown): PathCost | null {
  if (!isObj(x) || !isInt(x.edges, 0) || !isInt(x.transforms, 0) || !isNum(x.span) || x.span < 0) return null;
  return { edges: x.edges, transforms: x.transforms, span: x.span };
}

const RUN_STATUSES: readonly PathRunStatus[] = ['käynnissä', 'löytyi', 'ei-löytynyt', 'valmis', 'virhe', 'keskeytetty'];

function sanitizeRun(x: unknown): PathRunSummary | null {
  if (!isObj(x) || !isStr(x.id) || !isStr(x.ts) || !isStr(x.hash) || !HASH.test(x.hash)) return null;
  if (x.kind !== 'haku' && x.kind !== 'vertailu') return null;
  let status = RUN_STATUSES.includes(x.status as PathRunStatus) ? (x.status as PathRunStatus) : null;
  if (!status) return null;
  // Ajo jäi kesken (sovellus suljettiin): kirjataan keskeytetyksi.
  let error = strOrNull(x.error);
  if (status === 'käynnissä') {
    status = 'keskeytetty';
    error = error ?? 'Ajo keskeytyi (sovellus suljettiin tai ladattiin uudelleen kesken ajon).';
  }
  if (x.kind === 'haku' && status === 'valmis') return null;
  if (x.kind === 'vertailu' && (status === 'löytyi' || status === 'ei-löytynyt')) return null;
  let nullSpec: PathRunSummary['nullSpec'] = null;
  if (x.kind === 'vertailu') {
    const s = x.nullSpec;
    if (!isObj(s) || !isInt(s.R, 0) || !isInt(s.S, 0) || !isInt(s.seed, 0)) return null;
    nullSpec = { R: s.R, S: s.S, seed: s.seed, seedText: str(s.seedText, String(s.seed)), searchRunId: strOrNull(s.searchRunId) };
  }
  return {
    id: x.id,
    ts: x.ts,
    finishedAt: strOrNull(x.finishedAt),
    kind: x.kind,
    mode: mode(x.mode),
    use369: x.use369 === true,
    status,
    routes: isInt(x.routes, 0) ? x.routes : 0,
    bestCost: sanitizeCost(x.bestCost),
    fingerprint: strOrNull(x.fingerprint),
    hash: x.hash,
    queryKey: str(x.queryKey),
    configKey: str(x.configKey),
    exploratory: x.exploratory === true,
    exploratoryReason: strOrNull(x.exploratoryReason),
    reasons: isInt(x.reasons, 0) ? x.reasons : 0,
    label: str(x.label, '–'),
    datasetSha: strOrNull(x.datasetSha),
    ms: numOrNull(x.ms),
    nullSpec,
    pValue: isNum(x.pValue) && x.pValue >= 0 && x.pValue <= 1 ? x.pValue : null,
    reproducible: boolOrNull(x.reproducible),
    error,
  };
}

const LAYERS = ['matemaattinen', 'geometrinen'] as const;
const DOMAINS = ['pi-indeksi', 'koodi', 'spiraali', 'oktaedri', 'tarina', 'aika'] as const;

function sanitizeNode(x: unknown): PathNode | null {
  if (!isObj(x) || !isStr(x.code) || !/^\d+$/.test(x.code) || !isInt(x.n, 1)) return null;
  return {
    code: x.code,
    n: x.n,
    labels: strArr(x.labels),
    roles: (Array.isArray(x.roles) ? x.roles : []).filter((r): r is IdentifierRole => ROLE_ORDER.includes(r as IdentifierRole)),
  };
}

function sanitizeStep(x: unknown): PathStep | null {
  if (!isObj(x)) return null;
  const from = sanitizeNode(x.from);
  const to = sanitizeNode(x.to);
  if (!from || !to || !RULE_ORDER.includes(x.rule as PathRuleId) || (x.side !== '234' && x.side !== '432')) return null;
  if (!LAYERS.includes(x.layer as (typeof LAYERS)[number]) || !DOMAINS.includes(x.domain as (typeof DOMAINS)[number])) return null;
  const metrics: Record<string, number | string> = {};
  if (isObj(x.metrics)) for (const [k, v] of Object.entries(x.metrics)) if (isNum(v) || isStr(v)) metrics[k] = v;
  return {
    from,
    to,
    rule: x.rule as PathRuleId,
    side: x.side,
    layer: x.layer as PathStep['layer'],
    domain: x.domain as PathStep['domain'],
    formula: str(x.formula),
    delta: numOr(x.delta, to.n - from.n),
    metrics,
    branching: numOr(x.branching, 1),
    transform: x.transform === true,
    verified: boolOrNull(x.verified),
    digitsFrom: strOrNull(x.digitsFrom),
    digitsTo: strOrNull(x.digitsTo),
  };
}

function sanitizeRoute(x: unknown): PathRoute | null {
  if (!isObj(x) || !isStr(x.key) || !Array.isArray(x.nodes) || !Array.isArray(x.steps)) return null;
  const nodes = x.nodes.map(sanitizeNode);
  const steps = x.steps.map(sanitizeStep);
  if (!nodes.length || nodes.some((n) => !n) || steps.some((s) => !s) || steps.length !== nodes.length - 1) return null;
  const cost = sanitizeCost(x.cost);
  if (!cost) return null;
  return {
    key: x.key,
    nodes: nodes as PathNode[],
    steps: steps as PathStep[],
    cost,
    meetIndex: isInt(x.meetIndex, 0) && x.meetIndex < nodes.length ? x.meetIndex : null,
  };
}

function sanitizeNull(x: unknown): NullComparison | null {
  if (!isObj(x) || (x.model !== 'tasajakauma' && x.model !== 'satunnaisjono')) return null;
  if (!isInt(x.replicates, 0) || !isInt(x.countAsGood, 0) || !isNum(x.pValue)) return null;
  return {
    model: x.model,
    replicates: x.replicates,
    seed: isInt(x.seed, 0) ? x.seed : 0,
    countAsGood: x.countAsGood,
    noRoute: isInt(x.noRoute, 0) ? x.noRoute : 0,
    pValue: x.pValue,
    pLow: numOr(x.pLow, NaN),
    pHigh: numOr(x.pHigh, NaN),
  };
}

function sanitizeCompactScore(x: unknown): CompactScore | null {
  if (!isObj(x)) return null;
  const st = isObj(x.structure) ? x.structure : {};
  return {
    total: numOrNull(x.total),
    rarity: numOrNull(x.rarity),
    length: numOr(x.length, 0),
    branching: numOr(x.branching, 0),
    transforms: numOr(x.transforms, 0),
    structure: { geometric: numOr(st.geometric, 0), numeric: numOr(st.numeric, 0) },
    reproducible: boolOrNull(x.reproducible),
  };
}

function sanitizeVocab(x: unknown): SearchOutcome['vocabulary'][number] | null {
  if (!isObj(x) || !isStr(x.code)) return null;
  return {
    code: x.code,
    labels: strArr(x.labels),
    roles: (Array.isArray(x.roles) ? x.roles : []).filter((r): r is IdentifierRole => ROLE_ORDER.includes(r as IdentifierRole)),
    hits: isInt(x.hits, 0) ? x.hits : 0,
    used: x.used === true,
    note: strOrNull(x.note),
  };
}

function sanitizeFailure(x: unknown): SearchFailure | null {
  if (!isObj(x) || !isStr(x.reason)) return null;
  return { code: strOrNull(x.code), label: strOrNull(x.label), reason: x.reason };
}

function sanitizeBlindRef(x: unknown): BlindRef | null {
  if (!isObj(x) || !isStr(x.id) || !isStr(x.hash) || !isStr(x.verdict)) return null;
  return {
    id: x.id,
    ts: str(x.ts),
    hash: x.hash,
    verdict: x.verdict,
    hitsAt1: numOr(x.hitsAt1, 0),
    folds: numOr(x.folds, 0),
    pVsRandom: numOr(x.pVsRandom, NaN),
  };
}

function sanitizeSaved(x: unknown): SavedPathResult | null {
  if (!isObj(x) || !isStr(x.id) || !isStr(x.createdAt) || !isStr(x.hash) || !HASH.test(x.hash)) return null;
  const status = x.status === 'löytyi' || x.status === 'ei-löytynyt' || x.status === 'virhe' ? x.status : null;
  if (!status || !Array.isArray(x.routes)) return null;
  const routes = x.routes.map(sanitizeRoute);
  // Yksikin virheellinen reitti hylkää tallennuksen: osittainen reittilista olisi harhaanjohtava.
  if (routes.some((r) => !r)) return null;
  const w: string[] = [];
  const scores = list(x.scores, sanitizeCompactScore, 'pisteet', w);
  return {
    id: x.id,
    title: str(x.title, 'Tallennettu tulos'),
    createdAt: x.createdAt,
    version: str(x.version, PATH_VERSION),
    scoreVersion: str(x.scoreVersion, PATHSCORE_VERSION),
    runId: str(x.runId),
    runTs: str(x.runTs),
    startText: str(x.startText),
    goalText: str(x.goalText),
    identifiers: list(x.identifiers, sanitizePathIdentifier, 'tunnisteet', w),
    timeRange: sanitizeTimeRange(x.timeRange),
    params: sanitizePathParams(x.params),
    mode: mode(x.mode),
    hash: x.hash,
    fingerprint: str(x.fingerprint),
    status,
    routes: routes as PathRoute[],
    reasons: strArr(x.reasons),
    failures: list(x.failures, sanitizeFailure, 'epäonnistumiset', w),
    vocabulary: list(x.vocabulary, sanitizeVocab, 'sanasto', w),
    sourceLabel: str(x.sourceLabel),
    datasetSha: strOrNull(x.datasetSha),
    exploratory: x.exploratory === true,
    exploratoryReason: strOrNull(x.exploratoryReason),
    scores: scores.length === routes.length ? scores : [],
    nulls: list(x.nulls, sanitizeNull, 'vertailut', w),
    nullHash: strOrNull(x.nullHash),
    reproducible: boolOrNull(x.reproducible),
    blindRef: sanitizeBlindRef(x.blindRef),
  };
}

function sanitizeFold(x: unknown): BlindFoldRecord | null {
  if (!isObj(x) || !isStr(x.hiddenLabel) || !isInt(x.rankPi, 1) || !isInt(x.candidates, 1) || x.rankPi > x.candidates) return null;
  return {
    hiddenLabel: x.hiddenLabel,
    group: str(x.group),
    contextLabels: strArr(x.contextLabels),
    candidates: x.candidates,
    rankPi: x.rankPi,
    // Oikein/väärin johdetaan sijoituksesta, ei tallennetusta lipusta.
    correct: x.rankPi === 1,
    topLabel: str(x.topLabel),
    rankRandomStrings: Array.isArray(x.rankRandomStrings) ? x.rankRandomStrings.filter((r): r is number => isInt(r, 1)) : [],
    notes: strArr(x.notes),
  };
}

function sanitizeSummary(x: unknown): BlindResult['summary'] | null {
  if (!isObj(x) || !isInt(x.folds, 0) || !isInt(x.hitsAt1, 0) || !isNum(x.pVsRandom) || !isStr(x.verdict)) return null;
  const rs = isObj(x.randomStrings) && isNum(x.randomStrings.hitsAt1) && isNum(x.randomStrings.meanRank)
    ? { hitsAt1: x.randomStrings.hitsAt1, meanRank: x.randomStrings.meanRank }
    : null;
  return {
    folds: x.folds,
    hitsAt1: x.hitsAt1,
    expectedHitsAt1: numOr(x.expectedHitsAt1, NaN),
    meanRank: numOr(x.meanRank, NaN),
    expectedMeanRank: numOr(x.expectedMeanRank, NaN),
    pVsRandom: x.pVsRandom,
    randomStrings: rs,
    verdict: x.verdict,
  };
}

function sanitizeBlindParams(x: unknown): BlindParams | null {
  if (!isObj(x) || (x.kind !== 'tapahtuma' && x.kind !== 'polun-askel') || !isInt(x.decoys, 1) || !isNum(x.seed)) return null;
  return {
    kind: x.kind,
    decoys: x.decoys,
    seed: x.seed,
    randomStrings: isInt(x.randomStrings, 0) ? x.randomStrings : 0,
    dateFormat: DATE_FORMATS.includes(x.dateFormat as DateFormat) ? (x.dateFormat as DateFormat) : 'DDMMYYYY',
    path: sanitizePathParams(x.path),
  };
}

function sanitizeBlindRun(x: unknown): BlindRunRecord | null {
  if (!isObj(x) || !isStr(x.id) || !isStr(x.ts) || !isStr(x.hash) || !HASH.test(x.hash)) return null;
  const params = sanitizeBlindParams(x.params);
  if (!params) return null;
  let status: BlindRunRecord['status'] | null =
    x.status === 'valmis' || x.status === 'virhe' || x.status === 'keskeytetty' || x.status === 'käynnissä' ? x.status : null;
  if (!status) return null;
  let error = strOrNull(x.error);
  if (status === 'käynnissä') {
    status = 'keskeytetty';
    error = error ?? 'Ajo keskeytyi (sovellus suljettiin tai ladattiin uudelleen kesken ajon).';
  }
  const summary = sanitizeSummary(x.summary);
  if (status === 'valmis' && !summary) return null;
  const w: string[] = [];
  return {
    id: x.id,
    ts: x.ts,
    finishedAt: strOrNull(x.finishedAt),
    version: str(x.version, BLIND_VERSION),
    status,
    error,
    hash: x.hash,
    queryKey: str(x.queryKey),
    configKey: str(x.configKey),
    exploratory: x.exploratory === true,
    exploratoryReason: strOrNull(x.exploratoryReason),
    params,
    seedText: str(x.seedText, String(params.seed)),
    items: isInt(x.items, 0) ? x.items : 0,
    folds: list(x.folds, sanitizeFold, 'kierrokset', w),
    skipped: list(
      x.skipped,
      (s) => (isObj(s) && isStr(s.reason) ? { label: str(s.label), reason: s.reason } : null),
      'ohitetut',
      w,
    ),
    summary,
    notes: strArr(x.notes),
    pMethod: strOrNull(x.pMethod),
    randomStringRuns: list(
      x.randomStringRuns,
      (r) => (isObj(r) && isNum(r.hitsAt1) && isNum(r.meanRank) ? { label: str(r.label), hitsAt1: r.hitsAt1, meanRank: r.meanRank } : null),
      'satunnaisjonot',
      w,
    ),
    piBeatsRandomStrings: boolOrNull(x.piBeatsRandomStrings),
    fingerprint: strOrNull(x.fingerprint),
    durationMs: numOrNull(x.durationMs),
    sourceLabel: str(x.sourceLabel),
    datasetSha: strOrNull(x.datasetSha),
  };
}

function sanitizeExploreIndex(x: unknown): ExploreIndex {
  const out: ExploreIndex = {};
  if (!isObj(x)) return out;
  for (const [k, v] of Object.entries(x)) {
    if (!isObj(v)) continue;
    const locked = strArr(v.locked);
    const firstSeen = strOrNull(v.firstSeen);
    const seenConfig = strOrNull(v.seenConfig);
    if (!locked.length && !firstSeen) continue;
    out[k] = { firstSeen, seenConfig, locked: seenConfig && !locked.includes(seenConfig) ? [...locked, seenConfig] : locked };
  }
  return out;
}

/** Hakemisto tallennetuista ajoista (aikajärjestyksessä): täydentää tallennettua hakemistoa, ei korvaa sitä. */
export function rebuildIndex(
  stored: ExploreIndex,
  runs: readonly { ts: string; queryKey: string; configKey: string; status: PathRunStatus | BlindRunRecord['status'] }[],
): ExploreIndex {
  let idx: ExploreIndex = {};
  for (const r of [...runs].sort((a, b) => cmpStr(a.ts, b.ts))) {
    if (!r.queryKey || !r.configKey) continue;
    idx = exploreStart(idx, r.queryKey, r.configKey);
    if (isSeenStatus(r.status as PathRunStatus)) idx = exploreSeen(idx, r.queryKey, r.configKey, r.ts);
  }
  const out: ExploreIndex = { ...stored };
  for (const [k, v] of Object.entries(idx)) {
    const s = out[k];
    if (!s) out[k] = v;
    else if (v.firstSeen && (!s.firstSeen || v.firstSeen < s.firstSeen)) out[k] = { ...v, locked: [...new Set([...v.locked])] };
  }
  return out;
}

/**
 * Tallennettu polkuhakutila takaisin. Ei koskaan heitä poikkeusta: puuttuva tai virheellinen osa korvataan oletuksella,
 * virheelliset kohteet ohitetaan yksitellen ja ilmoitetaan `warnings`-listassa. Kesken jääneet ajot kirjataan
 * keskeytetyiksi. Laskurit ovat vähintään tallennettujen ajojen määrä.
 */
export function deserializePath(raw: unknown): { state: PathState; warnings: string[] } {
  const base = initialPathState();
  const warnings: string[] = [];
  if (raw === undefined || raw === null) return { state: base, warnings };
  if (!isObj(raw)) return { state: base, warnings: ['Tallennettu polkuhakutila oli virheellinen; käytetään oletuksia.'] };
  try {
    const runs = list(raw.runs, sanitizeRun, 'Polkuhaun ajot', warnings).slice(-PATH_RUNS_PERSIST);
    const blindRuns = list(raw.blindRuns, sanitizeBlindRun, 'Sokkotestit', warnings).slice(-BLIND_RUNS_PERSIST);
    const saved = list(raw.saved, sanitizeSaved, 'Tallennetut polkuhaun tulokset', warnings).slice(-PATH_SAVED_PERSIST);
    const c = isObj(raw.counts) ? raw.counts : {};
    const nSearch = runs.filter((r) => r.kind === 'haku').length;
    const nNull = runs.filter((r) => r.kind === 'vertailu').length;
    const counts: PathCounts = {
      searches: Math.max(isInt(c.searches, 0) ? c.searches : 0, nSearch),
      nulls: Math.max(isInt(c.nulls, 0) ? c.nulls : 0, nNull),
      blinds: Math.max(isInt(c.blinds, 0) ? c.blinds : 0, blindRuns.length),
    };
    const ix = isObj(raw.index) ? raw.index : {};
    const index: PathIndexes = {
      searches: rebuildIndex(sanitizeExploreIndex(ix.searches), runs.filter((r) => r.kind === 'haku')),
      nulls: rebuildIndex(sanitizeExploreIndex(ix.nulls), runs.filter((r) => r.kind === 'vertailu')),
      blinds: rebuildIndex(sanitizeExploreIndex(ix.blinds), blindRuns),
    };
    return {
      state: {
        ...base,
        form: sanitizeForm(raw.form, warnings),
        nullForm: sanitizeNullForm(raw.nullForm),
        blindForm: sanitizeBlindForm(raw.blindForm),
        runs,
        counts,
        index,
        saved,
        blindRuns,
      },
      warnings,
    };
  } catch (e) {
    return { state: base, warnings: [`Polkuhakutilan lataus epäonnistui (${e instanceof Error ? e.message : String(e)}); käytetään oletuksia.`] };
  }
}
