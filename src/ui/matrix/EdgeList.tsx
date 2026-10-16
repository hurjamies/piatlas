// Kaikki fokussolmun yhteydet ryhmittäin. Ryhmät ovat taitettavia ja sivutettuja: aluksi 12 riviä,
// "Näytä kaikki (k)" näyttää loput (esim. koodilla 629 on 1 040 osumaa).
import { useState } from 'react';
import type { Expansion, MatrixEdge, MatrixEnv } from '../../core/matrix/types';
import { nodeKey } from '../../core/matrix/types';
import { fmtN } from '../format';
import { EdgeRow } from './bits';
import { groupEdges, shortLabel } from './labels';

export const PAGE = 12;

export function EdgeList({
  exp,
  env,
  visited,
  onTrail,
  onOpen,
}: {
  exp: Expansion;
  env: MatrixEnv;
  visited: Set<string>;
  onTrail: Map<string, number>;
  onOpen: (e: MatrixEdge) => void;
}) {
  const groups = groupEdges(exp.edges);
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const [shown, setShown] = useState<Record<string, number>>({});
  return (
    <section className="mx-edges" data-testid="matrix-edges" aria-label="Yhteydet">
      <div className="mx-edges-head">
        <span className="eyebrow">Yhteydet</span>
        <span className="mx-small faint">
          {fmtN(exp.edges.length)} yhteyttä · {groups.length} ryhmää
        </span>
      </div>
      {exp.truncated.map((t) => (
        <div key={t.group} className="note warn">
          {t.group}: näytetään {fmtN(t.shown)}/{fmtN(t.total)}. Kaikki osumat lasketaan silti mukaan määriin.
        </div>
      ))}
      {!groups.length && <div className="muted mx-small">Solmusta ei lähde yhteyksiä. Vaihda suuntaa tai palaa murupolussa.</div>}
      {groups.map((g) => {
        const isClosed = closed.has(g.group);
        const limit = shown[g.group] ?? PAGE;
        const rows = g.edges.slice(0, limit);
        return (
          <div key={g.group} className="mx-group">
            <button
              type="button"
              className="mx-group-head"
              aria-expanded={!isClosed}
              onClick={() => {
                const next = new Set(closed);
                if (isClosed) next.delete(g.group);
                else next.add(g.group);
                setClosed(next);
              }}
            >
              <span className="mx-group-name">{g.group}</span>
              <span className="mx-group-count">{fmtN(g.edges.length)}</span>
              <span className="mx-group-chev" aria-hidden="true">
                {isClosed ? '+' : '–'}
              </span>
            </button>
            {!isClosed && (
              <div className="mx-group-body">
                {rows.map((e, i) => {
                  const k = nodeKey(e.to);
                  return (
                    <EdgeRow
                      key={`${k}-${i}`}
                      edge={e}
                      title={shortLabel(e.to, env.story, env.events)}
                      visited={visited.has(k)}
                      onTrail={onTrail.has(k)}
                      onOpen={onOpen}
                    />
                  );
                })}
                {g.edges.length > limit && (
                  <div className="mx-btn-row">
                    {g.edges.length - limit > 50 && (
                      <button type="button" className="mx-btn ghost" onClick={() => setShown({ ...shown, [g.group]: limit + 50 })}>
                        Näytä 50 lisää
                      </button>
                    )}
                    <button type="button" className="mx-btn ghost" onClick={() => setShown({ ...shown, [g.group]: g.edges.length })}>
                      Näytä kaikki ({fmtN(g.edges.length)})
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
