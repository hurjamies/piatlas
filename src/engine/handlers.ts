// Moottorin käsittelijät. Sama koodi ajetaan Web Workerissa tai varapolkuna pääsäikeessä.

import { RouteTestParams, RouteTestResult, runRouteTest } from '../core/matrix/route-test';
import { findAllDetailed, findSkip, startPositions } from '../core/search';
import { MCParams, MCResult, RandomControlParams, RandomControlResult, RunHooks, runMonteCarlo, runRandomControl } from '../core/stats';

export interface SearchSpec {
  id: string;
  code: string;
  mode: 'contiguous' | 'fibSkip';
  step?: number;
}

export interface SearchResult {
  id: string;
  code: string;
  mode: 'contiguous' | 'fibSkip';
  step?: number;
  hits: Int32Array;
  count: number;
  truncated: boolean;
  expected: number;
  positions: number;
  ms: number;
}

export type EngineRequest =
  | { type: 'ping' }
  | { type: 'setDigits'; digits: string }
  | { type: 'search'; specs: SearchSpec[]; limit?: number }
  | { type: 'monteCarlo'; params: MCParams }
  | { type: 'randomControl'; params: RandomControlParams }
  | { type: 'routeTest'; params: RouteTestParams };

export type EngineResponse<R extends EngineRequest> = R extends { type: 'ping' }
  ? 'pong'
  : R extends { type: 'setDigits' }
    ? { length: number }
    : R extends { type: 'search' }
      ? SearchResult[]
      : R extends { type: 'monteCarlo' }
        ? MCResult
        : R extends { type: 'randomControl' }
          ? RandomControlResult
          : R extends { type: 'routeTest' }
            ? RouteTestResult
            : never;

export interface EngineState {
  digits: string;
}

export const HIT_LIMIT = 250_000;

export async function handleRequest(state: EngineState, req: EngineRequest, hooks: RunHooks = {}): Promise<unknown> {
  switch (req.type) {
    case 'ping':
      return 'pong';
    case 'setDigits':
      state.digits = req.digits;
      return { length: state.digits.length };
    case 'search': {
      const out: SearchResult[] = [];
      const N = state.digits.length;
      for (const s of req.specs) {
        const t0 = Date.now();
        const r =
          s.mode === 'fibSkip' && s.step
            ? findSkip(s.code, state.digits, s.step, req.limit ?? HIT_LIMIT)
            : findAllDetailed(s.code, state.digits, req.limit ?? HIT_LIMIT);
        const span = s.mode === 'fibSkip' && s.step ? (s.code.length - 1) * s.step + 1 : s.code.length;
        out.push({
          id: s.id,
          code: s.code,
          mode: s.mode,
          step: s.step,
          hits: Int32Array.from(r.hits),
          count: r.hits.length,
          truncated: r.truncated,
          // Odotusarvo satunnaisjonossa: alkukohtien määrä / 10^L (hyppypolulla alkukohtia on vähemmän).
          expected: startPositions(N, span) / Math.pow(10, s.code.length),
          positions: startPositions(N, span),
          ms: Date.now() - t0,
        });
      }
      return out;
    }
    case 'monteCarlo':
      return runMonteCarlo(req.params, hooks);
    case 'randomControl':
      return runRandomControl(req.params, state.digits, hooks);
    case 'routeTest':
      return runRouteTest(req.params, hooks);
  }
}
