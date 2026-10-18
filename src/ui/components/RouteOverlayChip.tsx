// Polkuhaun reitin selitelappu kartoilla ja 3D:ssä ("Reitti: …") sulkemispainikkeineen. Reitti on laskettua
// π-rakennetta: numeroidut merkit ovat reitin solmut järjestyksessä (π-indeksit kartoitettuina).
import { clearPathOverlay } from '../../state/path-actions';
import { useApp } from '../../state/store';
import { fmtN } from '../format';

export function RouteOverlayChip() {
  const o = useApp((s) => s.pathOverlay);
  if (!o) return null;
  const text = o.points.map((p, i) => `${i + 1}. ${p.label} @${fmtN(p.n)}`).join(' → ');
  return (
    <span className="pd-overlay-chip" data-testid="path-overlay-chip" title={`${o.label}: ${text}`}>
      <span className="pd-overlay-text">Reitti: {text}</span>
      <button type="button" className="pd-overlay-x" aria-label="Sulje reitin näyttö" data-testid="path-overlay-close" onClick={() => clearPathOverlay()}>
        ×
      </button>
    </span>
  );
}
