import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './ui/styles.css';

declare const __BUILD_TARGET__: string;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline-käyttö: service worker vain GitHub Pages -julkaisussa (ei kehitystilassa eikä claude.ai-julkaisussa).
if (__BUILD_TARGET__ === 'pages' && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => undefined);
  });
}
