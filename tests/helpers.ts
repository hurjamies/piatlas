import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DATA = resolve(__dirname, '../public/data/pi_digits_1m.txt');
const FIXTURE = resolve(__dirname, 'fixtures/pi_first_2000.txt');

/** Täysi 1M-aineisto, jos se on saatavilla. Muuten null (täyden aineiston testit ohitetaan). */
export const FULL: string | null = existsSync(DATA) ? readFileSync(DATA, 'utf8').trim() : null;
export const HAS_FULL = FULL !== null;
export const full = (): string => {
  if (!FULL) throw new Error('Täysi aineisto puuttuu');
  return FULL;
};

/** Pieni fixture: piin 2000 ensimmäistä desimaalia. */
export const FIXTURE_DIGITS = readFileSync(FIXTURE, 'utf8').trim();
