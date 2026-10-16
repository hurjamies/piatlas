// Matriisin yhteiset pienet osat: kerros- ja tasomerkit, särmärivi sekä kopiointi ja lataus.
import { useState } from 'react';
import type { Layer, MatrixEdge, Realm } from '../../core/matrix/types';
import { DIRECTION_SEMANTICS, DOMAIN_LABELS, LAYER_LABELS, nodeKey, REALM_LABELS, realmOf } from '../../core/matrix/types';
import { toast } from '../../state/actions';
import { fmtMetricValue } from './labels';

declare const __BUILD_TARGET__: string;
export const IS_ARTIFACT = typeof __BUILD_TARGET__ !== 'undefined' && __BUILD_TARGET__ === 'artifact';

/** Yhteyden tyyppi: Matemaattinen / Geometrinen / Ajallinen / Symbolinen. */
export function LayerBadge({ layer, short = false }: { layer: Layer; short?: boolean }) {
  return (
    <span className={`mx-layer l-${layer}`} title={`Yhteyden tyyppi: ${LAYER_LABELS[layer]}`}>
      {short ? LAYER_LABELS[layer].slice(0, 4) + '.' : LAYER_LABELS[layer]}
    </span>
  );
}

/** Tietokerros: π-data tai Tarinaverkko. */
export function RealmBadge({ realm }: { realm: Realm }) {
  return (
    <span className={`mx-realm r-${realm}`} title={realm === 'pi' ? 'Laskettu piin desimaaleista' : 'Käyttäjän symbolinen tarinakerros'}>
      {REALM_LABELS[realm]}
    </span>
  );
}

export function EdgeRow({
  edge,
  title,
  visited,
  onTrail,
  onOpen,
}: {
  edge: MatrixEdge;
  title: string;
  visited: boolean;
  onTrail: boolean;
  onOpen: (e: MatrixEdge) => void;
}) {
  const [open, setOpen] = useState(false);
  const key = nodeKey(edge.to);
  const toRealm = realmOf(edge.to);
  const metrics = edge.metrics ? Object.entries(edge.metrics) : [];
  return (
    <div className={`mx-edge l-${edge.layer}${edge.crossesRealm ? ' crossing' : ''}`} data-testid="matrix-edge" data-key={key}>
      <button type="button" className="mx-edge-main" onClick={() => onOpen(edge)}>
        <span className="mx-edge-rel">{edge.relation}</span>
        <span className="mx-chips">
          <span className="mx-edge-target">
            <span className={`mx-dot r-${toRealm}`} aria-hidden="true" />
            {title}
          </span>
          <LayerBadge layer={edge.layer} />
          {edge.direction && edge.domain && (
            <span className="mx-chip dir" title={DIRECTION_SEMANTICS[edge.domain][edge.direction]}>
              {edge.direction} · {DOMAIN_LABELS[edge.domain]}
            </span>
          )}
          {edge.op && <span className="mx-chip op">{edge.op.startsWith('369') ? '369' : 'hyppy'}</span>}
          {edge.verified === true && <span className="mx-chip ok">✓ tarkistettu</span>}
          {edge.verified === false && <span className="mx-chip bad">✗ ei täsmää</span>}
          {edge.crossesRealm && (
            <span className={`mx-chip cross r-${toRealm}`}>{toRealm === 'tarina' ? '→ tarinaverkko' : '→ π-data'}</span>
          )}
          {onTrail ? <span className="mx-chip trail">↺ jo polulla</span> : visited ? <span className="mx-chip seen">käyty</span> : null}
        </span>
        {metrics.length > 0 && (
          <span className="mx-metrics">
            {metrics.map(([k, v]) => (
              <span key={k}>
                {k} {fmtMetricValue(k, v)}
              </span>
            ))}
          </span>
        )}
      </button>
      <button
        type="button"
        className="mx-trace-btn"
        aria-expanded={open}
        aria-label={open ? 'Piilota jäljitys' : 'Näytä jäljitys'}
        title="Jäljitys: miten yhteys laskettiin"
        onClick={() => setOpen(!open)}
      >
        {open ? '–' : 'i'}
      </button>
      {open && <div className="mx-trace">{edge.trace}</div>}
    </div>
  );
}

/** Kopioi leikepöydälle; jos estetty, teksti näytetään valittavaksi (`onFallback`). */
export async function copyText(text: string, what: string, onFallback: (text: string) => void) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} kopioitu leikepöydälle`);
  } catch {
    onFallback(text);
    toast('Kopiointi estetty: valitse teksti alta käsin');
  }
}

export function downloadText(text: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
