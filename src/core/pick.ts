// Yhteinen valintalogiikka kaikille kartoille: napautus → lähin osuma → alkuperäinen indeksi n.

export interface View2D {
  /** Näkymän keskipiste maailmakoordinaateissa. */
  cx: number;
  cy: number;
  /** Pikseliä per maailmayksikkö. */
  scale: number;
  width: number;
  height: number;
}

export function worldToScreen(v: View2D, x: number, y: number): { sx: number; sy: number } {
  return { sx: v.width / 2 + (x - v.cx) * v.scale, sy: v.height / 2 - (y - v.cy) * v.scale };
}

export function screenToWorld(v: View2D, sx: number, sy: number): { x: number; y: number } {
  return { x: v.cx + (sx - v.width / 2) / v.scale, y: v.cy - (sy - v.height / 2) / v.scale };
}

/** Sovittaa maailman suorakulmion näkymään marginaalilla. */
export function fitView(
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
  width: number,
  height: number,
  margin = 24,
): View2D {
  const w = Math.max(1e-9, bbox.maxX - bbox.minX);
  const h = Math.max(1e-9, bbox.maxY - bbox.minY);
  const scale = Math.min((width - 2 * margin) / w, (height - 2 * margin) / h);
  return { cx: (bbox.minX + bbox.maxX) / 2, cy: (bbox.minY + bbox.maxY) / 2, scale, width, height };
}

export interface PickItem {
  termId: string;
  n: number;
  /** Näyttökoordinaatit. */
  sx: number;
  sy: number;
  /** Merkin säde pikseleinä (isommat merkit on helpompi osua). */
  r: number;
  /** Syvyys (3D): pienempi = lähempänä kameraa. */
  depth?: number;
}

/** Lähin osuma napautuskohtaan. Etäisyydestä vähennetään merkin säde. */
export function pickNearest(items: Iterable<PickItem>, qx: number, qy: number, maxDist = 28): PickItem | null {
  let best: PickItem | null = null;
  let bestScore = Infinity;
  for (const it of items) {
    const d = Math.hypot(it.sx - qx, it.sy - qy) - it.r;
    const score = d + (it.depth ?? 0) * 1e-3;
    if (d <= maxDist && score < bestScore) {
      best = it;
      bestScore = score;
    }
  }
  return best;
}
