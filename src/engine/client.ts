// Moottorin asiakas. Yrittää ensin Web Workeria; jos se ei käynnisty (esim. rajoitettu kehys),
// sama koodi ajetaan pääsäikeessä pienissä paloissa, jotta käyttöliittymä ei jäädy.

import EngineWorker from './engine.worker?worker&inline';
import { EngineRequest, EngineResponse, EngineState, handleRequest } from './handlers';

type Progress = (done: number, total: number) => void;

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  onProgress?: Progress;
}

export type EngineMode = 'worker' | 'inline' | 'starting';

export class EngineClient {
  mode: EngineMode = 'starting';
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private inlineState: EngineState = { digits: '' };
  private lastDigits = '';
  private ready: Promise<void>;
  private listeners = new Set<(m: EngineMode) => void>();

  constructor() {
    this.ready = this.start();
  }

  onModeChange(fn: (m: EngineMode) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private setMode(m: EngineMode) {
    this.mode = m;
    for (const fn of this.listeners) fn(m);
  }

  private async start(): Promise<void> {
    try {
      const w = new EngineWorker();
      this.worker = w;
      w.onmessage = (ev) => this.onMessage(ev.data);
      w.onerror = (ev) => {
        ev.preventDefault?.();
        this.fallBack(new Error('Worker kaatui: ' + (ev.message || 'tuntematon virhe')));
      };
      const pong = await Promise.race([
        this.post({ type: 'ping' }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Worker ei vastannut')), 4000)),
      ]);
      if (pong !== 'pong') throw new Error('Worker ei vastannut oikein');
      this.setMode('worker');
    } catch {
      this.fallBack(null);
    }
  }

  private fallBack(err: Error | null) {
    if (this.worker) {
      try {
        this.worker.terminate();
      } catch {
        /* ohita */
      }
    }
    this.worker = null;
    for (const p of this.pending.values()) p.reject(err ?? new Error('Worker ei käytettävissä'));
    this.pending.clear();
    this.inlineState.digits = this.lastDigits;
    this.setMode('inline');
  }

  private onMessage(msg: { id: number; ok?: boolean; result?: unknown; error?: string; progress?: [number, number] }) {
    const p = this.pending.get(msg.id);
    if (!p) return;
    if (msg.progress) {
      p.onProgress?.(msg.progress[0], msg.progress[1]);
      return;
    }
    this.pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new Error(msg.error || 'Tuntematon virhe'));
  }

  private post(req: EngineRequest, onProgress?: Progress): Promise<unknown> {
    const w = this.worker;
    if (!w) return Promise.reject(new Error('Worker ei käytettävissä'));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      w.postMessage({ id, req });
    });
  }

  async call<R extends EngineRequest>(req: R, onProgress?: Progress): Promise<EngineResponse<R>> {
    await this.ready;
    if (req.type === 'setDigits') this.lastDigits = req.digits;
    if (this.worker) {
      try {
        return (await this.post(req, onProgress)) as EngineResponse<R>;
      } catch (e) {
        if (this.worker) throw e; // varsinainen laskentavirhe
        // worker kaatui kesken: jatketaan pääsäikeessä
      }
    }
    this.inlineState.digits = this.lastDigits;
    const result = await handleRequest(this.inlineState, req, {
      onProgress,
      yieldEvery: 20,
      yieldFn: () => new Promise((r) => setTimeout(r, 0)),
    });
    return result as EngineResponse<R>;
  }

  /** Keskeyttää käynnissä olevan laskennan (worker käynnistetään uudelleen). */
  async cancel(): Promise<void> {
    if (!this.worker) return;
    this.worker.terminate();
    this.worker = null;
    for (const p of this.pending.values()) p.reject(new Error('Keskeytetty'));
    this.pending.clear();
    this.setMode('starting');
    this.ready = this.start().then(async () => {
      if (this.worker && this.lastDigits) await this.post({ type: 'setDigits', digits: this.lastDigits });
    });
    await this.ready;
  }
}

let shared: EngineClient | null = null;
export function getEngine(): EngineClient {
  if (!shared) shared = new EngineClient();
  return shared;
}
