import { describe, expect, it } from 'vitest';
import { findAll } from '../src/core/search';
import {
  barycentric,
  chordDistance,
  faceBits,
  faceNumber,
  faceRelation,
  GAMMA,
  legacyMapIndex,
  mapIndex,
  sphereDir,
  toP4,
  toP5,
  vogel,
} from '../src/core/mapping';
import { atlasLayout, netLayout, placeOnLayout, unplace } from '../src/core/net';
import { randomDigits } from '../src/core/random';
import { full, HAS_FULL } from './helpers';

const SAMPLE = Array.from({ length: 20000 }, (_, i) => 1 + i * 50);

describe('3D-oktaedrikartoitus', () => {
  it('jokainen piste on oktaedrin pinnalla |x|+|y|+|z| ≈ 1', () => {
    for (const n of [1, 2, 3, 48227, 858260, 858511, 858960, 874141, 999_999, 1_000_000, 9_999_999, ...SAMPLE]) {
      const p = mapIndex(n);
      expect(Math.abs(Math.abs(p.x) + Math.abs(p.y) + Math.abs(p.z) - 1)).toBeLessThan(1e-12);
    }
  });

  it('pallosuunta u on yksikkövektori ja z noudattaa kaavaa', () => {
    const n = 858511;
    const u = sphereDir(n);
    expect(Math.hypot(u.x, u.y, u.z)).toBeCloseTo(1, 12);
    const a = Math.SQRT2 - 1;
    const z = 2 * (n * a + 0.5 - Math.floor(n * a + 0.5)) - 1;
    expect(u.z).toBe(z);
    expect(Math.atan2(u.y, u.x)).toBeCloseTo(Math.atan2(Math.sin(n * GAMMA), Math.cos(n * GAMMA)), 12);
  });

  it('mapIndex ei hyväksy kokonaismäärää N argumenttina', () => {
    expect(mapIndex.length).toBe(1);
    expect(legacyMapIndex.length).toBe(2);
  });

  it.skipIf(!HAS_FULL)('vakainvarianssi: mapIndex(858511) ei muutu, kun aineisto kasvaa 1M → 10M', () => {
    const d1 = full();
    const before = mapIndex(858511);
    // 10M-aineisto: todellinen 1M + 9M siemenellistä täytettä (oikeaa 10M-piitä ei ole ympäristössä)
    const d10 = d1 + randomDigits(9_000_000, 2025);
    expect(d10.length).toBe(10_000_000);
    expect(findAll('432', d10.slice(0, 1_000_010))).toContain(858511);
    const after = mapIndex(858511);
    expect(after).toEqual(before);
    expect(Object.is(after.x, before.x) && Object.is(after.y, before.y) && Object.is(after.z, before.z)).toBe(true);
    // Vanha malli siirtää samaa pistettä, kun N muuttuu:
    const l1 = legacyMapIndex(858511, d1.length);
    const l10 = legacyMapIndex(858511, d10.length);
    expect(chordDistance(l1, l10)).toBeGreaterThan(0.1);
  });

  it('sama piste saa saman kolmioseinämän myös toisella kerralla', () => {
    const first = SAMPLE.map((n) => faceBits(mapIndex(n)));
    const second = SAMPLE.map((n) => faceBits(mapIndex(n)));
    expect(second).toEqual(first);
    // jokainen kahdeksasta pinnasta esiintyy
    expect(new Set(first).size).toBe(8);
    // nollakoordinaatti tulkitaan aina positiiviseksi
    expect(faceBits({ x: 0, y: -0, z: 0.5 })).toBe(0);
    expect(faceNumber({ x: -0.2, y: -0.3, z: -0.5 })).toBe(7);
  });

  it('pintasuhteet: sama, reuna-, kärkinaapuri, vastakkainen', () => {
    expect(faceRelation(0, 0)).toBe('sama');
    expect(faceRelation(0, 4)).toBe('reunanaapuri');
    expect(faceRelation(0, 3)).toBe('kärkinaapuri');
    expect(faceRelation(0, 7)).toBe('vastakkainen');
  });

  it('barysentriset koordinaatit summautuvat ykköseen', () => {
    for (const n of SAMPLE.slice(0, 500)) {
      const b = barycentric(mapIndex(n));
      expect(b[0] + b[1] + b[2]).toBeCloseTo(1, 12);
      expect(Math.min(...b)).toBeGreaterThanOrEqual(0);
    }
  });

  it('P4 ja P5: viides arvo on null ilman linkitettyä tapahtumaa', () => {
    const p4 = toP4(858511);
    expect(p4[3]).toBe(858511);
    const p5 = toP5(858511, null);
    expect(p5[4]).toBeNull();
    expect(toP5(858511, 1_400_000_000_000)[4]).toBe(1_400_000_000_000);
  });
});

describe('2D: kultaisen kulman spiraali', () => {
  it('r = √n ja θ = n·π(3−√5)', () => {
    const n = 858511;
    const p = vogel(n);
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(Math.sqrt(n), 9);
    expect(GAMMA).toBeCloseTo(2.399963229728653, 15);
  });
});

describe('avattu oktaedri ja 8 kolmion atlas', () => {
  const layouts = [atlasLayout(2), atlasLayout(4), netLayout(false), netLayout(true)];

  it('kolmiot ovat tasasivuisia (sivu 1)', () => {
    for (const L of layouts)
      for (const f of L.faces) {
        expect(Math.hypot(f.X.x - f.Y.x, f.X.y - f.Y.y)).toBeCloseTo(1, 9);
        expect(Math.hypot(f.Y.x - f.Z.x, f.Y.y - f.Z.y)).toBeCloseTo(1, 9);
        expect(Math.hypot(f.Z.x - f.X.x, f.Z.y - f.X.y)).toBeCloseTo(1, 9);
      }
  });

  it('verkossa on 7 taitosta ja 5 leikattua särmää, jotka esiintyvät kahdesti', () => {
    const net = netLayout();
    expect(net.edges.filter((e) => e.kind === 'fold').length).toBe(7);
    const cuts = net.edges.filter((e) => e.kind === 'cut');
    expect(cuts.length).toBe(10);
    const byLabel = new Map<string, number>();
    for (const c of cuts) byLabel.set(c.label!, (byLabel.get(c.label!) ?? 0) + 1);
    expect(byLabel.size).toBe(5);
    for (const v of byLabel.values()) expect(v).toBe(2);
  });

  it('verkon kolmiot eivät mene päällekkäin', () => {
    const net = netLayout();
    const inside = (q: { x: number; y: number }, f: (typeof net.faces)[number]) => {
      const s = (a: { x: number; y: number }, b: { x: number; y: number }) => (b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x);
      const d1 = s(f.X, f.Y), d2 = s(f.Y, f.Z), d3 = s(f.Z, f.X);
      return (d1 > 1e-9 && d2 > 1e-9 && d3 > 1e-9) || (d1 < -1e-9 && d2 < -1e-9 && d3 < -1e-9);
    };
    for (let a = 0; a < 8; a++)
      for (let b = 0; b < 8; b++) if (a !== b) expect(inside(net.faces[a].centroid, net.faces[b])).toBe(false);
  });

  it('osuma sijoittuu omaan kolmioonsa ja palautuu samaksi 3D-pisteeksi', () => {
    for (const L of layouts)
      for (const n of [858260, 858511, 858960, 874141, ...SAMPLE.slice(0, 300)]) {
        const p = mapIndex(n);
        const q = placeOnLayout(L, p);
        const back = unplace(L, q)!;
        expect(back).not.toBeNull();
        expect(faceBits(back)).toBe(faceBits(p));
        expect(chordDistance(back, p)).toBeLessThan(1e-9);
      }
  });
});
