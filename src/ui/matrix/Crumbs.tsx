// Murupolku: lähtöankkurista fokukseen. Jokainen muru näyttää tietokerroksen (π-data / Tarinaverkko) ja
// yhteyden tyypin, jota pitkin siihen tultiin. Kerrosvaihdon kohdalla on näkyvä erotin. Pitkä polku vierii
// sivuttain, joten alarivi näyttää aina myös kerrosten järjestyksen (esim. "π-data 3 | tarina 3"): kerrosvaihto
// pysyy näkyvissä, vaikka erotin olisi vieritetty pois näkyvistä.
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import type { MatrixEnv, Realm } from '../../core/matrix/types';
import { LAYER_LABELS, REALM_LABELS, realmOf } from '../../core/matrix/types';
import { jumpToCrumb, resetToRoot } from '../../state/matrix-actions';
import { useApp } from '../../state/store';
import { IconAnchor } from '../components/Icons';
import { useTrailInfo } from './hooks';
import { realmRuns, stepsText } from './labels';

const RUN_LABELS: Record<Realm, string> = { pi: 'π-data', tarina: 'tarina' };

export function Crumbs({ env }: { env: MatrixEnv }) {
  const trail = useApp((s) => s.matrix.trail);
  const infos = useTrailInfo(env);
  const scroller = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState('');
  // Reunojen häivytys kertoo, että murupolkua on vieritettävissä vasemmalle tai oikealle.
  const updateFade = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const left = el.scrollLeft > 2;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setFade(`${left ? 'l' : ''}${right ? 'r' : ''}`);
  }, []);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
    updateFade();
  }, [trail, updateFade]);
  useEffect(() => {
    window.addEventListener('resize', updateFade);
    return () => window.removeEventListener('resize', updateFade);
  }, [updateFade]);
  const k = trail.length - 1;
  const runs = realmRuns(trail.map((st) => realmOf(st.ref)));
  return (
    <div className="mx-crumbs-wrap">
      <div className="mx-crumbs-row">
        <button
          type="button"
          className="mx-root-btn"
          data-testid="matrix-root"
          onClick={resetToRoot}
          aria-label="Palaa lähtöankkuriin (juuri)"
          title="Palaa lähtöankkuriin"
        >
          <IconAnchor />
        </button>
        <div
          className="mx-crumbs"
          ref={scroller}
          data-fade={fade || undefined}
          onScroll={updateFade}
          data-testid="matrix-crumbs"
          role="group"
          aria-label="Murupolku lähtöankkurista"
        >
          {trail.map((st, i) => {
            const realm = realmOf(st.ref);
            const crossing = i > 0 && realmOf(trail[i - 1].ref) !== realm;
            const title = infos[i]?.title ?? '';
            return (
              <Fragment key={`${i}-${title}`}>
                {i > 0 &&
                  (crossing ? (
                    <span className={`mx-divider to-${realm}`} role="separator" aria-label="Kerros vaihtuu">
                      {realm === 'tarina' ? 'π-data | tarina' : 'tarina | π-data'}
                    </span>
                  ) : (
                    <span className="mx-sep" aria-hidden="true">
                      ›
                    </span>
                  ))}
                <button
                  type="button"
                  className={`mx-crumb r-${realm}${i === k ? ' cur' : ''}`}
                  data-testid={`matrix-crumb-${i}`}
                  aria-current={i === k ? 'step' : undefined}
                  onClick={() => jumpToCrumb(i)}
                  title={`${title} — ${REALM_LABELS[realm]}${st.via ? ` · ${LAYER_LABELS[st.via.layer]}: ${st.via.relation}` : ''}`}
                >
                  <span className="mx-crumb-meta">
                    {REALM_LABELS[realm]} · {st.via ? LAYER_LABELS[st.via.layer] : 'lähtö'}
                  </span>
                  <span className="mx-crumb-title">{title}</span>
                </button>
              </Fragment>
            );
          })}
        </div>
      </div>
      <div className="mx-crumbs-foot">
        <span>Polku takaisin ankkuriin: {stepsText(k)}</span>
        {runs.length > 1 ? (
          <span className="mx-runs" data-testid="matrix-realm-runs" title="Kerrokset polulla järjestyksessä; | = kerrosvaihto">
            {runs.map((r, i) => (
              <Fragment key={i}>
                {i > 0 && <span className="mx-runs-div">|</span>}
                <span className={`mx-run r-${r.realm}`}>
                  {RUN_LABELS[r.realm]} {r.count}
                </span>
              </Fragment>
            ))}
          </span>
        ) : (
          k > 0 && <span className="faint">napauta murua palataksesi</span>
        )}
      </div>
    </div>
  );
}
