// Kaikkien karttojen valinta johtaa samaan alkuperäiseen numeroindeksiin.
import { describe, expect, it } from 'vitest';
import { digitsAt, sliceContext } from '../src/core/digits';
import { mapIndex, vogel } from '../src/core/mapping';
import { atlasLayout, netLayout, placeOnLayout } from '../src/core/net';
import { fitView, PickItem, pickNearest, View2D, worldToScreen } from '../src/core/pick';
import { findAll } from '../src/core/search';
import { full, HAS_FULL } from './helpers';

/** Yksinkertainen ortografinen 3D-projektio (kääntö y-akselin ympäri) testiä varten. */
function project3D(n: number, yaw: number, view: View2D) {
  const p = mapIndex(n);
  const x = p.x * Math.cos(yaw) + p.z * Math.sin(yaw);
  const z = -p.x * Math.sin(yaw) + p.z * Math.cos(yaw);
  const s = worldToScreen(view, x, p.y);
  return { ...s, depth: z };
}

describe.skipIf(!HAS_FULL)('valinnan synkronointi kartoissa', () => {
  const d = full();
  const terms = [
    { id: 'ida', code: '432' },
    { id: 'matti', code: '62884' },
    { id: 'mini', code: '6464' },
  ];
  const hits = terms.flatMap((t) => findAll(t.code, d).map((n) => ({ termId: t.id, n, len: t.code.length })));
  const targets = [
    { termId: 'ida', n: 858511 },
    { termId: 'matti', n: 858260 },
    { termId: 'mini', n: 858960 },
  ];

  const maps: { name: string; place: (n: number) => { sx: number; sy: number; depth?: number } }[] = [];
  // spiraali, zoomattuna ankkurin ympäristöön
  const a2 = vogel(858511);
  const spiral: View2D = { cx: a2.x, cy: a2.y, scale: 6, width: 400, height: 700 };
  maps.push({ name: 'spiraali', place: (n) => { const p = vogel(n); return worldToScreen(spiral, p.x, p.y); } });
  for (const [name, L] of [['atlas', atlasLayout(2)], ['verkko', netLayout(true)]] as const) {
    const v = fitView(L.bbox, 400 * 6, 700 * 6); // tarkka zoomaus, jotta 1054 IDA-osumaa erottuvat
    maps.push({ name, place: (n) => { const q = placeOnLayout(L, mapIndex(n)); return worldToScreen(v, q.x, q.y); } });
  }
  const v3: View2D = { cx: 0, cy: 0, scale: 2400, width: 4000, height: 4000 };
  maps.push({ name: '3D', place: (n) => project3D(n, 0.7, v3) });

  for (const m of maps) {
    it(`${m.name}: napautus osuman kohdalle palauttaa saman n:n`, () => {
      const items: PickItem[] = hits.map((h) => ({ termId: h.termId, n: h.n, r: 2, ...m.place(h.n) }));
      for (const t of targets) {
        const s = m.place(t.n);
        const picked = pickNearest(items, s.sx, s.sy, 10);
        expect(picked).not.toBeNull();
        expect(picked!.n).toBe(t.n);
        expect(picked!.termId).toBe(t.termId);
      }
    });
  }

  it('1D-kontekstin numerot ovat lähdeaineiston mukaiset', () => {
    for (const t of targets) {
      const code = terms.find((x) => x.id === t.termId)!.code;
      const ctx = sliceContext(d, t.n, code.length, 30, 30);
      expect(ctx.text).toBe(d.slice(ctx.start - 1, ctx.end));
      expect(ctx.text.slice(t.n - ctx.start, t.n - ctx.start + code.length)).toBe(code);
      expect(digitsAt(d, t.n, code.length)).toBe(code);
    }
  });
});
