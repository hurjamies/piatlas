// Kaikki fokussolmun yhteydet ryhmittäin. Ryhmät ovat taitettavia ja sivutettuja: aluksi 12 riviä, "Näytä 50 lisää"
// ja "Näytä kaikki (k)" (esim. koodilla 629 on 1 040 osumaa). "Näytä kaikki" piirtää rivit vaiheittain (100 riviä
// animaatiokehystä kohden), joten pääsäie ei jumitu yhteen pitkään piirtoon. Näytettävien rivien määrä säilyy
// ryhmittäin, kun suunta vaihtuu (komponentin avain on fokussolmu, ei suunta); suunnan vaihtuessa jo näytetyt rivit
// piirretään uudelleen samalla tavalla vaiheittain.
import { memo, startTransition, useEffect, useMemo, useState } from 'react';
import type { Expansion, MatrixEdge, MatrixEnv } from '../../core/matrix/types';
import { nodeKey } from '../../core/matrix/types';
import { fmtN } from '../format';
import { EdgeRow } from './bits';
import { groupEdges, shortLabel } from './labels';

export const PAGE = 12;
/** "Näytä 50 lisää". */
export const MORE = 50;
/** Vaiheittaisen piirron rivimäärä animaatiokehystä kohden. */
export const CHUNK = 100;

/** Rivi piirretään uudelleen vain, jos sen omat tiedot muuttuvat (vaiheittainen piirto lisää vain uudet rivit). */
const Row = memo(EdgeRow);

/** Ryhmän pyydetty rivimäärä (`want`) ja tähän mennessä piirretty määrä (`drawn` ≤ want). */
type Shown = Record<string, { want: number; drawn: number }>;

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
  const groups = useMemo(() => groupEdges(exp.edges), [exp.edges]);
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const [shown, setShown] = useState<Shown>({});
  // Uusi laajennus (esim. suunnan vaihto): pyydetyt määrät säilyvät, mutta rivit piirretään uudelleen vaiheittain.
  const [seenExp, setSeenExp] = useState(exp);
  if (seenExp !== exp) {
    setSeenExp(exp);
    setShown((s) => {
      const next: Shown = {};
      for (const [g, v] of Object.entries(s)) next[g] = { want: v.want, drawn: Math.min(v.drawn, PAGE) };
      return next;
    });
  }
  const limitOf = (group: string, len: number) => {
    const v = shown[group];
    return { want: Math.min(v?.want ?? PAGE, len), drawn: Math.min(v?.drawn ?? PAGE, len) };
  };
  // Seuraava avoin ryhmä, jonka piirto on kesken.
  const pending = groups.find((g) => {
    if (closed.has(g.group)) return false;
    const { want, drawn } = limitOf(g.group, g.edges.length);
    return drawn < want;
  });
  const pendingGroup = pending?.group ?? null;
  const pendingDrawn = pending ? limitOf(pending.group, pending.edges.length).drawn : 0;
  useEffect(() => {
    if (pendingGroup == null) return;
    const id = requestAnimationFrame(() =>
      startTransition(() =>
        setShown((s) => {
          const v = s[pendingGroup] ?? { want: PAGE, drawn: PAGE };
          return { ...s, [pendingGroup]: { want: v.want, drawn: Math.min(v.drawn + CHUNK, v.want) } };
        }),
      ),
    );
    return () => cancelAnimationFrame(id);
  }, [pendingGroup, pendingDrawn]);
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
        const len = g.edges.length;
        const { want, drawn } = limitOf(g.group, len);
        const drawing = drawn < want;
        const rows = g.edges.slice(0, drawn);
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
              <span className="mx-group-count">{fmtN(len)}</span>
              <span className="mx-group-chev" aria-hidden="true">
                {isClosed ? '+' : '–'}
              </span>
            </button>
            {!isClosed && (
              <div className="mx-group-body" data-drawing={drawing || undefined}>
                {rows.map((e, i) => {
                  const k = nodeKey(e.to);
                  return (
                    <Row
                      key={`${k}-${i}`}
                      edge={e}
                      title={shortLabel(e.to, env.story, env.events)}
                      visited={visited.has(k)}
                      onTrail={onTrail.has(k)}
                      onOpen={onOpen}
                    />
                  );
                })}
                {drawing ? (
                  <div className="mx-small faint mx-edges-progress" data-testid="matrix-edges-progress" role="status">
                    Piirretään rivejä: {fmtN(drawn)}/{fmtN(want)}…
                  </div>
                ) : (
                  len > want && (
                    <div className="mx-btn-row">
                      {len - want > MORE && (
                        <button
                          type="button"
                          className="mx-btn ghost"
                          onClick={() => setShown((s) => ({ ...s, [g.group]: { want: want + MORE, drawn: want + MORE } }))}
                        >
                          Näytä {MORE} lisää
                        </button>
                      )}
                      <button type="button" className="mx-btn ghost" onClick={() => setShown((s) => ({ ...s, [g.group]: { want: len, drawn } }))}>
                        Näytä kaikki ({fmtN(len)})
                      </button>
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
