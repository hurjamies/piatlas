// Tarinamatriisin toiminnot. Jokainen toiminto kirjataan matriisin lokiin, ja tutkimuksen kannalta olennaiset
// (369, hyppysäännöt, reittitestit, hypoteesin lukitus, reitin tallennus ja tarinan muokkaukset) myös yhteiseen
// muutoshistoriaan (audit 'matriisi'). Laskenta tehdään ydinkirjastolla (src/core/matrix); tässä ei ole omaa
// matematiikkaa. Tarinatiedot tallentuvat vain laitteelle (persist.ts).

import { describe, fmtIndex } from '../core/matrix/expand';
import { codeHits } from '../core/matrix/hits';
import { JUMP_DEFINITIONS, JumpOpId, runJump } from '../core/matrix/jumps';
import { run369 } from '../core/matrix/ops369';
import { referenceCodes, t9Code } from '../core/matrix/refs';
import type { RouteOrder, RouteTestResult } from '../core/matrix/route-test';
import { createSeedStory } from '../core/matrix/seed';
import {
  personLabel,
  removeGloss,
  removePath,
  removePerson,
  removeRelation,
  upsertGloss,
  upsertPath,
  upsertPerson,
  upsertRelation,
} from '../core/matrix/story';
import { crossings, firstTestRoute, openEdge as coreOpenEdge, rootTrail, trailKeys, truncateTo } from '../core/matrix/trail';
import type {
  Direction,
  Gloss,
  HypothesisTiming,
  MatrixEdge,
  MatrixEnv,
  MatrixLogKind,
  NodeRef,
  Person,
  Relation,
  SavedRoute,
  StoryModel,
  StoryPath,
} from '../core/matrix/types';
import { DIRECTION_SEMANTICS, LAYER_LABELS, MATRIX_VERSION, MAX_DEPTH, nodeKey, REALM_LABELS, realmOf } from '../core/matrix/types';
import { seedFrom } from '../core/random';
import { sha256Hex } from '../core/sha256';
import { termEncoding } from '../core/types';
import { getEngine } from '../engine/client';
import { addTerm, audit, focusIndex, select, setMapMode, setTab, toast, updateEvent, updateTerm } from './actions';
import {
  addRunToIndex,
  canonicalRouteLock,
  evaluateRouteTiming,
  lockForQuestion,
  LOG_MEMORY,
  matrixEnvOf,
  MatrixState,
  MatrixSub,
  MatrixViewMode,
  NamedCode,
  RouteLock,
  RouteRunSummary,
  RouteTestForm,
  RouteTestUi,
  routeMathFacts,
  sanitizeStory,
  savedRouteHypothesis,
  summarizeRouteRun,
  taskDerivedReason,
  trailToHit,
  VISITED_MEMORY,
} from './matrix';
import { appendHitStep, appendSelected, danglingEventPersons, personLinkLabel } from './matrix-select';
import { matrixJobBusy } from './path';
import { store } from './store';

const nowIso = () => new Date().toISOString();
export const newId = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

function setM(patch: Partial<MatrixState> | ((m: MatrixState) => Partial<MatrixState>)) {
  store.set((s) => ({ matrix: { ...s.matrix, ...(typeof patch === 'function' ? patch(s.matrix) : patch) } }));
}

/** Matriisin ympäristö nykyisestä tilasta. */
export function matrixEnv(): MatrixEnv {
  const s = store.get();
  return matrixEnvOf(s, s.matrix);
}

/** Kirjaa matriisin lokiin; `research` = myös yhteiseen muutoshistoriaan. */
function mlog(kind: MatrixLogKind, text: string, ref?: string, research = false) {
  const entry = { ts: nowIso(), kind, text, ...(ref ? { ref } : {}) };
  setM((m) => ({ log: [...m.log, entry].slice(-LOG_MEMORY) }));
  if (research) audit('matriisi', text);
}

function visit(keys: string[]) {
  setM((m) => {
    const set = new Set(keys);
    return { visited: [...m.visited.filter((k) => !set.has(k)), ...keys].slice(-VISITED_MEMORY) };
  });
}

export const focusRef = (m: MatrixState = store.get().matrix) => m.trail[m.trail.length - 1].ref;

export const setMatrixView = (view: MatrixViewMode) => setM({ view, sub: null });
export const setMatrixSub = (sub: MatrixSub) => setM({ sub });

// ------------------------------------------------------------------ navigointi

/**
 * Avaa särmän. Reitillä jo oleva kohde katkaisee reitin siihen ("↺ jo polulla"); syvyysraja estää avauksen.
 * Palauttaa ydinkirjaston tuloksen ('lisätty' | 'palattu' | 'syvyysraja').
 */
export function openEdge(edge: MatrixEdge, fromIndex?: number) {
  const m = store.get().matrix;
  const r = coreOpenEdge(m.trail, edge, fromIndex);
  const key = nodeKey(edge.to);
  if (r.result === 'syvyysraja') {
    toast(`Syvyysraja ${MAX_DEPTH} solmua saavutettu. Palaa murupolussa taaksepäin ennen uutta avausta.`);
    mlog('avaus', `Syvyysraja ${MAX_DEPTH}: ${key} jäi avaamatta.`, key);
    return r.result;
  }
  setM({ trail: r.trail, sub: null });
  visit([key]);
  if (r.result === 'palattu') toast('Palattiin polulla olevaan solmuun');
  const crossing = edge.crossesRealm ? `; siirtymä ${REALM_LABELS[realmOf(m.trail[m.trail.length - 1].ref)]} → ${REALM_LABELS[realmOf(edge.to)]}` : '';
  mlog(
    'avaus',
    `${r.result === 'palattu' ? '↺ Palattiin solmuun' : 'Avattiin'} ${key} · ${edge.relation} (${LAYER_LABELS[edge.layer]}${crossing})`,
    key,
  );
  return r.result;
}

/** Murupolun muru: reitti katkaistaan siihen, ja alasivu (Tarina, Reitit, Loki) suljetaan, jotta fokus näkyy. */
export function jumpToCrumb(i: number) {
  const m = store.get().matrix;
  if (i === m.trail.length - 1) {
    if (m.sub !== null) setM({ sub: null });
    return;
  }
  const trail = truncateTo(m.trail, i);
  setM({ trail, sub: null });
  const key = nodeKey(trail[trail.length - 1].ref);
  mlog('avaus', `Murupolku: palattiin askeleeseen ${i} (${key}).`, key);
}

export function resetToRoot() {
  const m = store.get().matrix;
  if (m.trail.length === 1 && m.sub === null) return;
  setM({ trail: rootTrail(), sub: null });
  mlog('avaus', 'Palattiin lähtöankkuriin (juuri).', 'root');
}

export function startFirstTestRoute() {
  const env = matrixEnv();
  const { trail, errors } = firstTestRoute(env);
  setM({ trail, sub: null });
  visit(trailKeys(trail));
  mlog('avaus', `Ensimmäinen testireitti: ${trailKeys(trail).join(' → ')}${errors.length ? ` (keskeytyi: ${errors.join(' ')})` : ''}`, nodeKey(trail[trail.length - 1].ref));
  if (errors.length) toast(errors[0]);
}

export function setDirection(d: Direction) {
  const m = store.get().matrix;
  if (m.direction === d) return;
  setM({ direction: d });
  mlog(
    'suunta',
    `Suunta ${m.direction} → ${d} (esim. π-indeksi: ${DIRECTION_SEMANTICS['pi-indeksi'][d]}; tarina: ${DIRECTION_SEMANTICS.tarina[d]}). Suunta ei ole hyppy.`,
    nodeKey(focusRef(m)),
  );
}

// ------------------------------------------------------------------ operaatiot

export function runOps369() {
  const env = matrixEnv();
  const ref = focusRef();
  const report = run369(ref, env, nowIso());
  setM({ last369: report });
  mlog('369', `369-avausavain ${report.targetKey} (${report.direction} + vastakkainen): ${report.summary}`, report.targetKey, true);
  return report;
}

export function runJumpOp(id: JumpOpId) {
  const env = matrixEnv();
  const ref = focusRef();
  const res = runJump(id, ref, env);
  setM({ lastJump: res });
  const key = nodeKey(ref);
  mlog(
    'hyppy',
    `${JUMP_DEFINITIONS[id].title} (${id}) solmussa ${key}: ${res.base == null ? 'ei perustaa' : `jono ${res.jumpString || '–'}, ${res.matches.length ? `sama kuin ${res.matches.map((r) => `${r.name} ${r.code}`).join(', ')}` : 'ei uutta'}`}.`,
    key,
    true,
  );
  return res;
}

export const clearLast369 = () => setM({ last369: null });
export const clearLastJump = () => setM({ lastJump: null });

// ------------------------------------------------------------------ tallennetut reitit

export function saveRoute(opts: { title: string; interpretation: string; timing: HypothesisTiming; lockId?: string | null }): SavedRoute {
  const s = store.get();
  const m = s.matrix;
  const ts = nowIso();
  const lock = opts.lockId ? m.locks.find((l) => l.id === opts.lockId) ?? null : null;
  // Lukituksen on koskettava juuri tämän reitin koodeja ja edellettävä reitin π-solmujen avaamista (lockFitsRoute).
  const { meta, downgraded } = savedRouteHypothesis(opts.timing, lock, m.runIndex, ts, { trail: m.trail, story: m.story, log: m.log });
  const mathFacts = routeMathFacts(m.trail, s.digits, s.anchor, m.story);
  const route: SavedRoute = {
    id: newId('reitti'),
    title: opts.title.trim() || `Reitti ${m.saved.length + 1}`,
    createdAt: ts,
    trail: m.trail,
    direction: m.direction,
    interpretation: opts.interpretation.trim(),
    hypothesis: meta,
    mathFacts,
    crossings: crossings(m.trail),
    matrixVersion: MATRIX_VERSION,
  };
  setM((mm) => ({ saved: [...mm.saved, route] }));
  const bad = mathFacts.filter((f) => f.includes('✗')).length;
  mlog(
    'tallennus',
    `Reitti tallennettu: "${route.title}" (${route.trail.length} askelta, ${route.crossings.length} kerrosvaihtoa, π-faktat ${mathFacts.length - bad}/${mathFacts.length} ✓, ajoitus ${meta.timing}).`,
    nodeKey(focusRef(m)),
    true,
  );
  if (bad) mlog('tarkistus', `Tallennetun reitin "${route.title}" π-faktoista ${bad} ei täsmää lähdeaineistoon (✗).`);
  if (downgraded) toast(downgraded);
  else toast(`Reitti tallennettu: ${route.title}`);
  return route;
}

export function deleteRoute(id: string) {
  const r = store.get().matrix.saved.find((x) => x.id === id);
  if (!r) return;
  setM((m) => ({ saved: m.saved.filter((x) => x.id !== id) }));
  mlog('tallennus', `Tallennettu reitti poistettu: "${r.title}".`, undefined, true);
}

export function openRoute(id: string) {
  const r = store.get().matrix.saved.find((x) => x.id === id);
  if (!r) return;
  setM({ trail: r.trail, direction: r.direction, sub: null });
  visit(trailKeys(r.trail));
  mlog('avaus', `Avattiin tallennettu reitti "${r.title}" (suunta ${r.direction}).`, nodeKey(r.trail[r.trail.length - 1].ref));
}

// ------------------------------------------------------------------ hypoteesin lukitus ja reittitesti

/**
 * Lukitsee reittihypoteesin (SHA-256, tämän laitteen kirjaus). `taskSource` = tehtävänannon lähteen nimi, jos koodit
 * valittiin tehtävänannon reitistä tai polusta: silloin ajoitus on aina 'löydön-jälkeen'.
 */
export async function lockRouteHypothesis(text: string, codes: NamedCode[], order: RouteOrder, taskSource: string | null = null): Promise<RouteLock> {
  const s = store.get();
  const createdAt = nowIso();
  const datasetSha = s.dataset.info?.sha256 ?? null;
  const cs = codes.map((c) => c.code);
  const hash = await sha256Hex(canonicalRouteLock(text, cs, order, datasetSha, createdAt));
  const m = store.get().matrix;
  const v = evaluateRouteTiming(
    { codes: cs, order, datasetSha, createdAt, hash },
    m.runIndex,
    cs,
    order,
    datasetSha,
    taskDerivedReason(cs, m.story, taskSource),
  );
  const lock: RouteLock = {
    id: newId('lukitus'),
    createdAt,
    text,
    codes: cs,
    names: codes.map((c) => c.name),
    order,
    datasetSha,
    hash,
    timing: v.timing,
    reason: v.reason,
  };
  setM((m) => ({ locks: [...m.locks, lock] }));
  mlog(
    'vertailu',
    `Reittihypoteesi lukittu (SHA-256 ${hash.slice(0, 12)}…, ${v.timing}): ${codes.map((c) => c.name).join(' → ')}, järjestys ${order}. ${text}`,
    undefined,
    true,
  );
  toast(v.preregistered ? `Hypoteesi lukittu (${hash.slice(0, 10)}…). Aja reittitesti seuraavaksi.` : v.reason);
  return lock;
}

function setRT(patch: Partial<RouteTestUi> | ((rt: RouteTestUi) => Partial<RouteTestUi>)) {
  setM((m) => ({ routeTest: { ...m.routeTest, ...(typeof patch === 'function' ? patch(m.routeTest) : patch) } }));
}

/** Reittitestin lomakkeen muutos (store: säilyy, kun Reitit-sivulta poistutaan ja palataan). */
export function setRouteForm(patch: Partial<RouteTestForm>) {
  setRT((rt) => ({ form: { ...rt.form, ...patch } }));
}

export const selectRouteRun = (id: string | null) => setRT({ selected: id });
export const setRouteTestError = (error: string | null) => setRT({ error });

/**
 * Ajaa reittitestin. Ajon tila (eteneminen, parametrit, virhe, viimeisin tulos) pidetään storessa, joten se näkyy
 * myös, kun Reitit-sivulle palataan kesken ajon. Vain yksi ajo kerrallaan: toinen pyyntö hylätään.
 * Ajoitus arvioidaan ennen ajoa ajohakemistosta (runIndex); lukitus haetaan kysymyksen kanonisella avaimella.
 * `taskSource` = tehtävänannon lähteen nimi, jos koodit valittiin tehtävänannon reitistä tai polusta.
 * Palauttaa null, jos ajo ei käynnistynyt tai epäonnistui (syy: routeTest.error).
 */
export async function runRouteTest(
  opts: { codes: NamedCode[]; order: RouteOrder; R: number; seedText: string; randomStrings: number; taskSource?: string | null },
  onProgress?: (done: number, total: number) => void,
): Promise<{ result: RouteTestResult; summary: RouteRunSummary } | null> {
  const s = store.get();
  if (s.matrix.routeTest.running) {
    setRT({ error: 'Reittitesti on jo käynnissä. Odota sen valmistumista tai keskeytä se ensin.' });
    return null;
  }
  // Vain yksi moottorityö kerrallaan: polkuhaku, satunnaisvertailu tai sokkotesti estää reittitestin.
  const busy = matrixJobBusy(s.matrix);
  if (busy) {
    setRT({ error: busy });
    toast(busy);
    return null;
  }
  const label =
    `${opts.codes.map((c) => c.name).join(' → ')} (${opts.order}), R = ${opts.R}, siemen ”${opts.seedText}”` +
    `${opts.randomStrings ? `, ${opts.randomStrings} satunnaisjonoa` : ''}`;
  setRT({ error: null, running: { done: 0, total: opts.R + opts.randomStrings, startedAt: nowIso(), label } });
  try {
    const digits = s.digits;
    if (!digits) throw new Error('Aineistoa ei ole ladattu.');
    if (opts.codes.length < 2) throw new Error('Reittitesti vaatii vähintään kaksi koodia.');
    const codes = opts.codes.map((c) => c.code);
    const hits = codes.map((c) => Array.from(codeHits(digits, c)));
    const empty = opts.codes.filter((_, i) => !hits[i].length);
    if (empty.length) throw new Error(`Koodilla ${empty.map((c) => `${c.name} ${c.code}`).join(', ')} ei ole osumia aineistossa.`);
    const datasetSha = s.dataset.info?.sha256 ?? null;
    const lock = lockForQuestion(s.matrix.locks, codes, opts.order, datasetSha);
    // Ajoitus arvioidaan ennen ajoa: vain aiemmat ajot (kaikki järjestysvariantit) ratkaisevat.
    const timing = evaluateRouteTiming(
      lock,
      s.matrix.runIndex,
      codes,
      opts.order,
      datasetSha,
      taskDerivedReason(codes, s.matrix.story, opts.taskSource ?? null),
    );
    const seed = seedFrom(opts.seedText);
    const result = await getEngine().call(
      {
        type: 'routeTest',
        params: {
          codes,
          hits,
          lens: codes.map((c) => c.length),
          N: digits.length,
          R: opts.R,
          seed,
          order: opts.order,
          randomStrings: opts.randomStrings,
        },
      },
      (done, total) => {
        setRT((rt) => (rt.running ? { running: { ...rt.running, done, total } } : {}));
        onProgress?.(done, total);
      },
    );
    const summary = summarizeRouteRun(result, {
      id: newId('reittitesti'),
      ts: nowIso(),
      names: opts.codes.map((c) => c.name),
      seedText: opts.seedText,
      datasetSha,
      digits,
      timing,
      lock,
    });
    setM((m) => ({
      routeRuns: [...m.routeRuns, summary],
      runIndex: addRunToIndex(m.runIndex, summary),
      routeTest: { ...m.routeTest, last: { id: summary.id, nullValues: result.nullValues }, selected: summary.id },
    }));
    mlog(
      'vertailu',
      `Reittitesti ${opts.codes.map((c) => `${c.name} ${c.code}`).join(' → ')} (${opts.order}), R=${opts.R}, siemen ${seed}` +
        `${opts.randomStrings ? `, ${opts.randomStrings} satunnaisjonoa` : ''}: lyhin ikkuna ${summary.span ?? '∞'}, p=${summary.pValue.toPrecision(3)} (${timing.timing}).`,
      undefined,
      true,
    );
    return { result, summary };
  } catch (e) {
    setRT({ error: e instanceof Error ? e.message : String(e) });
    return null;
  } finally {
    setRT({ running: null });
  }
}

// ------------------------------------------------------------------ hakutermit ja muut näkymät

const PALETTE = ['#72e1d1', '#f4c56b', '#bd9bff', '#8fb6ff', '#ff9db4', '#86e3a8', '#ffb070', '#e6a3ff', '#7fd3ff', '#f0e68c'];

/** Koodin nimi tarinasta (lähtötunnisteet ja henkilöt), jos jokin nimi tuottaa koodin. */
export function nameForCode(code: string, story: StoryModel = store.get().matrix.story): string | null {
  return referenceCodes(story).find((r) => r.code === code)?.name ?? null;
}

/**
 * Hakutermi, jonka nykyinen koodi on `code`. Jos sellaista ei ole, lisätään näkyvä T9-nimitermi (tai RAW-numerojono,
 * jos koodilla ei ole nimeä). addTerm kirjaa lisäyksen muutoshistoriaan.
 */
export function ensureTermForHit(code: string, name: string | null): string {
  const s = store.get();
  const candidates = s.terms.filter((t) => {
    if (t.mode !== 'contiguous') return false;
    const c = s.hits[t.id]?.code || termEncoding(t).code;
    return c === code;
  });
  const existing = candidates.find((t) => t.visible) ?? candidates[0];
  if (existing) {
    if (!existing.visible) {
      updateTerm(existing.id, { visible: true });
      toast(`Hakutermi ${existing.label} asetettiin näkyväksi kartoille.`);
    }
    return existing.id;
  }
  const color = PALETTE[s.terms.length % PALETTE.length];
  const base = { scandi: 'fi-translit' as const, uppercase: true, color, visible: true, mode: 'contiguous' as const };
  const id =
    name && t9Code(name) === code
      ? addTerm({ ...base, label: name, value: name, kind: 'nimi', encoding: 'T9' })
      : addTerm({ ...base, scandi: 'none', label: code, value: code, kind: 'numerojono', encoding: 'RAW' });
  toast(`Lisättiin hakutermi ${name && t9Code(name) === code ? name : code} (${code}), jotta osuma näkyy myös muissa näkymissä.`);
  return id;
}

export type PiTarget = 'spiraali' | '3d' | 'atlas' | 'pi-indeksi';

/** Matriisin π-sijainti muihin näkymiin: spiraali, 3D, atlas/verkko tai 1D-numerolinja. */
export function showPiPosition(pos: { n: number; code: string | null }, target: PiTarget) {
  const s = store.get();
  const where = { spiraali: 'spiraaliin', '3d': '3D-näkymään', atlas: 'atlakseen', 'pi-indeksi': 'π-indeksiin' }[target];
  mlog('avaus', `Siirryttiin ${where}: ${pos.code ? `${pos.code} @${pos.n}` : `kohta @${pos.n}`}.`, nodeKey(focusRef()));
  if (!pos.code) {
    if (target !== 'pi-indeksi') toast('Kohta ei ole koodin osuma, joten se avataan π-indeksissä.');
    focusIndex(pos.n);
    return;
  }
  const termId = ensureTermForHit(pos.code, nameForCode(pos.code));
  const ref = { termId, n: pos.n };
  if (target === 'spiraali') {
    setMapMode('spiral');
    select(ref, { tab: 'map' });
  } else if (target === 'atlas') {
    setMapMode(s.mapMode === 'net' ? 'net' : 'atlas');
    select(ref, { tab: 'map' });
  } else if (target === '3d') select(ref, { tab: 'space' });
  else select(ref, { tab: 'digits' });
}

/** Hakutermin osuma matriisiin: juuri → koodi → osuma todellisia särmiä pitkin. */
export function openMatrixAtHit(termId: string, n: number) {
  const s = store.get();
  const t = s.terms.find((x) => x.id === termId);
  const code = s.hits[termId]?.code;
  if (!t || !code) {
    toast('Osuman koodia ei vielä tiedetä (haku kesken).');
    return;
  }
  if (t.mode !== 'contiguous') {
    toast('Kokeellinen hyppypolku ei ole peräkkäinen osuma, joten sitä ei avata matriisissa.');
    return;
  }
  const env = matrixEnv();
  const cur = store.get().matrix.trail;
  const key = nodeKey({ kind: 'hit', code, n });
  setTab('matrix');
  // Pelkkä juuri: juuri → koodi → osuma. Muuten nykyinen polku säilyy: polulla oleva osuma katkaisee polun siihen,
  // ja muu osuma lisätään polun loppuun näkyvänä "avattu osumasta" -askeleena (ei laskettu yhteys).
  if (cur.length <= 1) {
    const { trail, direct } = trailToHit(env, code, n, t.label);
    setM({ trail, sub: null });
    visit(trailKeys(trail));
    mlog(
      'avaus',
      `Avattiin osumasta ${t.label} ${code} @${n}${direct ? ' (juuri → koodi → osuma)' : ' (koodiin ei ole juuren särmää, askel merkitty)'}.`,
      key,
    );
    return;
  }
  const r = appendHitStep(cur, env.digits, code, n, t.label);
  if (r.result === 'syvyysraja') {
    setM({ sub: null });
    toast(`Syvyysraja ${MAX_DEPTH} solmua: osumaa ${code} @${fmtIndex(n)} ei lisätty polulle. Palaa murupolussa taaksepäin ja avaa osuma uudelleen.`);
    mlog('avaus', `Syvyysraja ${MAX_DEPTH}: osuma ${key} (${t.label}) jäi avaamatta.`, key);
    return;
  }
  setM({ trail: r.trail, sub: null });
  visit([key]);
  if (r.result === 'palattu') {
    toast(`Osuma ${code} @${fmtIndex(n)} on jo polulla: palattiin siihen.`);
    mlog('avaus', `↺ Osuma ${t.label} ${code} @${n} oli jo polulla: palattiin askeleeseen ${r.trail.length - 1}.`, key);
  } else {
    toast(`Osuma ${code} @${fmtIndex(n)} lisättiin polun loppuun (avattu osumasta). Aiempi polku säilyi.`);
    mlog('avaus', `Avattiin osumasta ${t.label} ${code} @${n}: lisättiin polun loppuun askeleena "avattu osumasta" (ei laskettu yhteys).`, key);
  }
}

/**
 * Käyttäjän valitsema solmu (solmuvalitsin, Tarina-sivu, tapahtumapaneeli) matriisin fokukseksi. Solmu lisätään
 * nykyisen polun loppuun näkyvänä "valittu käyttäjän toimesta" -askeleena; askel ei ole laskettu yhteys. Polulla jo
 * oleva solmu katkaisee polun siihen. Avaa Matriisi-välilehden ja sulkee alasivun.
 */
export function openSelectedNode(ref: NodeRef, source: string) {
  const env = matrixEnv();
  const m = store.get().matrix;
  const title = describe(ref, env).title;
  const key = nodeKey(ref);
  const r = appendSelected(m.trail, ref, title, source);
  setTab('matrix');
  if (r.result === 'syvyysraja') {
    setM({ sub: null });
    toast(`Syvyysraja ${MAX_DEPTH} solmua saavutettu. Palaa murupolussa taaksepäin ennen uutta avausta.`);
    mlog('avaus', `Syvyysraja ${MAX_DEPTH}: valittu solmu ${key} jäi avaamatta.`, key);
    return r.result;
  }
  setM({ trail: r.trail, sub: null });
  visit([key]);
  if (r.result === 'palattu') {
    toast('Solmu on jo polulla: palattiin siihen.');
    mlog('avaus', `↺ Valittu solmu ${key} (${source}) oli jo polulla: palattiin askeleeseen ${r.trail.length - 1}.`, key);
  } else {
    const via = r.trail[r.trail.length - 1].via;
    const crossing = via?.crossesRealm ? `; siirtymä ${REALM_LABELS[realmOf(focusRef(m))]} → ${REALM_LABELS[realmOf(ref)]}` : '';
    mlog('avaus', `Valittu käyttäjän toimesta (${source}): ${key} ${title}${crossing}. Ei laskettu yhteys.`, key);
  }
  return r.result;
}

/** Osuma (esim. reittitestin valinta) matriisin fokukseksi: juuri → koodi → osuma. Pysyy Matriisi-välilehdellä. */
export function openHitInMatrix(code: string, n: number, label: string) {
  const { trail } = trailToHit(matrixEnv(), code, n, label);
  setM({ trail, sub: null });
  visit(trailKeys(trail));
  mlog('avaus', `Avattiin osuma ${code} @${n} (${label}).`, nodeKey(trail[trail.length - 1].ref));
}

/** Henkilön liittäminen tapahtumaan (tarinakerros; käyttäjän valinta). */
export function toggleEventPerson(eventId: string, personId: string) {
  const s = store.get();
  const e = s.events.find((x) => x.id === eventId);
  if (!e) return;
  const ids = e.personIds ?? [];
  const on = ids.includes(personId);
  updateEvent(eventId, { personIds: on ? ids.filter((x) => x !== personId) : [...ids, personId] });
  const label = personLabel(s.matrix.story, personId);
  audit('tapahtuma', `${on ? 'Poistettu henkilö' : 'Käyttäjä liitti henkilön'} ${label} ${on ? 'tapahtumasta' : 'tapahtumaan'} "${e.title}"`);
  mlog('tarina', `${on ? 'Poistettu' : 'Liitetty'}: tapahtuma "${e.title}" ↔ ${label}.`, `event:${eventId}`);
}

// ------------------------------------------------------------------ tarinan muokkaus (ydinkirjaston muokkausoperaatiot)

function commitStory(next: StoryModel, text: string) {
  setM({ story: next });
  mlog('tarina', text, undefined, true);
}

const story = () => store.get().matrix.story;

export function savePerson(p: Person) {
  const exists = story().persons.some((x) => x.id === p.id);
  const next = upsertPerson(story(), p);
  commitStory(next, `${exists ? 'Muokattu' : 'Lisätty'} henkilö ${personLabel(next, p.id)} (${p.id}).`);
}

export function deletePerson(id: string): string | null {
  const r = removePerson(story(), id, store.get().events);
  if (r.error) return r.error;
  commitStory(r.model, `Poistettu henkilö ${id}.`);
  return null;
}

export function saveRelation(r: Relation) {
  const exists = story().relations.some((x) => x.id === r.id);
  commitStory(upsertRelation(story(), r), `${exists ? 'Muokattu' : 'Lisätty'} suhde ${r.from} → ${r.to} (${r.kind}).`);
}

export function deleteRelation(id: string) {
  commitStory(removeRelation(story(), id), `Poistettu suhde ${id}.`);
}

export function saveGloss(g: Gloss) {
  const exists = story().glosses.some((x) => x.id === g.id);
  commitStory(upsertGloss(story(), g), `${exists ? 'Muokattu' : 'Lisätty'} tulkinta ${g.symbol} = ${g.meanings.join(', ') || '–'} (${g.id}).`);
}

export function deleteGloss(id: string) {
  commitStory(removeGloss(story(), id), `Poistettu tulkinta ${id}.`);
}

export function savePath(p: StoryPath) {
  const exists = story().paths.some((x) => x.id === p.id);
  commitStory(upsertPath(story(), p), `${exists ? 'Muokattu' : 'Lisätty'} polku ${p.title} (${p.steps.length} askelta).`);
}

export function deletePath(id: string): string | null {
  const r = removePath(story(), id);
  if (r.error) return r.error;
  commitStory(r.model, `Poistettu polku ${id}.`);
  return null;
}

/**
 * Korvaa tarinan tuodulla. `precheck` = tuontiraportin huomautukset (Tarina-sivun sanitizeStory), jotka kirjataan
 * lokiin; tarkistus ajetaan tässä uudelleen, joten myös suoraan kutsuttu tuonti tarkistetaan.
 */
export function importStory(next0: StoryModel, sourceName: string, precheck: readonly string[] = []) {
  // Ajoitusväitteet tarkistetaan tämän laitteen lukituksia vasten myös tässä (tuontiraportin lisäksi):
  // 'ennen-löydöstä' ilman vastaavaa lukitusta → 'ei-tiedossa', tehtävänannon polku → 'löydön-jälkeen'.
  const checked = sanitizeStory(next0, store.get().matrix.locks);
  const next = checked.story ? { ...next0, paths: checked.story.paths } : next0;
  for (const d of new Set([...precheck, ...checked.dropped])) mlog('tarkistus', `Tarinan tuonti (${sourceName}): ${d}`);
  dropDanglingEventPersons(next, `Tarinan tuonti (${sourceName})`);
  commitStory(
    next,
    `Tarina tuotiin (${sourceName}): ${next.persons.length} henkilöä, ${next.paths.length} polkua, ${next.glosses.length} tulkintaa, ${next.relations.length} suhdetta.`,
  );
  setM({ trail: rootTrail(), last369: null, lastJump: null });
}

/**
 * Ennen tarinan korvaamista: tapahtumien henkilölinkit, joiden henkilöä ei ole uudessa tarinassa, poistetaan
 * (käyttäjä on vahvistanut listan Tarina-sivulla). Jokainen poisto kirjataan muutoshistoriaan.
 */
function dropDanglingEventPersons(next: StoryModel, reason: string) {
  const prev = story();
  for (const d of danglingEventPersons(store.get().events, next)) {
    const e = store.get().events.find((x) => x.id === d.eventId);
    if (!e) continue;
    const gone = new Set(d.personIds);
    updateEvent(e.id, { personIds: (e.personIds ?? []).filter((id) => !gone.has(id)) });
    const labels = d.personIds.map((id) => personLinkLabel(prev, id)).join(', ');
    audit('tapahtuma', `${reason}: poistettu henkilölinkit ${labels} tapahtumasta "${e.title}", koska henkilöitä ei ole uudessa tarinassa`);
    mlog('tarina', `${reason}: tapahtumasta "${e.title}" poistettiin henkilölinkit ${labels} (ei uudessa tarinassa).`, `event:${e.id}`);
  }
}

export function resetStoryToSeed() {
  const seed = createSeedStory();
  dropDanglingEventPersons(seed, 'Siemendatan palautus');
  commitStory(seed, `Tarina palautettiin testitapauksen siemendataan (${seed.seedVersion}).`);
  setM({ trail: rootTrail(), last369: null, lastJump: null });
  toast('Testitapauksen siemendata palautettu.');
}
