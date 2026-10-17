// Path Discovery Engine: yhteiset tyypit. Määrittely: docs/POLKUHAKU.md.
// Kaikki tässä kuvattu on laskettua π-rakennetta. Käyttäjän tekstit ovat symbolista tulkintaa, eivätkä ne
// vaikuta hakuun muuten kuin tunnisteiden kautta, jotka käyttäjä on hyväksynyt.

import type { DateFormat } from '../encodings';
import type { DirectionDomain } from '../matrix/types';

export const PATH_VERSION = 'PIATLAS-PATH-1.0.0';
export const PATHSCORE_VERSION = 'PIATLAS-PATHSCORE-1.0.0';
export const BLIND_VERSION = 'PIATLAS-BLIND-1.0.0';

// ------------------------------------------------------------------ syöte

export type IdentifierKind = 'nimi' | 'sana' | 'numerojono' | 'päivämäärä' | 'henkilö' | 'tapahtuma';
export type IdentifierRole = 'lähtö' | 'tavoite' | 'tunnettu';

export interface PathIdentifier {
  id: string;
  role: IdentifierRole;
  kind: IdentifierKind;
  /** Näyttönimi, esim. "HANNA" tai "Muutto 2014-03-23". */
  label: string;
  /** Koodattava arvo: nimi/sana (T9, fi-translit), numerojono, ISO-päivämäärä. Henkilölle nimi, tapahtumalle ISO-päivä. */
  value: string;
  /** Päivämäärille ja tapahtumille. Oletus 'DDMMYYYY'. */
  dateFormat?: DateFormat;
  personId?: string | null;
  eventId?: string | null;
  /** Mistä tunniste tuli: 'teksti' = poimittu lähtö/tavoitetekstistä tunnetun nimen perusteella. */
  origin: 'käyttäjä' | 'teksti' | 'tarina' | 'tapahtumat';
}

/** Tunnisteen koodi ja koodauksen kuvaus (esim. "T9: H=4 A=2 N=6 N=6 A=2"). */
export interface EncodedIdentifier {
  identifier: PathIdentifier;
  ok: boolean;
  code: string;
  rule: string;
  error: string | null;
}

export interface PathQuery {
  /** Käyttäjän symbolinen kuvaus lähtötilasta. Ei vaikuta hakuun. */
  startText: string;
  /** Käyttäjän symbolinen kuvaus tavoitetilasta. Ei vaikuta hakuun. */
  goalText: string;
  identifiers: PathIdentifier[];
  /** Rajaa tapahtumatunnisteet. Piin indekseillä ei ole kalenteriaikaa. */
  timeRange: { from: string | null; to: string | null } | null;
}

// ------------------------------------------------------------------ säännöt ja parametrit

export type PathRuleId = 'indeksi-seuraava' | 'fib-naapuri' | 'oktaedri-lähin' | '369-siirtymä' | '369-fib3k' | '369-mod9';

export interface PathRuleDef {
  id: PathRuleId;
  title: string;
  /** Kaava selkokielellä, sama kuin docs/POLKUHAKU.md §3. */
  formula: string;
  layer: 'matemaattinen' | 'geometrinen';
  domain: DirectionDomain;
  /** Onko sääntö suunnaton (oktaedri-lähin). */
  undirected: boolean;
  /** 369-sääntö: vain käyttäjän aktivoimana, ja jokainen askel on muunnos. */
  is369: boolean;
}

export type SearchMode = '234' | '432' | 'kaksisuuntainen';

export interface PathParams {
  /** Käytössä olevat perussäännöt (369-säännöt lisätään vain use369 = true). */
  rules: PathRuleId[];
  use369: boolean;
  /** indeksi-seuraava: suurin |Δn|. 369-mod9 käyttää 9·W. */
  indexWindow: number;
  fibKMin: number;
  fibKMax: number;
  nearestK: number;
  chordMax: number;
  /** Lyhyempiä koodeja ei käytetä solmuina (liikaa osumia). */
  minCodeLength: number;
  /** Koodi, jolla on enemmän osumia, hylätään solmuna syyn kanssa. */
  maxHitsPerCode: number;
  /** Reitin enimmäispituus askelina. */
  maxEdges: number;
  /** Laajennettujen solmujen enimmäismäärä kummallekin puolelle. */
  budget: number;
  /** Palautettavien reittiehdokkaiden enimmäismäärä. */
  maxRoutes: number;
}

export const DEFAULT_PATH_PARAMS: PathParams = {
  rules: ['indeksi-seuraava', 'fib-naapuri', 'oktaedri-lähin'],
  use369: false,
  indexWindow: 2000,
  fibKMin: 2,
  fibKMax: 25,
  nearestK: 3,
  chordMax: 0.01,
  minCodeLength: 3,
  maxHitsPerCode: 5000,
  maxEdges: 6,
  budget: 20000,
  maxRoutes: 5,
};

// ------------------------------------------------------------------ osumalähde

/**
 * Mistä osumat tulevat. Todellinen pii: codeHits(digits, code). Nollamallit: arvotut paikat tai satunnainen
 * 0–9-jono. `digits` on mukana vain, kun osumat voidaan tarkistaa lähdeaineistosta.
 */
export interface HitSource {
  kind: 'pii' | 'tasajakauma' | 'satunnaisjono';
  N: number;
  hitsOf(code: string): Int32Array;
  digits: string | null;
  /** Kuvaus raporttiin, esim. "pi_digits_1m.txt" tai "satunnaisjono siemen 20261017". */
  label: string;
}

// ------------------------------------------------------------------ tulos

export interface PathNode {
  code: string;
  n: number;
  /** Tunnisteen nimi, esim. "HANNA" (useampi, jos sama koodi monella tunnisteella). */
  labels: string[];
  roles: IdentifierRole[];
}

export interface PathStep {
  from: PathNode;
  to: PathNode;
  rule: PathRuleId;
  /** Kumpi haku tuotti askeleen: lähtöpuoli (234) vai tavoitepuoli (432). */
  side: '234' | '432';
  layer: 'matemaattinen' | 'geometrinen';
  domain: DirectionDomain;
  /** Instansioitu kaava, esim. "858 511 + F18 (2 584) = 861 095". */
  formula: string;
  /** to.n − from.n reitin kulkusuunnassa (lähtö → tavoite). */
  delta: number;
  metrics: Record<string, number | string>;
  /** Naapurien määrä, joista askel valittiin (haarautuminen). */
  branching: number;
  /** 369-askel = muunnos. */
  transform: boolean;
  /** Lähdeaineistosta tarkistettu (molemmat solmut). null, jos lähteellä ei ole numeroita (nollamalli). */
  verified: boolean | null;
  digitsFrom: string | null;
  digitsTo: string | null;
}

export interface PathCost {
  edges: number;
  transforms: number;
  /** Σ|Δn| askelista. */
  span: number;
}

export interface PathRoute {
  /** Deterministinen tunniste solmuavaimista. */
  key: string;
  nodes: PathNode[];
  steps: PathStep[];
  cost: PathCost;
  /** Solmun indeksi reitillä, jossa lähtö- ja tavoitepuolen haut kohtasivat (kaksisuuntainen). */
  meetIndex: number | null;
}

export interface SearchFailure {
  code: string | null;
  label: string | null;
  reason: string;
}

export interface SideStats {
  expanded: number;
  reached: number;
  frontier: number;
  budgetHit: boolean;
  maxDepthReached: number;
}

export interface SearchOutcome {
  version: string;
  mode: SearchMode;
  status: 'löytyi' | 'ei-löytynyt' | 'virhe';
  routes: PathRoute[];
  /** 234-/432-tilassa: saavutetut solmut (puu), rajattu. */
  reachedSample: { node: PathNode; depth: number; via: PathRuleId | null }[];
  failures: SearchFailure[];
  /** Selkokieliset syyt, miksi reittiä ei löytynyt tai miksi haku rajattiin. */
  reasons: string[];
  forward: SideStats | null;
  backward: SideStats | null;
  /** Käytetty sanasto: koodi → osumamäärä ja käyttö. */
  vocabulary: { code: string; labels: string[]; roles: IdentifierRole[]; hits: number; used: boolean; note: string | null }[];
  params: PathParams;
  /** SHA-256 ei ole synkroninen: tähän tulee kanoninen merkkijono; tiiviste lasketaan tilakerroksessa. */
  canonical: string;
  /** Tuloksen sormenjälki (FNV-1a) toistettavuuden tarkistukseen. */
  resultFingerprint: string;
  sourceLabel: string;
  ms: number;
}

// ------------------------------------------------------------------ Path Score

export interface NullComparison {
  model: 'tasajakauma' | 'satunnaisjono';
  replicates: number;
  seed: number;
  /** Replikaatit, joissa paras reitti oli yhtä hyvä tai parempi (kustannus, muunnokset, span). */
  countAsGood: number;
  /** Replikaatit, joissa reittiä ei löytynyt lainkaan. */
  noRoute: number;
  pValue: number;
  pLow: number;
  pHigh: number;
}

export interface PathScore {
  version: string;
  /** null, jos satunnaisvertailua ei ole ajettu tai toistettavuus epäonnistui. */
  total: number | null;
  rarity: number | null;
  length: number;
  branching: number;
  transforms: number;
  structure: { geometric: number; numeric: number };
  reproducible: boolean | null;
  nulls: NullComparison[];
  definition: string;
  disclaimer: string;
}

// ------------------------------------------------------------------ sokkotesti

export type BlindItemKind = 'tapahtuma' | 'polun-askel';

export interface BlindItem {
  id: string;
  kind: BlindItemKind;
  label: string;
  code: string;
  /** Konteksti, josta kohde piilotetaan (esim. polun tunnus). Vain saman ryhmän muut kohteet ovat kontekstia. */
  group: string;
  /** Tunnisteet, jotka vuotaisivat vastauksen (esim. henkilö-id, tapahtuma-id): poistetaan sanastosta. */
  leakKeys: string[];
  /** Tapahtumille ISO-päivä (harhauttimien aikaväliä varten). */
  date?: string | null;
}

export interface BlindParams {
  kind: BlindItemKind;
  decoys: number;
  seed: number;
  /** Piittömän mallin satunnaisjonojen määrä. */
  randomStrings: number;
  dateFormat: DateFormat;
  path: PathParams;
}

export interface BlindFold {
  hiddenId: string;
  hiddenLabel: string;
  group: string;
  contextLabels: string[];
  candidates: { label: string; code: string; isTrue: boolean; cost: PathCost | null }[];
  /** Oikean vastauksen sijoitus 1…D+1 (1 = paras). */
  rankPi: number;
  correct: boolean;
  /** Sama algoritmi satunnaisjonoissa: oikean vastauksen sijoitus kussakin jonossa. */
  rankRandomStrings: number[];
  topLabel: string;
}

export interface BlindResult {
  version: string;
  params: BlindParams;
  folds: BlindFold[];
  skipped: { id: string; label: string; reason: string }[];
  summary: {
    folds: number;
    hitsAt1: number;
    expectedHitsAt1: number;
    meanRank: number;
    expectedMeanRank: number;
    /** P(keskisijoitus ≤ havaittu | sijoitukset tasajakautuneita). */
    pVsRandom: number;
    /** Piittömän mallin keskiarvot. */
    randomStrings: { hitsAt1: number; meanRank: number } | null;
    verdict: string;
  };
  durationMs: number;
}
