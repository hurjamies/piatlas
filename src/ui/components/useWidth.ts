import { useCallback, useEffect, useState } from 'react';

/**
 * Elementin leveys pikseleinä: kaaviot piirretään todellisella leveydellä, jotta teksti pysyy luettavana
 * puhelimessa. Palauttaa callback-refin, joten se toimii myös myöhemmin ilmestyvälle elementille.
 */
export function useWidth<T extends HTMLElement>(fallback = 360, min = 300) {
  const [el, setEl] = useState<T | null>(null);
  const [w, setW] = useState(fallback);
  const ref = useCallback((node: T | null) => setEl(node), []);
  useEffect(() => {
    if (!el) return;
    const update = () => setW(Math.max(min, Math.round(el.clientWidth)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, min]);
  return [ref, w] as const;
}
