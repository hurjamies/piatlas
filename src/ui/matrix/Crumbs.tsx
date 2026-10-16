// Murupolku: lähtöankkurista fokukseen. Jokainen muru näyttää tietokerroksen (π-data / Tarinaverkko) ja
// yhteyden tyypin, jota pitkin siihen tultiin. Kerrosvaihdon kohdalla on näkyvä erotin.
import { Fragment, useEffect, useRef } from 'react';
import type { MatrixEnv } from '../../core/matrix/types';
import { LAYER_LABELS, REALM_LABELS, realmOf } from '../../core/matrix/types';
import { jumpToCrumb, resetToRoot } from '../../state/matrix-actions';
import { useApp } from '../../state/store';
import { IconAnchor } from '../components/Icons';
import { useTrailInfo } from './hooks';
import { stepsText } from './labels';

export function Crumbs({ env }: { env: MatrixEnv }) {
  const trail = useApp((s) => s.matrix.trail);
  const infos = useTrailInfo(env);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [trail]);
  const k = trail.length - 1;
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
        <div className="mx-crumbs" ref={scroller} data-testid="matrix-crumbs" role="group" aria-label="Murupolku lähtöankkurista">
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
        Polku takaisin ankkuriin: {stepsText(k)}
        {k > 0 && <span className="faint"> · napauta murua palataksesi</span>}
      </div>
    </div>
  );
}
