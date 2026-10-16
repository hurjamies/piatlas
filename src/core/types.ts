import type { DateFormat, EncodingId, EncodeResult, ScandiRule } from './encodings';
import { dateToDigits, encodeValue } from './encodings';
import type { Metric } from './geometry-index';
import type { Statistic, Verdict } from './stats';

export type TermKind = 'nimi' | 'paikka' | 'päivämäärä' | 'numerojono' | 'teksti';
export type SearchMode = 'contiguous' | 'fibSkip';

export interface SearchTerm {
  id: string;
  label: string;
  /** Käyttäjän syöttämä arvo (nimi, teksti, numerojono tai ISO-päivämäärä). */
  value: string;
  kind: TermKind;
  encoding: EncodingId;
  scandi: ScandiRule;
  uppercase: boolean;
  dateFormat?: DateFormat;
  color: string;
  visible: boolean;
  mode: SearchMode;
  /** Kokeellinen Fibonacci-hyppy: askel F_k. */
  fibK?: number;
  /** Vapaaehtoinen elämäntapahtuman ajankohta (ISO), käyttäjän antama. */
  eventDate?: string | null;
  createdAt: string;
  builtin?: boolean;
}

export function termEncoding(t: SearchTerm): EncodeResult {
  if (t.kind === 'päivämäärä') {
    const digits = dateToDigits(t.value, t.dateFormat ?? 'YYYYMMDD');
    if (digits == null) {
      return { ok: false, code: '', steps: [], ignored: [], errors: ['Päivämäärä muodossa VVVV-KK-PP.'], rule: '' };
    }
    const r = encodeValue(digits, 'RAW');
    return { ...r, rule: `Päivämäärä ${t.dateFormat ?? 'YYYYMMDD'} → ${digits}` };
  }
  return encodeValue(t.value, t.encoding, { scandi: t.scandi, uppercase: t.uppercase });
}

/** Osuman yksilöivä tunnus: sama nimi eri paikassa on eri osuma. */
export interface HitRef {
  termId: string;
  n: number;
}
export const hitKey = (h: HitRef): string => `${h.termId}@${h.n}`;
export function parseHitKey(k: string): HitRef | null {
  const i = k.lastIndexOf('@');
  if (i < 0) return null;
  const n = Number(k.slice(i + 1));
  return Number.isFinite(n) ? { termId: k.slice(0, i), n } : null;
}

export type Confidence = 'koodattu osuma' | 'kokeellinen hyppypolku' | 'geometrinen yhteys' | 'tilastollisesti arvioitu';

export interface LifeEvent {
  id: string;
  title: string;
  /** Kalenteriaika ISO-muodossa (päivä tai päivä+kellonaika). */
  date: string;
  note: string;
  /** Käyttäjän itse linkittämät osumat. Ei koskaan automaattisia linkkejä. */
  linkedHits: string[];
  createdAt: string;
}

export function eventTimestamp(e: LifeEvent): number | null {
  const t = Date.parse(e.date);
  return Number.isFinite(t) ? t : null;
}

export type AuditType = 'ankkuri' | 'aineisto' | 'termi' | 'esirekisteröinti' | 'testi' | 'tapahtuma';

export interface AuditEntry {
  ts: string;
  type: AuditType;
  text: string;
}

export interface Anchor {
  termId: string;
  n: number;
  label: string;
  code: string;
  setAt: string;
}

export interface TestSpec {
  termA: string;
  termB: string;
  labelA: string;
  labelB: string;
  codeA: string;
  codeB: string;
  metric: Metric;
  statistic: Statistic;
  anchorN: number | null;
  R: number;
  seed: number;
  alpha: number;
  datasetSha: string;
  datasetLength: number;
}

export interface PreRegistration {
  id: string;
  createdAt: string;
  hypothesis: string;
  spec: TestSpec;
  /** SHA-256 lukitusta sisällöstä: hypoteesi + parametrit + aikaleima. */
  hash: string;
}

export interface TestRunSummary {
  observed: number;
  pValue: number;
  pLow: number;
  pHigh: number;
  shareGreater: number;
  kA: number;
  kB: number;
  nullMedian: number;
  nullQ05: number;
  nullQ95: number;
  durationMs: number;
  version: string;
}

export interface TestRun {
  id: string;
  ts: string;
  kind: 'monte-carlo' | 'random-control';
  spec: TestSpec;
  preregId: string | null;
  summary: TestRunSummary;
  verdict: Verdict;
  /** Satunnaisaineistokontrolli: osuus satunnaisjonoista, joissa arvo ≤ piin arvo. */
  shareLE?: number;
}

export function canonicalSpec(s: TestSpec): string {
  const keys = Object.keys(s).sort() as (keyof TestSpec)[];
  return JSON.stringify(keys.map((k) => [k, s[k]]));
}

export function sameSpec(a: TestSpec, b: TestSpec): boolean {
  return canonicalSpec(a) === canonicalSpec(b);
}

/**
 * Sama tutkimuskysymys: samat termit, koodit, metriikka, testisuure, ankkuri ja aineisto.
 * Siemen, R ja α eivät muuta kysymystä — niiden vaihtaminen jo nähdyn tuloksen jälkeen ei tee testistä ennakkoon lukittua.
 */
export function sameQuestion(a: TestSpec, b: TestSpec): boolean {
  return (
    a.termA === b.termA &&
    a.termB === b.termB &&
    a.codeA === b.codeA &&
    a.codeB === b.codeB &&
    a.metric === b.metric &&
    a.statistic === b.statistic &&
    a.anchorN === b.anchorN &&
    a.datasetSha === b.datasetSha
  );
}
