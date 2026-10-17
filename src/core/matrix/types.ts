// Recursive Story Matrix: yhteiset tyypit. Määrittely: docs/MATRIISI.md.
// Kaksi kerrosta pidetään erillään: `pi` (laskennallinen π-data) ja `tarina` (käyttäjän antamat merkitykset).

export const MATRIX_VERSION = 'PIATLAS-MATRIX-1.0.0';
export const OPS369_VERSION = 'PIATLAS-369-1.0.0';
export const JUMP_VERSION = 'PIATLAS-JUMP-1.0.0';
export const ROUTE_TEST_VERSION = 'PIATLAS-ROUTE-1.0.0';

/** Yhteyden tyyppi. Jokainen särmä kuuluu täsmälleen yhteen. */
export type Layer = 'matemaattinen' | 'geometrinen' | 'ajallinen' | 'symbolinen';

export const LAYER_LABELS: Record<Layer, string> = {
  matemaattinen: 'Matemaattinen',
  geometrinen: 'Geometrinen',
  ajallinen: 'Ajallinen',
  symbolinen: 'Symbolinen',
};

/** Solmun tietokerros: `pi` = laskennallinen π-data, `tarina` = käyttäjän symbolinen tarinakerros. */
export type Realm = 'pi' | 'tarina';

/** Lukusuunta. '234' = etenevä, '432' = käänteinen. EI tarkoita indeksihyppyjä 2, 3 ja 4. */
export type Direction = '234' | '432';

export const opposite = (d: Direction): Direction => (d === '234' ? '432' : '234');

/** Alue, jossa suunta tulkitaan. Indeksisuunta, geometrinen liikesuunta ja tarinan suunta ovat eri asioita. */
export type DirectionDomain = 'pi-indeksi' | 'koodi' | 'spiraali' | 'oktaedri' | 'tarina' | 'aika';

export const DIRECTION_SEMANTICS: Record<DirectionDomain, Record<Direction, string>> = {
  'pi-indeksi': { '234': 'kasvava n', '432': 'pienenevä n' },
  koodi: { '234': 'numerot vasemmalta oikealle', '432': 'numerot oikealta vasemmalle' },
  spiraali: { '234': 'ulospäin: n + F_k', '432': 'sisäänpäin: n − F_k' },
  oktaedri: { '234': 'vastapäivään +Z-akselin ympäri', '432': 'myötäpäivään +Z-akselin ympäri' },
  tarina: { '234': 'polun järjestyksessä eteenpäin', '432': 'polkua takaperin' },
  aika: { '234': 'vanhimmasta uusimpaan', '432': 'uusimmasta vanhimpaan' },
};

export const DOMAIN_LABELS: Record<DirectionDomain, string> = {
  'pi-indeksi': 'π-indeksi',
  koodi: 'koodi',
  spiraali: 'spiraali',
  oktaedri: 'oktaedri',
  tarina: 'tarina',
  aika: 'aika',
};

/** "234 · π-indeksi: kasvava n" */
export function directionLabel(d: Direction, domain: DirectionDomain): string {
  return `${d} · ${DOMAIN_LABELS[domain]}: ${DIRECTION_SEMANTICS[domain][d]}`;
}

// ------------------------------------------------------------------ solmut

/** Serialisoitava solmuviite. Nimet ja koodit normalisoidaan isoiksi kirjaimiksi / pelkiksi numeroiksi. */
export type NodeRef =
  /** Lähtöankkuri (oletus IDA 432 @858 511) ja lähtötunnisteet. */
  | { kind: 'root' }
  /** Nimi (isot kirjaimet). Tarinakerros: nimi ei yksilöi henkilöä. */
  | { kind: 'name'; name: string }
  /** Numerojono. π-kerros. */
  | { kind: 'code'; code: string }
  /** Koodin yksittäinen numero portina (index = 0-pohjainen paikka koodissa). */
  | { kind: 'digit'; code: string; index: number }
  /** Esiintymä: digits[n − 1 … n + L − 2] === code (1-pohjainen n). Tarkistetaan aina lähdeaineistosta. */
  | { kind: 'hit'; code: string; n: number }
  /** Pelkkä π-indeksi (ei välttämättä minkään koodin osuma). */
  | { kind: 'position'; n: number }
  /** Käyttäjän tulkinta numerolle tietyssä kontekstissa. */
  | { kind: 'gloss'; glossId: string }
  | { kind: 'person'; personId: string }
  /** Samannimisten henkilöiden kronologinen verkko (esim. Hanna I–III). */
  | { kind: 'homonyms'; name: string }
  | { kind: 'path'; pathId: string }
  /** Polkujen yhdistys yhdessä henkilössä: alkuperäiset polut säilyvät. */
  | { kind: 'junction'; personId: string; pathIds: string[] }
  | { kind: 'event'; eventId: string };

export type NodeKind = NodeRef['kind'];

/** Yksikäsitteinen, vakaa avain. Käytetään silmukoiden estoon ja vierailtujen kirjanpitoon. */
export function nodeKey(r: NodeRef): string {
  switch (r.kind) {
    case 'root':
      return 'root';
    case 'name':
      return `name:${r.name}`;
    case 'code':
      return `code:${r.code}`;
    case 'digit':
      return `digit:${r.code}#${r.index}`;
    case 'hit':
      return `hit:${r.code}@${r.n}`;
    case 'position':
      return `pos:${r.n}`;
    case 'gloss':
      return `gloss:${r.glossId}`;
    case 'person':
      return `person:${r.personId}`;
    case 'homonyms':
      return `homonyms:${r.name}`;
    case 'path':
      return `path:${r.pathId}`;
    case 'junction':
      return `junction:${r.personId}:${[...r.pathIds].sort().join('+')}`;
    case 'event':
      return `event:${r.eventId}`;
  }
}

export function parseNodeKey(k: string): NodeRef | null {
  if (k === 'root') return { kind: 'root' };
  const i = k.indexOf(':');
  if (i < 0) return null;
  const kind = k.slice(0, i);
  const rest = k.slice(i + 1);
  switch (kind) {
    case 'name':
      return rest ? { kind: 'name', name: rest } : null;
    case 'code':
      return /^\d+$/.test(rest) ? { kind: 'code', code: rest } : null;
    case 'digit': {
      const m = /^(\d+)#(\d+)$/.exec(rest);
      return m ? { kind: 'digit', code: m[1], index: Number(m[2]) } : null;
    }
    case 'hit': {
      const m = /^(\d+)@(\d+)$/.exec(rest);
      return m ? { kind: 'hit', code: m[1], n: Number(m[2]) } : null;
    }
    case 'pos':
      return /^\d+$/.test(rest) ? { kind: 'position', n: Number(rest) } : null;
    case 'gloss':
      return rest ? { kind: 'gloss', glossId: rest } : null;
    case 'person':
      return rest ? { kind: 'person', personId: rest } : null;
    case 'homonyms':
      return rest ? { kind: 'homonyms', name: rest } : null;
    case 'path':
      return rest ? { kind: 'path', pathId: rest } : null;
    case 'junction': {
      const j = rest.indexOf(':');
      if (j < 0) return null;
      const pathIds = rest.slice(j + 1).split('+').filter(Boolean);
      return pathIds.length ? { kind: 'junction', personId: rest.slice(0, j), pathIds } : null;
    }
    case 'event':
      return rest ? { kind: 'event', eventId: rest } : null;
  }
  return null;
}

export function realmOf(r: NodeRef): Realm {
  switch (r.kind) {
    case 'root':
    case 'code':
    case 'digit':
    case 'hit':
    case 'position':
      return 'pi';
    default:
      return 'tarina';
  }
}

export const REALM_LABELS: Record<Realm, string> = {
  pi: 'π-data',
  tarina: 'Tarinaverkko',
};

// ------------------------------------------------------------------ särmät ja avaus

export interface MatrixEdge {
  to: NodeRef;
  layer: Layer;
  /** Ryhmä listauksessa, esim. "Kaikki osumat", "Polut", "Tulkinnat". */
  group: string;
  /** Lyhyt kuvaus, esim. "seuraava osuma". */
  relation: string;
  /** Miten yhteys laskettiin tai mistä se tulee. Toistettava kuvaus. */
  trace: string;
  direction?: Direction | null;
  domain?: DirectionDomain | null;
  /** Operaation tunnus, jos särmä syntyi nimetystä operaatiosta (esim. '369:fib-3k', 'hyppy-2-3-4'). */
  op?: string | null;
  /** π-kerroksen yhteydet: tarkistettu lähdeaineistosta. Tarinakerroksessa null. */
  verified?: boolean | null;
  /** Raportoitavat luvut (Δn, chord, F_k, …). */
  metrics?: Record<string, number | string>;
  /** realmOf(lähtö) ≠ realmOf(kohde): siirrytään π-datasta tarinaverkkoon tai takaisin. */
  crossesRealm: boolean;
}

export interface Fact {
  label: string;
  value: string;
  layer: Layer;
  verified?: boolean | null;
}

export interface NodeInfo {
  ref: NodeRef;
  key: string;
  realm: Realm;
  /** Lyhyt otsikko, esim. "HANNA III", "MAX 629", "42662 @858 610". */
  title: string;
  /** Selite, esim. "henkilö · samannimisistä kolmas (kronologinen)". */
  subtitle: string;
  facts: Fact[];
  /** Jos solmulla on konkreettinen π-sijainti (osuma tai indeksi): siirtymät spiraaliin, 3D:hen ja 1D:hen. */
  piPosition: { n: number; code: string | null } | null;
  /** Solmu viittaa olemattomaan dataan (poistettu henkilö tms.). */
  missing?: boolean;
}

export interface Expansion {
  node: NodeInfo;
  edges: MatrixEdge[];
  /** Ryhmät, joista näytetään vain osa (esim. tuhansia osumia). */
  truncated: { group: string; shown: number; total: number }[];
  notes: string[];
}

// ------------------------------------------------------------------ reitti (murupolku)

export interface TrailStep {
  ref: NodeRef;
  /** Särmä, jonka kautta solmuun tultiin. Juuressa null. */
  via: { relation: string; layer: Layer; crossesRealm: boolean; trace: string; group: string } | null;
}

export const MAX_DEPTH = 32;

// ------------------------------------------------------------------ tarinamalli

export type StorySource = 'tehtävänanto' | 'käyttäjä';

export interface Person {
  id: string;
  /** Koodattava nimi isoin kirjaimin, esim. "HANNA". EI yksilöi henkilöä. */
  name: string;
  /**
   * Samannimisten henkilöiden kronologinen järjestysnumero (Hanna I = 1, II = 2, III = 3).
   * null, jos nimellä on vain yksi henkilö. EI ole symbolinen numero (ks. PathStep.symbol).
   */
  homonymOrdinal: number | null;
  description: string;
  /** Käyttäjän antamat roolit, esim. "Maxin äiti". */
  roles: string[];
  /** Käyttäjän antama ajanjakso (ISO-päivämäärät). null = ei tiedossa. Päivämääriä ei keksitä. */
  period: { start: string | null; end: string | null } | null;
  source: StorySource;
  createdAt: string;
}

export interface Relation {
  id: string;
  from: string;
  to: string;
  /** Esim. "äiti". Luetaan: from on to:n <kind>. */
  kind: string;
  note: string;
  source: StorySource;
}

/** Tulkinnan konteksti. Tulkinta on aina kontekstisidonnainen, ei yleispätevä merkitys. */
export type GlossContext =
  /** Käyttäjän elämäntarinan yleinen tulkinta (ei yleispätevä numeron merkitys). */
  | { kind: 'tarina' }
  /** Tulkinta tämän koodin sisällä, esim. "2 = HANNA" koodissa 629 (MAX). */
  | { kind: 'koodi'; code: string }
  /** Tulkinta tämän polun sisällä. */
  | { kind: 'polku'; pathId: string };

export interface Gloss {
  id: string;
  /** Numero tai numerojono, jota tulkitaan, esim. "2" tai "23". */
  symbol: string;
  meanings: string[];
  context: GlossContext;
  /** Tulkinta viittaa henkilöön tässä kontekstissa (esim. 2 → HANNA III koodissa 629). */
  personId?: string | null;
  /** Tulkinta viittaa nimeen (symbolinen nimisolmu), esim. "HANNA". */
  name?: string | null;
  note: string;
  source: StorySource;
  createdAt: string;
}

export interface PathStep {
  /** Nimi, johon askel viittaa (symbolinen nimisolmu), esim. "HANNA". */
  name: string;
  /** Tarkka henkilö, jos käyttäjä on valinnut (esim. hanna-3). null = vain nimi. */
  personId: string | null;
  /** Käyttäjän antama symbolinen numero tässä polussa, esim. "2". EI ole Person.homonymOrdinal. */
  symbol: string;
  /** Vaiheen kuvaus, esim. "siirtymä". */
  stage: string;
}

export type HypothesisTiming = 'ennen-löydöstä' | 'löydön-jälkeen' | 'ei-tiedossa';

export const HYPOTHESIS_LABELS: Record<HypothesisTiming, string> = {
  'ennen-löydöstä': 'Määritelty ennen löydöstä (lukittu)',
  'löydön-jälkeen': 'Muodostettu löydön jälkeen',
  'ei-tiedossa': 'Ajoitus ei tiedossa',
};

export interface HypothesisMeta {
  timing: HypothesisTiming;
  /** Milloin hypoteesi kirjattiin (ISO). */
  statedAt: string | null;
  /** SHA-256 lukitusta sisällöstä. Vain 'ennen-löydöstä' vaatii tämän. */
  lockHash: string | null;
  note: string;
}

export interface StoryPath {
  id: string;
  title: string;
  /** Esim. "sukupolvien jatkuvuus". */
  theme: string;
  /** Määrittelyjärjestys = suunta 234. */
  steps: PathStep[];
  note: string;
  source: StorySource;
  hypothesis: HypothesisMeta;
  createdAt: string;
}

/** Lähtötunniste ja aiemmin ilmoitetut sijainnit. Sijainnit hyväksytään vasta tarkistuksen jälkeen. */
export interface Identifier {
  name: string;
  /** Ilmoitettu koodi (tarkistetaan: T9(name) === code). */
  code: string;
  encoding: 'T9';
  /** Aiemmin ilmoitetut 1-pohjaiset sijainnit (tarkistetaan lähdeaineistosta). */
  reportedPositions: number[];
  /** Mistä sijainti on ilmoitettu. */
  reportedBy: string;
}

export interface StoryModel {
  version: 1;
  /** Siemenaineiston versio. Muuttuu, jos tehtävänannon testidataa päivitetään. */
  seedVersion: string;
  identifiers: Identifier[];
  persons: Person[];
  relations: Relation[];
  glosses: Gloss[];
  paths: StoryPath[];
}

// ------------------------------------------------------------------ ympäristö

/** Elämäntapahtuma sellaisena kuin matriisi sen näkee (yhteensopiva core/types.ts:n LifeEventin kanssa). */
export interface MatrixEvent {
  id: string;
  title: string;
  date: string;
  note: string;
  linkedHits: string[];
  personIds?: string[];
}

export interface MatrixEnv {
  /** Piin desimaalit, 1-pohjainen indeksi n ↔ digits[n − 1]. */
  digits: string;
  story: StoryModel;
  anchor: { code: string; n: number; label: string };
  direction: Direction;
  events: MatrixEvent[];
}

// ------------------------------------------------------------------ tallennus ja loki

export interface SavedRoute {
  id: string;
  title: string;
  createdAt: string;
  trail: TrailStep[];
  direction: Direction;
  /** Käyttäjän tulkinta reitistä (tarinakerros). */
  interpretation: string;
  hypothesis: HypothesisMeta;
  /** Reitin π-kerroksen faktat tallennushetkellä, tarkistettuina (esim. "42662 @858610 ✓"). */
  mathFacts: string[];
  /** Reitin askelindeksit, joissa siirrytään kerroksesta toiseen. */
  crossings: number[];
  matrixVersion: string;
}

export type MatrixLogKind = 'avaus' | 'suunta' | '369' | 'hyppy' | 'tallennus' | 'vertailu' | 'tarkistus' | 'tarina';

export interface MatrixLogEntry {
  ts: string;
  kind: MatrixLogKind;
  text: string;
  /** Solmun avain, jos merkintä koskee solmua. */
  ref?: string;
}

// ------------------------------------------------------------------ apufunktiot

const ROMAN: [number, string][] = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
  [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];

export function toRoman(n: number): string {
  if (!Number.isInteger(n) || n < 1) return String(n);
  let out = '';
  let x = n;
  for (const [v, s] of ROMAN) {
    while (x >= v) {
      out += s;
      x -= v;
    }
  }
  return out;
}

/** Nimen normalisointi solmuavaimiin: NFC, isot kirjaimet, reunavälit pois. */
export function normName(s: string): string {
  return s.normalize('NFC').trim().toUpperCase();
}
