// Fibonacci-luvut F_1 = F_2 = 1, F_k = F_(k-1) + F_(k-2). Indeksierojen tarkasteluun.

export const PHI = (1 + Math.sqrt(5)) / 2;

/** FIB[k] = F_k, k = 0…60 (F_0 = 0). */
export const FIB: number[] = (() => {
  const f = [0, 1];
  while (f.length < 61) f.push(f[f.length - 1] + f[f.length - 2]);
  return f;
})();

/** Jos d on Fibonacci-luku, palauttaa sen suurimman k:n (F_2 = 1, joten d=1 → k=2). */
export function fibIndexOf(d: number): number | null {
  if (!Number.isInteger(d) || d < 1) return null;
  for (let k = FIB.length - 1; k >= 2; k--) if (FIB[k] === d) return k;
  return null;
}

export interface NearestFib {
  k: number;
  F: number;
  delta: number;
  exact: boolean;
}

/** Lähin Fibonacci-luku positiiviselle erolle d. */
export function nearestFib(d: number): NearestFib {
  const a = Math.abs(d);
  let best = 2;
  for (let k = 2; k < FIB.length; k++) {
    if (Math.abs(FIB[k] - a) < Math.abs(FIB[best] - a)) best = k;
    if (FIB[k] > a) break;
  }
  return { k: best, F: FIB[best], delta: a - FIB[best], exact: FIB[best] === a };
}

export interface FibNeighbor {
  k: number;
  F: number;
  minus: number | null;
  plus: number | null;
}

/** Indeksit n ± F_k aineiston rajoissa 1…N. */
export function fibNeighbors(n: number, N: number, kMin = 2, kMax = 40): FibNeighbor[] {
  const out: FibNeighbor[] = [];
  let lastF = -1;
  for (let k = Math.max(2, kMin); k <= kMax && k < FIB.length; k++) {
    const F = FIB[k];
    if (F === lastF) continue;
    lastF = F;
    const minus = n - F >= 1 ? n - F : null;
    const plus = n + F <= N ? n + F : null;
    if (minus === null && plus === null) break;
    out.push({ k, F, minus, plus });
  }
  return out;
}

/**
 * Vogelin spiraalissa indeksin n lähimmät naapurit ovat Fibonacci-etäisyyksillä, joiden
 * suuruusluokka on noin √(5n). Palauttaa sitä vastaavan k:n.
 */
export function localParastichyK(n: number): number {
  const target = Math.sqrt(5 * Math.max(1, n));
  let best = 2;
  for (let k = 2; k < FIB.length; k++) {
    if (Math.abs(Math.log(FIB[k] / target)) < Math.abs(Math.log(FIB[best] / target))) best = k;
    if (FIB[k] > target * 4) break;
  }
  return best;
}
