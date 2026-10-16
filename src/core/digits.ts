import { sha256Hex } from './sha256';

/** Mukana tulevan aineiston tunnetut ominaisuudet (tehtävänanto, kohta 0). */
export const PI_1M_LENGTH = 1_000_000;
export const PI_1M_SHA256 = '7806ee47461b49ef1f578e14461b2c83c09c6d7a9a914275da1d71e9cbbf7069';
/** Piin 60 ensimmäistä desimaalia — tällä tunnistetaan, että tiedosto todella alkaa piin desimaaleista. */
export const PI_PREFIX = '141592653589793238462643383279502884197169399375105820974944';

export interface NormalizeResult {
  digits: string;
  /** Poistettu etuliite, esim. "3." */
  strippedPrefix: string | null;
  /** Poistettujen välilyöntien ja rivinvaihtojen määrä. */
  removedWhitespace: number;
  /** Ensimmäiset virheelliset merkit (sijainti 1-pohjaisena raakatiedostossa). */
  invalid: { char: string; pos: number }[];
  invalidCount: number;
}

/**
 * Siistii raakatekstin: poistaa välilyönnit/rivinvaihdot ja mahdollisen alun "3." tai "3,".
 * Kaikki muut merkit kuin 0–9 ovat virheitä: tiedostoa ei hyväksytä, jos niitä on.
 */
export function normalizeDigitsText(raw: string): NormalizeResult {
  let text = raw;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM
  let removedWhitespace = 0;
  if (/\s/.test(text)) {
    const before = text.length;
    text = text.replace(/\s+/g, '');
    removedWhitespace = before - text.length;
  }
  let strippedPrefix: string | null = null;
  const m = /^3[.,]/.exec(text);
  if (m) {
    strippedPrefix = m[0];
    text = text.slice(m[0].length);
  } else if (text.startsWith('314159') && !text.startsWith('14159')) {
    strippedPrefix = '3';
    text = text.slice(1);
  }
  const invalid: { char: string; pos: number }[] = [];
  let invalidCount = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 48 || c > 57) {
      invalidCount++;
      if (invalid.length < 8) invalid.push({ char: text[i], pos: i + 1 });
    }
  }
  return { digits: invalidCount ? '' : text, strippedPrefix, removedWhitespace, invalid, invalidCount };
}

export type ReferenceStatus = 'pi-1m-verified' | 'pi-prefix-1m-verified' | 'pi-prefix-ok' | 'not-pi' | 'unknown';

export interface DatasetInfo {
  name: string;
  length: number;
  sha256: string;
  reference: ReferenceStatus;
  prefixOk: boolean;
  /** Kun aineisto on yli 1M: täsmäävätkö sen ensimmäiset 1M numeroa referenssiin. */
  first1MMatches: boolean | null;
  strippedPrefix: string | null;
  removedWhitespace: number;
  warnings: string[];
  loadedAt: string;
}

export interface ValidationOutcome {
  ok: boolean;
  digits: string;
  info: DatasetInfo | null;
  error: string | null;
}

export async function validateDataset(raw: string, name: string): Promise<ValidationOutcome> {
  const norm = normalizeDigitsText(raw);
  if (norm.invalidCount) {
    const first = norm.invalid.map((x) => `"${x.char}" kohdassa ${x.pos}`).join(', ');
    return {
      ok: false,
      digits: '',
      info: null,
      error: `Tiedostossa on ${norm.invalidCount} merkkiä, jotka eivät ole numeroita 0–9 (${first}). Aineistoa ei ladattu.`,
    };
  }
  const digits = norm.digits;
  if (digits.length < 10) {
    return { ok: false, digits: '', info: null, error: 'Tiedostossa on alle 10 numeroa. Aineistoa ei ladattu.' };
  }
  const sha = await sha256Hex(digits);
  const prefixOk = digits.startsWith(PI_PREFIX.slice(0, Math.min(PI_PREFIX.length, digits.length)));
  let first1MMatches: boolean | null = null;
  if (digits.length > PI_1M_LENGTH) {
    first1MMatches = (await sha256Hex(digits.slice(0, PI_1M_LENGTH))) === PI_1M_SHA256;
  }
  let reference: ReferenceStatus = 'unknown';
  if (sha === PI_1M_SHA256 && digits.length === PI_1M_LENGTH) reference = 'pi-1m-verified';
  else if (first1MMatches) reference = 'pi-prefix-1m-verified';
  else if (prefixOk) reference = 'pi-prefix-ok';
  else reference = 'not-pi';

  const warnings: string[] = [];
  if (norm.strippedPrefix) warnings.push(`Alusta poistettiin "${norm.strippedPrefix}", jotta indeksi 1 on ensimmäinen desimaali.`);
  if (norm.removedWhitespace) warnings.push(`Tiedostosta poistettiin ${norm.removedWhitespace} välilyönti- tai rivinvaihtomerkkiä.`);
  if (reference === 'not-pi') warnings.push('Aineisto ei ala piin desimaaleilla 14159… Tuloksia ei voi tulkita piin osumiksi.');
  if (reference === 'pi-prefix-ok') warnings.push('Alku täsmää piihin, mutta tiedostolle ei ole tunnettua tarkistussummaa.');
  if (first1MMatches === false) warnings.push('Ensimmäinen miljoona numeroa ei täsmää mukana tulevaan referenssiin.');

  return {
    ok: true,
    digits,
    error: null,
    info: {
      name,
      length: digits.length,
      sha256: sha,
      reference,
      prefixOk,
      first1MMatches,
      strippedPrefix: norm.strippedPrefix,
      removedWhitespace: norm.removedWhitespace,
      warnings,
      loadedAt: new Date().toISOString(),
    },
  };
}

export interface ContextSlice {
  /** 1-pohjainen ensimmäinen näytetty indeksi. */
  start: number;
  /** 1-pohjainen viimeinen näytetty indeksi. */
  end: number;
  text: string;
  atStart: boolean;
  atEnd: boolean;
}

/** Leike 1-pohjaisen indeksin n ympäriltä. Rajat leikataan aineiston alkuun ja loppuun. */
export function sliceContext(digits: string, n: number, length: number, before: number, after: number): ContextSlice {
  const N = digits.length;
  const start = Math.max(1, n - before);
  const end = Math.min(N, n + length - 1 + after);
  return { start, end, text: digits.slice(start - 1, end), atStart: start === 1, atEnd: end === N };
}

/** Numerot n…n+len-1 (1-pohjainen). */
export function digitsAt(digits: string, n: number, len: number): string {
  return digits.slice(n - 1, n - 1 + len);
}
