// Path Discovery: Blind Discovery -sokkotesti (PIATLAS-BLIND-1.0.0). Määrittely: docs/POLKUHAKU.md §7.
//
// Sokkotesti mittaa, tunnistaako menetelmä piilotetun todellisen tiedon. Jokainen kohde piilotetaan vuorollaan
// (leave-one-out). Konteksti = saman ryhmän muut kohteet. Ehdokkaat = oikea vastaus + D harhautinta, joiden koodilla
// on sama pituus (pituus määrää odotetun osumamäärän). Jokaiselle ehdokkaalle ajetaan sama kaksisuuntainen haku
// konteksti → ehdokas, ja ehdokkaat järjestetään parhaan reitin mukaan. Tulos = oikean vastauksen sijoitus.
//
// Vuotojen esto:
//  - piilotetun kohteen koodi ja kaikki kontekstikohteet, joilla on sama koodi tai yhteinen vuotoavain (leakKeys:
//    henkilö, nimi, tapahtuma, päivä, koodi), poistetaan sanastosta; sanasto = vain kontekstin koodit (lähtö) +
//    testattava ehdokas (tavoite)
//  - vuotoavaimet "kohta:<n>" (tapahtuman linkitetyt osumat) poistavat kyseisestä kohdasta alkavat osumat kierroksen
//    osumalähteestä kaikilta koodeilta
//  - tarina, suhteet, tulkinnat ja tapahtumat eivät koskaan välity hakuun (searchPaths saa ctx = null); niitä käytetään
//    vain harhauttimien poissulkemiseen (harhautin ei ole koskaan tarinan nimi tai todellinen tapahtumapäivä)
//  - ehdokkaiden järjestys sekoitetaan siemenellä, ja tasapelit ratkaistaan siemenellisellä satunnaispermutaatiolla,
//    joka arvotaan ennen hakua eikä riipu ehdokkaiden järjestyksestä eikä siitä, mikä ehdokas on oikea
// Kaikki on deterministististä siemenen perusteella (paitsi ajat ms).

import type { DateFormat } from '../encodings';
import { dateToDigits } from '../encodings';
import { fmtInt } from '../matrix/ops369';
import { t9Code } from '../matrix/refs';
import type { StoryModel } from '../matrix/types';
import { normName } from '../matrix/types';
import { createRng, seedFrom } from '../random';
import type { RunHooks } from '../stats';
import { fmtP } from '../stats';
import { canonicalParams, fnv1a, stableStringify } from './canonical';
import { DECOY_NAMES_SOURCE, decoyNameCodes } from './decoy-names';
import type { IdentifierContext } from './identifiers';
import { isValidIsoDate } from './identifiers';
import { searchPaths, validatePathParams } from './search';
import { randomStringSource } from './source';
import type {
  BlindFold,
  BlindItem,
  BlindParams,
  BlindResult,
  HitSource,
  PathCost,
  PathIdentifier,
  PathQuery,
  SearchOutcome,
} from './types';
import { BLIND_VERSION } from './types';

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : 0);
const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const fmtDec = (x: number, d = 2): string => (Number.isFinite(x) ? x.toFixed(d).replace('.', ',') : '–');

/** Merkitsevyystaso, jolla tulos voidaan sanoa sattumaa paremmaksi (vain yhdessä piittömän vertailun kanssa). */
export const BLIND_ALPHA = 0.05;
/** Monte Carlo -arvontojen vähimmäismäärä p-arvolle, kun tarkka laskenta olisi liian raskas. */
export const BLIND_MC_DRAWS = 20_000;
/** Päivämääräharhauttimien aikaväli: ryhmän päivämäärien väli ± tämä määrä päiviä. */
export const DECOY_DATE_PAD_DAYS = 365;

export const BLIND_DEFINITION =
  'Sokkotesti (PIATLAS-BLIND-1.0.0): jokainen kohde piilotetaan vuorollaan. Konteksti = saman ryhmän muut kohteet; ' +
  'piilotetun koodi ja siihen liittyvät tunnisteet poistetaan sanastosta. Ehdokkaat = oikea vastaus + D harhautinta, ' +
  `joiden koodin pituus on sama (nimet: ${DECOY_NAMES_SOURCE}; päivämäärät: ryhmän aikaväli ± ${DECOY_DATE_PAD_DAYS} päivää). ` +
  'Jokaiselle ehdokkaalle ajetaan sama kaksisuuntainen haku konteksti → ehdokas; ehdokkaat järjestetään parhaan reitin ' +
  'mukaan (askeleet + muunnokset, muunnokset, Σ|Δn|; ei reittiä = huonoin), tasapelit siemenellisellä arvonnalla. ' +
  'Vertailu: satunnainen valinta (sijoitus tasajakautunut 1…D + 1) ja sama algoritmi siemenellisissä satunnaisjonoissa.';

// ------------------------------------------------------------------ kohteet

/** Tapahtuma sokkotestiä varten (yhteensopiva LifeEventin ja IdentifierContextin tapahtumien kanssa). */
export interface BlindEventInput {
  id: string;
  title: string;
  date: string;
  personIds?: string[];
  /** Käyttäjän linkittämät osumat ("termi@n"): kohdat poistetaan sanastosta, kun tapahtuma on piilotettu. */
  linkedHits?: string[];
}

/**
 * Tarinan polkujen askeleet sokkotestin kohteina: yksi kohde jokaista askelta kohden, ryhmä = polun tunnus,
 * koodi = askeleen nimen T9 (suomalainen translitterointi). Vuotoavaimet: nimi, koodi ja henkilö (jos valittu).
 * Nimeä, jota ei voi koodata, ei hylätä hiljaa: koodi jää tyhjäksi ja runBlindTest ohittaa kohteen syyn kanssa.
 */
export function blindItemsFromStory(story: StoryModel): BlindItem[] {
  const out: BlindItem[] = [];
  for (const path of story.paths) {
    path.steps.forEach((s, i) => {
      const name = normName(s.name);
      const code = t9Code(name) ?? '';
      const leakKeys = [`nimi:${name}`];
      if (code) leakKeys.push(`koodi:${code}`);
      if (s.personId) leakKeys.push(`henkilö:${s.personId}`);
      out.push({ id: `${path.id}#${i + 1}`, kind: 'polun-askel', label: name, code, group: path.id, leakKeys, date: null });
    });
  }
  return out;
}

/** Päivämäärän ISO-osa (VVVV-KK-PP), jos merkkijono alkaa kelvollisella päivämäärällä (mahdollinen kellonaika ohitetaan). */
export function isoDatePart(s: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})(?:$|[T ])/.exec((s ?? '').trim());
  return m && isValidIsoDate(m[1]) ? m[1] : null;
}

/**
 * Tapahtumat sokkotestin kohteina: ryhmä 'tapahtumat', koodi = päivämäärä valitussa muodossa. Vain tapahtumat,
 * joilla on kelvollinen ISO-päivämäärä. Vuotoavaimet: tapahtuma, päivä, koodi ja linkitettyjen osumien kohdat.
 */
export function blindItemsFromEvents(events: readonly BlindEventInput[], dateFormat: DateFormat): BlindItem[] {
  const out: BlindItem[] = [];
  for (const e of events) {
    const iso = isoDatePart(e.date);
    if (!iso) continue;
    const code = dateToDigits(iso, dateFormat);
    if (!code) continue;
    const leakKeys = [`tapahtuma:${e.id}`, `päivä:${iso}`, `koodi:${code}`];
    for (const k of e.linkedHits ?? []) {
      const i = k.lastIndexOf('@');
      const n = i >= 0 ? Number(k.slice(i + 1)) : NaN;
      if (Number.isInteger(n) && n >= 1 && !leakKeys.includes(`kohta:${n}`)) leakKeys.push(`kohta:${n}`);
    }
    const title = (e.title ?? '').trim() || e.id;
    out.push({ id: `tapahtuma:${e.id}`, kind: 'tapahtuma', label: `${title} (${iso})`, code, group: 'tapahtumat', leakKeys, date: iso });
  }
  return out;
}

// ------------------------------------------------------------------ päivämääräharhauttimet

const MIN_DAY = daysFromCivil(1, 1, 1);
const MAX_DAY = daysFromCivil(9999, 12, 31);

/** Päivän järjestysnumero (1970-01-01 = 0), proleptinen gregoriaaninen kalenteri. */
function daysFromCivil(y0: number, m: number, d: number): number {
  const y = m <= 2 ? y0 - 1 : y0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (m + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function civilFromDays(z0: number): [number, number, number] {
  const z = z0 + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return [yoe + era * 400 + (m <= 2 ? 1 : 0), m, d];
}

/** VVVV-KK-PP → päivän järjestysnumero. */
export function isoToDay(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return daysFromCivil(y, m, d);
}

/** Päivän järjestysnumero → VVVV-KK-PP. */
export function dayToIso(day: number): string {
  const [y, m, d] = civilFromDays(day);
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Harhauttimien aikaväli: [pienin − pad, suurin + pad] päivää. null, jos kelvollisia päivämääriä ei ole. */
export function decoyDateRange(dates: readonly (string | null | undefined)[], padDays = DECOY_DATE_PAD_DAYS): { from: string; to: string } | null {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const s of dates) {
    if (!s || !isValidIsoDate(s)) continue;
    const d = isoToDay(s);
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  if (!Number.isFinite(lo)) return null;
  return { from: dayToIso(Math.max(MIN_DAY, lo - padDays)), to: dayToIso(Math.min(MAX_DAY, hi + padDays)) };
}

export interface DecoyDate {
  label: string;
  code: string;
  date: string;
}

/**
 * Päivämääräharhauttimet: enintään `count` päivää tasajakautuneesti väliltä [rangeFrom, rangeTo] (rajat mukaan
 * lukien; runBlindTest antaa välin decoyDateRange-funktiolla: ryhmän päivämäärät ± 365 päivää). Sama muoto →
 * sama koodin pituus. Koodit ovat keskenään erilaiset, eivätkä ne ole oikean päivän koodi eivätkä joukossa
 * `exclude` (koodit tai ISO-päivät, esim. todelliset tapahtumapäivät). Otanta ilman palautusta (harva Fisher–Yates,
 * createRng). Jos välillä ei ole tarpeeksi kelvollisia päiviä (esim. muoto DDMM ja pitkä väli), palautetaan vähemmän.
 */
export function decoyDates(
  trueIso: string,
  count: number,
  seed: number,
  rangeFrom: string,
  rangeTo: string,
  format: DateFormat,
  exclude: ReadonlySet<string>,
): DecoyDate[] {
  const want = Math.max(0, Math.floor(count));
  if (!want || !isValidIsoDate(trueIso) || !isValidIsoDate(rangeFrom) || !isValidIsoDate(rangeTo)) return [];
  const trueCode = dateToDigits(trueIso, format);
  if (!trueCode) return [];
  const lo = Math.max(MIN_DAY, isoToDay(rangeFrom));
  const hi = Math.min(MAX_DAY, isoToDay(rangeTo));
  if (lo > hi) return [];
  const span = hi - lo + 1;
  // Kattoraja vain patologisille tapauksille (lyhyt muoto ja vuosisatojen väli): tasajakauma säilyy.
  const maxIter = Math.min(span, Math.max(100_000, want * 1000));
  const rng = createRng(seed >>> 0);
  const moved = new Map<number, number>();
  const seen = new Set<string>([trueCode]);
  const out: DecoyDate[] = [];
  for (let i = 0; i < maxIter && out.length < want; i++) {
    const j = rng.int(i, span - 1);
    const vj = moved.get(j) ?? j;
    moved.set(j, moved.get(i) ?? i);
    const iso = dayToIso(lo + vj);
    const code = dateToDigits(iso, format);
    if (!code || code.length !== trueCode.length) continue;
    if (iso === trueIso || seen.has(code) || exclude.has(code) || exclude.has(iso)) continue;
    seen.add(code);
    out.push({ label: iso, code, date: iso });
  }
  return out;
}

// ------------------------------------------------------------------ järjestys

/**
 * Parhaan reitin kustannusten vertailu (negatiivinen = a parempi). Sama järjestys kuin haun reittijärjestys:
 * (askeleet + muunnokset, muunnokset, Σ|Δn|). null (ei reittiä) on huonoin; kaksi null-arvoa ovat tasapeli.
 */
export function compareBlindCost(a: PathCost | null, b: PathCost | null): number {
  if (a == null || b == null) return a == null && b == null ? 0 : a == null ? 1 : -1;
  const ca = a.edges + a.transforms;
  const cb = b.edges + b.transforms;
  if (ca !== cb) return ca < cb ? -1 : 1;
  if (a.transforms !== b.transforms) return a.transforms < b.transforms ? -1 : 1;
  if (a.span !== b.span) return a.span < b.span ? -1 : 1;
  return 0;
}

/**
 * Sijoitukset (1 = paras): kustannus ensin, tasapelit tie-avaimen mukaan (pienempi ensin). tie on siemenellinen
 * satunnaispermutaatio, joka ei riipu ehdokkaiden sisällöstä, joten tasapelin voittaja on arvottu.
 */
export function rankCandidates(costs: readonly (PathCost | null)[], tie: readonly number[]): number[] {
  const order = costs.map((_, i) => i).sort((a, b) => compareBlindCost(costs[a], costs[b]) || tie[a] - tie[b] || a - b);
  const ranks = new Array<number>(costs.length);
  order.forEach((i, pos) => (ranks[i] = pos + 1));
  return ranks;
}

/** Siemenellinen permutaatio 0 … n − 1 (Fisher–Yates). */
function permutation(n: number, seed: number): number[] {
  const rng = createRng(seed >>> 0);
  const p = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  return p;
}

const foldSeed = (seed: number, itemId: string, what: string): number => seedFrom(`${BLIND_VERSION}|${seed}|${itemId}|${what}`);

/** Satunnaisjonon i siemen (0-pohjainen i): johdettu sokkotestin siemenestä ja jonon indeksistä. */
export function blindRandomSeed(seed: number, i: number): number {
  return seedFrom(`${BLIND_VERSION}|${seed}|satunnaisjono|${i}`);
}

/** Piittömän mallin osumalähde: siemenellinen satunnainen 0–9-jono, pituus N (sama kuin π-aineistolla). */
export function blindRandomSource(N: number, seed: number, i: number): HitSource {
  const s = blindRandomSeed(seed, i);
  return randomStringSource(N, s, `satunnaisjono ${i + 1} (siemen ${s})`);
}

// ------------------------------------------------------------------ p-arvo

/**
 * P(R₁ + … + R_F ≤ havaittu summa), kun R_i on tasajakautunut 1 … sizes[i] ja riippumaton (= todennäköisyys saada
 * yhtä hyvä tai parempi keskisijoitus sattumalta). Tarkka konvoluutio, kun työmäärä on kohtuullinen; muuten
 * siemenellinen Monte Carlo (vähintään 20 000 arvontaa), p = (1 + #{summa ≤ havaittu}) / (arvonnat + 1).
 * Tarkka laskenta, kun F · Σ sizes ≤ exactLimit (oletus 5 · 10⁷ eli käytännössä aina).
 */
export function rankSumPValue(
  observedSum: number,
  sizes: readonly number[],
  seed: number,
  draws = BLIND_MC_DRAWS,
  exactLimit = 50_000_000,
): { p: number; method: 'tarkka' | 'monte-carlo'; draws: number } {
  const F = sizes.length;
  if (!F) return { p: 1, method: 'tarkka', draws: 0 };
  let total = 0;
  for (const m of sizes) total += m;
  if (F * total <= exactLimit) {
    let dist = new Float64Array([1]);
    let max = 0;
    for (const m of sizes) {
      const prefix = new Float64Array(max + 2);
      for (let s = 0; s <= max; s++) prefix[s + 1] = prefix[s] + dist[s];
      const next = new Float64Array(max + m + 1);
      for (let s = 1; s <= max + m; s++) {
        const lo = Math.max(0, s - m);
        const hi = Math.min(max, s - 1);
        if (hi >= lo) next[s] = (prefix[hi + 1] - prefix[lo]) / m;
      }
      dist = next;
      max += m;
    }
    let p = 0;
    for (let s = 0; s <= Math.min(max, Math.floor(observedSum)); s++) p += dist[s];
    return { p: Math.min(1, Math.max(0, p)), method: 'tarkka', draws: 0 };
  }
  const n = Math.max(BLIND_MC_DRAWS, Math.floor(draws));
  const rng = createRng(seed >>> 0);
  let count = 0;
  for (let d = 0; d < n; d++) {
    let sum = 0;
    for (const m of sizes) sum += rng.int(1, m);
    if (sum <= observedSum) count++;
  }
  return { p: (count + 1) / (n + 1), method: 'monte-carlo', draws: n };
}

// ------------------------------------------------------------------ kierrosten suunnittelu

export interface BlindCandidatePlan {
  label: string;
  code: string;
  isTrue: boolean;
}

export interface BlindFoldPlan {
  item: BlindItem;
  /** Kontekstin kohteet (saman ryhmän muut kohteet vuotojen poiston jälkeen). */
  context: BlindItem[];
  /** Kontekstista poistetut kohteet syineen (sama koodi tai yhteinen vuotoavain). */
  removedContext: { id: string; label: string; reason: string }[];
  /** Kierroksen sanaston lähtökoodit (kontekstin koodit, toistot pois, järjestettyinä). */
  contextCodes: string[];
  /** Ehdokkaat siemenellä sekoitetussa järjestyksessä. */
  candidates: BlindCandidatePlan[];
  decoysRequested: number;
  /** Kohdat, joista alkavat osumat poistetaan kierroksen osumalähteestä (vuotoavaimet "kohta:<n>"). */
  removedPositions: number[];
  notes: string[];
}

export interface BlindPlan {
  plans: BlindFoldPlan[];
  skipped: { id: string; label: string; reason: string }[];
  notes: string[];
  /** Varaus johtopäätökseen: polkujen hypoteesi muodostettu löydön jälkeen (kohteet voivat olla valikoituneita). */
  caveat: string | null;
}

/** Sokkotestin parametrien tarkistus. Palauttaa virheet suomeksi (tyhjä = kelvolliset). */
export function validateBlindParams(p: BlindParams): string[] {
  if (!p || typeof p !== 'object') return ['Sokkotestin parametrit puuttuvat.'];
  const errors: string[] = [];
  if (p.kind !== 'tapahtuma' && p.kind !== 'polun-askel') errors.push(`Tuntematon kohdetyyppi "${String(p.kind)}".`);
  if (!Number.isInteger(p.decoys) || p.decoys < 1) errors.push(`Harhauttimien määrän D on oltava kokonaisluku ≥ 1 (nyt ${String(p.decoys)}).`);
  if (typeof p.seed !== 'number' || !Number.isFinite(p.seed)) errors.push(`Siemenen on oltava luku (nyt ${String(p.seed)}).`);
  if (!Number.isInteger(p.randomStrings) || p.randomStrings < 0) {
    errors.push(`Satunnaisjonojen määrän on oltava kokonaisluku ≥ 0 (nyt ${String(p.randomStrings)}).`);
  }
  if (!['YYYYMMDD', 'DDMMYYYY', 'DDMMYY', 'MMDD', 'DDMM'].includes(p.dateFormat)) errors.push(`Tuntematon päivämäärän muoto "${String(p.dateFormat)}".`);
  errors.push(...validatePathParams(p.path));
  return errors;
}

/** Kontekstikohteen poiston syy (vuoto piilotetusta kohteesta), tai null. */
function leakReason(hidden: BlindItem, other: BlindItem): string | null {
  if (other.code === hidden.code) return `sama koodi ${other.code} kuin piilotetulla kohteella`;
  if (hidden.leakKeys.includes(`koodi:${other.code}`)) return `koodi ${other.code} kuuluu piilotetun kohteen tunnisteisiin`;
  const shared = other.leakKeys.find((k) => hidden.leakKeys.includes(k));
  return shared ? `yhteinen tunniste ${shared} piilotetun kohteen kanssa` : null;
}

/** Tarinan ja tapahtumien koodit, joita harhautin ei saa olla (todellinen tieto ei ole harhautin). */
function contextExclusions(ctx: IdentifierContext | null, fmt: DateFormat): Set<string> {
  const out = new Set<string>();
  if (!ctx) return out;
  const add = (c: string | null) => {
    if (c) out.add(c);
  };
  for (const i of ctx.story?.identifiers ?? []) add(t9Code(i.name));
  for (const p of ctx.story?.persons ?? []) add(t9Code(p.name));
  for (const path of ctx.story?.paths ?? []) for (const s of path.steps) add(t9Code(s.name));
  for (const e of ctx.events ?? []) {
    const iso = isoDatePart(e.date);
    if (iso) {
      out.add(iso);
      add(dateToDigits(iso, fmt));
    }
  }
  return out;
}

/**
 * Sokkotestin kierrokset (ei hakua): kohteiden tarkistus, konteksti vuotojen poiston jälkeen, harhauttimet ja
 * ehdokkaiden sekoitus. Puhdas ja deterministinen. Ohitetut kohteet syineen.
 */
export function planBlindFolds(items: readonly BlindItem[], params: BlindParams, ctx: IdentifierContext | null): BlindPlan {
  const skipped: BlindPlan['skipped'] = [];
  const notes: string[] = [];
  const valid: BlindItem[] = [];
  const ids = new Set<string>();
  const skip = (it: BlindItem, reason: string) => skipped.push({ id: String(it?.id ?? ''), label: String(it?.label ?? it?.id ?? ''), reason });
  for (const it of items ?? []) {
    if (!it || typeof it !== 'object') continue;
    if (ids.has(it.id)) {
      skip(it, `Tunnus "${it.id}" on jo käytössä; kohde ohitettiin.`);
      continue;
    }
    ids.add(it.id);
    if (it.kind !== params.kind) {
      skip(it, `Kohde on tyyppiä "${it.kind}", testi tyyppiä "${params.kind}".`);
      continue;
    }
    if (!/^\d+$/.test(it.code ?? '')) {
      skip(it, it.kind === 'polun-askel' ? 'Nimeä ei voi koodata T9:llä (koodi puuttuu).' : 'Kohteella ei ole numerokoodia.');
      continue;
    }
    if (it.kind === 'tapahtuma') {
      if (!it.date || !isValidIsoDate(it.date)) {
        skip(it, 'Tapahtumalla ei ole kelvollista päivämäärää (VVVV-KK-PP).');
        continue;
      }
      const expected = dateToDigits(it.date, params.dateFormat);
      if (expected !== it.code) {
        skip(it, `Koodi ${it.code} ei vastaa päivämäärää ${it.date} muodossa ${params.dateFormat} (${expected ?? '–'}).`);
        continue;
      }
    }
    valid.push({ ...it, leakKeys: [...(it.leakKeys ?? [])] });
  }

  // Harhautin ei ole koskaan minkään kohteen koodi (ei edes toisen ryhmän) eikä tarinan nimi tai todellinen päivä.
  const exclude = contextExclusions(ctx, params.dateFormat);
  for (const it of valid) {
    exclude.add(it.code);
    if (it.date) exclude.add(it.date);
  }

  const byGroup = new Map<string, BlindItem[]>();
  for (const it of valid) {
    const g = byGroup.get(it.group);
    if (g) g.push(it);
    else byGroup.set(it.group, [it]);
  }

  const D = params.decoys;
  const plans: BlindFoldPlan[] = [];
  const minLen = params.path.minCodeLength;
  for (const item of valid) {
    const group = byGroup.get(item.group)!;
    const context: BlindItem[] = [];
    const removedContext: BlindFoldPlan['removedContext'] = [];
    for (const o of group) {
      if (o === item) continue;
      const why = leakReason(item, o);
      if (why) removedContext.push({ id: o.id, label: o.label, reason: why });
      else context.push(o);
    }
    if (!context.length) {
      skip(
        item,
        removedContext.length
          ? `Ryhmässä "${item.group}" ei ole kontekstia vuotojen poiston jälkeen (${removedContext.map((r) => `${r.label}: ${r.reason}`).join('; ')}).`
          : `Ryhmässä "${item.group}" ei ole muita kohteita: kontekstia ei ole (vähintään 1 tarvitaan).`,
      );
      continue;
    }
    if (item.code.length < minLen) {
      skip(item, `Koodi ${item.code} on liian lyhyt: ${item.code.length} < minCodeLength = ${minLen}; kaikki samanpituiset ehdokkaat hylättäisiin.`);
      continue;
    }
    const contextCodes = [...new Set(context.map((c) => c.code))].sort(cmpStr);
    if (contextCodes.every((c) => c.length < minLen)) {
      skip(item, `Kontekstin koodit (${contextCodes.join(', ')}) ovat kaikki lyhyempiä kuin minCodeLength = ${minLen}.`);
      continue;
    }

    const fNotes: string[] = [];
    const decoySeed = foldSeed(params.seed, item.id, 'harhauttimet');
    let decoys: { label: string; code: string }[];
    if (item.kind === 'polun-askel') {
      decoys = decoyNameCodes(item.code, D, decoySeed, exclude);
    } else {
      const range = decoyDateRange(group.map((g) => g.date));
      decoys = range ? decoyDates(item.date!, D, decoySeed, range.from, range.to, params.dateFormat, exclude) : [];
    }
    if (!decoys.length) {
      skip(
        item,
        item.kind === 'polun-askel'
          ? `Nimilistassa ei ole yhtään ${item.code.length}-numeroista koodia, joka ei olisi kohteiden tai tarinan koodi.`
          : 'Päivämääräharhauttimia ei löytynyt aikaväliltä.',
      );
      continue;
    }
    if (decoys.length < D) {
      fNotes.push(
        `Harhauttimia löytyi vain ${decoys.length} < D = ${D} (${item.code.length}-numeroiset koodit` +
          (item.kind === 'polun-askel' ? `, ${DECOY_NAMES_SOURCE})` : ', aikaväli)') +
          `; kierroksella on ${decoys.length + 1} ehdokasta ja sattuman odotus lasketaan sen mukaan.`,
      );
    }
    const candidates: BlindCandidatePlan[] = [
      { label: item.label, code: item.code, isTrue: true },
      ...decoys.map((d) => ({ label: d.label, code: d.code, isTrue: false })),
    ];
    // Sekoitus: ehdokkaiden järjestys ei paljasta oikeaa vastausta.
    const perm = permutation(candidates.length, foldSeed(params.seed, item.id, 'sekoitus'));
    const shuffled = perm.map((i) => candidates[i]);

    const removedPositions: number[] = [];
    for (const k of item.leakKeys) {
      if (!k.startsWith('kohta:')) continue;
      const n = Number(k.slice(6));
      if (Number.isInteger(n) && n >= 1 && !removedPositions.includes(n)) removedPositions.push(n);
    }
    removedPositions.sort((a, b) => a - b);
    if (removedPositions.length) {
      fNotes.push(`Piilotetun kohteen linkitetyt kohdat poistettiin sanastosta: ${removedPositions.map(fmtInt).join(', ')}.`);
    }
    plans.push({ item, context, removedContext, contextCodes, candidates: shuffled, decoysRequested: D, removedPositions, notes: fNotes });
  }

  let caveat: string | null = null;
  if (params.kind === 'polun-askel' && ctx?.story) {
    const groups = new Set(plans.map((p) => p.item.group));
    const posthoc = (ctx.story.paths ?? []).filter((p) => groups.has(p.id) && p.hypothesis?.timing !== 'ennen-löydöstä');
    if (posthoc.length) {
      caveat =
        `Polkujen ${posthoc.map((p) => p.title).join(', ')} hypoteesia ei ole lukittu ennen löydöstä: kohteet on voitu valita ` +
        'π-sijaintien perusteella, joten sokkotesti ei ole niiden osalta riippumaton.';
      notes.push(caveat);
    }
  }
  return { plans, skipped, notes, caveat };
}

// ------------------------------------------------------------------ ajo

export interface BlindCandidateResult {
  label: string;
  code: string;
  isTrue: boolean;
  /** Paras reitti π-aineistossa (null = ei reittiä). */
  cost: PathCost | null;
  /** Sijoitus π-aineistossa (1 = paras). */
  rankPi: number;
  /** Parhaan reitin avain π-aineistossa. */
  routeKey: string | null;
  /** Parhaan reitin jokainen askel tarkistettu lähdeaineistosta (null, jos reittiä ei ole). */
  verified: boolean | null;
  /** Paras reitti kussakin satunnaisjonossa. */
  costRandomStrings: (PathCost | null)[];
}

export interface BlindFoldResult extends BlindFold {
  /** Ehdokkaat π-sijoituksen mukaan (1 = paras). */
  candidates: BlindCandidateResult[];
  contextCodes: string[];
  removedContext: { id: string; label: string; reason: string }[];
  removedPositions: number[];
  decoysRequested: number;
  decoysUsed: number;
  notes: string[];
}

export interface BlindRunResult extends BlindResult {
  folds: BlindFoldResult[];
  notes: string[];
  definition: string;
  pMethod: 'tarkka' | 'monte-carlo';
  /** Piittömän mallin tulos jonoittain. */
  randomStringRuns: { label: string; hitsAt1: number; meanRank: number }[];
  /** Oliko π-keskisijoitus pienempi kuin satunnaisjonojen keskisijoitus (null, jos satunnaisjonoja ei ajettu). */
  piBeatsRandomStrings: boolean | null;
  sourceLabel: string;
  /** Kanoninen kuvaus testistä (parametrit ja kohteiden koodit); SHA-256 lasketaan tilakerroksessa. */
  canonical: string;
  /** Tuloksen sormenjälki (FNV-1a): ehdokkaat, kustannukset ja sijoitukset. */
  resultFingerprint: string;
}

export interface BlindRunOptions {
  /** Testejä ja vianetsintää varten: jokainen haku (source 0 = π, 1… = satunnaisjonot). */
  onSearch?: (e: { fold: number; candidate: number; source: number; outcome: SearchOutcome }) => void;
}

/** Osumalähde ilman annetuista kohdista alkavia osumia (piilotetun tapahtuman linkitetyt kohdat). */
function withoutPositions(src: HitSource, positions: readonly number[]): HitSource {
  if (!positions.length) return src;
  const drop = new Set(positions);
  const memo = new Map<string, Int32Array>();
  return {
    ...src,
    hitsOf: (code: string) => {
      let h = memo.get(code);
      if (!h) {
        h = src.hitsOf(code).filter((n) => !drop.has(n));
        memo.set(code, h);
      }
      return h;
    },
  };
}

function foldQuery(plan: BlindFoldPlan, cand: BlindCandidatePlan): PathQuery {
  const origin: PathIdentifier['origin'] = plan.item.kind === 'tapahtuma' ? 'tapahtumat' : 'tarina';
  const labels = new Map<string, string[]>();
  for (const c of plan.context) labels.set(c.code, [...(labels.get(c.code) ?? []), c.label]);
  const identifiers: PathIdentifier[] = plan.contextCodes.map((code, i) => ({
    id: `sokko:konteksti:${i + 1}`,
    role: 'lähtö',
    kind: 'numerojono',
    label: (labels.get(code) ?? [code]).join(' / '),
    value: code,
    origin,
  }));
  identifiers.push({ id: 'sokko:ehdokas', role: 'tavoite', kind: 'numerojono', label: cand.label, value: cand.code, origin });
  return { startText: '', goalText: '', identifiers, timeRange: null };
}

/** Kanoninen kuvaus: versio, parametrit ja kohteiden koodit (tunnuksen mukaan järjestettyinä). */
export function canonicalBlind(items: readonly BlindItem[], params: BlindParams): string {
  return stableStringify({
    versio: BLIND_VERSION,
    parametrit: { ...params, path: canonicalParams(params.path) },
    kohteet: [...items]
      .map((i) => ({ id: i.id, tyyppi: i.kind, koodi: i.code, ryhmä: i.group, vuotoavaimet: [...(i.leakKeys ?? [])].sort(cmpStr), päivä: i.date ?? null }))
      .sort((a, b) => cmpStr(a.id, b.id)),
  });
}

const mean = (xs: readonly number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * Sokkotesti. makePiSource antaa π-aineiston osumalähteen; makeRandomSource(i) piittömän mallin satunnaisjonon i
 * (sama pituus N; ks. blindRandomSource). Jokainen kierros: kaksisuuntainen haku konteksti → ehdokas jokaiselle
 * ehdokkaalle, ensin π-aineistossa ja sitten jokaisessa satunnaisjonossa (yksi jono muistissa kerrallaan).
 * Edistyminen: hooks.onProgress(tehdyt haut, kaikki haut). Virheelliset parametrit → poikkeus.
 */
export async function runBlindTest(
  items: readonly BlindItem[],
  params: BlindParams,
  makePiSource: () => HitSource,
  makeRandomSource: (i: number) => HitSource,
  ctx: IdentifierContext | null,
  hooks: RunHooks = {},
  opts: BlindRunOptions = {},
): Promise<BlindRunResult> {
  const t0 = now();
  const errors = validateBlindParams(params);
  if (errors.length) throw new Error(`Sokkotestin parametrit eivät kelpaa: ${errors.join(' ')}`);
  const plan = planBlindFolds(items, params, ctx);
  const notes = [...plan.notes];
  const skipped = [...plan.skipped];
  let plans = plan.plans;
  const pi = makePiSource();
  if (!pi || !(pi.N > 0)) {
    for (const p of plans) skipped.push({ id: p.item.id, label: p.item.label, reason: 'Aineisto on tyhjä (N = 0): lataa piin desimaalit ennen sokkotestiä.' });
    plans = [];
  }

  const S = params.randomStrings;
  const total = plans.reduce((a, p) => a + p.candidates.length, 0) * (1 + S);
  const every = Math.max(1, hooks.yieldEvery ?? 5);
  let done = 0;
  const tick = async () => {
    done++;
    if (hooks.onProgress && (done % every === 0 || done === total)) hooks.onProgress(done, total);
    if (hooks.yieldFn && done % every === 0) await hooks.yieldFn();
  };

  // costs[source][fold][candidate]
  const costs: (PathCost | null)[][][] = [];
  const keys: (string | null)[][] = [];
  const verifiedPi: (boolean | null)[][] = [];
  const sourceLabels: string[] = [];
  const failNotes = new Set<string>();
  for (let s = 0; s <= (plans.length ? S : -1); s++) {
    const base = s === 0 ? pi : makeRandomSource(s - 1);
    sourceLabels.push(base.label);
    const perSource: (PathCost | null)[][] = [];
    for (let f = 0; f < plans.length; f++) {
      const p = plans[f];
      const src = withoutPositions(base, p.removedPositions);
      const row: (PathCost | null)[] = [];
      for (let c = 0; c < p.candidates.length; c++) {
        const outcome = searchPaths(foldQuery(p, p.candidates[c]), params.path, 'kaksisuuntainen', src, null);
        opts.onSearch?.({ fold: f, candidate: c, source: s, outcome });
        let cost: PathCost | null = null;
        let key: string | null = null;
        let ver: boolean | null = null;
        if (outcome.status === 'virhe') failNotes.add(`Haku epäonnistui (${base.label}): ${outcome.reasons.join(' ')}`);
        else if (outcome.routes.length) {
          const r = outcome.routes[0];
          ver = base.digits ? r.steps.every((st) => st.verified === true) : null;
          if (ver === false) {
            // Ei pitäisi koskaan tapahtua: tarkistamaton reitti ei kelpaa sijoitukseen.
            failNotes.add(`Reitti ${r.key} ei läpäissyt tarkistusta lähdeaineistosta (${base.label}); sitä ei käytetty.`);
          } else {
            cost = { edges: r.cost.edges, transforms: r.cost.transforms, span: r.cost.span };
            key = r.key;
          }
        }
        row.push(cost);
        if (s === 0) {
          (keys[f] ??= []).push(key);
          (verifiedPi[f] ??= []).push(ver);
        }
        await tick();
      }
      perSource.push(row);
    }
    costs.push(perSource);
  }
  notes.push(...failNotes);

  // Sijoitukset: tasapelit siemenellisellä permutaatiolla, eri lähteille eri permutaatio.
  const ranksOf = (s: number, f: number): number[] =>
    rankCandidates(costs[s][f], permutation(plans[f].candidates.length, foldSeed(params.seed, plans[f].item.id, `tasapeli|${s}`)));

  const folds: BlindFoldResult[] = plans.map((p, f) => {
    const ti = p.candidates.findIndex((c) => c.isTrue);
    const rPi = ranksOf(0, f);
    const rankRandomStrings: number[] = [];
    for (let s = 1; s <= S; s++) rankRandomStrings.push(ranksOf(s, f)[ti]);
    const cands: BlindCandidateResult[] = p.candidates.map((c, i) => ({
      label: c.label,
      code: c.code,
      isTrue: c.isTrue,
      cost: costs[0][f][i],
      rankPi: rPi[i],
      routeKey: keys[f][i],
      verified: verifiedPi[f][i],
      costRandomStrings: costs.slice(1).map((src) => src[f][i]),
    }));
    cands.sort((a, b) => a.rankPi - b.rankPi);
    return {
      hiddenId: p.item.id,
      hiddenLabel: p.item.label,
      group: p.item.group,
      contextLabels: p.context.map((c) => c.label),
      candidates: cands,
      rankPi: rPi[ti],
      correct: rPi[ti] === 1,
      rankRandomStrings,
      topLabel: cands[0].label,
      contextCodes: [...p.contextCodes],
      removedContext: p.removedContext.map((r) => ({ ...r })),
      removedPositions: [...p.removedPositions],
      decoysRequested: p.decoysRequested,
      decoysUsed: p.candidates.length - 1,
      notes: [...p.notes],
    };
  });

  // Yhteenveto
  const F = folds.length;
  const sizes = folds.map((f) => f.candidates.length);
  const hitsAt1 = folds.filter((f) => f.correct).length;
  const expectedHitsAt1 = sizes.reduce((a, m) => a + 1 / m, 0);
  const rankSum = folds.reduce((a, f) => a + f.rankPi, 0);
  const meanRank = F ? rankSum / F : 0;
  const expectedMeanRank = F ? mean(sizes.map((m) => (m + 1) / 2)) : 0;
  const pv = rankSumPValue(rankSum, sizes, foldSeed(params.seed, '', 'p-arvo'));
  const randomStringRuns: BlindRunResult['randomStringRuns'] = [];
  if (F) {
    for (let s = 0; s < S; s++) {
      const ranks = folds.map((f) => f.rankRandomStrings[s]);
      randomStringRuns.push({ label: sourceLabels[s + 1], hitsAt1: ranks.filter((r) => r === 1).length, meanRank: mean(ranks) });
    }
  }
  const randomStrings = randomStringRuns.length
    ? { hitsAt1: mean(randomStringRuns.map((r) => r.hitsAt1)), meanRank: mean(randomStringRuns.map((r) => r.meanRank)) }
    : null;
  const piBeatsRandomStrings = randomStrings && F ? meanRank < randomStrings.meanRank : null;
  const verdict = verdictText({
    F,
    hitsAt1,
    expectedHitsAt1,
    meanRank,
    expectedMeanRank,
    p: pv.p,
    randomStrings,
    piBeats: piBeatsRandomStrings,
    caveat: plan.caveat,
  });

  const fingerprint = fnv1a(
    `${BLIND_VERSION}\n` +
      folds
        .map(
          (f) =>
            `${f.hiddenId}|${f.rankPi}|${f.rankRandomStrings.join(',')}|` +
            f.candidates.map((c) => `${c.code}:${c.cost ? `${c.cost.edges}/${c.cost.transforms}/${c.cost.span}` : '-'}`).join(','),
        )
        .join('\n'),
  );

  return {
    version: BLIND_VERSION,
    params: { ...params, path: { ...params.path, rules: [...params.path.rules] } },
    folds,
    skipped,
    summary: {
      folds: F,
      hitsAt1,
      expectedHitsAt1,
      meanRank,
      expectedMeanRank,
      pVsRandom: pv.p,
      randomStrings,
      verdict,
    },
    durationMs: Math.round((now() - t0) * 10) / 10,
    notes,
    definition: BLIND_DEFINITION,
    pMethod: pv.method,
    randomStringRuns,
    piBeatsRandomStrings,
    sourceLabel: pi?.label ?? '',
    canonical: canonicalBlind(items.filter((i) => i && typeof i === 'object'), params),
    resultFingerprint: fingerprint,
  };
}

/** Johtopäätös selkokielellä. Ennustuskykyä ei väitetä koskaan, ellei p ≤ α JA π ole parempi kuin satunnaisjonot. */
function verdictText(v: {
  F: number;
  hitsAt1: number;
  expectedHitsAt1: number;
  meanRank: number;
  expectedMeanRank: number;
  p: number;
  randomStrings: { hitsAt1: number; meanRank: number } | null;
  piBeats: boolean | null;
  caveat: string | null;
}): string {
  if (!v.F) return 'Ei näyttöä: yhtään sokkotestin kierrosta ei voitu ajaa (ks. ohitetut kohteet).';
  const facts =
    `${v.F} kierrosta: oikea vastaus ensimmäisenä ${v.hitsAt1}/${v.F} (sattuman odotus ${fmtDec(v.expectedHitsAt1)}), ` +
    `keskisijoitus ${fmtDec(v.meanRank)} (odotus ${fmtDec(v.expectedMeanRank)}), p = ${fmtP(v.p)} satunnaista valintaa vastaan` +
    (v.randomStrings ? `; satunnaisjonoissa keskisijoitus ${fmtDec(v.randomStrings.meanRank)}` : '; satunnaisjonoja ei ajettu');
  if (v.p <= BLIND_ALPHA && v.piBeats === true) {
    return (
      `Sattumaa parempi tässä sokkotestissä (${v.F} kierrosta): ${facts}. Tulos koskee vain näitä kohteita, tätä aineistoa ` +
      'ja lukittuja parametreja; se ei ole ennuste yksittäisestä tapahtumasta.' +
      (v.caveat ? ` ${v.caveat}` : '')
    );
  }
  if (v.p <= BLIND_ALPHA) {
    return (
      'Ei näyttöä piin osuudesta: sijoitukset olivat sattumaa parempia, mutta ' +
      (v.randomStrings
        ? 'sama algoritmi ilman piin numeroita (satunnaisjonot) pärjäsi yhtä hyvin tai paremmin, joten ero ei johdu piin numeroista'
        : 'piitöntä vertailua (satunnaisjonot) ei ajettu, joten eroa ei voi liittää piin numeroihin') +
      ` (${facts}).`
    );
  }
  return `Ei näyttöä: menetelmä ei tunnistanut piilotettuja kohteita sattumaa paremmin. (${facts}.)`;
}
