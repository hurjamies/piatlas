import { describe, expect, it } from 'vitest';
import {
  dateToDigits,
  encodeA1Z26,
  encodeA1Z26Detailed,
  encodeT9,
  encodeT9Detailed,
  encodeUtf8Triples,
  t9Ambiguity,
  t9Readings,
} from '../src/core/encodings';

describe('hakukoodaukset (tehtävänannon kohta 8)', () => {
  it('T9', () => {
    expect(encodeT9('MATTI')).toBe('62884');
    expect(encodeT9('IDA')).toBe('432');
    expect(encodeT9('MINI')).toBe('6464');
    expect(encodeT9('matti')).toBe('62884');
  });

  it('A1Z26 kaksinumeroisena', () => {
    expect(encodeA1Z26('MATTI')).toBe('1301202009');
  });

  it('UTF-8-tavut kolmella numerolla', () => {
    expect(encodeUtf8Triples('MATTI')).toBe('077065084084073');
  });
});

describe('skandinaaviset kirjaimet', () => {
  it('T9 ei muunna Ä:tä hiljaa ilman valintaa', () => {
    expect(() => encodeT9('MÄKI')).toThrow();
    const r = encodeT9Detailed('MÄKI');
    expect(r.ok).toBe(false);
    expect(encodeT9('MÄKI', { scandi: 'fi-translit' })).toBe('6254');
    expect(encodeT9('Åke Öhman', { scandi: 'fi-translit' })).toBe('25364626');
  });

  it('A1Z26: translitterointi tai aakkosjärjestys', () => {
    expect(encodeA1Z26('ÄÖ', { scandi: 'fi-translit' })).toBe('0115');
    expect(encodeA1Z26('ÅÄÖ', { scandi: 'fi-alphabet' })).toBe('272829');
    expect(encodeA1Z26Detailed('Ä').ok).toBe(false);
  });

  it('UTF-8 on yksikäsitteinen myös ääkkösille', () => {
    expect(encodeUtf8Triples('Ä')).toBe('195132');
    expect(encodeUtf8Triples('Ö')).toBe('195150');
    // NFD-muotoinen Ä normalisoidaan NFC:ksi
    expect(encodeUtf8Triples('Ä')).toBe('195132');
  });
});

describe('T9 ei ole yksikäsitteinen', () => {
  it('432 vastaa 27 kirjainjonoa, esim. HEB ja GFC', () => {
    expect(t9Ambiguity('432')).toBe(27);
    expect(encodeT9('HEB')).toBe('432');
    expect(encodeT9('GFC')).toBe('432');
    expect(t9Ambiguity('62884')).toBe(3 * 3 * 3 * 3 * 3);
    const r = t9Readings('432', 27);
    expect(r).toContain('IDA');
    expect(new Set(r).size).toBe(27);
    for (const s of r) expect(encodeT9(s)).toBe('432');
  });
});

describe('päivämäärät', () => {
  it('muodot', () => {
    expect(dateToDigits('2014-03-23', 'YYYYMMDD')).toBe('20140323');
    expect(dateToDigits('2014-03-23', 'DDMMYYYY')).toBe('23032014');
    expect(dateToDigits('2014-03-23', 'DDMMYY')).toBe('230314');
    expect(dateToDigits('23.3.2014', 'YYYYMMDD')).toBeNull();
  });
});
