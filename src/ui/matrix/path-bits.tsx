// Polkuhaun ja sokkotestin yhteiset pienet osat: käynnissä olevan työn eteneminen ja keskeytys, monivertailun
// huomautus sekä muotoilut. Path Score ei ole todennäköisyys: vastuuvapauslauseke näytetään aina sen vieressä.
import { useEffect, useState } from 'react';
import type { IdentifierRole } from '../../core/path/types';
import { sha256Hex } from '../../core/sha256';
import { cancelPathJob } from '../../state/path-actions';
import { PATH_ALPHA, pathTestsTotal } from '../../state/path';
import { useApp } from '../../state/store';
import { fmtN } from '../format';

export const ROLE_SLUG: Record<IdentifierRole, 'start' | 'goal' | 'known'> = { lähtö: 'start', tavoite: 'goal', tunnettu: 'known' };
export const ROLE_TITLE: Record<IdentifierRole, string> = { lähtö: 'Lähtö', tavoite: 'Tavoite', tunnettu: 'Tunnettu' };

const JOB_TITLE = { haku: 'Polkuhaku', vertailu: 'Satunnaisvertailu', sokkotesti: 'Sokkotesti' } as const;

/** Desimaaliluku pilkulla. */
export const fmtFi = (x: number | null | undefined, d = 2) => (x == null || !Number.isFinite(x) ? '–' : x.toFixed(d).replace('.', ','));

/** Käynnissä oleva polkuhaun työ: eteneminen ja Keskeytä. Näytetään vain, jos työ on jokin annetuista lajeista. */
export function JobProgress({ kinds, testId }: { kinds: ('haku' | 'vertailu' | 'sokkotesti')[]; testId: string }) {
  const running = useApp((s) => s.matrix.path.running);
  if (!running || !kinds.includes(running.kind)) return null;
  const pct = running.total > 0 ? Math.min(100, (100 * running.done) / running.total) : null;
  return (
    <div className="pd-progress" data-testid={testId} role="status">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="muted mx-small">
          {JOB_TITLE[running.kind]} käynnissä{running.total > 0 ? `: ${fmtN(running.done)} / ${fmtN(running.total)}` : '…'}
          {running.cancelRequested ? ' · keskeytetään…' : ''}
        </span>
        <button
          type="button"
          className="mx-btn ghost"
          data-testid={running.kind === 'sokkotesti' ? 'blind-cancel' : 'path-cancel'}
          onClick={() => void cancelPathJob()}
          disabled={running.cancelRequested}
        >
          Keskeytä
        </button>
      </div>
      <div className="mx-small faint">{running.label}</div>
      <div className="progress">
        <i className={pct == null ? 'pd-indeterminate' : ''} style={{ width: pct == null ? '30%' : `${pct}%` }} />
      </div>
    </div>
  );
}

/** Monivertailu: kaikki polkuhaut, satunnaisvertailut ja sokkotestit lasketaan (myös keskeytetyt), kuten Reitit-sivulla. */
export function PathMultipleComparisonNote({ testId }: { testId: string }) {
  const counts = useApp((s) => s.matrix.path.counts);
  const runs = useApp((s) => s.matrix.path.runs);
  const blindRuns = useApp((s) => s.matrix.path.blindRuns);
  const m = pathTestsTotal(counts);
  const exploratory = runs.filter((r) => r.exploratory).length + blindRuns.filter((r) => r.exploratory).length;
  return (
    <div className="note warn" data-testid={testId}>
      Polkuhakuja ajettu {counts.searches}, satunnaisvertailuja {counts.nulls} ja sokkotestejä {counts.blinds} (yhteensä m = {m}).
      Jos testejä on m kappaletta, noin m·α niistä antaa p ≤ α pelkällä sattumalla (nyt {(m * PATH_ALPHA).toFixed(1).replace('.', ',')},
      kun α = 0,05). Raportoi kaikki, ei vain parhaita. Eksploratiivisia ajoja {exploratory}. Pelkkä reitin löytyminen ei ole testi:
      reittejä löytyy myös satunnaisaineistosta.
    </div>
  );
}

/** SHA-256 (async) annetusta merkkijonosta; null laskennan ajan. */
export function useSha256(text: string | null): string | null {
  const [hash, setHash] = useState<{ text: string; hash: string } | null>(null);
  useEffect(() => {
    if (text == null) return;
    let alive = true;
    void sha256Hex(text).then((h) => {
      if (alive) setHash({ text, hash: h });
    });
    return () => {
      alive = false;
    };
  }, [text]);
  return text != null && hash && hash.text === text ? hash.hash : null;
}
