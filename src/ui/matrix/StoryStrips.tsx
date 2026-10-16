// Tarinakerroksen rakenteet fokussolmussa: polkujen haarat (yhdistys), samannimisten kronologia ja polun
// symbolinen numerojono. Kronologia (I → II → III) ja symbolinen numerointi (2 → 3 → 4) näytetään eri tyyleillä,
// koska ne ovat eri asioita.
import { CHRONOLOGY_LABELS, homonymChronology, junction, pathsOfPerson, personLabel, stepsInDirection, symbolString } from '../../core/matrix/story';
import type { Expansion, MatrixEdge, MatrixEnv, PathStep, StoryModel, StoryPath } from '../../core/matrix/types';
import { normName, toRoman } from '../../core/matrix/types';

function stepName(model: StoryModel, s: PathStep): string {
  return s.personId && model.persons.some((p) => p.id === s.personId) ? personLabel(model, s.personId) : normName(s.name);
}

function pathLetter(p: StoryPath): string {
  const m = /^polku\s+(.+)$/i.exec(p.title.trim());
  return m ? m[1] : p.title;
}

export function StoryStructures({ exp, env, onOpen }: { exp: Expansion; env: MatrixEnv; onOpen: (e: MatrixEdge) => void }) {
  const ref = exp.node.ref;
  if (ref.kind === 'person') {
    const ids: string[] = [];
    for (const o of pathsOfPerson(env.story, ref.personId)) if (!ids.includes(o.path.id)) ids.push(o.path.id);
    if (ids.length < 2) return null;
    const edge = exp.edges.find((e) => e.to.kind === 'junction');
    return <JunctionCard personId={ref.personId} pathIds={ids} env={env} mergeEdge={edge ?? null} onOpen={onOpen} />;
  }
  if (ref.kind === 'junction') return <JunctionCard personId={ref.personId} pathIds={ref.pathIds} env={env} mergeEdge={null} onOpen={onOpen} />;
  if (ref.kind === 'homonyms') return <HomonymStrip name={ref.name} env={env} exp={exp} onOpen={onOpen} />;
  if (ref.kind === 'path') {
    const p = env.story.paths.find((x) => x.id === ref.pathId);
    return p ? <PathStrip path={p} env={env} /> : null;
  }
  return null;
}

function JunctionCard({
  personId,
  pathIds,
  env,
  mergeEdge,
  onOpen,
}: {
  personId: string;
  pathIds: string[];
  env: MatrixEnv;
  mergeEdge: MatrixEdge | null;
  onOpen: (e: MatrixEdge) => void;
}) {
  const model = env.story;
  const j = junction(model, personId, pathIds, env.direction);
  const label = personLabel(model, personId);
  return (
    <section className="card mx-junction" data-testid="matrix-junction" aria-label="Polkujen haarat">
      <div className="eyebrow rose">Polut henkilössä {label} · suunta {env.direction}</div>
      <div className="mx-branches">
        {j.branches.map((b) => (
          <div key={`${b.path.id}-${b.index}`} className="mx-branch">
            <div className="mx-branch-head">
              <span className="mx-branch-letter">{pathLetter(b.path)}</span>
              <span className="mx-small">
                {b.path.title} · {b.path.theme || '–'}
              </span>
            </div>
            <div className="mx-chain">
              <b className="mx-chain-cur">{label}</b>
              {b.after.map((s, i) => (
                <span key={i}>
                  {' → '}
                  {stepName(model, s)}
                </span>
              ))}
              {!b.after.length && <span className="faint"> (ei jatkoa suuntaan {env.direction})</span>}
            </div>
            {b.before.length > 0 && (
              <div className="mx-small faint">
                edeltää: {b.before.map((s) => stepName(model, s)).join(' → ')} → {label}
              </div>
            )}
          </div>
        ))}
      </div>
      {j.missing.length > 0 && <div className="mx-small faint">Ei löytynyt: {j.missing.join(', ')}</div>}
      {mergeEdge ? (
        <button type="button" className="mx-btn" data-testid="matrix-junction-merge" onClick={() => onOpen(mergeEdge)}>
          Yhdistä polut
        </button>
      ) : (
        <div className="mx-small faint">Yhdistys näyttää haarat rinnakkain. Alkuperäiset polut säilyvät muuttumattomina.</div>
      )}
    </section>
  );
}

function HomonymStrip({ name, env, exp, onOpen }: { name: string; env: MatrixEnv; exp: Expansion; onOpen: (e: MatrixEdge) => void }) {
  const chron = homonymChronology(env.story, name);
  if (!chron.persons.length) return null;
  return (
    <section className="card mx-chrono" data-testid="matrix-homonyms" aria-label="Samannimisten kronologia">
      <div className="eyebrow amber">Samannimisten kronologinen järjestys — ei symbolinen polku</div>
      <div className="mx-chrono-strip" role="list">
        {chron.persons.map((p, i) => {
          const edge = exp.edges.find((e) => e.to.kind === 'person' && e.to.personId === p.id);
          return (
            <span key={p.id} className="mx-chrono-item" role="listitem">
              {i > 0 && (
                <span className="mx-chrono-arrow" aria-hidden="true">
                  →
                </span>
              )}
              <button type="button" className="mx-chrono-chip" onClick={() => edge && onOpen(edge)} disabled={!edge}>
                <span className="mx-roman">{p.homonymOrdinal != null ? toRoman(p.homonymOrdinal) : '?'}</span>
                {personLabel(env.story, p)}
              </button>
            </span>
          );
        })}
      </div>
      <div className="mx-small faint">
        Peruste: {CHRONOLOGY_LABELS[chron.basis]}. Roomalainen numero on samannimisten järjestys, ei polun symbolinen
        numero. Sama nimi ja T9-koodi eivät tee henkilöistä samaa henkilöä.
      </div>
    </section>
  );
}

function PathStrip({ path, env }: { path: StoryPath; env: MatrixEnv }) {
  const steps = stepsInDirection(path, env.direction);
  return (
    <section className="card mx-symstrip" data-testid="matrix-path-symbols" aria-label="Polun symbolinen numerojono">
      <div className="eyebrow rose">Käyttäjän symbolinen polku · suunta {env.direction}</div>
      <div className="mx-sym-strip">
        {steps.map((s, i) => (
          <span key={i} className="mx-sym-item">
            {i > 0 && <span className="mx-sym-arrow">→</span>}
            <span className="mx-sym-chip">
              <span className="mx-sym-num">{s.symbol}</span>
              {stepName(env.story, s)}
            </span>
          </span>
        ))}
      </div>
      <div className="mx-small faint">
        Symbolinen numerojono {symbolString(path, env.direction) || '–'}: numerot ovat käyttäjän antamia symboleja, eivät
        samannimisten järjestysnumeroita eivätkä π-havaintoja.
      </div>
    </section>
  );
}
