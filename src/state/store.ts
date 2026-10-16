import { useSyncExternalStore } from 'react';
import type { DatasetInfo } from '../core/digits';
import type { EngineMode } from '../engine/client';
import type {
  Anchor,
  AuditEntry,
  HitRef,
  LifeEvent,
  PreRegistration,
  SearchTerm,
  TestRun,
} from '../core/types';
import { initialMatrixState, type MatrixState } from './matrix';

export type Tab = 'space' | 'map' | 'digits' | 'tests' | 'matrix';
export type MapMode = 'spiral' | 'atlas' | 'net';
export type PanelId = 'terms' | 'neighbors' | 'events';

export interface TermHits {
  status: 'searching' | 'ready' | 'error';
  code: string;
  hits: Int32Array;
  count: number;
  expected: number;
  positions: number;
  truncated: boolean;
  ms: number;
  error?: string;
}

export interface Prefs {
  showSamples: boolean;
  showPath: boolean;
  colorBy: 'term' | 'index';
  /** Näytä 3D:ssä vain osumat ankkurin ±ikkunassa (null = kaikki). */
  indexWindow: number | null;
  contextWidth: number;
  autoRotate: boolean;
}

export interface AppState {
  dataset: {
    status: 'loading' | 'ready' | 'error';
    info: DatasetInfo | null;
    error: string | null;
    progress: number;
    source: 'bundled' | 'imported';
  };
  digits: string;
  engineMode: EngineMode;
  terms: SearchTerm[];
  hits: Record<string, TermHits>;
  anchor: Anchor;
  selection: HitRef | null;
  /** Vapaa tarkastelukohta 1D-näkymässä (kun valittuna ei ole osumaa). */
  focusN: number | null;
  tab: Tab;
  mapMode: MapMode;
  spaceMode: 'octa' | 'legacy';
  panel: PanelId | null;
  sheetExpanded: boolean;
  notes: Record<string, string>;
  events: LifeEvent[];
  audit: AuditEntry[];
  prereg: PreRegistration[];
  runs: TestRun[];
  prefs: Prefs;
  toast: { text: string; id: number } | null;
  /** Recursive Story Matrix (docs/MATRIISI.md): tarinamalli, reitti, tallennetut reitit, loki ja reittitestit. */
  matrix: MatrixState;
}

type Listener = () => void;

export interface Store<T> {
  get(): T;
  set(patch: Partial<T> | ((s: T) => Partial<T>)): void;
  subscribe(l: Listener): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => state,
    set(patch) {
      const p = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...p };
      for (const l of listeners) l();
    },
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

export const DEFAULT_ANCHOR: Anchor = {
  termId: 'ida',
  n: 858511,
  label: 'IDA',
  code: '432',
  setAt: '2025-01-01T00:00:00.000Z',
};

const now = () => new Date().toISOString();

function term(
  id: string,
  label: string,
  value: string,
  kind: SearchTerm['kind'],
  encoding: SearchTerm['encoding'],
  color: string,
  visible: boolean,
): SearchTerm {
  return {
    id,
    label,
    value,
    kind,
    encoding,
    scandi: 'none',
    uppercase: true,
    color,
    visible,
    mode: 'contiguous',
    createdAt: now(),
    builtin: true,
  };
}

export const DEFAULT_TERMS: SearchTerm[] = [
  term('ida', 'IDA', 'IDA', 'nimi', 'T9', '#72e1d1', true),
  term('matti', 'MATTI', 'MATTI', 'nimi', 'T9', '#f4c56b', true),
  term('mini', 'MINI', 'MINI', 'nimi', 'T9', '#bd9bff', true),
  term('m23', '23', '23', 'numerojono', 'RAW', '#8fb6ff', false),
  term('m43', '43', '43', 'numerojono', 'RAW', '#ff9db4', false),
  term('m4444', '4444', '4444', 'numerojono', 'RAW', '#86e3a8', false),
  term('m1414', '1414', '1414', 'numerojono', 'RAW', '#ffb070', false),
  term('m4141', '4141', '4141', 'numerojono', 'RAW', '#e6a3ff', false),
];

export const DEFAULT_PREFS: Prefs = {
  showSamples: true,
  showPath: true,
  colorBy: 'term',
  indexWindow: null,
  contextWidth: 60,
  autoRotate: false,
};

export const store = createStore<AppState>({
  dataset: { status: 'loading', info: null, error: null, progress: 0, source: 'bundled' },
  digits: '',
  engineMode: 'starting',
  terms: DEFAULT_TERMS,
  hits: {},
  anchor: DEFAULT_ANCHOR,
  selection: { termId: DEFAULT_ANCHOR.termId, n: DEFAULT_ANCHOR.n },
  focusN: null,
  tab: 'space',
  mapMode: 'spiral',
  spaceMode: 'octa',
  panel: null,
  sheetExpanded: false,
  notes: {},
  events: [],
  audit: [],
  prereg: [],
  runs: [],
  prefs: DEFAULT_PREFS,
  toast: null,
  matrix: initialMatrixState(),
});

export function useApp<U>(selector: (s: AppState) => U): U {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()), () => selector(store.get()));
}
