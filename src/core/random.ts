// Siemenellinen, toistettava satunnaislukugeneraattori (xoshiro128**, alustus splitmix32).
// Sama siemen → täsmälleen sama jono kaikilla laitteilla.

export interface Rng {
  nextU32(): number;
  /** Tasajakautunut kokonaisluku väliltä [lo, hi] (hylkäysotanta, ei modulovinoumaa). */
  int(lo: number, hi: number): number;
  /** Liukuluku väliltä [0, 1). */
  float(): number;
}

function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

export function createRng(seed: number): Rng {
  const sm = splitmix32(seed);
  let a = sm(), b = sm(), c = sm(), d = sm();
  if ((a | b | c | d) === 0) a = 1;
  const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;
  const nextU32 = (): number => {
    const result = Math.imul(rotl(Math.imul(b, 5) >>> 0, 7), 9) >>> 0;
    const t = (b << 9) >>> 0;
    c ^= a; d ^= b; b ^= c; a ^= d;
    c ^= t;
    d = rotl(d, 11);
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    return result;
  };
  const int = (lo: number, hi: number): number => {
    const range = hi - lo + 1;
    if (range <= 0 || range > 0x100000000) throw new Error('int: virheellinen väli');
    const limit = 0x100000000 - (0x100000000 % range);
    let v = nextU32();
    while (v >= limit) v = nextU32();
    return lo + (v % range);
  };
  const float = (): number => nextU32() / 0x100000000;
  return { nextU32, int, float };
}

/** Siemen tekstistä (FNV-1a 32-bit). Numerot käytetään sellaisenaan. */
export function seedFrom(input: string | number): number {
  if (typeof input === 'number' && Number.isFinite(input)) return input >>> 0;
  const s = String(input).trim();
  if (/^\d+$/.test(s) && Number(s) < 0x100000000) return Number(s) >>> 0;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Siemenellinen satunnainen 0–9-merkkijono (lisäkontrolli piin rinnalle). */
export function randomDigits(N: number, seed: number): string {
  const rng = createRng(seed);
  const buf = new Uint8Array(N);
  let i = 0;
  // Yhdestä 32-bittisestä arvosta saadaan 9 desimaalia, kun arvo < 4 000 000 000 (hylkäysotanta).
  while (i < N) {
    const v = rng.nextU32();
    if (v >= 4_000_000_000) continue;
    let x = v % 1_000_000_000;
    for (let k = 0; k < 9 && i < N; k++) {
      buf[i++] = 48 + (x % 10);
      x = Math.floor(x / 10);
    }
  }
  return new TextDecoder('latin1').decode(buf);
}
