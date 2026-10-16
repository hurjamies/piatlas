// Kartoitukset 1-pohjaisesta desimaali-indeksistä n geometriaan.
// TÄRKEÄÄ: mapIndex ja vogel riippuvat VAIN n:stä. Aineiston koko N ei vaikuta pisteisiin,
// joten sama osuma pysyy samassa paikassa, vaikka aineistoa kasvatetaan.

export const GAMMA = Math.PI * (3 - Math.sqrt(5)); // kultainen kulma ≈ 2.39996 rad ≈ 137.5078°
export const A_STEP = Math.SQRT2 - 1; // ≈ 0.41421
/** gamma / 2π = (3 − √5)/2 = 2 − φ — kulma kierroksina. */
export const G_TURNS = (3 - Math.sqrt(5)) / 2;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const fract = (x: number): number => x - Math.floor(x);

export function theta(n: number): number {
  return n * GAMMA;
}

/** Yksikköpallon suunta u(n) ennen oktaedriprojektiota. */
export function sphereDir(n: number): Vec3 {
  const z = 2 * fract(n * A_STEP + 0.5) - 1;
  const t = n * GAMMA;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return { x: r * Math.cos(t), y: r * Math.sin(t), z };
}

function toOcta(u: Vec3): Vec3 {
  const s = Math.abs(u.x) + Math.abs(u.y) + Math.abs(u.z);
  return { x: u.x / s, y: u.y / s, z: u.z / s };
}

/**
 * Oletuskartoitus: N-riippumaton kultaisen kulman / irrationaalisen askelluksen piste oktaedrin
 * pinnalla |x|+|y|+|z| = 1. Funktio ottaa tarkoituksella vain yhden argumentin.
 */
export function mapIndex(n: number): Vec3 {
  return toOcta(sphereDir(n));
}

/**
 * LEGACY: vanhan prototyypin kartoitus z = 1 − 2(n − 0.5)/N. Pisteet siirtyvät, kun N muuttuu.
 * Vain vertailuun.
 */
export function legacyMapIndex(n: number, N: number): Vec3 {
  const z = 1 - (2 * (n - 0.5)) / N;
  const t = n * GAMMA;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return toOcta({ x: r * Math.cos(t), y: r * Math.sin(t), z });
}

// ---------------------------------------------------------------- kolmioseinämät

/** Pinnan bittikoodi: bit0 = x<0, bit1 = y<0, bit2 = z<0. Nolla lasketaan positiiviseksi. */
export function faceBits(p: Vec3): number {
  return (p.x < 0 ? 1 : 0) | (p.y < 0 ? 2 : 0) | (p.z < 0 ? 4 : 0);
}

/** Nimetty järjestys: F1–F4 yläpuolisko (z ≥ 0) vastapäivään +x+y:stä, F5–F8 alapuolisko. */
const BITS_TO_FACE = [1, 2, 4, 3, 5, 6, 8, 7]; // bits → F-numero
export const FACE_TO_BITS = [0, 1, 3, 2, 4, 5, 7, 6]; // (F-numero − 1) → bits

export function faceNumber(p: Vec3): number {
  return BITS_TO_FACE[faceBits(p)];
}

export function faceSigns(bits: number): [1 | -1, 1 | -1, 1 | -1] {
  return [bits & 1 ? -1 : 1, bits & 2 ? -1 : 1, bits & 4 ? -1 : 1];
}

export function faceSignLabel(bits: number): string {
  return faceSigns(bits)
    .map((s) => (s > 0 ? '+' : '−'))
    .join('');
}

export function faceName(bits: number): string {
  return `F${BITS_TO_FACE[bits]} (${faceSignLabel(bits).split('').join(',')})`;
}

export type FaceRelation = 'sama' | 'reunanaapuri' | 'kärkinaapuri' | 'vastakkainen';

/** Kahden pinnan suhde: montako etumerkkiä eroaa (0 = sama, 1 = yhteinen särmä, 2 = yhteinen kärki, 3 = vastakkainen). */
export function faceRelation(a: number, b: number): FaceRelation {
  const d = a ^ b;
  const k = (d & 1) + ((d >> 1) & 1) + ((d >> 2) & 1);
  return (['sama', 'reunanaapuri', 'kärkinaapuri', 'vastakkainen'] as const)[k];
}

/** Barysentriset koordinaatit oman kolmion sisällä: (|x|, |y|, |z|), summa 1. */
export function barycentric(p: Vec3): [number, number, number] {
  return [Math.abs(p.x), Math.abs(p.y), Math.abs(p.z)];
}

/** Euklidinen suora etäisyys 3D:ssä (chord). EI ole oktaedrin pintaa pitkin kulkeva lyhin reitti. */
export function chordDistance(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// ---------------------------------------------------------------- 2D-spiraali

export interface Vec2 {
  x: number;
  y: number;
}

/** Vogelin kuvio: r = √n, θ = n·gamma. */
export function vogel(n: number): Vec2 {
  const r = Math.sqrt(n);
  const t = n * GAMMA;
  return { x: r * Math.cos(t), y: r * Math.sin(t) };
}

export function dist2(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ---------------------------------------------------------------- 4D / 5D -tietomalli

/** P4 = (x, y, z, n). n on piin järjestysindeksi ("π-järjestysaika"), ei fyysinen aika. */
export type P4 = readonly [x: number, y: number, z: number, n: number];
/** P5 = (x, y, z, n, eventTimestamp). Viides arvo on null, ellei käyttäjä ole linkittänyt tapahtumaa. */
export type P5 = readonly [x: number, y: number, z: number, n: number, eventTimestamp: number | null];

export function toP4(n: number): P4 {
  const p = mapIndex(n);
  return [p.x, p.y, p.z, n];
}

export function toP5(n: number, eventTimestamp: number | null): P5 {
  const p = mapIndex(n);
  return [p.x, p.y, p.z, n, eventTimestamp ?? null];
}

// ---------------------------------------------------------------- rakenne-erittely

/**
 * Miksi kaksi indeksiä ovat lähellä toisiaan kartalla? Indeksiero d siirtää
 * kulmaa d·gamma ja z-askelta d·a. Pisteet osuvat lähelle, kun molemmat ovat lähes kokonaislukukierroksia.
 */
export function indexDiffStructure(d: number): { turnFrac: number; zFrac: number; angleDeg: number; zShift: number } {
  const tf = fract(d * G_TURNS);
  const zf = fract(d * A_STEP);
  const turnFrac = tf > 0.5 ? tf - 1 : tf; // −0.5…0.5 kierrosta
  const zfrac = zf > 0.5 ? zf - 1 : zf;
  return { turnFrac, zFrac: zfrac, angleDeg: turnFrac * 360, zShift: 2 * zfrac };
}
