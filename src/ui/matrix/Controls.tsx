// Ohjausrivi: lukusuunta 234/432 (selitettynä fokussolmun alueissa), erillinen 369-avausavain, erilliset
// hyppysäännöt, reitin tallennus ja ensimmäinen testireitti.
import { useMemo, useState } from 'react';
import { JUMP_DEFINITIONS, JUMP_IDS, JUMP_NOTE } from '../../core/matrix/jumps';
import type { Expansion, HypothesisTiming, MatrixEnv } from '../../core/matrix/types';
import { HYPOTHESIS_LABELS } from '../../core/matrix/types';
import { lockFitsRoute, routeMathFacts } from '../../state/matrix';
import { runJumpOp, runOps369, saveRoute, setDirection, startFirstTestRoute } from '../../state/matrix-actions';
import { useApp } from '../../state/store';
import { fmtDateTime } from '../format';
import { LayerBadge } from './bits';
import { useTrailInfo } from './hooks';
import { directionDomains, directionExplanation, truncate } from './labels';

export function Controls({ exp, env }: { exp: Expansion; env: MatrixEnv }) {
  const dir = useApp((s) => s.matrix.direction);
  const [panel, setPanel] = useState<null | 'jumps' | 'save'>(null);
  const [busy, setBusy] = useState(false);
  const domains = useMemo(() => directionDomains(exp.edges, exp.node.realm), [exp]);
  const run369 = () => {
    setBusy(true);
    // Annetaan painalluksen näkyä ennen laskentaa (koodisolmussa satoja osumia).
    setTimeout(() => {
      try {
        runOps369();
      } finally {
        setBusy(false);
      }
    }, 16);
  };
  return (
    <section className="card mx-controls" aria-label="Matriisin ohjaus">
      <div className="mx-ctl-line">
        <span className="eyebrow">Lukusuunta</span>
        <div className="seg mx-dir" role="group" aria-label="Lukusuunta">
          <button type="button" aria-pressed={dir === '234'} data-testid="matrix-dir-234" onClick={() => setDirection('234')}>
            234 →
          </button>
          <button type="button" aria-pressed={dir === '432'} data-testid="matrix-dir-432" onClick={() => setDirection('432')}>
            ← 432
          </button>
        </div>
      </div>
      <div className="mx-dir-help" data-testid="matrix-dir-help">
        {directionExplanation(dir, domains)}
      </div>
      <div className="mx-small faint">Lukusuunta, ei hyppy: 234 ja 432 eivät tarkoita hyppyjä 2, 3 ja 4 (ks. Hyppysäännöt).</div>

      <div className="mx-key-row">
        <button type="button" className="mx-key369" data-testid="matrix-369" onClick={run369} disabled={busy} aria-busy={busy}>
          <span className="mx-key-num">369</span>
          <span className="mx-key-sub">{busy ? 'lasketaan…' : 'avausavain'}</span>
        </button>
        <div className="mx-key-help">
          Avausavain: käytä, kun tavalliset suunnat eivät tuo uutta.
          <span className="faint"> Ajetaan vain painamalla, suuntaan {dir} ja vastakkaiseen.</span>
        </div>
      </div>

      <div className="mx-btn-row">
        <button
          type="button"
          className="mx-btn"
          data-testid="matrix-jumps"
          aria-expanded={panel === 'jumps'}
          onClick={() => setPanel(panel === 'jumps' ? null : 'jumps')}
        >
          Hyppysäännöt
        </button>
        <button
          type="button"
          className="mx-btn"
          data-testid="matrix-save"
          aria-expanded={panel === 'save'}
          onClick={() => setPanel(panel === 'save' ? null : 'save')}
        >
          Tallenna reitti
        </button>
        <button type="button" className="mx-btn" data-testid="matrix-first-route" onClick={startFirstTestRoute} title="Ensimmäinen testireitti: MAX (629) → 2 → HANNA → HANNA III">
          Testireitti
        </button>
      </div>

      {panel === 'jumps' && (
        <div className="mx-subpanel" data-testid="matrix-jump-rules">
          <div className="mx-small muted">{JUMP_NOTE} Sääntö ajetaan vain, kun painat sitä.</div>
          {JUMP_IDS.map((id) => (
            <div key={id} className="mx-jump-rule">
              <button type="button" className="mx-btn" data-testid={`matrix-jump-${id}`} onClick={() => runJumpOp(id)}>
                {JUMP_DEFINITIONS[id].title}
              </button>
              <span className="mx-small faint">{JUMP_DEFINITIONS[id].definition}</span>
            </div>
          ))}
        </div>
      )}
      {panel === 'save' && <SaveRouteForm env={env} onDone={() => setPanel(null)} />}
    </section>
  );
}

function SaveRouteForm({ env, onDone }: { env: MatrixEnv; onDone: () => void }) {
  const trail = useApp((s) => s.matrix.trail);
  const locks = useApp((s) => s.matrix.locks);
  const runIndex = useApp((s) => s.matrix.runIndex);
  const log = useApp((s) => s.matrix.log);
  const anchor = useApp((s) => s.anchor);
  const infos = useTrailInfo(env);
  const defaultTitle = truncate(infos.slice(1).map((i) => i.title).join(' → ') || 'Lähtöankkuri', 90);
  const [title, setTitle] = useState('');
  const [interp, setInterp] = useState('');
  const [timing, setTiming] = useState<HypothesisTiming>('ei-tiedossa');
  // Vain lukitukset, jotka koskevat juuri tämän reitin koodeja ja edeltävät reitin π-solmujen avaamista ja
  // saman koodijoukon ensimmäistä ajoa (lockFitsRoute). Viimeisimmän hylätyn lukituksen syy näytetään.
  const checked = useMemo(
    () => locks.map((l) => ({ lock: l, fit: lockFitsRoute(l, runIndex, { trail, story: env.story, log }) })).reverse(),
    [locks, runIndex, trail, env.story, log],
  );
  const valid = checked.filter((c) => c.fit.ok).map((c) => c.lock);
  const rejected = checked.find((c) => !c.fit.ok) ?? null;
  const [lockId, setLockId] = useState<string>('');
  const facts = useMemo(() => routeMathFacts(trail, env.digits, anchor, env.story), [trail, env, anchor]);
  return (
    <form
      className="mx-subpanel"
      onSubmit={(e) => {
        e.preventDefault();
        saveRoute({ title: title || defaultTitle, interpretation: interp, timing, lockId: lockId || null });
        onDone();
      }}
    >
      <label className="field">
        <span>REITIN NIMI</span>
        <input className="input" id="mx-save-title" value={title} placeholder={defaultTitle} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        <span>OMA TULKINTA (TARINAKERROS, EI MATEMAATTINEN HAVAINTO)</span>
        <textarea className="input" id="mx-save-interp" value={interp} onChange={(e) => setInterp(e.target.value)} placeholder="Mitä reitti merkitsee sinulle? Tallentuu vain tälle laitteelle." />
      </label>
      <label className="field">
        <span>HYPOTEESIN AJOITUS</span>
        <select className="input" id="mx-save-timing" value={timing} onChange={(e) => setTiming(e.target.value as HypothesisTiming)}>
          <option value="ei-tiedossa">{HYPOTHESIS_LABELS['ei-tiedossa']}</option>
          <option value="löydön-jälkeen">{HYPOTHESIS_LABELS['löydön-jälkeen']}</option>
          <option value="ennen-löydöstä" disabled={!valid.length}>
            {HYPOTHESIS_LABELS['ennen-löydöstä']}
            {valid.length ? '' : ' — vaatii lukituksen'}
          </option>
        </select>
      </label>
      {timing === 'ennen-löydöstä' && (
        <label className="field">
          <span>LUKITTU HYPOTEESI</span>
          <select className="input" value={lockId} onChange={(e) => setLockId(e.target.value)}>
            <option value="">valitse lukitus…</option>
            {valid.map((l) => (
              <option key={l.id} value={l.id}>
                {fmtDateTime(l.createdAt)} · {l.names.join(' → ')} · {l.hash.slice(0, 10)}…
              </option>
            ))}
          </select>
        </label>
      )}
      {!valid.length && (
        <div className="mx-small faint" data-testid="matrix-save-lock-help">
          ”{HYPOTHESIS_LABELS['ennen-löydöstä']}” on mahdollinen vain, jos tämän reitin koodien hypoteesi on lukittu
          SHA-256-tiivisteellä tällä laitteella ennen reitin π-solmujen avaamista ja ennen saman koodijoukon ensimmäistä
          ajoa (Reitit → reittitesti). Tehtävänannon reitit ovat aina ”{HYPOTHESIS_LABELS['löydön-jälkeen']}”.
          {rejected && ` Viimeisin lukitus ei kelpaa: ${rejected.fit.reason}`}
        </div>
      )}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <span className="eyebrow">π-faktat tarkistetaan tallennettaessa</span>
        <LayerBadge layer="matemaattinen" />
      </div>
      <ul className="mx-factlist">
        {facts.map((f) => (
          <li key={f} className={f.includes('✗') ? 'bad' : ''}>
            {f}
          </li>
        ))}
        {!facts.length && <li className="faint">Reitillä ei ole π-kerroksen solmuja.</li>}
      </ul>
      <div className="mx-btn-row">
        <button type="submit" className="mx-btn primary" data-testid="matrix-save-confirm">
          Tallenna
        </button>
        <button type="button" className="mx-btn ghost" onClick={onDone}>
          Peru
        </button>
      </div>
    </form>
  );
}
