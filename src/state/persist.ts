// Paikallinen tallennus. localStorage: hakutermit, ankkuri, muistiinpanot, tapahtumat, testiloki.
// IndexedDB: käyttäjän tuoma (mahdollisesti suuri) numerotiedosto.
// Kaikki kutsut on suojattu: jos selain estää tallennuksen, sovellus toimii silti.

import { AppState, DEFAULT_PREFS, DEFAULT_TERMS, store } from './store';

const KEY = 'pi-atlas:v1';

type Persisted = Pick<
  AppState,
  'terms' | 'anchor' | 'notes' | 'events' | 'audit' | 'prereg' | 'runs' | 'prefs' | 'tab' | 'mapMode' | 'spaceMode'
>;

export function loadPersisted(): Partial<Persisted> | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<Persisted>;
    if (!Array.isArray(data.terms) || !data.terms.length) data.terms = DEFAULT_TERMS;
    // Uudet oletustermit lisätään, jos käyttäjä ei ole niitä poistanut (poistetut kirjataan auditiin).
    data.prefs = { ...DEFAULT_PREFS, ...(data.prefs ?? {}) };
    return data;
  } catch {
    return null;
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;

export function startPersisting(): void {
  let last = '';
  const save = () => {
    const s = store.get();
    const data: Persisted = {
      terms: s.terms,
      anchor: s.anchor,
      notes: s.notes,
      events: s.events,
      audit: s.audit.slice(-500),
      prereg: s.prereg,
      runs: s.runs.slice(-300),
      prefs: s.prefs,
      tab: s.tab,
      mapMode: s.mapMode,
      spaceMode: s.spaceMode,
    };
    const json = JSON.stringify(data);
    if (json === last) return;
    last = json;
    try {
      localStorage.setItem(KEY, json);
    } catch {
      /* tallennus estetty: jatketaan ilman */
    }
  };
  store.subscribe(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, 400);
  });
}

// ------------------------------------------------------------------ IndexedDB

const DB = 'pi-atlas';
const STORE = 'datasets';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) {
      reject(e);
    }
  });
}

export async function saveImportedDataset(name: string, digits: string): Promise<boolean> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ name, digits, savedAt: new Date().toISOString() }, 'imported');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return true;
  } catch {
    return false;
  }
}

export async function loadImportedDataset(): Promise<{ name: string; digits: string } | null> {
  try {
    const db = await openDb();
    const v = await new Promise<{ name: string; digits: string } | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).get('imported');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    db.close();
    return v ?? null;
  } catch {
    return null;
  }
}

export async function clearImportedDataset(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete('imported');
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    /* ohita */
  }
}
