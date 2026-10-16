/// <reference lib="webworker" />
import { EngineRequest, EngineState, handleRequest } from './handlers';

const state: EngineState = { digits: '' };
const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = async (ev: MessageEvent<{ id: number; req: EngineRequest }>) => {
  const { id, req } = ev.data;
  try {
    const result = await handleRequest(state, req, {
      onProgress: (done, total) => ctx.postMessage({ id, progress: [done, total] }),
    });
    const transfer: Transferable[] = [];
    if (Array.isArray(result)) {
      for (const r of result) if (r && r.hits instanceof Int32Array) transfer.push(r.hits.buffer);
    } else if (result && typeof result === 'object' && 'nullValues' in result) {
      transfer.push((result as { nullValues: Float64Array }).nullValues.buffer);
    }
    ctx.postMessage({ id, ok: true, result }, transfer);
  } catch (e) {
    ctx.postMessage({ id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
};
