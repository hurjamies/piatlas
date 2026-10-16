// Oktaedrin kahdeksan kolmioseinämää tasossa.
//  - atlasLayout: kahdeksan erillistä, nimettyä kolmiota. Saman kvadrantin ylä- ja alapinta ovat
//    vastakkain yhteisen päiväntasaajasärmän (X–Y) kautta.
//  - netLayout: geometrisesti oikein avattu, yhtenäinen verkko (tasasivuiset kolmiot). Verkko taitetaan
//    virittävän puun mukaan; leikatut särmät esiintyvät kahdesti ja saavat saman kirjaintunnuksen.
// Pisteet sijoitetaan oman kolmionsa barysentrisillä koordinaateilla (|x|, |y|, |z|).

import { FACE_TO_BITS, faceBits, faceName, faceSigns, Vec2, Vec3 } from './mapping';

export type VertexId = 'X+' | 'X-' | 'Y+' | 'Y-' | 'Z+' | 'Z-';

export interface FaceLayout {
  bits: number;
  /** Kolmion kärjet: pinnan ±X-, ±Y- ja ±Z-kärki. */
  X: Vec2;
  Y: Vec2;
  Z: Vec2;
  centroid: Vec2;
  name: string;
}

export interface LayoutEdge {
  a: Vec2;
  b: Vec2;
  kind: 'fold' | 'cut';
  /** 3D-särmän päätepisteet. */
  ends: [VertexId, VertexId];
  /** Leikatun särmän tunnus (sama kirjain kummassakin kohdassa). */
  label?: string;
  face: number;
}

export interface VertexMark {
  pos: Vec2;
  id: VertexId;
}

export interface Layout {
  kind: 'atlas' | 'net';
  faces: FaceLayout[]; // indeksi = pinnan bittikoodi
  edges: LayoutEdge[];
  vertices: VertexMark[];
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}

const H = Math.sqrt(3) / 2;

export function faceVertexIds(bits: number): { X: VertexId; Y: VertexId; Z: VertexId } {
  const [sx, sy, sz] = faceSigns(bits);
  return {
    X: sx > 0 ? 'X+' : 'X-',
    Y: sy > 0 ? 'Y+' : 'Y-',
    Z: sz > 0 ? 'Z+' : 'Z-',
  };
}

const centroid = (a: Vec2, b: Vec2, c: Vec2): Vec2 => ({ x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 });

function bboxOf(faces: FaceLayout[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const f of faces)
    for (const v of [f.X, f.Y, f.Z]) {
      minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
    }
  return { minX, minY, maxX, maxY };
}

function makeFace(bits: number, X: Vec2, Y: Vec2, Z: Vec2): FaceLayout {
  return { bits, X, Y, Z, centroid: centroid(X, Y, Z), name: faceName(bits) };
}

/**
 * Atlas: jokainen kvadrantti (±x, ±y) on vinoneliö, jonka yläkolmio on z+-pinta ja alakolmio z−-pinta.
 * cols = 4 (leveä näyttö) tai 2 (puhelin pystyssä).
 */
export function atlasLayout(cols: 2 | 4 = 2): Layout {
  const gapX = 0.5;
  const gapY = 0.34;
  const gapPair = 0.06; // ylä- ja alakolmion väli: kolmiot ovat erillisiä
  const faces: FaceLayout[] = new Array(8);
  const edges: LayoutEdge[] = [];
  const vertices: VertexMark[] = [];
  for (let q = 0; q < 4; q++) {
    const upper = FACE_TO_BITS[q]; // F1..F4
    const lower = FACE_TO_BITS[q + 4]; // F5..F8
    const col = q % cols;
    const row = Math.floor(q / cols);
    const ox = col * (1 + gapX);
    const oy = -row * (2 * H + gapPair + gapY);
    // yläpinta: X vasen ala, Y oikea ala, Z ylhäällä
    const uX = { x: ox, y: oy }, uY = { x: ox + 1, y: oy }, uZ = { x: ox + 0.5, y: oy + H };
    const lX = { x: ox, y: oy - gapPair }, lY = { x: ox + 1, y: oy - gapPair }, lZ = { x: ox + 0.5, y: oy - gapPair - H };
    faces[upper] = makeFace(upper, uX, uY, uZ);
    faces[lower] = makeFace(lower, lX, lY, lZ);
    for (const bits of [upper, lower]) {
      const f = faces[bits];
      const ids = faceVertexIds(bits);
      vertices.push({ pos: f.X, id: ids.X }, { pos: f.Y, id: ids.Y }, { pos: f.Z, id: ids.Z });
      edges.push(
        { a: f.X, b: f.Y, kind: 'cut', ends: [ids.X, ids.Y], face: bits },
        { a: f.Y, b: f.Z, kind: 'cut', ends: [ids.Y, ids.Z], face: bits },
        { a: f.Z, b: f.X, kind: 'cut', ends: [ids.Z, ids.X], face: bits },
      );
    }
  }
  return { kind: 'atlas', faces, edges, vertices, bbox: bboxOf(faces) };
}

// --------------------------------------------------------------------- avattu verkko

/** Virittävä puu: [lapsi, vanhempi] pinnan F-numeroina. Yläpinnat tuuletin +Z:n ympäri, alapinnat päiväntasaajasärmillä. */
const NET_TREE: [number, number][] = [
  [2, 1], [3, 2], [4, 3], // F2–F4 kiinni edelliseen yhteisellä +Z-särmällä
  [5, 1], [6, 2], [7, 3], [8, 4], // alapinnat kiinni omaan yläpintaansa X–Y-särmällä
];

function reflect(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
  const fx = a.x + t * dx, fy = a.y + t * dy;
  return { x: 2 * fx - p.x, y: 2 * fy - p.y };
}

function edgeKey(a: VertexId, b: VertexId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** portrait = true kääntää verkon pystyyn (puhelin), muuten tuuletin aukeaa ylöspäin. */
export function netLayout(portrait = false): Layout {
  const pos: Record<number, Partial<Record<VertexId, Vec2>>> = {};
  const fBits = (F: number) => FACE_TO_BITS[F - 1];
  // Juuri F1: +Z keskellä, +X oikealla, +Y 60° kulmassa.
  const root = fBits(1);
  pos[root] = { 'Z+': { x: 0, y: 0 }, 'X+': { x: 1, y: 0 }, 'Y+': { x: 0.5, y: H } };
  const folds = new Set<string>();
  for (const [childF, parentF] of NET_TREE) {
    const c = fBits(childF), p = fBits(parentF);
    const cid = faceVertexIds(c), pid = faceVertexIds(p);
    const cv = [cid.X, cid.Y, cid.Z];
    const pv = [pid.X, pid.Y, pid.Z];
    const shared = cv.filter((v) => pv.includes(v));
    const pThird = pv.find((v) => !shared.includes(v))!;
    const cThird = cv.find((v) => !shared.includes(v))!;
    const pp = pos[p]!;
    const placed: Partial<Record<VertexId, Vec2>> = {};
    for (const s of shared) placed[s] = pp[s]!;
    placed[cThird] = reflect(pp[pThird]!, pp[shared[0]]!, pp[shared[1]]!);
    pos[c] = placed;
    folds.add(`${c}:${edgeKey(shared[0], shared[1])}`);
    folds.add(`${p}:${edgeKey(shared[0], shared[1])}`);
  }
  // Käännetään verkkoa niin, että tuulettimen symmetria-akseli osoittaa ylöspäin (tai vasemmalle pystynäytöllä).
  const rot = Math.PI / 2 - (2 * Math.PI) / 3 + (portrait ? Math.PI / 2 : 0); // tuuletin kattaa 0…240°, keskikulma 120°
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const R = (v: Vec2): Vec2 => ({ x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos });
  const faces: FaceLayout[] = new Array(8);
  for (let bits = 0; bits < 8; bits++) {
    const ids = faceVertexIds(bits);
    const P = pos[bits]!;
    faces[bits] = makeFace(bits, R(P[ids.X]!), R(P[ids.Y]!), R(P[ids.Z]!));
  }
  // Särmät: taitos (puun särmä) tai leikkaus (esiintyy kahdesti → sama kirjain).
  const cutLabels = new Map<string, string>();
  const letters = 'abcdefghij';
  const edges: LayoutEdge[] = [];
  const vertices: VertexMark[] = [];
  for (let F = 1; F <= 8; F++) {
    const bits = fBits(F);
    const f = faces[bits];
    const ids = faceVertexIds(bits);
    const list: [VertexId, Vec2, VertexId, Vec2][] = [
      [ids.X, f.X, ids.Y, f.Y],
      [ids.Y, f.Y, ids.Z, f.Z],
      [ids.Z, f.Z, ids.X, f.X],
    ];
    for (const [ia, a, ib, b] of list) {
      const key = edgeKey(ia, ib);
      const isFold = folds.has(`${bits}:${key}`);
      let label: string | undefined;
      if (!isFold) {
        if (!cutLabels.has(key)) cutLabels.set(key, letters[cutLabels.size]);
        label = cutLabels.get(key);
      }
      edges.push({ a, b, kind: isFold ? 'fold' : 'cut', ends: [ia, ib], label, face: bits });
    }
    vertices.push({ pos: f.X, id: ids.X }, { pos: f.Y, id: ids.Y }, { pos: f.Z, id: ids.Z });
  }
  // Taitossärmät esiintyvät kahdesti (kummankin pinnan listassa) — pidetään yksi.
  const seen = new Set<string>();
  const dedup = edges.filter((e) => {
    if (e.kind === 'cut') return true;
    const k = `${edgeKey(e.ends[0], e.ends[1])}:${Math.round((e.a.x + e.b.x) * 1000)}:${Math.round((e.a.y + e.b.y) * 1000)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  // Kärjet: sama 3D-kärki voi esiintyä usein; poistetaan päällekkäiset merkinnät.
  const vseen = new Set<string>();
  const vdedup = vertices.filter((v) => {
    const k = `${v.id}:${Math.round(v.pos.x * 1000)}:${Math.round(v.pos.y * 1000)}`;
    if (vseen.has(k)) return false;
    vseen.add(k);
    return true;
  });
  return { kind: 'net', faces, edges: dedup, vertices: vdedup, bbox: bboxOf(faces) };
}

/** Oktaedrin pisteen sijainti asettelussa (deterministinen, barysentrinen). */
export function placeOnLayout(layout: Layout, p: Vec3): Vec2 {
  const f = layout.faces[faceBits(p)];
  const ax = Math.abs(p.x), ay = Math.abs(p.y), az = Math.abs(p.z);
  return {
    x: ax * f.X.x + ay * f.Y.x + az * f.Z.x,
    y: ax * f.X.y + ay * f.Y.y + az * f.Z.y,
  };
}

/** Barysentriset koordinaatit takaisin: tason piste → oktaedrin piste (jos piste on jonkin kolmion sisällä). */
export function unplace(layout: Layout, q: Vec2): Vec3 | null {
  for (let bits = 0; bits < 8; bits++) {
    const f = layout.faces[bits];
    const det = (f.Y.y - f.Z.y) * (f.X.x - f.Z.x) + (f.Z.x - f.Y.x) * (f.X.y - f.Z.y);
    const l1 = ((f.Y.y - f.Z.y) * (q.x - f.Z.x) + (f.Z.x - f.Y.x) * (q.y - f.Z.y)) / det;
    const l2 = ((f.Z.y - f.X.y) * (q.x - f.Z.x) + (f.X.x - f.Z.x) * (q.y - f.Z.y)) / det;
    const l3 = 1 - l1 - l2;
    if (l1 >= -1e-9 && l2 >= -1e-9 && l3 >= -1e-9) {
      const [sx, sy, sz] = faceSigns(bits);
      return { x: sx * l1, y: sy * l2, z: sz * l3 };
    }
  }
  return null;
}

/** 3D-kärkien koordinaatit. */
export const VERTEX_POS: Record<VertexId, Vec3> = {
  'X+': { x: 1, y: 0, z: 0 },
  'X-': { x: -1, y: 0, z: 0 },
  'Y+': { x: 0, y: 1, z: 0 },
  'Y-': { x: 0, y: -1, z: 0 },
  'Z+': { x: 0, y: 0, z: 1 },
  'Z-': { x: 0, y: 0, z: -1 },
};
