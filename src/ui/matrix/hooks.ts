import { useMemo } from 'react';
import { describe } from '../../core/matrix/expand';
import type { MatrixEnv, NodeInfo } from '../../core/matrix/types';
import { nodeKey } from '../../core/matrix/types';
import { matrixEnvOf } from '../../state/matrix';
import { useApp } from '../../state/store';

/** Matriisin ympäristö: aineisto, tarina, ankkuri, suunta ja tapahtumat. Muistetaan, ettei avausta lasketa turhaan. */
export function useMatrixEnv(): MatrixEnv {
  const digits = useApp((s) => s.digits);
  const story = useApp((s) => s.matrix.story);
  const direction = useApp((s) => s.matrix.direction);
  const anchor = useApp((s) => s.anchor);
  const events = useApp((s) => s.events);
  return useMemo(() => matrixEnvOf({ digits, anchor, events }, { story, direction }), [digits, story, direction, anchor, events]);
}

/** Reitin solmuavaimet (indeksi reitillä) ja vieraillut solmut. */
export function useTrailSets() {
  const trail = useApp((s) => s.matrix.trail);
  const visitedList = useApp((s) => s.matrix.visited);
  const onTrail = useMemo(() => new Map(trail.map((st, i) => [nodeKey(st.ref), i])), [trail]);
  const visited = useMemo(() => new Set(visitedList), [visitedList]);
  return { trail, onTrail, visited };
}

/** Murupolun solmujen tiedot (otsikot) ilman särmiä. */
export function useTrailInfo(env: MatrixEnv): NodeInfo[] {
  const trail = useApp((s) => s.matrix.trail);
  return useMemo(() => trail.map((st) => describe(st.ref, env)), [trail, env]);
}
