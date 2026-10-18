// Path Discovery -toiminnot (docs/POLKUHAKU.md). Jokainen toiminto kirjataan matriisin lokiin (lajit 'polkuhaku' ja
// 'sokkotesti'), ja tutkimuksen kannalta olennaiset (haku, 369-laajennus, satunnaisvertailu, sokkotesti, tallennus)
// myös yhteiseen muutoshistoriaan (audit 'matriisi'). Laskenta tehdään ydinkirjastolla moottorin kautta
// ('pathSearch', 'pathNull', 'blindTest'); tässä ei ole omaa hakua eikä tilastoa. Tarinatiedot pysyvät laitteella.
//
// Lukitus ennen tulosta: jokaisen ajon kanoninen kuvaus ja sen SHA-256 lasketaan ja ajo kirjataan (tila 'käynnissä')
// ennen moottorikutsua. Vain yksi moottorityö kerrallaan koko matriisissa (polkuhaku, vertailu, sokkotesti, reittitesti).

import type { BlindRunResult } from '../core/path/blind';
import { canonicalBlind, validateBlindParams } from '../core/path/blind';
import { canonicalQuery } from '../core/path/canonical';
import type { IdentifierContext } from '../core/path/identifiers';
import { encodeIdentifier, extractIdentifiers } from '../core/path/identifiers';
import { bestRouteCost, fmtCost, scoreRoutes } from '../core/path/score';
import { validatePathParams } from '../core/path/search';
import type { BlindParams, IdentifierRole, PathIdentifier, PathParams, SearchMode, SearchOutcome } from '../core/path/types';
import { DEFAULT_PATH_PARAMS } from '../core/path/types';
import { seedFrom } from '../core/random';
import { sha256Hex } from '../core/sha256';
import { getEngine } from '../engine/client';
import { audit, cancelEngine, select, setMapMode, toast } from './actions';
import { LOG_MEMORY } from './matrix';
import { ensureTermForHit, newId, openHitInMatrix } from './matrix-actions';
import {
  beginBlindRun,
  beginSearchRun,
  BlindForm,
  blindConfigKey,
  blindItemsFor,
  blindQueryKey,
  canonicalNull,
  clonePathParams,
  EXPLORATORY_LABEL,
  exploreSeen,
  exploreStart,
  exploreVerdict,
  ExploreVerdict,
  failRun,
  finishBlindRun,
  finishSearchRun,
  isSeenStatus,
  latestBlindFor,
  matrixJobBusy,
  mergeIdentifiers,
  NullForm,
  nullConfigKey,
  paramsChangeFromDefaults,
  outcomeFromSaved,
  PathCurrent,
  PathForm,
  PathJob,
  pathConfigKey,
  pathOverlayFromRoute,
  pathQueryKey,
  pathQueryOf,
  PathRunSummary,
  PathState,
  queryLabel,
  savedFromCurrent,
  SavedPathResult,
  storyKnownIdentifiers,
} from './path';
import { store } from './store';

const nowIso = () => new Date().toISOString();

function setP(patch: Partial<PathState> | ((p: PathState) => Partial<PathState>)) {
  store.set((s) => ({ matrix: { ...s.matrix, path: { ...s.matrix.path, ...(typeof patch === 'function' ? patch(s.matrix.path) : patch) } } }));
}

const pathState = () => store.get().matrix.path;

/** Kirjaa matriisin lokiin; `research` = myös yhteiseen muutoshistoriaan. */
function plog(kind: 'polkuhaku' | 'sokkotesti', text: string, research = false) {
  const entry = { ts: nowIso(), kind, text };
  store.set((s) => ({ matrix: { ...s.matrix, log: [...s.matrix.log, entry].slice(-LOG_MEMORY) } }));
  if (research) audit('matriisi', text);
}

/** Tarina ja tapahtumat tunnisteita, aikarajausta ja harhauttimien poissulkemista varten (ei koskaan hakusärmiä). */
export function pathContext(): IdentifierContext {
  const s = store.get();
  return {
    story: s.matrix.story,
    events: s.events.map((e) => ({ id: e.id, title: e.title, date: e.date, personIds: [...(e.personIds ?? [])] })),
  };
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isCancel = (msg: string) => /keskeytetty/i.test(msg);

/** Hylkää uuden työn, jos jokin matriisin moottorityö on käynnissä (ilmoitus ja virheteksti). */
function refuseIfBusy(where: 'error' | 'blindError'): boolean {
  const busy = matrixJobBusy(store.get().matrix);
  if (!busy) return false;
  toast(busy);
  setP({ [where]: busy } as Partial<PathState>);
  return true;
}

function startJob(job: Omit<PathJob, 'done' | 'total' | 'startedAt' | 'cancelRequested'>) {
  setP({ running: { ...job, done: 0, total: 0, startedAt: nowIso(), cancelRequested: false } });
}

const progressOf = (runId: string) => (done: number, total: number) =>
  setP((p) => (p.running && p.running.runId === runId ? { running: { ...p.running, done, total } } : {}));

const endJob = (runId: string) => setP((p) => (p.running?.runId === runId ? { running: null } : {}));

// ------------------------------------------------------------------ lomake ja tunnisteet

export function setPathForm(patch: Partial<Omit<PathForm, 'params'>>) {
  setP((p) => ({ form: { ...p.form, ...patch } }));
}

/** Parametrien muutos lomakkeella. Muutokset kirjataan ajon yhteydessä (tiiviste ja muuttuneet asetukset). */
export function setPathParams(patch: Partial<PathParams>) {
  setP((p) => ({ form: { ...p.form, params: { ...p.form.params, ...patch } } }));
}

export function resetPathParams() {
  setP((p) => ({ form: { ...p.form, params: clonePathParams(DEFAULT_PATH_PARAMS) } }));
  plog('polkuhaku', 'Polkuhaun parametrit palautettiin oletuksiin (DEFAULT_PATH_PARAMS).');
}

const ROLE_FI: Record<IdentifierRole, string> = { lähtö: 'lähtö', tavoite: 'tavoite', tunnettu: 'tunnettu' };

function idText(i: PathIdentifier): string {
  const e = encodeIdentifier(i);
  return `${i.label || i.value} (${i.kind}, ${ROLE_FI[i.role]}) → ${e.ok ? `koodi ${e.code}` : `ei koodia: ${e.error}`}`;
}

/** Lisää käyttäjän tunnisteen. Sama tunniste (rooli + koodi) ei tuplaannu. */
export function addPathIdentifier(id: PathIdentifier): boolean {
  const { identifiers, added } = mergeIdentifiers(pathState().form.identifiers, [id]);
  if (!added.length) {
    toast('Sama tunniste (rooli ja koodi) on jo listalla.');
    return false;
  }
  setP((p) => ({ form: { ...p.form, identifiers } }));
  plog('polkuhaku', `Lisättiin tunniste ${idText(id)}.`);
  return true;
}

export function removePathIdentifier(id: string) {
  const i = pathState().form.identifiers.find((x) => x.id === id);
  if (!i) return;
  setP((p) => ({ form: { ...p.form, identifiers: p.form.identifiers.filter((x) => x.id !== id) } }));
  plog('polkuhaku', `Poistettiin tunniste ${idText(i)}.`);
}

/**
 * Poimii lähtö- tai tavoitetekstistä tarinan tunnetut nimet (extractIdentifiers). Mitään muuta ei keksitä:
 * tuntemattomat sanat ohitetaan. Palauttaa lisättyjen määrän.
 */
export function extractPathIdentifiers(role: 'lähtö' | 'tavoite'): number {
  const p = pathState();
  const text = role === 'lähtö' ? p.form.startText : p.form.goalText;
  const found = extractIdentifiers(text, role, pathContext());
  const { identifiers, added } = mergeIdentifiers(p.form.identifiers, found);
  if (!found.length) {
    toast(`${role === 'lähtö' ? 'Lähtötekstistä' : 'Tavoitetekstistä'} ei löytynyt tarinan tunnettuja nimiä. Lisää tunnisteet käsin.`);
    plog('polkuhaku', `Tunnisteiden poiminta (${role}): tekstistä ei löytynyt tarinan tunnettuja nimiä.`);
    return 0;
  }
  setP((pp) => ({ form: { ...pp.form, identifiers } }));
  plog(
    'polkuhaku',
    `Tunnisteiden poiminta (${role}): tekstistä löytyi ${found.map((i) => i.label).join(', ')}; lisättiin ${added.length} (${added.map((i) => i.label).join(', ') || 'ei uusia'}).`,
  );
  toast(added.length ? `Poimittiin ${added.length} tunnistetta: ${added.map((i) => i.label).join(', ')}` : 'Poimitut nimet olivat jo listalla.');
  return added.length;
}

/** Tarinan nimet (lähtötunnisteet ja henkilöt) tunnetuiksi välisolmuiksi yhdellä napautuksella. */
export function addStoryNamesAsKnown(): number {
  const p = pathState();
  const add = storyKnownIdentifiers(store.get().matrix.story, p.form.identifiers);
  const { identifiers, added } = mergeIdentifiers(p.form.identifiers, add);
  if (!added.length) {
    toast('Tarinan nimet ovat jo tunnisteina (tai tarinassa ei ole nimiä).');
    return 0;
  }
  setP((pp) => ({ form: { ...pp.form, identifiers } }));
  plog('polkuhaku', `Tarinan nimet lisättiin tunnetuiksi välisolmuiksi: ${added.map((i) => i.label).join(', ')}.`);
  toast(`Lisättiin ${added.length} tunnettua nimeä.`);
  return added.length;
}

export function setPathTimeRange(from: string | null, to: string | null) {
  const f = from || null;
  const t = to || null;
  setP((p) => ({ form: { ...p.form, timeRange: f || t ? { from: f, to: t } : null } }));
  plog('polkuhaku', f || t ? `Aikarajaus ${f ?? '…'} – ${t ?? '…'} (koskee vain tapahtumatunnisteita).` : 'Aikarajaus poistettiin.');
}

export const setNullForm = (patch: Partial<NullForm>) => setP((p) => ({ nullForm: { ...p.nullForm, ...patch } }));
export const setBlindForm = (patch: Partial<BlindForm>) => setP((p) => ({ blindForm: { ...p.blindForm, ...patch } }));
export const selectBlindRun = (id: string | null) => setP({ selectedBlind: id });
export const clearPathError = () => setP({ error: null, blindError: null });

// ------------------------------------------------------------------ haku

/**
 * Polkuhaku moottorissa ('pathSearch'). `use369` = sama kysely 369-säännöillä ("369 · tutki vaihtoehtoiset reitit");
 * lomakkeen parametreja ei muuteta. Tiiviste lasketaan ja ajo kirjataan ennen moottorikutsua. Palauttaa tuloksen tai
 * null (syy: path.error).
 */
export async function runPathSearch(mode: SearchMode, opts: { use369?: boolean } = {}): Promise<SearchOutcome | null> {
  if (refuseIfBusy('error')) return null;
  const s = store.get();
  const form = s.matrix.path.form;
  const params: PathParams = { ...clonePathParams(form.params), ...(opts.use369 ? { use369: true } : {}) };
  const errors = validatePathParams(params);
  if (errors.length) {
    setP({ error: `Parametrit eivät kelpaa: ${errors.join(' ')}` });
    return null;
  }
  if (!s.digits) {
    setP({ error: 'Aineistoa ei ole ladattu.' });
    return null;
  }
  const query = pathQueryOf(form);
  const runId = newId('polkuhaku');
  const label = `${queryLabel(query)} · ${mode}${params.use369 ? ' · 369' : ''}`;
  startJob({ kind: 'haku', runId, label });
  setP({ error: null });
  // 1. Lukitus: kanoninen kysely ja SHA-256 ennen moottorikutsua.
  const canonical = canonicalQuery(query, params, mode);
  let hash: string;
  try {
    hash = await sha256Hex(canonical);
  } catch (e) {
    endJob(runId);
    setP({ error: `Tiivistettä ei voitu laskea: ${errText(e)}` });
    return null;
  }
  const ts = nowIso();
  const qk = pathQueryKey(query);
  const ck = pathConfigKey(query, params);
  const verdict = exploreVerdict(pathState().index.searches, qk, ck);
  const run = beginSearchRun({ id: runId, ts, query, params, mode, hash, datasetSha: s.dataset.info?.sha256 ?? null, verdict });
  setP((p) => ({
    runs: [...p.runs, run],
    counts: { ...p.counts, searches: p.counts.searches + 1 },
    index: { ...p.index, searches: exploreStart(p.index.searches, qk, ck) },
  }));
  const what = opts.use369 ? '369-laajennus (sama kysely 369-säännöillä)' : 'Polkuhaku';
  const changed = paramsChangeFromDefaults(params);
  const known = query.identifiers.filter((i) => i.role === 'tunnettu').length;
  plog(
    'polkuhaku',
    `${what} lukittu ja käynnistetty: ${run.label}, tila ${mode}, ` +
      `parametrit ${changed.length ? `muutettu oletuksista (${changed.join('; ')})` : 'oletukset'}, tunnettuja välisolmuja ${known}, ` +
      `SHA-256 ${hash.slice(0, 12)}…${verdict.exploratory ? ` — ${EXPLORATORY_LABEL}` : ''}.`,
    true,
  );
  // 2. Haku
  try {
    const outcome = await getEngine().call({ type: 'pathSearch', query, params, mode, ctx: pathContext() }, progressOf(runId));
    const done = finishSearchRun(run, outcome, nowIso());
    const current: PathCurrent = {
      runId,
      source: 'ajo',
      savedId: null,
      ts,
      query,
      params,
      mode,
      hash,
      hashMatches: outcome.canonical ? outcome.canonical === canonical : null,
      exploratory: verdict.exploratory,
      exploratoryReason: verdict.reason,
      outcome,
      scores: scoreRoutes(outcome, [], null),
      null: null,
    };
    setP((p) => ({
      runs: p.runs.map((r) => (r.id === runId ? done : r)),
      index: { ...p.index, searches: isSeenStatus(done.status) ? exploreSeen(p.index.searches, qk, ck, ts) : p.index.searches },
      current,
      form: { ...p.form, mode },
    }));
    plog(
      'polkuhaku',
      `${what} valmis (${run.label}): ${outcome.status}` +
        (outcome.routes.length ? `, ${outcome.routes.length} reittiä, paras ${fmtCost(bestRouteCost(outcome))}` : `, syitä ${done.reasons}`) +
        `, tulostiiviste ${outcome.resultFingerprint}.`,
      true,
    );
    return outcome;
  } catch (e) {
    const msg = errText(e);
    setP((p) => ({
      runs: p.runs.map((r) => (r.id === runId ? failRun(r, msg, nowIso()) : r)),
      error: isCancel(msg) ? 'Polkuhaku keskeytettiin. Ajo kirjattiin keskeytetyksi.' : `Polkuhaku epäonnistui: ${msg}`,
    }));
    plog('polkuhaku', `${what} ${isCancel(msg) ? 'keskeytettiin' : `epäonnistui: ${msg}`} (${run.label}).`, true);
    return null;
  } finally {
    endJob(runId);
  }
}

// ------------------------------------------------------------------ satunnaisvertailu (Path Score)

/**
 * Satunnaisvertailu näytetylle tulokselle ('pathNull'): sama haku nollamalleissa ja π-haun toistettavuus. Tiiviste
 * (haun tiiviste + R, jonot, siemen) lasketaan ja ajo kirjataan ennen moottorikutsua. Path Score lasketaan tuloksesta.
 */
export async function runPathNullComparison(): Promise<boolean> {
  if (refuseIfBusy('error')) return false;
  const s = store.get();
  const cur = s.matrix.path.current;
  if (!cur) {
    setP({ error: 'Aja ensin polkuhaku: satunnaisvertailu verrataan näytettyyn hakutulokseen.' });
    return false;
  }
  const nf = s.matrix.path.nullForm;
  const spec = { R: nf.R, S: nf.randomStrings, seed: seedFrom(nf.seedText) };
  const runId = newId('vertailu');
  startJob({ kind: 'vertailu', runId, label: `${queryLabel(cur.query)} · R = ${spec.R}, jonot ${spec.S}, siemen ${spec.seed}` });
  setP({ error: null });
  let hash: string;
  try {
    hash = await sha256Hex(canonicalNull(cur.hash, spec));
  } catch (e) {
    endJob(runId);
    setP({ error: `Tiivistettä ei voitu laskea: ${errText(e)}` });
    return false;
  }
  const ts = nowIso();
  const qk = cur.hash;
  const ck = nullConfigKey(spec);
  const own = exploreVerdict(pathState().index.nulls, qk, ck, 'Saman haun satunnaisvertailu');
  // Eksploratiivisen haun vertailu on itsekin eksploratiivinen.
  const verdict: ExploreVerdict =
    !own.exploratory && cur.exploratory ? { exploratory: true, reason: `Vertailtava haku on ${cur.exploratoryReason ?? EXPLORATORY_LABEL}` } : own;
  const base = beginSearchRun({ id: runId, ts, query: cur.query, params: cur.params, mode: cur.mode, hash, datasetSha: s.dataset.info?.sha256 ?? null, verdict });
  const run: PathRunSummary = {
    ...base,
    kind: 'vertailu',
    queryKey: qk,
    configKey: ck,
    routes: cur.outcome.routes.length,
    bestCost: bestRouteCost(cur.outcome),
    fingerprint: cur.outcome.resultFingerprint,
    nullSpec: { R: spec.R, S: spec.S, seed: spec.seed, seedText: nf.seedText, searchRunId: cur.runId },
  };
  setP((p) => ({
    runs: [...p.runs, run],
    counts: { ...p.counts, nulls: p.counts.nulls + 1 },
    index: { ...p.index, nulls: exploreStart(p.index.nulls, qk, ck) },
  }));
  plog(
    'polkuhaku',
    `Satunnaisvertailu lukittu ja käynnistetty: ${run.label} (haku ${cur.hash.slice(0, 12)}…), R = ${spec.R}, satunnaisjonot ${spec.S}, ` +
      `siemen ”${nf.seedText}” = ${spec.seed}, SHA-256 ${hash.slice(0, 12)}…${verdict.exploratory ? ` — ${EXPLORATORY_LABEL}` : ''}.`,
    true,
  );
  try {
    const res = await getEngine().call(
      {
        type: 'pathNull',
        query: cur.query,
        params: cur.params,
        mode: cur.mode,
        ctx: pathContext(),
        observed: bestRouteCost(cur.outcome),
        replicates: spec.R,
        randomStrings: spec.S,
        seed: spec.seed,
        observedFingerprint: cur.outcome.resultFingerprint || null,
      },
      progressOf(runId),
    );
    const pValue = res.nulls.length ? Math.max(...res.nulls.map((n) => n.pValue)) : null;
    const scores = scoreRoutes(cur.outcome, res.nulls, res.reproducible);
    setP((p) => ({
      runs: p.runs.map((r) =>
        r.id === runId ? { ...r, status: 'valmis', finishedAt: nowIso(), pValue, reproducible: res.reproducible, ms: res.durationMs } : r,
      ),
      index: { ...p.index, nulls: exploreSeen(p.index.nulls, qk, ck, ts) },
      current:
        p.current && p.current.runId === cur.runId
          ? {
              ...p.current,
              scores,
              null: {
                runId,
                hash,
                spec: { ...spec, seedText: nf.seedText },
                nulls: res.nulls,
                reproducible: res.reproducible,
                notes: res.notes,
                fingerprint: res.fingerprint,
                durationMs: res.durationMs,
                exploratory: verdict.exploratory,
                exploratoryReason: verdict.reason,
              },
            }
          : p.current,
    }));
    plog(
      'polkuhaku',
      `Satunnaisvertailu valmis (${run.label}): ${res.nulls.map((n) => `${n.model} ${n.countAsGood}/${n.replicates} yhtä hyvä tai parempi, p = ${n.pValue.toPrecision(3)}`).join('; ') || 'ei malleja'}` +
        `; toistettavuus ${res.reproducible ? 'kyllä' : 'ei'}; Path Score ${scores.map((x) => (x.total == null ? 'ei pistemäärää' : x.total)).join(', ') || '–'}.`,
      true,
    );
    return true;
  } catch (e) {
    const msg = errText(e);
    setP((p) => ({
      runs: p.runs.map((r) => (r.id === runId ? failRun(r, msg, nowIso()) : r)),
      error: isCancel(msg) ? 'Satunnaisvertailu keskeytettiin. Ajo kirjattiin keskeytetyksi.' : `Satunnaisvertailu epäonnistui: ${msg}`,
    }));
    plog('polkuhaku', `Satunnaisvertailu ${isCancel(msg) ? 'keskeytettiin' : `epäonnistui: ${msg}`} (${run.label}).`, true);
    return false;
  } finally {
    endJob(runId);
  }
}

// ------------------------------------------------------------------ sokkotesti

/**
 * Sokkotesti ('blindTest') lomakkeen asetuksilla ja polkuhaun nykyisillä parametreilla. Kanoninen kuvaus
 * (canonicalBlind) ja sen SHA-256 lasketaan ja ajo kirjataan ennen moottorikutsua. Kaikki ajot tallennetaan.
 */
export async function runBlindTest(): Promise<boolean> {
  if (refuseIfBusy('blindError')) return false;
  const s = store.get();
  const bf = s.matrix.path.blindForm;
  const params: BlindParams = {
    kind: bf.kind,
    decoys: bf.decoys,
    seed: seedFrom(bf.seedText),
    randomStrings: bf.randomStrings,
    dateFormat: bf.dateFormat,
    path: clonePathParams(s.matrix.path.form.params),
  };
  const errors = validateBlindParams(params);
  if (errors.length) {
    setP({ blindError: `Sokkotestin parametrit eivät kelpaa: ${errors.join(' ')}` });
    return false;
  }
  if (!s.digits) {
    setP({ blindError: 'Aineistoa ei ole ladattu.' });
    return false;
  }
  const items = blindItemsFor(bf.kind, s.matrix.story, s.events, bf.dateFormat);
  if (!items.length) {
    setP({
      blindError:
        bf.kind === 'polun-askel'
          ? 'Tarinassa ei ole polkuja, joiden askeleita voisi piilottaa. Lisää polku Tarina-sivulla.'
          : 'Tapahtumia, joilla on kelvollinen päivämäärä (VVVV-KK-PP), ei ole. Lisää tapahtumia Tapahtumat-paneelissa.',
    });
    return false;
  }
  const runId = newId('sokkotesti');
  const label = `${bf.kind}, D = ${params.decoys}, siemen ${params.seed}, jonot ${params.randomStrings}`;
  startJob({ kind: 'sokkotesti', runId, label });
  setP({ blindError: null });
  let hash: string;
  try {
    hash = await sha256Hex(canonicalBlind(items, params));
  } catch (e) {
    endJob(runId);
    setP({ blindError: `Tiivistettä ei voitu laskea: ${errText(e)}` });
    return false;
  }
  const ts = nowIso();
  const qk = blindQueryKey(items, bf.kind, bf.dateFormat);
  const ck = blindConfigKey(params);
  const verdict = exploreVerdict(pathState().index.blinds, qk, ck, 'Sama kohdejoukko');
  const run = beginBlindRun({
    id: runId,
    ts,
    hash,
    queryKey: qk,
    configKey: ck,
    verdict,
    params,
    seedText: bf.seedText,
    items: items.length,
    datasetSha: s.dataset.info?.sha256 ?? null,
  });
  setP((p) => ({
    blindRuns: [...p.blindRuns, run],
    counts: { ...p.counts, blinds: p.counts.blinds + 1 },
    index: { ...p.index, blinds: exploreStart(p.index.blinds, qk, ck) },
    selectedBlind: runId,
  }));
  plog(
    'sokkotesti',
    `Sokkotesti lukittu ja käynnistetty: ${label}, ${items.length} kohdetta, siemen ”${bf.seedText}”, SHA-256 ${hash.slice(0, 12)}…` +
      `${verdict.exploratory ? ` — ${EXPLORATORY_LABEL}` : ''}.`,
    true,
  );
  try {
    const res = (await getEngine().call({ type: 'blindTest', items, params, ctx: pathContext() }, progressOf(runId))) as BlindRunResult;
    const done = finishBlindRun(run, res, nowIso());
    setP((p) => ({
      blindRuns: p.blindRuns.map((r) => (r.id === runId ? done : r)),
      index: { ...p.index, blinds: exploreSeen(p.index.blinds, qk, ck, ts) },
    }));
    const sm = res.summary;
    plog(
      'sokkotesti',
      `Sokkotesti valmis (${label}): ${sm.folds} kierrosta, oikein ${sm.hitsAt1}, väärin ${sm.folds - sm.hitsAt1}, ` +
        `p = ${sm.pVsRandom.toPrecision(3)} satunnaista valintaa vastaan. ${sm.verdict}`,
      true,
    );
    return true;
  } catch (e) {
    const msg = errText(e);
    setP((p) => ({
      blindRuns: p.blindRuns.map((r) => (r.id === runId ? failRun(r, msg, nowIso()) : r)),
      blindError: isCancel(msg) ? 'Sokkotesti keskeytettiin. Ajo kirjattiin keskeytetyksi.' : `Sokkotesti epäonnistui: ${msg}`,
    }));
    plog('sokkotesti', `Sokkotesti ${isCancel(msg) ? 'keskeytettiin' : `epäonnistui: ${msg}`} (${label}).`, true);
    return false;
  } finally {
    endJob(runId);
  }
}

/** Keskeyttää käynnissä olevan polkuhaun, vertailun tai sokkotestin (moottori käynnistetään uudelleen). */
export async function cancelPathJob() {
  const r = pathState().running;
  if (!r) return;
  setP((p) => (p.running ? { running: { ...p.running, cancelRequested: true } } : {}));
  plog(r.kind === 'sokkotesti' ? 'sokkotesti' : 'polkuhaku', `Käyttäjä keskeytti työn: ${r.label}.`);
  await cancelEngine();
}

// ------------------------------------------------------------------ tallennetut tulokset

/** Tallentaa näytetyn tuloksen: kysely, tunnisteet, parametrit, tiiviste, reitit, Path Score, vertailut ja sokkotesti. */
export function savePathResult(title = ''): SavedPathResult | null {
  const s = store.get();
  const p = s.matrix.path;
  const cur = p.current;
  if (!cur) {
    toast('Ei tallennettavaa tulosta. Aja ensin polkuhaku.');
    return null;
  }
  const nullHash = cur.null?.hash ?? null;
  if (p.saved.some((x) => x.runId === cur.runId && x.nullHash === nullHash)) {
    toast('Tämä tulos on jo tallennettu.');
    return null;
  }
  const blind = latestBlindFor(p.blindRuns, cur.params);
  const saved = savedFromCurrent(cur, {
    id: newId('polkutulos'),
    title: title.trim() || `${queryLabel(cur.query)} · ${cur.mode}${cur.params.use369 ? ' · 369' : ''}`,
    createdAt: nowIso(),
    datasetSha: s.dataset.info?.sha256 ?? null,
    blind,
  });
  setP((pp) => ({ saved: [...pp.saved, saved] }));
  const totals = saved.scores.map((x) => (x.total == null ? 'ei pistemäärää' : String(x.total)));
  plog(
    'polkuhaku',
    `Polkuhaun tulos tallennettu: "${saved.title}" (${saved.status}, ${saved.routes.length} reittiä, SHA-256 ${saved.hash.slice(0, 12)}…, ` +
      `Path Score ${totals.join(', ') || '–'}, sokkotesti ${blind ? `${blind.summary?.hitsAt1}/${blind.summary?.folds} oikein` : 'ei testattu'}` +
      `${saved.exploratory ? `, ${EXPLORATORY_LABEL}` : ''}).`,
    true,
  );
  toast(`Tulos tallennettu: ${saved.title}`);
  return saved;
}

export function deletePathResult(id: string) {
  const r = pathState().saved.find((x) => x.id === id);
  if (!r) return;
  setP((p) => ({ saved: p.saved.filter((x) => x.id !== id), current: p.current?.savedId === id ? null : p.current }));
  plog('polkuhaku', `Tallennettu polkuhaun tulos poistettu: "${r.title}".`, true);
}

/** Avaa tallennetun tuloksen: lomake palautetaan ja tulos näytetään (tallennushetken tiedot). */
export function openPathResult(id: string) {
  const r = pathState().saved.find((x) => x.id === id);
  if (!r) return;
  const outcome = outcomeFromSaved(r);
  const query = { startText: r.startText, goalText: r.goalText, identifiers: r.identifiers.map((i) => ({ ...i })), timeRange: r.timeRange };
  const tas = r.nulls.find((n) => n.model === 'tasajakauma');
  const sat = r.nulls.find((n) => n.model === 'satunnaisjono');
  const seed = tas?.seed ?? (sat ? sat.seed - 10_000 : 0);
  const current: PathCurrent = {
    runId: r.runId || r.id,
    source: 'tallennettu',
    savedId: r.id,
    ts: r.runTs || r.createdAt,
    query,
    params: clonePathParams(r.params),
    mode: r.mode,
    hash: r.hash,
    hashMatches: null,
    exploratory: r.exploratory,
    exploratoryReason: r.exploratoryReason,
    outcome,
    scores: scoreRoutes(outcome, r.nulls, r.reproducible),
    null: r.nulls.length
      ? {
          runId: '',
          hash: r.nullHash ?? '',
          spec: { R: tas?.replicates ?? 0, S: sat?.replicates ?? 0, seed, seedText: String(seed) },
          nulls: r.nulls,
          reproducible: r.reproducible === true,
          notes: ['Tallennettu satunnaisvertailu (tallennushetken tulos).'],
          fingerprint: r.fingerprint,
          durationMs: 0,
          exploratory: r.exploratory,
          exploratoryReason: r.exploratoryReason,
        }
      : null,
  };
  setP((p) => ({
    current,
    form: { ...p.form, startText: r.startText, goalText: r.goalText, identifiers: query.identifiers, timeRange: r.timeRange, params: clonePathParams(r.params), mode: r.mode },
  }));
  plog('polkuhaku', `Avattiin tallennettu polkuhaun tulos "${r.title}" (SHA-256 ${r.hash.slice(0, 12)}…).`);
}

// ------------------------------------------------------------------ reitti muissa näkymissä

/** Reitti spiraaliin tai 3D:hen: päällyskerros, reitin ensimmäinen solmu valituksi ja välilehden vaihto. */
export function showPathRoute(index: number, target: 'spiraali' | '3d') {
  const cur = pathState().current;
  const route = cur?.outcome.routes[index];
  if (!route) return;
  const overlay = pathOverlayFromRoute(route, index);
  if (!overlay.points.length) {
    toast('Reitillä ei ole näytettäviä π-kohtia.');
    return;
  }
  const first = overlay.points[0];
  const node = route.nodes[0];
  const termId = ensureTermForHit(first.code, node?.labels[0] ?? null);
  store.set({ pathOverlay: overlay });
  if (target === 'spiraali') {
    setMapMode('spiral');
    select({ termId, n: first.n }, { tab: 'map' });
  } else select({ termId, n: first.n }, { tab: 'space' });
  plog(
    'polkuhaku',
    `Reitti ${index + 1} näytettiin ${target === 'spiraali' ? 'spiraalissa' : '3D-näkymässä'}: ${overlay.points.map((p) => `${p.label} ${p.code}@${p.n}`).join(' → ')}.`,
  );
}

export function clearPathOverlay() {
  const o = store.get().pathOverlay;
  if (!o) return;
  store.set({ pathOverlay: null });
  plog('polkuhaku', `Reitin näyttö suljettiin (${o.label}).`);
}

/** Reitin solmu matriisiin (juuri → koodi → osuma). Sulkee alasivun, jotta fokus näkyy. */
export function openPathNode(code: string, n: number, label: string) {
  openHitInMatrix(code, n, label);
}
