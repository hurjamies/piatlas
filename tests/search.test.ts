import { describe, expect, it } from 'vitest';
import { digitsAt, normalizeDigitsText, PI_1M_SHA256, sliceContext, validateDataset } from '../src/core/digits';
import { encodeT9 } from '../src/core/encodings';
import { expectedCount, findAll, findSkip, nearestIndex } from '../src/core/search';
import { handleRequest } from '../src/engine/handlers';
import { FIXTURE_DIGITS, full, HAS_FULL } from './helpers';

describe.skipIf(!HAS_FULL)('täysi 1M-aineisto (tehtävänannon kohta 0 ja 8)', () => {
  it('aineisto on validi ja tarkistussumma täsmää', async () => {
    const v = await validateDataset(full(), 'pi_digits_1m.txt');
    expect(v.ok).toBe(true);
    expect(v.info!.length).toBe(1_000_000);
    expect(v.info!.sha256).toBe(PI_1M_SHA256);
    expect(v.info!.reference).toBe('pi-1m-verified');
    expect(full().startsWith('141592653589793')).toBe(true);
  });

  it("findAll('62884') sisältää 858260 ja 48227, yhteensä 9", () => {
    const h = findAll(encodeT9('MATTI'), full());
    expect(h).toContain(858260);
    expect(h).toContain(48227);
    expect(h[0]).toBe(48227); // ensimmäinen esiintymä
    expect(h.length).toBe(9);
  });

  it("findAll('432') sisältää 858511 ja 874141, yhteensä 1054", () => {
    const h = findAll(encodeT9('IDA'), full());
    expect(h).toContain(858511);
    expect(h).toContain(874141);
    expect(h.length).toBe(1054);
  });

  it("findAll('6464') sisältää 858960", () => {
    expect(findAll(encodeT9('MINI'), full())).toContain(858960);
  });

  it('osumien 858260 ja 858511 indeksiero on 251', () => {
    const matti = findAll('62884', full());
    const ida = findAll('432', full());
    const a = ida[ida.indexOf(858511)];
    const m = matti[nearestIndex(matti, a)];
    expect(m).toBe(858260);
    expect(a - m).toBe(251);
  });

  it('osuman numerot ovat lähdeaineiston numerot (1-pohjainen indeksi)', () => {
    const d = full();
    expect(digitsAt(d, 858260, 5)).toBe('62884');
    expect(digitsAt(d, 858511, 3)).toBe('432');
    expect(digitsAt(d, 858960, 4)).toBe('6464');
    expect(digitsAt(d, 874141, 3)).toBe('432');
    expect(digitsAt(d, 1, 5)).toBe('14159');
    const c = sliceContext(d, 858511, 3, 10, 10);
    expect(c.start).toBe(858501);
    expect(c.text).toBe(d.slice(858500, 858523));
    expect(c.text.slice(10, 13)).toBe('432');
  });

  it('aineiston loppu näkyy kontekstissa', () => {
    const d = full();
    const c = sliceContext(d, 999_998, 3, 5, 50);
    expect(c.end).toBe(1_000_000);
    expect(c.atEnd).toBe(true);
  });

  it('muut käyttäjän motiivit haetaan erillisinä numerojonoina', () => {
    const d = full();
    for (const code of ['23', '43', '4444', '1414', '4141']) {
      const h = findAll(code, d);
      expect(h.length).toBeGreaterThan(0);
      for (const n of h.slice(0, 50)) expect(digitsAt(d, n, code.length)).toBe(code);
    }
  });

  it('lyhyt koodi 432 esiintyy lähes odotusarvon verran (se ei yksilöi Idaa)', () => {
    const e = expectedCount(1_000_000, 3);
    expect(e).toBeCloseTo(999.998, 3);
    const c = findAll('432', full()).length;
    expect(Math.abs(c - e) / Math.sqrt(e)).toBeLessThan(3); // alle 3 keskihajontaa
  });

  it('moottorin haku palauttaa samat osumat', async () => {
    const state = { digits: full() };
    const r = (await handleRequest(state, {
      type: 'search',
      specs: [
        { id: 'ida', code: '432', mode: 'contiguous' },
        { id: 'matti', code: '62884', mode: 'contiguous' },
      ],
    })) as { id: string; hits: Int32Array; count: number }[];
    expect(r[0].count).toBe(1054);
    expect(Array.from(r[0].hits)).toContain(858511);
    expect(r[1].count).toBe(9);
  });
});

describe('haku ja validointi pienellä fixture-aineistolla', () => {
  it('päällekkäiset osumat lasketaan', () => {
    expect(findAll('44', '4444')).toEqual([1, 2, 3]);
    expect(findAll('4444', '44444')).toEqual([1, 2]);
  });

  it('fixture alkaa piin desimaaleilla', async () => {
    const v = await validateDataset(FIXTURE_DIGITS, 'fixture');
    expect(v.ok).toBe(true);
    expect(v.info!.reference).toBe('pi-prefix-ok');
    expect(findAll('14159', FIXTURE_DIGITS)[0]).toBe(1);
    expect(findAll('26535', FIXTURE_DIGITS)[0]).toBe(6);
  });

  it('alku "3." poistetaan ja rivinvaihdot siivotaan', () => {
    const r = normalizeDigitsText('3.14159\n26535\r\n');
    expect(r.digits).toBe('1415926535');
    expect(r.strippedPrefix).toBe('3.');
    expect(r.removedWhitespace).toBe(3);
  });

  it('muut merkit hylätään', async () => {
    const v = await validateDataset('14159x26535', 'virhe');
    expect(v.ok).toBe(false);
    expect(v.error).toMatch(/x/);
  });

  it('kokeellinen Fibonacci-hyppy ei ole peräkkäinen osuma', () => {
    // 1 4 1 5 9 2 6 5 3 5 … : askel 2 kohdasta 1 → 1,1,9 ; askel 3 kohdasta 2 → 4,9,5
    expect(findSkip('119', '14159265', 2).hits).toEqual([1]);
    expect(findSkip('495', '1415926535', 3).hits).toEqual([2]);
    expect(findAll('119', '14159265')).toEqual([]);
  });
});
