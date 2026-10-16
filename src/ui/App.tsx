import { ComponentType, useEffect } from 'react';
import { importDatasetFile, initApp, openPanel, resetAnchor, setTab } from '../state/actions';
import { store, Tab, useApp } from '../state/store';
import { fmtN } from './format';
import { HitSheet } from './components/HitSheet';
import { IconAnchor, IconClose, IconDigits, IconOcta, IconPanel, IconSpiral, IconTests } from './components/Icons';
import { EventsPanel } from './panels/EventsPanel';
import { NeighborsPanel } from './panels/NeighborsPanel';
import { TermsPanel } from './panels/TermsPanel';
import { DigitsView } from './views/DigitsView';
import { MapView } from './views/MapView';
import { SpaceView } from './views/SpaceView';
import { TestsView } from './views/TestsView';

const TABS: { id: Tab; label: string; icon: ComponentType }[] = [
  { id: 'space', label: 'Avaruus', icon: IconOcta },
  { id: 'map', label: 'Kartta', icon: IconSpiral },
  { id: 'digits', label: 'Numerot', icon: IconDigits },
  { id: 'tests', label: 'Testit', icon: IconTests },
];

export function App() {
  useEffect(() => {
    void initApp();
  }, []);
  const tab = useApp((s) => s.tab);
  const hasDigits = useApp((s) => s.digits.length > 0);
  const panel = useApp((s) => s.panel);
  const toast = useApp((s) => s.toast);

  return (
    <div className="app">
      <TopBar />
      <main className="main">
        {!hasDigits ? (
          <LoadingScreen />
        ) : (
          <>
            {tab === 'space' && <SpaceView />}
            {tab === 'map' && <MapView />}
            {tab === 'digits' && <DigitsView />}
            {tab === 'tests' && <TestsView />}
          </>
        )}
        {hasDigits && (tab === 'space' || tab === 'map') && <HitSheet />}
      </main>
      <nav className="tabbar" aria-label="Näkymät">
        {TABS.map((t) => (
          <button
            key={t.id}
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => setTab(t.id)}
            data-testid={`tab-${t.id}`}
          >
            <t.icon />
            {t.label}
          </button>
        ))}
      </nav>
      {panel && (
        <>
          <div className="scrim" onClick={() => openPanel(null)} />
          <aside className="panel" aria-label="Hakupaneeli">
            <div className="panel-head">
              <div className="seg" role="tablist">
                <button aria-pressed={panel === 'terms'} onClick={() => openPanel('terms')}>
                  Haut
                </button>
                <button aria-pressed={panel === 'neighbors'} onClick={() => openPanel('neighbors')}>
                  Naapurit
                </button>
                <button aria-pressed={panel === 'events'} onClick={() => openPanel('events')}>
                  Tapahtumat
                </button>
              </div>
              <span style={{ flex: 1 }} />
              <button className="icon-btn" onClick={() => openPanel(null)} aria-label="Sulje paneeli">
                <IconClose />
              </button>
            </div>
            <div className="panel-body">
              {panel === 'terms' && <TermsPanel />}
              {panel === 'neighbors' && <NeighborsPanel />}
              {panel === 'events' && <EventsPanel />}
            </div>
          </aside>
        </>
      )}
      {toast && (
        <div className="toast" role="status" key={toast.id}>
          {toast.text}
        </div>
      )}
    </div>
  );
}

function TopBar() {
  const info = useApp((s) => s.dataset.info);
  const status = useApp((s) => s.dataset.status);
  const anchor = useApp((s) => s.anchor);
  const anchorTerm = useApp((s) => s.terms.find((t) => t.id === s.anchor.termId));
  const isDefault = anchor.termId === 'ida' && anchor.n === 858511;
  const verified = info?.reference === 'pi-1m-verified' || info?.reference === 'pi-prefix-1m-verified';
  return (
    <header className="topbar">
      <div className="wordmark" aria-label="PI ATLAS">
        <span>
          <i>π</i> Atlas
        </span>
      </div>
      {info && (
        <span className={`chip ${verified ? 'ok' : 'warn'}`} title={`SHA-256 ${info.sha256}`} data-testid="dataset-chip">
          {info.length >= 1e6 && info.length % 1e6 === 0 ? `${info.length / 1e6}M` : fmtN(info.length)} {verified ? '✓' : '!'}
        </span>
      )}
      {status === 'loading' && info && <span className="chip">lataa…</span>}
      <span className="spacer" />
      <button
        className="chip anchor"
        onClick={() => {
          resetAnchor();
          store.set({ sheetExpanded: false });
        }}
        title={isDefault ? 'Palaa ankkuriin IDA @858 511' : 'Palauta oletusankkuri IDA @858 511'}
        data-testid="anchor-chip"
      >
        <IconAnchor />
        <b>{anchorTerm?.label ?? anchor.label}</b>
        <span className="mono">{fmtN(anchor.n)}</span>
      </button>
      <button className="icon-btn" onClick={() => openPanel('terms')} aria-label="Avaa haut ja tapahtumat" data-testid="open-panel">
        <IconPanel />
      </button>
    </header>
  );
}

function LoadingScreen() {
  const ds = useApp((s) => s.dataset);
  return (
    <div className="view">
      <div className="loading-screen">
        <div className="box">
          <div className="big">
            <i>π</i> Atlas
          </div>
          <div className="muted">The Geometry of a Life · piin desimaalien tutkimusväline</div>
          {ds.status !== 'error' ? (
            <>
              <div className="progress">
                <i style={{ width: `${Math.round(ds.progress * 100)}%` }} />
              </div>
              <div className="faint" style={{ fontSize: 12.5 }}>
                Ladataan ja tarkistetaan 1 000 000 desimaalia (SHA-256)…
              </div>
            </>
          ) : (
            <>
              <div className="note err">{ds.error}</div>
              <ImportButton />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ImportButton() {
  return (
    <label className="btn primary" style={{ cursor: 'pointer' }}>
      Tuo pi_digits_1m.txt
      <input
        type="file"
        accept=".txt,text/plain"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) await importDatasetFile(f);
        }}
      />
    </label>
  );
}
