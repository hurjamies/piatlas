// Matriisi-välilehti: Recursive Story Matrix (docs/MATRIISI.md). Murupolku ylhäällä, solmuvalitsin, ohjaus, fokussolmu,
// 369- ja hyppysääntötulokset, tarinarakenteet, verkkokuva ja kaikki yhteydet listana. Alasivut: Tarina,
// Reitit ja Loki. π-data ja symbolinen tarinaverkko pidetään näkyvästi erillään.
import { useCallback, useMemo } from 'react';
import { expand } from '../../core/matrix/expand';
import type { MatrixEdge } from '../../core/matrix/types';
import { nodeKey } from '../../core/matrix/types';
import { openEdge, setMatrixSub, setMatrixView } from '../../state/matrix-actions';
import { useApp } from '../../state/store';
import { Controls } from '../matrix/Controls';
import { Crumbs } from '../matrix/Crumbs';
import { EdgeList } from '../matrix/EdgeList';
import { FocusCard, IdentifiersCard, RealmBanner } from '../matrix/FocusCard';
import { useMatrixEnv, useTrailSets } from '../matrix/hooks';
import { LogPage } from '../matrix/LogPage';
import { NetGraph } from '../matrix/NetGraph';
import { NodePicker } from '../matrix/NodePicker';
import { JumpPanel, Ops369Panel } from '../matrix/ResultPanels';
import { RoutesPage } from '../matrix/RoutesPage';
import { StoryEditor } from '../matrix/StoryEditor';
import { StoryStructures } from '../matrix/StoryStrips';

export function MatrixView() {
  const hasDigits = useApp((s) => s.digits.length > 0);
  const sub = useApp((s) => s.matrix.sub);
  const view = useApp((s) => s.matrix.view);
  const env = useMatrixEnv();
  if (!hasDigits)
    return (
      <div className="view scroll" data-testid="matrix-view">
        <div className="page muted">Matriisi odottaa aineistoa: π-kerroksen solmut lasketaan ladatuista desimaaleista.</div>
      </div>
    );
  return (
    <div className="view scroll mx-view" data-testid="matrix-view">
      <Crumbs env={env} />
      <div className="page mx-page">
        <nav className="mx-subnav" aria-label="Matriisin sivut">
          <div className="seg" role="group" aria-label="Näkymä">
            <button type="button" aria-pressed={!sub && view === 'verkko'} data-testid="matrix-view-verkko" onClick={() => setMatrixView('verkko')}>
              Verkko
            </button>
            <button type="button" aria-pressed={!sub && view === 'lista'} data-testid="matrix-view-lista" onClick={() => setMatrixView('lista')}>
              Lista
            </button>
          </div>
          <button type="button" className="mx-subbtn" aria-pressed={sub === 'tarina'} data-testid="matrix-sub-tarina" onClick={() => setMatrixSub(sub === 'tarina' ? null : 'tarina')}>
            Tarina
          </button>
          <button type="button" className="mx-subbtn" aria-pressed={sub === 'reitit'} data-testid="matrix-sub-reitit" onClick={() => setMatrixSub(sub === 'reitit' ? null : 'reitit')}>
            Reitit
          </button>
          <button type="button" className="mx-subbtn" aria-pressed={sub === 'loki'} data-testid="matrix-sub-loki" onClick={() => setMatrixSub(sub === 'loki' ? null : 'loki')}>
            Loki
          </button>
        </nav>
        {sub === 'tarina' ? <StoryEditor /> : sub === 'reitit' ? <RoutesPage /> : sub === 'loki' ? <LogPage /> : <Explorer />}
      </div>
    </div>
  );
}

function Explorer() {
  const env = useMatrixEnv();
  const { trail, onTrail, visited } = useTrailSets();
  const view = useApp((s) => s.matrix.view);
  const last369 = useApp((s) => s.matrix.last369);
  const lastJump = useApp((s) => s.matrix.lastJump);
  const step = trail[trail.length - 1];
  const focusKey = nodeKey(step.ref);
  const exp = useMemo(() => expand(step.ref, env), [focusKey, env]); // eslint-disable-line react-hooks/exhaustive-deps
  const onOpen = useCallback((e: MatrixEdge) => {
    openEdge(e);
  }, []);
  const common = { env, visited, onTrail, onOpen };
  return (
    <>
      <RealmBanner trail={trail} />
      <NodePicker env={env} />
      <Controls exp={exp} env={env} />
      <FocusCard exp={exp} />
      {step.ref.kind === 'root' && <IdentifiersCard env={env} />}
      {last369 && last369.targetKey === focusKey && <Ops369Panel report={last369} {...common} />}
      {lastJump && nodeKey(lastJump.target) === focusKey && <JumpPanel res={lastJump} {...common} />}
      <StoryStructures exp={exp} env={env} onOpen={onOpen} />
      {view === 'verkko' && <NetGraph exp={exp} {...common} />}
      {/* Avain on fokussolmu: näytettyjen rivien määrä säilyy ryhmittäin, kun suunta vaihtuu. */}
      <EdgeList key={focusKey} exp={exp} {...common} />
    </>
  );
}
