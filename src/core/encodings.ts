// Hakukoodaukset: teksti → numerojono. Jokainen koodaus palauttaa myös "lukutavan"
// (merkki → numerot), jotta käyttäjä näkee täsmälleen, mitä haettiin.

export type EncodingId = 'T9' | 'A1Z26' | 'UTF8_3' | 'RAW';

/**
 * Skandinaavisten kirjainten sääntö:
 *  - 'none'        Å/Ä/Ö ovat virheitä (ei hiljaista muunnosta)
 *  - 'fi-translit' Å,Ä → A ja Ö → O (suomalainen translitterointi)
 *  - 'fi-alphabet' vain A1Z26: Å=27, Ä=28, Ö=29 (suomen aakkosjärjestys Z:n jälkeen)
 */
export type ScandiRule = 'none' | 'fi-translit' | 'fi-alphabet';

export interface EncodeOptions {
  scandi?: ScandiRule;
  /** UTF-8: muunnetaanko isoiksi kirjaimiksi ennen koodausta. */
  uppercase?: boolean;
}

export interface EncodeStep {
  ch: string;
  out: string;
}

export interface EncodeResult {
  ok: boolean;
  code: string;
  steps: EncodeStep[];
  ignored: string[];
  errors: string[];
  /** Selkokielinen kuvaus käytetystä säännöstä. */
  rule: string;
}

export const ENCODING_LABELS: Record<EncodingId, string> = {
  T9: 'T9-näppäimistö',
  A1Z26: 'A1Z26 (A=01 … Z=26)',
  UTF8_3: 'UTF-8 tavut, 3 numeroa/tavu',
  RAW: 'Raaka numerojono',
};

const T9_KEYS: Record<string, string> = {
  A: '2', B: '2', C: '2', D: '3', E: '3', F: '3', G: '4', H: '4', I: '4', J: '5', K: '5', L: '5',
  M: '6', N: '6', O: '6', P: '7', Q: '7', R: '7', S: '7', T: '8', U: '8', V: '8', W: '9', X: '9', Y: '9', Z: '9',
};
/** Näppäimen kirjaimet (T9:n monitulkintaisuuden laskemiseen). */
export const T9_LETTERS: Record<string, string> = {
  '2': 'ABC', '3': 'DEF', '4': 'GHI', '5': 'JKL', '6': 'MNO', '7': 'PQRS', '8': 'TUV', '9': 'WXYZ',
};

const SEPARATORS = /[\s\-_'’.,]/;

function translitFi(ch: string): string | null {
  if (ch === 'Å' || ch === 'Ä') return 'A';
  if (ch === 'Ö') return 'O';
  return null;
}

function isScandi(ch: string): boolean {
  return ch === 'Å' || ch === 'Ä' || ch === 'Ö';
}

export function encodeT9Detailed(text: string, opts: EncodeOptions = {}): EncodeResult {
  const scandi = opts.scandi ?? 'none';
  const steps: EncodeStep[] = [];
  const ignored: string[] = [];
  const errors: string[] = [];
  for (const raw of text.normalize('NFC').toUpperCase()) {
    if (SEPARATORS.test(raw)) {
      ignored.push(raw);
      continue;
    }
    if (/[0-9]/.test(raw)) {
      steps.push({ ch: raw, out: raw });
      continue;
    }
    let ch = raw;
    if (isScandi(ch)) {
      if (scandi === 'fi-translit' || scandi === 'fi-alphabet') ch = translitFi(ch)!;
      else {
        errors.push(`"${raw}": valitse suomalainen translitterointi (Å,Ä→A, Ö→O), jotta merkki voidaan koodata.`);
        continue;
      }
    }
    const key = T9_KEYS[ch];
    if (!key) {
      errors.push(`"${raw}" ei kuulu T9-näppäimistöön.`);
      continue;
    }
    steps.push({ ch: raw, out: key });
  }
  const rule =
    'T9: ABC=2 DEF=3 GHI=4 JKL=5 MNO=6 PQRS=7 TUV=8 WXYZ=9' +
    (scandi !== 'none' ? '; Å,Ä→A, Ö→O' : '') +
    (ignored.length ? '; välit ja välimerkit ohitetaan' : '');
  return finish(steps, ignored, errors, rule);
}

export function encodeA1Z26Detailed(text: string, opts: EncodeOptions = {}): EncodeResult {
  const scandi = opts.scandi ?? 'none';
  const steps: EncodeStep[] = [];
  const ignored: string[] = [];
  const errors: string[] = [];
  for (const raw of text.normalize('NFC').toUpperCase()) {
    if (SEPARATORS.test(raw)) {
      ignored.push(raw);
      continue;
    }
    if (isScandi(raw)) {
      if (scandi === 'fi-alphabet') {
        steps.push({ ch: raw, out: raw === 'Å' ? '27' : raw === 'Ä' ? '28' : '29' });
      } else if (scandi === 'fi-translit') {
        const t = translitFi(raw)!;
        steps.push({ ch: raw, out: String(t.charCodeAt(0) - 64).padStart(2, '0') });
      } else {
        errors.push(`"${raw}": valitse sääntö (translitterointi Å,Ä→A, Ö→O tai aakkosjärjestys Å=27, Ä=28, Ö=29).`);
      }
      continue;
    }
    const c = raw.charCodeAt(0);
    if (raw.length === 1 && c >= 65 && c <= 90) {
      steps.push({ ch: raw, out: String(c - 64).padStart(2, '0') });
    } else {
      errors.push(`"${raw}" ei ole kirjain A–Z.`);
    }
  }
  const rule =
    'A1Z26: A=01 … Z=26 (aina kaksi numeroa)' +
    (scandi === 'fi-alphabet' ? '; Å=27, Ä=28, Ö=29' : scandi === 'fi-translit' ? '; Å,Ä→A, Ö→O' : '');
  return finish(steps, ignored, errors, rule);
}

export function encodeUtf8TriplesDetailed(text: string, opts: EncodeOptions = {}): EncodeResult {
  const src = opts.uppercase ? text.normalize('NFC').toUpperCase() : text.normalize('NFC');
  const steps: EncodeStep[] = [];
  const enc = new TextEncoder();
  for (const ch of src) {
    const bytes = enc.encode(ch);
    steps.push({ ch, out: Array.from(bytes, (b) => String(b).padStart(3, '0')).join('') });
  }
  const rule = 'UTF-8: jokainen tavu 000–255 kolmella numerolla (yksikäsitteinen)' + (opts.uppercase ? '; isot kirjaimet' : '');
  return finish(steps, [], [], rule);
}

export function encodeRawDetailed(text: string): EncodeResult {
  const steps: EncodeStep[] = [];
  const ignored: string[] = [];
  const errors: string[] = [];
  for (const ch of text) {
    if (/[0-9]/.test(ch)) steps.push({ ch, out: ch });
    else if (/[\s.\-/:]/.test(ch)) ignored.push(ch);
    else errors.push(`"${ch}" ei ole numero.`);
  }
  return finish(steps, ignored, errors, 'Raaka numerojono: numerot sellaisenaan' + (ignored.length ? '; erottimet ohitetaan' : ''));
}

function finish(steps: EncodeStep[], ignored: string[], errors: string[], rule: string): EncodeResult {
  const code = steps.map((s) => s.out).join('');
  if (!code && !errors.length) errors.push('Tyhjä haku.');
  return { ok: errors.length === 0 && code.length > 0, code, steps, ignored, errors, rule };
}

function orThrow(r: EncodeResult): string {
  if (!r.ok) throw new Error(r.errors.join(' '));
  return r.code;
}

export function encodeT9(text: string, opts?: EncodeOptions): string {
  return orThrow(encodeT9Detailed(text, opts));
}
export function encodeA1Z26(text: string, opts?: EncodeOptions): string {
  return orThrow(encodeA1Z26Detailed(text, opts));
}
export function encodeUtf8Triples(text: string, opts?: EncodeOptions): string {
  return orThrow(encodeUtf8TriplesDetailed(text, opts));
}

export function encodeValue(value: string, encoding: EncodingId, opts: EncodeOptions = {}): EncodeResult {
  switch (encoding) {
    case 'T9':
      return encodeT9Detailed(value, opts);
    case 'A1Z26':
      return encodeA1Z26Detailed(value, opts);
    case 'UTF8_3':
      return encodeUtf8TriplesDetailed(value, opts);
    case 'RAW':
      return encodeRawDetailed(value);
  }
}

/** Kuinka monta eri A–Z-kirjainjonoa tuottaa saman T9-koodin (numerot 0/1 lasketaan yhdeksi). */
export function t9Ambiguity(code: string): number {
  let n = 1;
  for (const d of code) n *= T9_LETTERS[d]?.length ?? 1;
  return n;
}

/** Muutama esimerkkilukutapa samalle T9-koodille (osoittaa, ettei T9 ole yksikäsitteinen). */
export function t9Readings(code: string, limit = 8): string[] {
  const out: string[] = [];
  const keys = [...code].map((d) => T9_LETTERS[d] ?? d);
  const total = t9Ambiguity(code);
  // Tasaisesti hajautetut esimerkit kaikista vaihtoehdoista, deterministisesti.
  const take = Math.min(limit, total);
  for (let t = 0; t < take; t++) {
    let idx = Math.floor((t * total) / take);
    let s = '';
    for (let i = keys.length - 1; i >= 0; i--) {
      const letters = keys[i];
      s = letters[idx % letters.length] + s;
      idx = Math.floor(idx / letters.length);
    }
    out.push(s);
  }
  return out;
}

export type DateFormat = 'YYYYMMDD' | 'DDMMYYYY' | 'DDMMYY' | 'MMDD' | 'DDMM';

/** ISO-päivämäärä (YYYY-MM-DD) → numerojono valitussa muodossa. */
export function dateToDigits(iso: string, fmt: DateFormat): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const [, y, mo, d] = m;
  switch (fmt) {
    case 'YYYYMMDD':
      return y + mo + d;
    case 'DDMMYYYY':
      return d + mo + y;
    case 'DDMMYY':
      return d + mo + y.slice(2);
    case 'MMDD':
      return mo + d;
    case 'DDMM':
      return d + mo;
  }
}
