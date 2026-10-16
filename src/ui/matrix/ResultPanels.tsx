// 369-avausavaimen ja nimettyjen hyppysääntöjen tulokset. Kaikki tarkistukset näytetään, myös ne, joissa
// ei löytynyt mitään ("Ei uutta"), sekä odotettu satunnaisosumien määrä, kun se on määritelty.
import { useEffect, useRef, useState } from 'react';
import { JUMP_DEFINITIONS, JumpResult } from '../../core/matrix/jumps';
import { fmtExpectedFi, Op369Report, OpDirectionResult } from '../../core/matrix/ops369';
import type { MatrixEdge, MatrixEnv } from '../../core/matrix/types';
import { DIRECTION_SEMANTICS, DOMAIN_LABELS, nodeKey, opposite } from '../../core/matrix/types';
import { clearLast369, clearLastJump } from '../../state/matrix-actions';
import { fmtDateTime } from '../format';
import { EdgeRow } from './bits';
import { shortLabel } from './labels';

const FINDINGS_SHOWN = 6;

interface Common {
  env: MatrixEnv;
  visited: Set<string>;
  onTrail: Map<string, number>;
  onOpen: (e: MatrixEdge) => void;
}

function Findings({ edges, env, visited, onTrail, onOpen }: Common & { edges: MatrixEdge[] }) {
  const [all, setAll] = useState(false);
  if (!edges.length) return null;
  const rows = all ? edges : edges.slice(0, FINDINGS_SHOWN);
  return (
    <div className="mx-findings">
      {rows.map((e, i) => {
        const k = nodeKey(e.to);
        return (
          <EdgeRow key={`${k}-${i}`} edge={e} title={shortLabel(e.to, env.story, env.events)} visited={visited.has(k)} onTrail={onTrail.has(k)} onOpen={onOpen} />
        );
      })}
      {edges.length > FINDINGS_SHOWN && (
        <button type="button" className="mx-link" onClick={() => setAll(!all)}>
          {all ? 'Näytä vähemmän' : `Näytä kaikki löydöt (${edges.length})`}
        </button>
      )}
    </div>
  );
}

function DirBlock({ d, primary, ...rest }: Common & { d: OpDirectionResult; primary: boolean }) {
  return (
    <div className={`mx-dirblock${d.matches ? ' found' : ''}`}>
      <div className="mx-dirblock-head">
        <span className="mx-chip dir">
          {primary ? 'valittu' : 'vastakkainen'} {d.direction}
          {d.domain ? ` · ${DOMAIN_LABELS[d.domain]}` : ''}
        </span>
        <span className="mx-small">
          löytöjä <b>{d.matches}</b> · odotus {d.expected == null ? 'ei määritelty' : fmtExpectedFi(d.expected)}
        </span>
      </div>
      {d.domain && <div className="mx-small faint">{DIRECTION_SEMANTICS[d.domain][d.direction]}</div>}
      {d.matches === 0 && <div className="mx-nothing">Ei uutta tähän suuntaan.</div>}
      <Findings edges={d.findings} {...rest} />
      <div className="mx-small faint">{d.expectedNote}</div>
      <details className="mx-checks">
        <summary>Kaikki tarkistukset ({d.checks.length})</summary>
        <ul>
          {d.checks.map((c, i) => (
            <li key={i} className={c.match ? 'match' : ''}>
              <span className="mx-check-mark">{c.match ? '●' : '○'}</span>
              <span className="mx-check-label">{c.label}</span>
              <span className="mx-check-val">{c.value}</span>
              {c.detail && <span className="mx-check-detail">{c.detail}</span>}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

/** Uusi tulos vieritetään näkyviin (ohjaus on tuloksen yläpuolella). */
function useScrollIntoView<T extends HTMLElement>(dep: unknown) {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  }, [dep]);
  return ref;
}

export function Ops369Panel({ report, ...rest }: Common & { report: Op369Report }) {
  const ref = useScrollIntoView<HTMLElement>(report.ranAt);
  return (
    <section ref={ref} className="card mx-result mx-369" data-testid="matrix-369-result" aria-label="369-avausavaimen tulos">
      <div className="mx-result-head">
        <span className="eyebrow gold">369-avausavain · {report.version}</span>
        <button type="button" className="mx-close" onClick={clearLast369} aria-label="Sulje 369-tulos">
          ×
        </button>
      </div>
      <div className="mx-small">
        Kohde <b>{shortLabel(report.target, rest.env.story, rest.env.events)}</b> · valittu suunta {report.direction}, lisäksi{' '}
        {opposite(report.direction)} · {fmtDateTime(report.ranAt)}
      </div>
      <div className={`mx-summary${report.nothingNewOverall ? ' none' : ''}`}>
        {report.nothingNewOverall && <span className="mx-chip">Ei uutta</span>} {report.summary}
      </div>
      <div className="note warn">{report.disclaimer}</div>
      <div className="mx-small">
        <span className="faint">Viitekoodit: </span>
        {report.referenceCodes.map((r) => `${r.name} ${r.code}`).join(', ') || '–'}
      </div>
      {report.results.map((r) => (
        <details key={r.id} className="mx-method" open={!r.nothingNew}>
          <summary>
            <span className="mx-method-title">{r.title}</span>
            <span className="mx-method-id mono">{r.id}</span>
            {!r.applicable ? (
              <span className="mx-chip">ei sovellu</span>
            ) : r.nothingNew ? (
              <span className="mx-chip">Ei uutta</span>
            ) : (
              <span className="mx-chip gold">{(r.primary?.matches ?? 0) + (r.opposite?.matches ?? 0)} löytöä</span>
            )}
          </summary>
          <div className="mx-small faint">{r.definition}</div>
          {!r.applicable && <div className="mx-nothing">{r.reasonNotApplicable}</div>}
          {r.primary && <DirBlock d={r.primary} primary {...rest} />}
          {r.opposite && <DirBlock d={r.opposite} primary={false} {...rest} />}
          {r.notes.length > 0 && (
            <ul className="mx-notes">
              {r.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
        </details>
      ))}
    </section>
  );
}

export function JumpPanel({ res, ...rest }: Common & { res: JumpResult }) {
  const def = JUMP_DEFINITIONS[res.op];
  const ref = useScrollIntoView<HTMLElement>(res);
  return (
    <section ref={ref} className="card mx-result" data-testid="matrix-jump-result" aria-label="Hyppysäännön tulos">
      <div className="mx-result-head">
        <span className="eyebrow">Hyppysääntö · {res.version}</span>
        <button type="button" className="mx-close" onClick={clearLastJump} aria-label="Sulje hyppysäännön tulos">
          ×
        </button>
      </div>
      <h3 className="mx-h3">
        {def.title} <span className="mono faint">{res.op}</span>
      </h3>
      <div className="mx-small faint">{def.definition}</div>
      {res.base != null ? (
        <>
          <div className="mx-small">
            Perusta n = <b className="mono">{res.base}</b> · kohdat{' '}
            {res.positions.map((p) => (
              <span key={p.n} className="mx-chip mono">
                @{p.n} = {p.digit}
              </span>
            ))}
          </div>
          <div className="mx-small">
            Hyppyjono <b className="mono">{res.jumpString || '–'}</b> · odotus {fmtExpectedFi(res.expected)}
          </div>
        </>
      ) : (
        <div className="mx-nothing">Hyppysääntöä ei voitu ajaa tälle solmulle.</div>
      )}
      {res.nothingNew ? (
        <div className="mx-nothing">Ei uutta: hyppyjono ei ole minkään 3-numeroisen viitekoodin merkkijono.</div>
      ) : (
        <div className="mx-summary">Sama merkkijono kuin {res.matches.map((m) => `${m.name} ${m.code}`).join(', ')}. Tämä on merkkijonojen yhtäläisyys, ei todiste.</div>
      )}
      <Findings edges={res.findings} {...rest} />
      <ul className="mx-notes">
        {res.notes.map((n, i) => (
          <li key={i}>{n}</li>
        ))}
      </ul>
      <div className="mx-small faint">Lukusuunta (234/432) ei vaikuta hyppysääntöön: tulos riippuu vain säännöstä ja perustasta.</div>
    </section>
  );
}
