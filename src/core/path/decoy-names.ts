// Sokkotestin nimiharhauttimet (docs/POLKUHAKU.md §7). Lähde: yleisiä suomalaisia etunimiä, kiinteä lista.
//
// Lista on kiinteä ja deterministinen: sitä ei muuteta ajojen välillä, koska harhauttimet arvotaan siitä siemenellä.
// Nimet ovat isoin kirjaimin (A–Z sekä Ä, Ö ja Å) ja ne koodataan samalla T9-säännöllä kuin tarinan nimet
// (t9Code: suomalainen translitterointi Å,Ä → A ja Ö → O). Harhautin valitaan vain nimistä, joiden koodin pituus on
// sama kuin oikean vastauksen, koska koodin pituus määrää odotetun osumamäärän.

import { createRng } from '../random';
import { t9Code } from '../matrix/refs';

export const DECOY_NAMES_SOURCE = 'yleisiä suomalaisia etunimiä, kiinteä lista';

/** Kiinteä nimilista (ei toistoja). Järjestys on osa määrittelyä: siemenellinen sekoitus lähtee tästä järjestyksestä. */
export const DECOY_NAMES: readonly string[] = [
  // 3 kirjainta
  'ADA', 'AKI', 'ARI', 'ASA', 'AVA', 'AYA', 'ELI', 'ELO', 'ESA', 'EVA', 'IDA', 'IIA', 'ILO', 'INA', 'ISA', 'JAN',
  'JON', 'KAI', 'LEA', 'LEO', 'LIA', 'MAX', 'MIA', 'NEA', 'NEO', 'OLA', 'PIA', 'SAM', 'TEA', 'TIA', 'TIM', 'UNA',
  'UNO', 'ANU', 'BEN', 'OLE', 'SIV', 'TOM', 'ÅSA',
  // naisten nimiä
  'AILA', 'AILI', 'AINO', 'ALISA', 'ALMA', 'AMANDA', 'ANJA', 'ANNA', 'ANNE', 'ANNELI', 'ANNI', 'ANNIKA', 'ANITA',
  'ARJA', 'AURORA', 'AUNE', 'EEVA', 'EILA', 'EIJA', 'ELINA', 'ELISA', 'ELLA', 'ELLEN', 'ELSA', 'EMILIA', 'EMMA',
  'EMMI', 'ERJA', 'ESTER', 'HANNA', 'HANNELE', 'HEIDI', 'HELENA', 'HELI', 'HELJÄ', 'HELKA', 'HELLA', 'HELMI', 'HELVI',
  'HENNA', 'HILKKA', 'HILJA', 'IIDA', 'IINA', 'IIRIS', 'ILONA', 'INKA', 'INKERI', 'IRJA', 'IRMA', 'IRMELI', 'ISLA',
  'JAANA', 'JENNA', 'JENNI', 'JOHANNA', 'JONNA', 'JUTTA', 'KAARINA', 'KAIJA', 'KAISA', 'KATARIINA', 'KATJA',
  'KATRI', 'KERTTU', 'KIRSI', 'KRISTIINA', 'LAILA', 'LAURA', 'LEENA', 'LIISA', 'LILJA', 'LINNEA', 'LOTTA', 'LUMI',
  'MAIJA', 'MARI', 'MARIA', 'MARIKA', 'MARJA', 'MARJATTA', 'MARKETTA', 'MERJA', 'MERI', 'MILLA', 'MINNA', 'MIRJA',
  'MIRJAM', 'MINTTU', 'NELLI', 'NIINA', 'NOORA', 'OONA', 'OUTI', 'PAULA', 'PÄIVI', 'PIIA', 'PIRJO', 'PIRKKO',
  'RAIJA', 'RAILI', 'RIIKKA', 'RIITTA', 'RITVA', 'SAARA', 'SAIJA', 'SANNA', 'SANNI', 'SARI', 'SATU', 'SEIJA',
  'SENJA', 'SIIRI', 'SINI', 'SIRPA', 'SOFIA', 'SOILE', 'SONJA', 'SUSANNA', 'SUVI', 'SYLVI', 'SÄDE', 'TAINA',
  'TARJA', 'TEIJA', 'TERHI', 'TIINA', 'TILDA', 'TUIJA', 'TUULA', 'TUULI', 'ULLA', 'VAPPU', 'VEERA', 'VENLA',
  'VILMA', 'VIIVI', 'VIRPI', 'VUOKKO', 'ELVIRA', 'ESSI', 'HILMA', 'JASMIN', 'KIIA', 'MINEA', 'NEEA', 'RONJA',
  'SALLA', 'SELMA', 'SIRI', 'SANELMA', 'TYYNE', 'BRITA', 'EBBA', 'ALVA',
  // miesten nimiä
  'AAPO', 'AARNE', 'AARO', 'AATU', 'AKSELI', 'ALEKSI', 'ALPO', 'ANTERO', 'ANTTI', 'ARTO', 'ARTTU', 'AULIS', 'EELI',
  'EEMELI', 'EEMIL', 'EERO', 'EETU', 'EINO', 'ELIAS', 'EMIL', 'ERKKI', 'ESKO', 'HANNU', 'HARRI', 'HEIKKI', 'HEINO',
  'HENRI', 'HENRIK', 'HERMANNI', 'ILKKA', 'ILMARI', 'ISMO', 'JAAKKO', 'JANI', 'JANNE', 'JARI', 'JARMO', 'JOEL',
  'JOHANNES', 'JONI', 'JOONA', 'JOONAS', 'JORMA', 'JOUKO', 'JOUNI', 'JUHA', 'JUHANI', 'JUHO', 'JUKKA', 'JUSSI',
  'JYRKI', 'KALEVI', 'KALLE', 'KAUKO', 'KARI', 'KEIJO', 'KIMMO', 'LASSE', 'LAURI', 'LEEVI', 'LUUKAS', 'MARKKU',
  'MARKO', 'MARTTI', 'MATIAS', 'MATTI', 'MIKA', 'MIKAEL', 'MIKKO', 'MIRO', 'NIILO', 'NIKLAS', 'NIKO', 'OIVA', 'OLAVI',
  'OLLI', 'ONNI', 'OSKARI', 'OSMO', 'OTTO', 'PAAVO', 'PANU', 'PASI', 'PATRIK', 'PEKKA', 'PENTTI', 'PERTTI', 'PETRI',
  'PETTERI', 'RAIMO', 'RASMUS', 'RAUNO', 'REIJO', 'RIKU', 'RISTO', 'ROOPE', 'SAKARI', 'SAMI', 'SAMU', 'SAMUEL',
  'SANTERI', 'SEPPO', 'SIMO', 'SULO', 'TAPANI', 'TAPIO', 'TATU', 'TEEMU', 'TEPPO', 'TERO', 'TIMO', 'TOIVO', 'TOMI',
  'TOMMI', 'TONI', 'TOPI', 'TOPIAS', 'TUOMAS', 'TUOMO', 'TUUKKA', 'UOLEVI', 'URHO', 'UUNO', 'VALTTERI', 'VEETI',
  'VEIKKO', 'VELI', 'VESA', 'VILHO', 'VILJAMI', 'VILJO', 'VILLE', 'VÄINÖ', 'YRJÖ', 'ARVO', 'ELMERI',
  'ELJAS', 'HUGO', 'ISAK', 'JALMARI', 'KASPER', 'KAAPO', 'LENNI', 'LEON', 'NOOA', 'NOEL', 'OLIVER', 'OSSI', 'PERTTU',
  'RAFAEL', 'TAAVI', 'TAUNO', 'VERNERI', 'VIENO', 'BJÖRN', 'GÖRAN',
];

export interface DecoyName {
  label: string;
  code: string;
}

/** Nimilistan T9-koodit (sama sääntö kuin tarinan nimillä). Nimet, joita ei voi koodata, ohitetaan. */
function encodedNames(): DecoyName[] {
  const out: DecoyName[] = [];
  for (const label of DECOY_NAMES) {
    const code = t9Code(label);
    if (code) out.push({ label, code });
  }
  return out;
}

let cache: DecoyName[] | null = null;

/** Koko lista koodeineen kiinteässä järjestyksessä. */
export function decoyNamePool(): DecoyName[] {
  if (!cache) cache = encodedNames();
  return cache.map((x) => ({ ...x }));
}

/** Eri koodien määrä annetulla koodin pituudella, kun exclude-joukon koodit jätetään pois. */
export function decoyNameCapacity(length: number, exclude: ReadonlySet<string> = new Set()): number {
  const codes = new Set<string>();
  for (const x of decoyNamePool()) if (x.code.length === length && !exclude.has(x.code)) codes.add(x.code);
  return codes.size;
}

/**
 * Nimiharhauttimet: enintään `count` nimeä, joiden T9-koodin pituus on sama kuin `trueCode`:n, koodit keskenään
 * erilaiset, eikä yksikään koodi ole `trueCode` tai joukossa `exclude` (esim. kontekstin ja tarinan koodit).
 * Valinta: lista sekoitetaan siemenellä (Fisher–Yates, createRng) ja otetaan ensimmäiset kelvolliset; saman koodin
 * nimistä kelpaa sekoituksessa ensimmäinen. Jos samanpituisia nimiä ei ole tarpeeksi, palautetaan vähemmän:
 * kutsuja vertaa pituutta pyydettyyn ja kertoo vajeen (runBlindTest kirjaa sen huomautuksiin).
 */
export function decoyNameCodes(trueCode: string, count: number, seed: number, exclude: ReadonlySet<string>): DecoyName[] {
  const want = Math.max(0, Math.floor(count));
  if (!want || !trueCode) return [];
  const pool = decoyNamePool().filter((x) => x.code.length === trueCode.length);
  const rng = createRng(seed >>> 0);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const t = pool[i];
    pool[i] = pool[j];
    pool[j] = t;
  }
  const out: DecoyName[] = [];
  const seen = new Set<string>([trueCode]);
  for (const x of pool) {
    if (out.length >= want) break;
    if (seen.has(x.code) || exclude.has(x.code)) continue;
    seen.add(x.code);
    out.push(x);
  }
  return out;
}
