// Fokussolmun kortti, kerrosvaihdon ilmoitus ja juuren lähtötunnisteiden tarkistus.
import { useMemo, useState } from 'react';
import { personLabel, verifyIdentifiers } from '../../core/matrix/story';
import { crossings } from '../../core/matrix/trail';
import type { Expansion, MatrixEnv, TrailStep } from '../../core/matrix/types';
import { REALM_LABELS, realmOf } from '../../core/matrix/types';
import { showPiPosition, startFirstTestRoute } from '../../state/matrix-actions';
import { fmtExpected, fmtN } from '../format';
import { LayerBadge, RealmBadge } from './bits';
import { KIND_LABELS } from './labels';

const FACTS_SHOWN = 7;

/**
 * Näkyvä ilmoitus kerrosvaihdosta (π-data ↔ tarinaverkko). Näkyy aina, kun fokus on tarinaverkossa (myös, jos
 * siirtymä tapahtui aiemmin reitillä, esim. testireitillä), ja kun viimeisin askel palasi π-dataan.
 */
export function RealmBanner({ trail }: { trail: TrailStep[] }) {
  const last = trail.length - 1;
  const step = trail[last];
  const cs = crossings(trail);
  const at = cs.length ? cs[cs.length - 1] : -1;
  if (at < 0) return null;
  const to = realmOf(step.ref);
  const justNow = at === last;
  if (to === 'pi' && !justNow) return null;
  const via = trail[at].via;
  return (
    <div className={`mx-banner to-${to}`} role="status" data-testid="matrix-realm-banner">
      <span className="mx-banner-icon" aria-hidden="true">
        {to === 'tarina' ? '⇢' : '⇠'}
      </span>
      <span>
        {to === 'tarina' ? (
          <>
            <b>Siirryt piin todellisesta datasta symboliseen tarinaverkkoon.</b>{' '}
            {justNow ? 'Tästä eteenpäin' : `Siirtymä tapahtui askeleessa ${at}, ja`} yhteydet ovat käyttäjän antamia
            tulkintoja, eivät matemaattisia havaintoja eivätkä todisteita.
          </>
        ) : (
          <>
            <b>Palaat tarinaverkosta piin todelliseen dataan.</b> Tämän solmun tiedot lasketaan ja tarkistetaan
            lähdeaineistosta.
          </>
        )}
        {via && (
          <span className="mx-banner-via">
            Kerrosvaihto askeleessa {at}: {via.relation}
          </span>
        )}
      </span>
    </div>
  );
}

export function FocusCard({ exp }: { exp: Expansion }) {
  const [all, setAll] = useState(false);
  const { node, notes } = exp;
  const facts = all ? node.facts : node.facts.slice(0, FACTS_SHOWN);
  const pos = node.piPosition;
  return (
    <section className={`card mx-focus r-${node.realm}`} data-testid="matrix-focus" aria-label="Fokussolmu">
      <div className="mx-focus-meta">
        <RealmBadge realm={node.realm} />
        <span className="mx-kind">{KIND_LABELS[node.ref.kind]}</span>
        {node.missing && <span className="mx-chip bad">puuttuva tieto</span>}
      </div>
      <h2 className="mx-focus-title">{node.title}</h2>
      <div className="mx-focus-sub">{node.subtitle}</div>
      {node.realm === 'tarina' && (
        <div className="mx-small mx-story-note">
          {REALM_LABELS.tarina}: käyttäjän antamaa symbolista tietoa. Ei matemaattinen todiste.
        </div>
      )}
      {node.missing && (
        <div className="note err">Solmu viittaa tietoon, jota ei ole (poistettu tai ei löydy lähdeaineistosta). Palaa murupolussa taaksepäin.</div>
      )}
      {node.facts.length > 0 && (
        <ul className="mx-facts">
          {facts.map((f, i) => (
            <li key={`${f.label}-${i}`}>
              <span className="mx-fact-label">
                {f.label}
                <LayerBadge layer={f.layer} short />
                {f.verified === true && (
                  <span className="mx-ok" title="Tarkistettu lähdeaineistosta">
                    ✓
                  </span>
                )}
                {f.verified === false && (
                  <span className="mx-bad" title="Ei täsmää lähdeaineistoon">
                    ✗
                  </span>
                )}
              </span>
              <span className="mx-fact-val">{f.value}</span>
            </li>
          ))}
        </ul>
      )}
      {node.facts.length > FACTS_SHOWN && (
        <button type="button" className="mx-link" onClick={() => setAll(!all)}>
          {all ? 'Näytä vähemmän' : `Näytä kaikki faktat (${node.facts.length})`}
        </button>
      )}
      {notes.length > 0 && (
        <ul className="mx-notes">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {pos && (
        <div className="mx-goto" role="group" aria-label="Näytä muissa näkymissä">
          <button type="button" className="mx-btn" onClick={() => showPiPosition(pos, 'spiraali')} disabled={!pos.code}>
            Spiraali
          </button>
          <button type="button" className="mx-btn" onClick={() => showPiPosition(pos, '3d')} disabled={!pos.code}>
            3D
          </button>
          <button type="button" className="mx-btn" onClick={() => showPiPosition(pos, 'atlas')} disabled={!pos.code}>
            Atlas/verkko
          </button>
          <button type="button" className="mx-btn" onClick={() => showPiPosition(pos, 'pi-indeksi')}>
            π-indeksi
          </button>
          {!pos.code && <span className="mx-small faint">Kohta ei ole koodin osuma: kartat näyttävät osumia, joten avaa se π-indeksissä.</span>}
        </div>
      )}
    </section>
  );
}

/** Juurisolmu: lähtötunnisteiden tarkistus lähdeaineistosta ja ensimmäisen testireitin avaus. */
export function IdentifiersCard({ env }: { env: MatrixEnv }) {
  const checks = useMemo(() => verifyIdentifiers(env.digits, env.story), [env.digits, env.story]);
  const g = env.story.glosses.find((x) => x.context.kind === 'koodi' && x.context.code === '629' && x.symbol === '2');
  const routeText = g
    ? `MAX (629) → ${g.symbol}${g.name ? ` → ${g.name}` : ''}${g.personId ? ` → ${personLabel(env.story, g.personId)}` : ''}`
    : 'MAX (629) → 2 → HANNA → HANNA III';
  return (
    <section className="card mx-ident-card" data-testid="matrix-identifiers" aria-label="Lähtötunnisteet">
      <div className="eyebrow">Lähtötunnisteet · tarkistus lähdeaineistosta</div>
      <div className="mx-small faint">
        Koodi = T9(nimi) ja ilmoitetut sijainnit: digits[n … n + L − 1] = koodi. Ristiriitaista sijaintia ei käytetä.
      </div>
      <div className="mx-idents">
        {checks.map((c) => (
          <div key={c.name} className={`mx-ident${c.ok ? '' : ' bad'}`}>
            <div className="mx-ident-head">
              <b>{c.name}</b>
              <span className="mono">{c.reportedCode}</span>
              <span className={c.codeOk ? 'mx-ok' : 'mx-bad'}>{c.codeOk ? '✓' : '✗'}</span>
              <span className="mx-small faint">
                T9({c.name}) = {c.computedCode ?? '–'}
              </span>
            </div>
            <div className="mx-small">
              {fmtN(c.count)} osumaa · odotus {fmtExpected(c.expected)}
            </div>
            {c.positions.length > 0 ? (
              <div className="mx-ident-pos">
                {c.positions.map((p) => (
                  <span key={p.n} className={`mx-chip ${p.ok ? 'ok' : 'bad'}`}>
                    @{fmtN(p.n)}: {p.found || '–'} {p.ok ? '✓' : '✗'}
                  </span>
                ))}
              </div>
            ) : (
              <div className="mx-small faint">ei ilmoitettuja sijainteja</div>
            )}
          </div>
        ))}
      </div>
      <button type="button" className="btn primary mx-first" data-testid="matrix-first-route-root" onClick={startFirstTestRoute}>
        Avaa ensimmäinen testireitti: {routeText}
      </button>
    </section>
  );
}
