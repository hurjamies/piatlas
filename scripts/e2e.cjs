// Päästä päähän -savutesti ja kuvakaappaukset puhelinkoossa (Chromium/Playwright).
// Käyttö: npm run build && npx vite preview --port 4173 &  sitten  npm run e2e
// Playwright ei ole projektin riippuvuus: asenna se tarvittaessa (npm i -D playwright) tai aja NODE_PATH=$(npm root -g).
// Ensimmäiset 22 tarkistusta: MVP-1–3. Sen jälkeen 44 tarinamatriisin tarkistusta (Matriisi-välilehti) 412 px:ssä ja asettelu
// 360 px:ssä. PI_ATLAS_SHOTS = kuvien kansio (oletus docs/screenshots), PI_ATLAS_SHOTS_360 = 360 px:n kuvat
// (valinnainen), PI_ATLAS_NO_WORKER=1 = ilman Web Workeria.
const path = require('path');
const fs = require('fs');
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright puuttuu. Asenna: npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}

const BASE = process.env.PI_ATLAS_URL || 'http://localhost:4173/';
const OUT = process.env.PI_ATLAS_SHOTS || path.join(__dirname, '..', 'docs', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: 'jpeg', quality: 84 });
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok, extra });
  console.log(`${ok ? '✓' : '✕'} ${name}${extra ? ' — ' + extra : ''}`);
};

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36',
  });
  const page = await ctx.newPage();
  const NO_WORKER = process.env.PI_ATLAS_NO_WORKER === '1';
  if (NO_WORKER) {
    // Simuloi ympäristöä, jossa Web Worker on estetty: sovelluksen on toimittava pääsäikeessä.
    await page.addInitScript(() => {
      window.Worker = function () {
        throw new Error('Worker estetty testissä');
      };
    });
  }
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('[data-testid="dataset-chip"]', { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('[data-testid="dataset-chip"]')?.textContent?.includes('✓'));
  check('aineisto ladattu ja varmennettu', true, (await page.textContent('[data-testid="dataset-chip"]')).trim());
  const anchorTxt = (await page.textContent('[data-testid="anchor-chip"]')).replace(/\s+/g, ' ');
  check('ankkuri IDA @858 511', /IDA/.test(anchorTxt) && /858.511/.test(anchorTxt), anchorTxt);
  await page.waitForTimeout(1500);
  const labels = await page.$$eval('.label3d', (els) => els.map((e) => e.textContent));
  check('3D: MATTI @858 260 näkyy', labels.some((l) => /MATTI.*858.260/.test(l)), labels.filter((l) => /·/.test(l)).join(' | '));
  check('3D: MINI @858 960 näkyy', labels.some((l) => /MINI.*858.960/.test(l)));
  check('3D: ankkuri näkyy', labels.some((l) => /IDA.*858.511/.test(l)));
  await shot(page, '01-avaruus');

  // napauta MATTI-pistettä 3D:ssä
  const pos = await page.evaluate(() => window.__piatlasScene.screenOf(858260));
  const box = await page.locator('.canvas-host canvas').boundingBox();
  await page.touchscreen.tap(box.x + pos.x, box.y + pos.y);
  await page.waitForTimeout(400);
  const sheet = (await page.textContent('[data-testid="hit-sheet"]')).replace(/\s+/g, ' ');
  check('3D-napautus valitsee MATTI @858 260', /MATTI/.test(sheet) && /858.260/.test(sheet), sheet.slice(0, 90));
  await page.click('.sheet-head');
  await page.waitForTimeout(300);
  const ver = (await page.textContent('.sheet .verify')).replace(/\s+/g, ' ');
  check('yksityiskohdat: lähdeaineiston numerot = 62884', /62884 = haettu koodi/.test(ver), ver.slice(0, 120));
  await shot(page, '02-osuma-avattu');

  // Numerot
  await page.click('[data-testid="tab-digits"]');
  await page.waitForSelector('[data-testid="digits-view"]');
  const v1 = (await page.textContent('[data-testid="digits-view"] .verify')).replace(/\s+/g, ' ');
  check('1D: desimaalit 858 260–858 264 ovat 62884', /62884/.test(v1));
  await shot(page, '03-numerot');

  // Kartta: spiraali, atlas, verkko
  await page.click('[data-testid="tab-map"]');
  await page.waitForSelector('[data-testid="spiral-canvas"]');
  await page.waitForTimeout(600);
  const tapMap = async (n) => {
    const p = await page.evaluate((n) => window.__piatlasMap.screenOf(n), n);
    const b = await page.locator('.main').boundingBox();
    await page.touchscreen.tap(b.x + p.x, b.y + p.y);
    await page.waitForTimeout(350);
    return (await page.textContent('[data-testid="hit-sheet"]')).replace(/\s+/g, ' ');
  };
  let t = await tapMap(858960);
  check('spiraali: napautus valitsee MINI @858 960', /MINI/.test(t) && /858.960/.test(t), t.slice(0, 60));
  await shot(page, '04-spiraali');
  await page.click('text=Valittuun');
  await page.waitForTimeout(400);
  await shot(page, '04a-spiraali-fibonacci');
  await page.click('text=Numerot näkyviin');
  await page.waitForTimeout(500);
  await shot(page, '04b-spiraali-numerot');
  await page.click('text=8 kolmiota');
  await page.waitForTimeout(500);
  t = await tapMap(858260);
  check('atlas: napautus valitsee MATTI @858 260', /MATTI/.test(t) && /858.260/.test(t), t.slice(0, 60));
  await shot(page, '05-atlas');
  await page.click('text=Avattu verkko');
  await page.waitForTimeout(500);
  t = await tapMap(858960);
  check('verkko: napautus valitsee MINI @858 960', /MINI/.test(t) && /858.960/.test(t), t.slice(0, 60));
  await shot(page, '06-verkko');
  // Legacy-vertailu 3D:ssä
  await page.click('[data-testid="tab-space"]');
  await page.waitForTimeout(300);
  await page.click('text=Legacy N=1M');
  await page.waitForTimeout(500);
  check('legacy-tila merkitty N-riippuvaksi', /riippuu aineiston koosta/.test(await page.textContent('[data-testid="space-view"]')));
  await shot(page, '10-legacy');
  await page.click('.seg >> text=Oktaedri');
  await page.click('[data-testid="tab-map"]');
  await page.waitForTimeout(300);
  // ankkurin palautus yhdellä painikkeella
  await page.click('[data-testid="anchor-chip"]');
  await page.waitForTimeout(300);
  const sheet2 = (await page.textContent('[data-testid="hit-sheet"]')).replace(/\s+/g, ' ');
  check('ankkuripainike palauttaa IDA @858 511', /IDA/.test(sheet2) && /858.511/.test(sheet2));

  // Testit: kontrolloitu läheisyystesti
  await page.click('[data-testid="tab-tests"]');
  await page.waitForSelector('[data-testid="run-mc"]');
  await page.click('[data-testid="run-mc"]');
  await page.waitForSelector('[data-testid="mc-result"]', { timeout: 60000 });
  const mc = (await page.textContent('[data-testid="mc-result"]')).replace(/\s+/g, ' ');
  check('Monte Carlo -testi valmistui', /p \(Monte Carlo\)/.test(mc), mc.slice(0, 160));
  await page.locator('[data-testid="mc-result"]').scrollIntoViewIfNeeded();
  await shot(page, '07-testi');
  const engine = await page.textContent('[data-testid="tests-view"]');
  if (NO_WORKER) check('varapolku: laskenta pääsäikeessä', /pääsäie/.test(engine));
  else check('laskenta Web Workerissa', /Laskenta: Web Worker/.test(engine));

  // esirekisteröinti → lukittu ajo. Uusi kysymys: S2 (valintakorjattu) 3D:ssä, jota ei ole vielä ajettu.
  await page.selectOption('#mc-stat', 'setMin');
  await page.selectOption('#mc-a', 'ida');
  await page.click('text=Lukitse hypoteesi nykyisillä asetuksilla');
  await page.waitForSelector('text=Aja lukittu testi');
  await page.click('text=Aja lukittu testi');
  await page.waitForFunction(() => /ennalta lukittu/.test(document.querySelector('[data-testid="mc-result"]')?.textContent || ''), null, { timeout: 60000 });
  check('esirekisteröity testi merkitään lukituksi', true);
  // satunnaisjonokontrolli
  await page.selectOption('select[aria-label="Satunnaisjonojen määrä"]', '20');
  await page.click('text=Satunnaisjonokontrolli');
  await page.waitForSelector('text=siemenellistä satunnaista', { timeout: 90000 });
  const rc = (await page.textContent('[data-testid="tests-view"]')).replace(/\s+/g, ' ');
  check('satunnaisjonokontrolli valmistui', /20 siemenellistä satunnaista 0–9-jonoa/.test(rc));
  check('testiloki ja monivertailu näkyvät', /Ajettu 3 testiä/.test(rc), (rc.match(/Ajettu \d+ testiä/) || [''])[0]);

  // uusi hakutermi ääkkösillä
  await page.click('[data-testid="open-panel"]');
  await page.fill('#term-value', 'Äiti');
  await page.waitForTimeout(150);
  const prev = (await page.textContent('.panel form.card')).replace(/\s+/g, ' ');
  check('lisäyslomake: ÄITI → T9 2484 (translitterointi)', /Koodi 2484/.test(prev), prev.slice(prev.indexOf('Koodi'), prev.indexOf('Koodi') + 40));
  await page.click('text=Lisää ja hae');
  await page.waitForFunction(() => /ÄITI/.test(document.querySelector('.panel-body')?.textContent || '') && /2484 · \d+ osumaa/.test(document.querySelector('.panel-body')?.textContent || ''), null, { timeout: 20000 });
  check('uusi termi haettu', true);
  // tapahtuma ja käsin linkitys valittuun osumaan
  await page.click('.panel-head >> text=Tapahtumat');
  await page.fill('#ev-title', 'Testitapahtuma');
  await page.fill('#ev-date', '2014-03-23');
  await page.click('text=Tallenna tapahtuma');
  await page.click('text=Linkitä valittuun osumaan');
  await page.waitForTimeout(200);
  const evTxt = await page.textContent('.panel-body');
  check('tapahtuma linkitetty käsin valittuun osumaan', /858.511/.test(evTxt));
  await shot(page, '11-tapahtumat');
  await page.click('.panel-head >> text=Haut');

  // paneeli
  await page.click('[data-testid="open-panel"]').catch(() => undefined);
  await page.waitForTimeout(300);
  await shot(page, '08-haut');
  await page.click('.panel-head >> text=Naapurit');
  await page.waitForTimeout(300);
  await shot(page, '09-naapurit');

  check('ei konsolivirheitä', errors.length === 0, errors.slice(0, 3).join(' | '));

  // ================================================================== Matriisi (Recursive Story Matrix)
  // Sama sivu jatkuu: aiemmat termit ja tapahtumat ovat mukana, matriisin tila on oletus (juuri, suunta 234).
  // Lopuksi sama polku ajetaan 360 px leveässä kontekstissa vaakaylivuodon tarkistamiseksi.
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const mtext = async (p, sel) => norm(await p.textContent(sel));
  const crumbsOf = (p) =>
    p.$$eval('[data-testid^="matrix-crumb-"]', (els) =>
      els.map((e) => ({
        meta: (e.querySelector('.mx-crumb-meta')?.textContent || '').replace(/\s+/g, ' ').trim(),
        title: (e.querySelector('.mx-crumb-title')?.textContent || '').replace(/\s+/g, ' ').trim(),
      })),
    );
  const groupsOf = (p) =>
    p.$$eval('[data-testid="matrix-edges"] .mx-group', (gs) =>
      gs.map((g) => ({
        name: (g.querySelector('.mx-group-name')?.textContent || '').trim(),
        rows: [...g.querySelectorAll('[data-testid="matrix-edge"]')].map((r) => ({
          key: r.getAttribute('data-key'),
          text: r.textContent.replace(/\s+/g, ' ').trim(),
        })),
      })),
    );
  const group = async (p, name) => (await groupsOf(p)).find((g) => g.name === name) || { name, rows: [] };
  const focusTitle = async (p) => mtext(p, '[data-testid="matrix-focus"] h2');
  /** Avaa yhteyslistan rivin solmuavaimella (ei 369-löytöjä, joilla on sama rivikomponentti). */
  const openKey = async (p, key) => {
    const loc = p.locator(`[data-testid="matrix-edges"] [data-testid="matrix-edge"][data-key="${key}"] .mx-edge-main`).first();
    await loc.click();
    await p.waitForTimeout(250);
  };
  /** Vierittää matriisinäkymää niin, että elementti on heti tahmean murupolun alla. */
  const scrollTo = (p, sel, pad = 8) =>
    p.evaluate(
      ([sel, pad]) => {
        const view = document.querySelector('[data-testid="matrix-view"]');
        const el = document.querySelector(sel);
        if (!view || !el) return;
        const head = view.querySelector('.mx-crumbs-wrap');
        const y = el.getBoundingClientRect().top - view.getBoundingClientRect().top + view.scrollTop - (head ? head.offsetHeight : 0) - pad;
        view.scrollTop = Math.max(0, y);
      },
      [sel, pad],
    );
  const scrollTop = (p) => p.evaluate(() => (document.querySelector('[data-testid="matrix-view"]').scrollTop = 0));
  /** Ilmoitus (toast) peittää osan näkymästä: kuvat otetaan vasta, kun se on poistunut. */
  const noToast = (p) => p.waitForSelector('.toast', { state: 'detached', timeout: 5000 }).catch(() => undefined);
  /** Jokainen yhteysrivi näyttää yhteyden tyypin (Matemaattinen/…) ja kohteen kerroksen (π-data/Tarinaverkko). */
  const edgeRowIssues = (p) =>
    p.$$eval('[data-testid="matrix-edge"]', (rows) =>
      rows
        .map((r) => {
          const layer = r.querySelector('.mx-layer')?.textContent || '';
          const realm = r.querySelector('.mx-chip.realm, .mx-chip.cross')?.textContent || '';
          const ok = /^(Matemaattinen|Geometrinen|Ajallinen|Symbolinen)$/.test(layer) && /π-data|Tarinaverkko/.test(realm);
          return ok ? null : `${r.getAttribute('data-key')}: "${layer}" / "${realm}"`;
        })
        .filter(Boolean),
    );
  const edgeRowLog = [];
  const edgeRowsAt = async (p, label) => {
    const n = await p.$$eval('[data-testid="matrix-edge"]', (rows) => rows.length);
    edgeRowLog.push({ label, n, issues: await edgeRowIssues(p) });
  };
  /**
   * Vaakaylivuoto: dokumentti ei saa olla ikkunaa leveämpi, matriisinäkymä ei saa vieriä sivuttain, eikä mikään
   * näkymän elementti saa ulottua ikkunan ulkopuolelle. Tarkoitukselliset vaakavierittäjät (murupolku, taulukot)
   * ohitetaan. Verkkokuvan nimilappujen on mahduttava kuvaan.
   */
  const layoutIssues = (p) =>
    p.evaluate(() => {
      const iw = window.innerWidth;
      const out = [];
      if (document.documentElement.scrollWidth > iw) out.push(`document.scrollWidth ${document.documentElement.scrollWidth} > ${iw}`);
      const view = document.querySelector('[data-testid="matrix-view"]');
      if (view && view.scrollWidth > view.clientWidth + 1) out.push(`matrix-view.scrollWidth ${view.scrollWidth} > ${view.clientWidth}`);
      const desc = (el) => `${el.tagName.toLowerCase()}.${String(el.getAttribute('class') || '').split(' ')[0]} "${(el.textContent || '').trim().slice(0, 24)}"`;
      if (view)
        for (const el of view.querySelectorAll('*')) {
          if (el.closest('.mx-crumbs, .table-wrap')) continue;
          const b = el.getBoundingClientRect();
          if (b.width > 0 && b.height > 0 && (b.right > iw + 1 || b.left < -1)) out.push(`${desc(el)} ${Math.round(b.left)}…${Math.round(b.right)}`);
          if (out.length > 6) break;
        }
      const svg = document.querySelector('[data-testid="matrix-net"]');
      if (svg) {
        const s = svg.getBoundingClientRect();
        for (const t of svg.querySelectorAll('.mx-net-label, .mx-center-label')) {
          const b = t.getBoundingClientRect();
          if (b.left < s.left - 1 || b.right > s.right + 1 || b.top < s.top - 1 || b.bottom > s.bottom + 1)
            out.push(`verkkokuvan nimilappu "${t.textContent}" leikkautuu`);
        }
        // Keskilappu ei saa peittää kehän solmuja, ja sen teksti mahtuu lappuun.
        const pill = svg.querySelector('.mx-center')?.getBoundingClientRect();
        const ctext = svg.querySelector('.mx-center-label')?.getBoundingClientRect();
        if (pill) {
          if (ctext && (ctext.left < pill.left - 0.5 || ctext.right > pill.right + 0.5)) out.push('keskilapun teksti ylittää lapun');
          for (const c of svg.querySelectorAll('.mx-node')) {
            const b = c.getBoundingClientRect();
            if (b.right > pill.left && b.left < pill.right && b.bottom > pill.top && b.top < pill.bottom)
              out.push(`keskilappu peittää solmun ${c.closest('[data-key]')?.getAttribute('data-key')}`);
          }
        }
      }
      return out;
    });
  const tabbarIssues = (p) =>
    p.evaluate(() => {
      const iw = window.innerWidth;
      return [...document.querySelectorAll('.tabbar button')]
        .map((b) => ({ t: b.textContent.trim(), r: b.getBoundingClientRect(), w: b.scrollWidth > b.clientWidth + 1 }))
        .filter((x) => x.r.right > iw + 1 || x.r.left < -1 || x.w)
        .map((x) => `välilehti ${x.t} ei mahdu`);
    });
  const layoutLog = [];
  const layoutAt = async (p, label) => {
    const issues = await layoutIssues(p);
    layoutLog.push({ label, issues });
    return issues;
  };
  const sameHost = new URL(BASE).host;
  const external = [];
  const onRequest = (req) => {
    const u = req.url();
    if (/^(data|blob):/.test(u)) return;
    const h = new URL(u).host;
    // Fontit ladataan Googlelta jo ennen matriisia (index.html); kaikki muu on oltava sovelluksen omaa.
    if (h !== sameHost && h !== 'fonts.googleapis.com' && h !== 'fonts.gstatic.com') external.push(u);
  };
  page.on('request', onRequest);

  await page.click('[aria-label="Sulje paneeli"]');
  await page.waitForTimeout(200);
  await page.click('[data-testid="tab-matrix"]');
  await page.waitForSelector('[data-testid="matrix-identifiers"]', { timeout: 20000 });
  await page.waitForTimeout(300);
  const rootTitle = await focusTitle(page);
  check(
    'matriisi: välilehti avautuu lähtöankkurissa',
    /Lähtöankkuri IDA 432 @858.511/.test(rootTitle) && (await crumbsOf(page)).length === 1,
    rootTitle,
  );
  const idents = await page.$$eval('[data-testid="matrix-identifiers"] .mx-ident', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ')));
  const ident = (name) => idents.find((t) => t.startsWith(name)) || '';
  check('matriisi: lähtötunniste IDA 432 @858 511 ✓', /^IDA\s*432\s*✓/.test(ident('IDA')) && /@858.511: 432 ✓/.test(ident('IDA')), ident('IDA'));
  check('matriisi: lähtötunniste MATTI 62884 @858 260 ✓', /^MATTI\s*62884\s*✓/.test(ident('MATTI')) && /@858.260: 62884 ✓/.test(ident('MATTI')), ident('MATTI'));
  check('matriisi: lähtötunniste MINI 6464 @858 960 ✓', /^MINI\s*6464\s*✓/.test(ident('MINI')) && /@858.960: 6464 ✓/.test(ident('MINI')), ident('MINI'));
  await layoutAt(page, 'juuri');
  await edgeRowsAt(page, 'juuri');
  await scrollTo(page, '[data-testid="matrix-identifiers"]');
  await page.waitForTimeout(150);
  await shot(page, '12-matriisi-juuri');

  // Ensimmäinen testireitti todellisia särmiä pitkin.
  await page.click('[data-testid="matrix-first-route-root"]');
  await page.waitForSelector('[data-testid="matrix-crumb-5"]');
  await page.waitForTimeout(250);
  const route = await crumbsOf(page);
  const routeTxt = route.map((c) => c.title).join(' › ');
  const routeExpect = [/^Lähtöankkuri IDA 432 @858.511$/, /^MAX 629$/, /^2 \(2\/3 koodissa 629\)$/, /^2 = HANNA$/, /^HANNA$/, /^HANNA III$/];
  check(
    'matriisi: testireitti MAX (629) → 2 → tulkinta → HANNA → HANNA III',
    route.length === 6 && routeExpect.every((re, i) => re.test(route[i]?.title || '')),
    routeTxt,
  );
  const metaOk = route.every((c, i) => (i === 0 ? /^π-data · lähtö$/ : /^(π-data|Tarinaverkko) · (Matemaattinen|Geometrinen|Ajallinen|Symbolinen)$/).test(c.meta));
  const realmsOk = route.map((c) => c.meta.split(' · ')[0]).join(',') === 'π-data,π-data,π-data,Tarinaverkko,Tarinaverkko,Tarinaverkko';
  check('matriisi: jokainen muru näyttää kerroksen ja yhteyden tyypin', metaOk && realmsOk, route.map((c) => c.meta).join(' | '));
  const divider = await page.evaluate(() => {
    const ds = [...document.querySelectorAll('[data-testid="matrix-crumbs"] .mx-divider')];
    if (ds.length !== 1) return { n: ds.length };
    const d = ds[0];
    const row = d.parentElement;
    row.scrollLeft += d.getBoundingClientRect().left - row.getBoundingClientRect().left - 70;
    const r = d.getBoundingClientRect();
    const rr = row.getBoundingClientRect();
    return {
      n: 1,
      text: d.textContent.trim(),
      prev: d.previousElementSibling?.getAttribute('data-testid'),
      next: d.nextElementSibling?.getAttribute('data-testid'),
      visible: r.left >= rr.left - 1 && r.right <= rr.right + 1 && r.width > 0,
    };
  });
  await scrollTop(page);
  await page.waitForTimeout(150);
  const banner = await page.locator('[data-testid="matrix-realm-banner"]');
  const bannerTxt = norm(await banner.textContent());
  const bb = await banner.boundingBox();
  const foot = await mtext(page, '.mx-crumbs-foot');
  check(
    'matriisi: kerrosvaihto π-data | tarina murupolussa ja ilmoitus näkyy',
    divider.n === 1 &&
      divider.text === 'π-data | tarina' &&
      divider.prev === 'matrix-crumb-2' &&
      divider.next === 'matrix-crumb-3' &&
      divider.visible &&
      /Siirryt piin todellisesta datasta symboliseen tarinaverkkoon\./.test(bannerTxt) &&
      !!bb && bb.y >= 0 && bb.y + bb.height <= 915 &&
      /Polku takaisin ankkuriin: 5 askelta/.test(foot) &&
      /π-data 3\s*\|\s*tarina 3/.test(foot),
    `${divider.text} (${divider.prev} | ${divider.next}) · ${bannerTxt.slice(0, 70)} · ${foot}`,
  );
  await noToast(page);
  await shot(page, '13-matriisi-testireitti');
  await layoutAt(page, 'HANNA III 234');
  await edgeRowsAt(page, 'HANNA III 234');

  // HANNA III suuntaan 234: polkujen jatkot.
  const junc234 = await mtext(page, '[data-testid="matrix-junction"]');
  const cont234 = await group(page, 'Jatko suuntaan 234');
  const contKeys = cont234.rows.map((r) => r.key).join(' ');
  check(
    'matriisi: HANNA III suuntaan 234 — polku A → MAX, polku B → SALLA → IDA',
    /HANNA III → MAX/.test(junc234) &&
      /HANNA III → SALLA → IDA/.test(junc234) &&
      contKeys === 'person:max person:salla person:ida' &&
      /jatko polulla A: → MAX/.test(cont234.rows[0]?.text) &&
      /jatko polulla B: → SALLA → IDA/.test(cont234.rows[2]?.text),
    `${junc234.slice(0, 120)} · ${contKeys}`,
  );

  // Suunta 432: selitys vaihtuu, ja polku B avautuu käänteisenä polkusolmussa.
  const help234 = await mtext(page, '[data-testid="matrix-dir-help"]');
  await page.click('[data-testid="matrix-dir-432"]');
  await page.waitForTimeout(250);
  const help432 = await mtext(page, '[data-testid="matrix-dir-help"]');
  check(
    'matriisi: suunnan 432 selitys vaihtuu',
    /^234 · tarina: polun järjestyksessä eteenpäin/.test(help234) && /^432 · tarina: polkua takaperin/.test(help432),
    `${help234} → ${help432}`,
  );
  await openKey(page, 'path:polku-b');
  const pathTitle = await focusTitle(page);
  const symChips = await page.$$eval('[data-testid="matrix-path-symbols"] .mx-sym-chip', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  const steps432 = await group(page, 'Polun askeleet suunnassa 432');
  const symTxt = await mtext(page, '[data-testid="matrix-path-symbols"]');
  const symMatch = await group(page, 'Merkkijonon yhtäläisyys');
  check(
    'matriisi: polku B suuntaan 432 — IDA → SALLA → HANNA III polkusolmussa',
    /^Polku B/.test(pathTitle) &&
      symChips.join(' | ') === '4IDA | 3SALLA | 2HANNA III' &&
      steps432.rows.map((r) => r.key).join(' ') === 'person:ida person:salla person:hanna-3' &&
      /jo polulla/.test(steps432.rows[2]?.text) &&
      /Symbolinen numerojono 432/.test(symTxt) &&
      /ei π-havainto/.test(symMatch.rows[0]?.text || ''),
    `${pathTitle} · ${symChips.join(' → ')} · ${(symMatch.rows[0]?.text || '').slice(0, 60)}`,
  );
  await layoutAt(page, 'polku B 432');
  await edgeRowsAt(page, 'polku B 432');
  const before = (await crumbsOf(page)).map((c) => c.title);
  await openKey(page, 'person:hanna-3');
  const toastTxt = await page.textContent('.toast').catch(() => '');
  const after = (await crumbsOf(page)).map((c) => c.title);
  check(
    'matriisi: polulla olevan solmun avaus ei monista murua',
    before.length === 7 && after.length === 6 && after.join('|') === route.map((c) => c.title).join('|') && new Set(after).size === after.length && /Palattiin polulla olevaan solmuun/.test(toastTxt),
    `${before.length} → ${after.length} murua · ${norm(toastTxt)}`,
  );

  // Samannimiset: nimisolmusta HANNA kolmen Hannan kronologia.
  await page.click('[data-testid="matrix-dir-234"]');
  await page.click('[data-testid="matrix-crumb-4"]');
  await page.waitForTimeout(250);
  const nameFacts = await mtext(page, '[data-testid="matrix-focus"] .mx-facts');
  const nameCode = await group(page, 'Koodi');
  check(
    'matriisi: nimen HANNA T9-koodi 42662',
    (await focusTitle(page)) === 'HANNA' && /T9-koodi.*42662 \(T9: H=4 A=2 N=6 N=6 A=2 → 42662\)/.test(nameFacts) && nameCode.rows[0]?.key === 'code:42662',
    nameFacts.slice(0, 90),
  );
  await openKey(page, 'homonyms:HANNA');
  const homTitle = await focusTitle(page);
  const chrono = await page.$$eval('[data-testid="matrix-homonyms"] .mx-chrono-chip', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  const homTxt = await mtext(page, '[data-testid="matrix-homonyms"]');
  const homPersons = await group(page, 'Samannimiset henkilöt');
  const homCode = await group(page, 'Koodi');
  check(
    'matriisi: samannimiset HANNA I → II → III ovat kolme eri henkilöä',
    /^HANNA · samannimiset \(3\)$/.test(homTitle) &&
      chrono.join(' | ') === 'IHANNA I | IIHANNA II | IIIHANNA III' &&
      homPersons.rows.map((r) => r.key).join(' ') === 'person:hanna-1 person:hanna-2 person:hanna-3' &&
      /ei symbolinen polku/.test(homTxt) &&
      homCode.rows[0]?.key === 'code:42662',
    `${homTitle} · ${chrono.join(' → ')}`,
  );
  await layoutAt(page, 'samannimiset');
  await edgeRowsAt(page, 'samannimiset');
  await scrollTo(page, '[data-testid="matrix-focus"]');
  await page.waitForTimeout(150);
  await noToast(page);
  await shot(page, '14-matriisi-hannat');

  // Ankkuriosumasta suuntaan 234: HANNA @858 610 (Δn +99) tarkistettuna, ja koodin 42662 kaikki osumat.
  await page.click('[data-testid="matrix-root"]');
  await page.waitForTimeout(250);
  await openKey(page, 'hit:432@858511');
  const anchorHit = await focusTitle(page);
  const refNear = await group(page, 'Viitekoodien lähimmät osumat suunnassa');
  const hannaRow = refNear.rows.find((r) => r.key === 'hit:42662@858610');
  check(
    'matriisi: ankkuriosumasta suuntaan 234 HANNA @858 610 (Δn +99) ✓',
    /^432 @858.511$/.test(anchorHit) && !!hannaRow && /lähin HANNA 42662 @858.610 \(Δn \+99\)/.test(hannaRow.text) && /✓ tarkistettu/.test(hannaRow.text),
    hannaRow ? hannaRow.text.slice(0, 110) : refNear.rows.map((r) => r.key).join(' '),
  );
  await layoutAt(page, 'osuma IDA @858 511');
  await openKey(page, 'hit:42662@858610');
  const hannaHit = await mtext(page, '[data-testid="matrix-focus"]');
  check(
    'matriisi: osuma 42662 @858 610 tarkistettu lähdeaineistosta',
    /^42662 @858.610$/.test(await focusTitle(page)) && /digits\[858610…858614\] = "42662" ✓/.test(hannaHit) && /\+99 \(ankkuri IDA 432 @858.511\)/.test(hannaHit),
    (hannaHit.match(/Tarkistus lähdeaineistosta.{0,50}/) || [''])[0],
  );
  await layoutAt(page, 'osuma HANNA @858 610');
  await edgeRowsAt(page, 'osuma HANNA @858 610');
  await openKey(page, 'code:42662');
  const all42662 = await group(page, 'Kaikki osumat (7)');
  check(
    'matriisi: koodin 42662 kaikki osumat: 7',
    all42662.rows.length === 7 && all42662.rows.every((r) => /^hit:42662@\d+$/.test(r.key) && /✓ tarkistettu/.test(r.text)) && all42662.rows.some((r) => r.key === 'hit:42662@858610'),
    all42662.rows.map((r) => r.key.split('@')[1]).join(', '),
  );
  // 369 koodisolmussa 42662: vertailumenetelmät eivät löydä mitään → kokonaistulos ”Ei uutta”. Geometrisen kävelyn
  // askeleet ovat ”raportoituja askeleita” (tuotetaan aina), eivät löytöjä, eivätkä ne estä ”Ei uutta” -tulosta.
  await page.click('[data-testid="matrix-369"]');
  await page.waitForSelector('[data-testid="matrix-369-result"]', { timeout: 30000 });
  await page.waitForTimeout(800);
  const code369 = await page.evaluate(() => {
    const res = document.querySelector('[data-testid="matrix-369-result"]');
    const t = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const geo = [...res.querySelectorAll('.mx-method')].find((m) => m.querySelector('.mx-method-id')?.textContent === 'geo-369');
    return {
      summary: t(res.querySelector('.mx-summary')?.textContent),
      noneChip: !!res.querySelector('.mx-summary.none .mx-chip'),
      geoChips: geo ? [...geo.querySelectorAll('summary .mx-chip')].map((c) => ({ text: t(c.textContent), gold: c.classList.contains('gold') })) : [],
      geoBlocks: geo ? [...geo.querySelectorAll('.mx-dirblock')].map((b) => ({ text: t(b.textContent), found: b.classList.contains('found') })) : [],
      geoReported: geo ? geo.querySelectorAll('[data-testid="matrix-369-reported"]').length : -1,
    };
  });
  check(
    'matriisi: 369 koodissa 42662 — kokonaistulos ”Ei uutta”, geo-369 vain raportoituja askeleita',
    code369.noneChip &&
      /^Ei uutta Ei uutta: mikään menetelmä ei löytänyt yhteyttä\. Lisäksi geo-369: \d+ raportoitua kävelyaskelta \(tuotetaan aina, eivät ole löytöjä; odotusta ei määritellä\)\.$/.test(code369.summary) &&
      code369.geoChips.length === 2 &&
      code369.geoChips.every((c) => /^(234|432): (\d+ raportoitua askelta|1 raportoitu askel|ei askeleita)$/.test(c.text) && !c.gold) &&
      code369.geoBlocks.length === 2 &&
      code369.geoBlocks.every((b) => /raportoidut askeleet \(aina tuotetaan\) \d+ · odotus ei määritelty/.test(b.text) && /Ei löytöjä: kävelyn askeleet tuotetaan aina/.test(b.text) && !b.found),
    `${code369.summary.slice(0, 150)} · geo: ${code369.geoChips.map((c) => c.text + (c.gold ? ' (kulta)' : '')).join(', ')}`,
  );
  await page.click('[data-testid="matrix-view-lista"]');
  await page.waitForTimeout(250);
  const listHasNet = await page.$('[data-testid="matrix-net"]');
  check('matriisi: Lista-näkymä näyttää yhteydet ilman verkkokuvaa', !listHasNet && (await groupsOf(page)).length > 3);
  await layoutAt(page, 'koodi 42662 lista');
  await page.click('[data-testid="matrix-view-verkko"]');
  await page.waitForTimeout(250);

  // 369-avausavain osumasolmussa HANNA @858 610.
  await page.click('[data-testid="matrix-crumb-2"]');
  await page.waitForTimeout(250);
  await page.click('[data-testid="matrix-369"]');
  await page.waitForSelector('[data-testid="matrix-369-result"]', { timeout: 30000 });
  await page.waitForTimeout(1000); // tulos vieritetään näkyviin pehmeästi
  const ops = await page.$$eval('[data-testid="matrix-369-result"] .mx-method', (els) =>
    els.map((e) => ({
      id: e.querySelector('.mx-method-id')?.textContent || '',
      head: (e.querySelector('summary')?.textContent || '').replace(/\s+/g, ' '),
      dirs: [...e.querySelectorAll('.mx-dirblock-head .mx-chip')].map((c) => c.textContent.replace(/\s+/g, ' ').trim()),
      none: e.textContent.includes('Ei uutta'),
    })),
  );
  const r369 = await mtext(page, '[data-testid="matrix-369-result"]');
  const bothDirs = ops.every(
    (o) => o.dirs.some((d) => /^valittu 234/.test(d)) && o.dirs.some((d) => /^vastakkainen 432/.test(d)) && /234: /.test(o.head) && /432: /.test(o.head),
  );
  check(
    'matriisi: 369 — 6 menetelmää, molemmat suunnat, ”Ei uutta” ja vastuuvapauslauseke',
    ops.map((o) => o.id).join(',') === 'offset-369,skip-369,mod-9,digital-root,geo-369,fib-3k' &&
      bothDirs &&
      ops.some((o) => o.none) &&
      /369 on laskennallinen tarkistus\. Se ei tuota tulkintaa/.test(r369),
    ops.map((o) => o.head.replace(/^.*?(offset-369|skip-369|mod-9|digital-root|geo-369|fib-3k)/, '$1')).join(' · '),
  );
  await layoutAt(page, '369');
  await edgeRowsAt(page, '369 (löydöt mukana)');
  await scrollTo(page, '[data-testid="matrix-369-result"]');
  await page.waitForTimeout(200);
  await noToast(page);
  await shot(page, '15-matriisi-369');

  // Reitin tallennus: osumasta nimeen HANNA (kerrosvaihto), oma tulkinta ja ajoitus.
  await openKey(page, 'name:HANNA');
  await page.click('[data-testid="matrix-save"]');
  await page.fill('#mx-save-title', 'IDA → HANNA +99');
  await page.fill('#mx-save-interp', 'Oma testitulkinta: tarinakerros, ei todiste.');
  await page.selectOption('#mx-save-timing', 'löydön-jälkeen');
  await layoutAt(page, 'tallennuslomake');
  // Lukituksia ei vielä ole: lomake kertoo, miksi ”ennen löydöstä” ei ole valittavissa.
  const lockHelp = norm(await page.textContent('[data-testid="matrix-save-lock-help"]').catch(() => ''));
  await page.click('[data-testid="matrix-save-confirm"]');
  await page.waitForTimeout(250);
  await page.click('[data-testid="matrix-sub-reitit"]');
  await page.waitForSelector('[data-testid="matrix-saved-route"]');
  const savedTxt = await mtext(page, '[data-testid="matrix-saved-route"]');
  check(
    'matriisi: tallennettu reitti näkyy Reitit-sivulla ajoituksineen',
    /IDA → HANNA \+99/.test(savedTxt) &&
      /Muodostettu löydön jälkeen/.test(savedTxt) &&
      /π \| tarina/.test(savedTxt) &&
      /42662 @858.610 ✓ digits 858.610–858.614 = 42662/.test(savedTxt) &&
      /Oma testitulkinta/.test(savedTxt) &&
      /tämän reitin koodien hypoteesi on lukittu/.test(lockHelp),
    savedTxt.slice(0, 120),
  );
  // Tallennetun reitin jokainen askel näyttää kerroksen ja yhteyden tyypin (kuten elävä murupolku).
  const savedLayers = await page.$$eval('[data-testid="matrix-saved-route"] [data-testid="matrix-saved-step-layer"]', (els) =>
    els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()),
  );
  check(
    'matriisi: tallennetun reitin askeleet näyttävät kerroksen ja tyypin',
    savedLayers.length === 4 &&
      savedLayers[0] === 'π-data · lähtö' &&
      savedLayers.slice(1).every((l) => /^(π-data|Tarinaverkko) · (Matemaattinen|Geometrinen|Ajallinen|Symbolinen)$/.test(l)) &&
      savedLayers.slice(0, 3).every((l) => l.startsWith('π-data')) &&
      savedLayers[3].startsWith('Tarinaverkko'),
    savedLayers.join(' › '),
  );
  await layoutAt(page, 'reitit');

  // Reittitesti R = 200 ensimmäiselle testireitille. Reitti tulee tehtävänannosta (muodostettu IDA @858 511:n ja
  // HANNA @858 610:n ympärille), joten lukituskaan ei tee siitä ”ennen löydöstä”: ajoitus on ”löydön jälkeen” ja syy näkyy.
  const timingTxt = () => mtext(page, '[data-testid="matrix-route-timing"]');
  await page.selectOption('#mx-route-r', '200');
  const timingBefore = await timingTxt();
  await page.click('[data-testid="matrix-route-lock"]');
  await page.waitForSelector('.mx-lock .card', { timeout: 10000 });
  await page.waitForTimeout(150);
  const timingLocked = await timingTxt();
  const lockCard = await mtext(page, '.mx-lock .card');
  const taskTiming = (t) =>
    /^Tämän ajon hypoteesin ajoitus: Muodostettu löydön jälkeen\. Reitti tulee tehtävänannosta \(ensimmäinen testireitti MAX → HANNA → SALLA → IDA\)\./.test(t) &&
    !/Määritelty ennen löydöstä/.test(t);
  check(
    'matriisi: ensimmäistä testireittiä ei voi lukita ”ennen löydöstä” — ajoitus ”löydön jälkeen”, syy näkyy',
    taskTiming(timingBefore) && taskTiming(timingLocked) && /SHA-256 [0-9a-f]{16}… · lukittu tällä laitteella/.test(lockCard),
    `${timingLocked.slice(0, 160)} · ${lockCard.slice(0, 60)}`,
  );
  await page.click('[data-testid="matrix-route-run"]');
  await page.waitForSelector('[data-testid="matrix-route-result"]', { timeout: 120000 });
  await page.waitForTimeout(1000); // tulos vieritetään näkyviin pehmeästi
  const rres = await mtext(page, '[data-testid="matrix-route-result"]');
  const mcw = await mtext(page, '[data-testid="matrix-route-mc-warning"]');
  check(
    'matriisi: reittitesti R = 200 näyttää p:n ja määritelmän (lukittunakin ”löydön jälkeen”)',
    /p \(Monte Carlo\)\s*\d,\d+/.test(rres) &&
      /Testisuure: lyhin ikkuna reitille 629 → 42662 → 72552 → 432/.test(rres) &&
      /R = 200 kertaa/.test(rres) &&
      /Muodostettu löydön jälkeen/.test(rres) &&
      /Ajoitus\s*Muodostettu löydön jälkeen — Reitti tulee tehtävänannosta/.test(rres) &&
      !/Määritelty ennen löydöstä/.test(rres) &&
      /Matriisin reittitestejä ajettu 1\./.test(mcw),
    `${(rres.match(/p \(Monte Carlo\).{0,40}/) || [''])[0]} · ${(rres.match(/Ajoitus\s*Muodostettu.{0,60}/) || [''])[0]}`,
  );
  await layoutAt(page, 'reittitesti');
  await scrollTo(page, '[data-testid="matrix-route-result"]');
  await page.waitForTimeout(200);
  await noToast(page);
  await shot(page, '16-matriisi-reitit');

  // Käynnissä oleva reittitesti säilyy, kun Reitit-sivulta poistutaan: eteneminen, parametrit ja Keskeytä näkyvät
  // palatessa (tai valmis tulos). Keskeytys pysäyttää ajon, eikä keskeytettyä ajoa kirjata.
  await page.selectOption('#mx-route-r', '5000');
  await page.selectOption('#mx-route-strings', '20');
  await page.click('[data-testid="matrix-route-run"]');
  await page.waitForSelector('[data-testid="matrix-route-running"]', { timeout: 10000 });
  const runBtn = async () => ({
    text: norm(await page.textContent('[data-testid="matrix-route-run"]')),
    disabled: await page.isDisabled('[data-testid="matrix-route-run"]'),
  });
  const btnDuring = await runBtn();
  await scrollTo(page, '[data-testid="matrix-route-running"]', 120);
  await page.waitForTimeout(150);
  await shot(page, '19-matriisi-reittitesti-kaynnissa');
  await page.click('[data-testid="matrix-sub-loki"]');
  await page.waitForSelector('[data-testid="matrix-log"]');
  await page.waitForTimeout(300);
  await page.click('[data-testid="matrix-sub-reitit"]');
  await page.waitForSelector('[data-testid="matrix-route-test"]');
  const back5000 = await page.evaluate(() => {
    const t = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const run = document.querySelector('[data-testid="matrix-route-run"]');
    return {
      running: t(document.querySelector('[data-testid="matrix-route-running"]')?.textContent),
      cancel: !!document.querySelector('[data-testid="matrix-route-cancel"]'),
      runDisabled: !!run?.disabled,
      runText: t(run?.textContent),
      R: document.querySelector('#mx-route-r')?.value,
      strings: document.querySelector('#mx-route-strings')?.value,
      result: t(document.querySelector('[data-testid="matrix-route-result"]')?.textContent),
    };
  });
  const stillRunning = !!back5000.running;
  check(
    'matriisi: reittitesti säilyy Reitit-sivulta poistuttaessa (eteneminen ja Keskeytä näkyvät palatessa)',
    btnDuring.disabled &&
      btnDuring.text === 'Reittitesti käynnissä…' &&
      back5000.R === '5000' &&
      back5000.strings === '20' &&
      (stillRunning
        ? /^Reittitesti: [\d\s]+ \/ 5.020\s*Keskeytä\s*.*R = 5000, siemen ”\d+”, 20 satunnaisjonoa/.test(back5000.running) &&
          back5000.cancel &&
          back5000.runDisabled &&
          back5000.runText === 'Reittitesti käynnissä…'
        : /R=5.000/.test(back5000.result)),
    stillRunning ? back5000.running.slice(0, 120) : `valmis ennen paluuta: ${back5000.result.slice(0, 80)}`,
  );
  if (stillRunning) {
    await page.click('[data-testid="matrix-route-cancel"]');
    await page.waitForSelector('[data-testid="matrix-route-running"]', { state: 'detached', timeout: 15000 });
    await page.waitForTimeout(200);
    const cancelled = await page.evaluate(() => ({
      err: (document.querySelector('[data-testid="matrix-route-test"] .note.err')?.textContent || '').trim(),
      warn: (document.querySelector('[data-testid="matrix-route-mc-warning"]')?.textContent || '').replace(/\s+/g, ' '),
      runDisabled: !!document.querySelector('[data-testid="matrix-route-run"]')?.disabled,
      runs: JSON.parse(localStorage.getItem('pi-atlas:v1') || '{}').matrix?.routeRuns?.length,
    }));
    check(
      'matriisi: Keskeytä pysäyttää reittitestin, eikä keskeytettyä ajoa kirjata',
      cancelled.err === 'Keskeytetty' && /Matriisin reittitestejä ajettu 1\./.test(cancelled.warn) && !cancelled.runDisabled,
      `${cancelled.err} · ${(cancelled.warn.match(/ajettu \d+/) || [''])[0]}`,
    );
  } else {
    // Ajo ehti valmistua ennen paluuta: tulos näkyi, eikä keskeytettävää ole.
    await page.waitForSelector('[data-testid="matrix-route-running"]', { state: 'detached', timeout: 120000 });
    check('matriisi: Keskeytä pysäyttää reittitestin, eikä keskeytettyä ajoa kirjata', false, 'ajo valmistui ennen paluuta, keskeytystä ei voitu testata');
  }
  const runsSoFar = stillRunning ? 1 : 2;

  // Vahvistava polku: uusi koodijoukko (MINI 6464 + MATTI 62884, ei tehtävänannosta) lukitaan ennen ensimmäistä ajoa →
  // ensimmäinen ajo on ”ennen löydöstä (lukittu)”. Toinen ajo eri siemenellä on ”löydön jälkeen”: lukitus kattaa
  // vain ensimmäisen ajon.
  await page.selectOption('#mx-route-r', '200');
  await page.selectOption('#mx-route-strings', '0');
  await page.selectOption('#mx-route-source', 'trail');
  for (const name of ['MINI', 'MATTI']) {
    await page.fill('#mx-route-extra', name);
    await page.click('[data-testid="matrix-route-test"] form.mx-btn-row button[type="submit"]');
    await page.waitForTimeout(100);
  }
  for (const code of ['432', '42662']) {
    const chip = page.locator('[data-testid="matrix-route-test"] .mx-code-chip', { hasText: code }).first();
    if ((await chip.getAttribute('aria-pressed')) === 'true') await chip.click();
  }
  await page.waitForTimeout(150);
  const chipsOn = await page.$$eval('[data-testid="matrix-route-test"] .mx-code-chip[aria-pressed="true"] .mono', (els) => els.map((e) => e.textContent));
  const freshTiming = await timingTxt();
  await page.click('[data-testid="matrix-route-lock"]');
  await page.waitForFunction(
    () => /Määritelty ennen löydöstä \(lukittu\) \(lukittu tällä laitteella\)/.test(document.querySelector('[data-testid="matrix-route-timing"]')?.textContent || ''),
    null,
    { timeout: 10000 },
  );
  const preTiming = await timingTxt();
  const resultId = () => page.evaluate(() => document.querySelector('[data-testid="matrix-route-result"] .kv')?.textContent || '');
  let prevResult = await resultId();
  const runAndWait = async () => {
    await page.click('[data-testid="matrix-route-run"]');
    await page.waitForFunction(
      (prev) => {
        const r = document.querySelector('[data-testid="matrix-route-result"] .kv')?.textContent || '';
        return r && r !== prev && !document.querySelector('[data-testid="matrix-route-running"]');
      },
      prevResult,
      { timeout: 120000 },
    );
    await page.waitForTimeout(600);
    prevResult = await resultId();
    return mtext(page, '[data-testid="matrix-route-result"]');
  };
  const firstLocked = await runAndWait();
  check(
    'matriisi: uuden koodijoukon lukittu ensimmäinen ajo on ”ennen löydöstä (lukittu)”',
    chipsOn.join(',') === '6464,62884' &&
      /Ajoitus ei tiedossa/.test(freshTiming) &&
      /Määritelty ennen löydöstä \(lukittu\) · lukittu tällä laitteella/.test(firstLocked) &&
      /Reitti\s*MINI 6464 → MATTI 62884/.test(firstLocked),
    `${chipsOn.join(',')} · ${preTiming.slice(0, 90)} · ${(firstLocked.match(/^.{0,90}/) || [''])[0]}`,
  );
  const seed0 = await page.inputValue('#mx-route-seed');
  await page.fill('#mx-route-seed', '7');
  await page.waitForTimeout(150);
  const secondTiming = await timingTxt();
  const secondRun = await runAndWait();
  const mcw3 = await mtext(page, '[data-testid="matrix-route-mc-warning"]');
  check(
    'matriisi: lukitus kattaa vain ensimmäisen ajon — toinen ajo eri siemenellä on ”löydön jälkeen”',
    /^Tämän ajon hypoteesin ajoitus: Muodostettu löydön jälkeen\./.test(secondTiming) &&
      /Lukitus kattaa vain ensimmäisen ajon/.test(secondTiming) &&
      /Muodostettu löydön jälkeen/.test(secondRun) &&
      !/Määritelty ennen löydöstä/.test(secondRun) &&
      /kattaa vain ensimmäisen ajon/.test(secondRun) &&
      /siemen ”7”/.test(secondRun) &&
      new RegExp(`Matriisin reittitestejä ajettu ${runsSoFar + 2}\\.`).test(mcw3),
    `${secondTiming.slice(40, 200)} · ${(mcw3.match(/ajettu \d+/) || [''])[0]}`,
  );
  await layoutAt(page, 'reittitesti: lukittu koodijoukko');
  await page.fill('#mx-route-seed', seed0);
  await page.selectOption('#mx-route-source', 'first');

  // Testit-välilehti: matriisin reittitestit omalla rivillään, testilaskuri ennallaan.
  await page.click('[data-testid="tab-tests"]');
  await page.waitForSelector('[data-testid="tests-matrix-runs"]');
  const tl = await mtext(page, '[data-testid="tests-view"]');
  check(
    'Testit: matriisin reittitestit erillisellä rivillä',
    new RegExp(`Matriisin reittitestejä: ${runsSoFar + 2} \\(ks\\. Matriisi → Reitit\\)`).test(tl) && /Ajettu 3 testiä/.test(tl),
    (tl.match(/Matriisin reittitestejä[^)]*\)/) || [''])[0],
  );
  await page.click('[data-testid="tab-matrix"]');
  await page.waitForTimeout(250);

  // Tarina: henkilön lisäys tallentuu vain laitteelle (localStorage) ja säilyy uudelleenlatauksessa.
  await page.click('[data-testid="matrix-sub-tarina"]');
  await page.waitForSelector('[data-testid="matrix-story-editor"]');
  await page.click('[data-testid="matrix-add-person"]');
  await page.fill('#mx-person-name', 'Aino');
  await layoutAt(page, 'tarina: henkilölomake');
  await page.click('.mx-story form.mx-form button[type="submit"]');
  // Tallennus localStorageen tapahtuu viiveellä (persist.ts); odotetaan, että henkilö on laitteella.
  await page.waitForFunction(() => /"AINO"/.test(localStorage.getItem('pi-atlas:v1') || ''), null, { timeout: 5000 }).catch(() => undefined);
  const storyTxt = await mtext(page, '[data-testid="matrix-story-editor"]');
  const personHeads = await page.$$eval('[data-testid="matrix-story-editor"] details.mx-story-sec:first-of-type .mx-item-head', (els) =>
    els.map((e) => `${e.querySelector('b')?.textContent || ''} · ${e.querySelector('.mx-chip')?.textContent || ''}`),
  );
  const stored = await page.evaluate(() => {
    try {
      const m = JSON.parse(localStorage.getItem('pi-atlas:v1') || '{}').matrix;
      return { persons: m.story.persons.map((p) => p.name), saved: m.saved.length, runs: m.routeRuns.length };
    } catch (e) {
      return { error: String(e) };
    }
  });
  check(
    'matriisi: tarinaeditori — henkilö tallentuu vain laitteelle',
    /Tarinatiedot tallentuvat vain tälle laitteelle\./.test(storyTxt) &&
      personHeads.includes('AINO · T9 2466') &&
      ['HANNA I · T9 42662', 'HANNA II · T9 42662', 'HANNA III · T9 42662'].every((h) => personHeads.includes(h)) &&
      (stored.persons || []).includes('AINO'),
    `${personHeads.slice(0, 4).join(', ')} · localStorage ${JSON.stringify(stored.persons)}`,
  );
  await layoutAt(page, 'tarina');
  await scrollTop(page);
  await page.waitForTimeout(150);
  await noToast(page);
  await shot(page, '17-matriisi-tarina');
  await page.click('[data-testid="matrix-sub-loki"]');
  await page.waitForSelector('[data-testid="matrix-log"]');
  await layoutAt(page, 'loki');

  await page.waitForTimeout(700);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('[data-testid="matrix-view"]', { timeout: 30000 });
  await page.waitForSelector('[data-testid="matrix-log"], [data-testid="matrix-focus"]', { timeout: 30000 });
  const afterReload = await page.evaluate(() => {
    const m = JSON.parse(localStorage.getItem('pi-atlas:v1') || '{}').matrix || {};
    return { persons: (m.story?.persons || []).length, saved: (m.saved || []).length, runs: (m.routeRuns || []).length, trail: (m.trail || []).map((s) => s.key) };
  });
  check(
    'matriisi: tarina, reitti ja reittitestit säilyvät uudelleenlatauksessa',
    afterReload.persons === 8 &&
      afterReload.saved === 1 &&
      afterReload.runs === runsSoFar + 2 &&
      afterReload.trail.join(' ') === 'root hit:432@858511 hit:42662@858610 name:HANNA',
    JSON.stringify(afterReload),
  );

  // Spiraali-painike osumasolmusta: kartta-välilehti ja sama osuma alapaneelissa.
  await page.click('[data-testid="matrix-view-verkko"]');
  await page.waitForSelector('[data-testid="matrix-crumb-2"]');
  await page.click('[data-testid="matrix-crumb-2"]');
  await page.waitForTimeout(250);
  await page.click('[data-testid="matrix-goto-spiraali"]');
  await page.waitForSelector('[data-testid="spiral-canvas"]', { timeout: 10000 });
  await page.waitForFunction(() => /858.610/.test(document.querySelector('[data-testid="hit-sheet"]')?.textContent || ''), null, { timeout: 10000 });
  await page.waitForTimeout(400);
  const sheet3 = await mtext(page, '[data-testid="hit-sheet"]');
  const curTab = await page.getAttribute('[data-testid="tab-map"]', 'aria-current');
  check('matriisi: Spiraali-painike avaa kartan ja osuman HANNA @858 610', curTab === 'page' && /HANNA/.test(sheet3) && /858.610/.test(sheet3), sheet3.slice(0, 70));
  // Takaisin: alapaneelin Matriisi-painike säilyttää nykyisen polun. Osuma HANNA @858 610 on jo polulla
  // (juuri › 432 @858 511 › 42662 @858 610), joten polku pysyy ennallaan ja fokus palaa siihen.
  const openHitFromSheet = async () => {
    if (!(await page.isVisible('[data-testid="hit-open-matrix"]'))) await page.click('.sheet-head');
    await page.waitForSelector('[data-testid="hit-open-matrix"]');
    await page.click('[data-testid="hit-open-matrix"]');
    await page.waitForSelector('[data-testid="matrix-focus"]');
    await page.waitForTimeout(250);
    const toast = norm(await page.textContent('.toast').catch(() => ''));
    return { crumbs: await crumbsOf(page), toast };
  };
  const back = await openHitFromSheet();
  check(
    'matriisi: osuman Matriisi-painike säilyttää polun (osuma jo polulla → palataan siihen)',
    back.crumbs.length === 3 &&
      /^432 @858.511$/.test(back.crumbs[1].title) &&
      /^42662 @858.610$/.test(back.crumbs[2].title) &&
      /^π-data · Matemaattinen$/.test(back.crumbs[2].meta) &&
      /Osuma 42662 @858.610 on jo polulla: palattiin siihen\./.test(back.toast),
    `${back.crumbs.map((c) => c.title).join(' › ')} · ${back.toast}`,
  );
  // Polulla olematon osuma (MINI @858 960 kartalta) lisätään polun loppuun: murujen määrä kasvaa, ei nollaudu.
  await noToast(page);
  await page.click('[data-testid="tab-map"]');
  await page.waitForSelector('[data-testid="spiral-canvas"]', { timeout: 10000 });
  await page.waitForTimeout(400);
  const miniSheet = await tapMap(858960);
  const grown = /MINI/.test(miniSheet) && /858.960/.test(miniSheet) ? await openHitFromSheet() : { crumbs: [], toast: '' };
  const lastCrumb = grown.crumbs[grown.crumbs.length - 1];
  check(
    'matriisi: osuman Matriisi-painike lisää uuden osuman polun loppuun (3 → 4 murua)',
    grown.crumbs.length === 4 &&
      grown.crumbs.slice(0, 3).map((c) => c.title).join('|') === back.crumbs.map((c) => c.title).join('|') &&
      /^6464 @858.960$/.test(lastCrumb?.title || '') &&
      /^π-data · Matemaattinen$/.test(lastCrumb?.meta || '') &&
      /Osuma 6464 @858.960 lisättiin polun loppuun \(avattu osumasta\)\. Aiempi polku säilyi\./.test(grown.toast),
    `${miniSheet.slice(0, 40)} · ${grown.crumbs.map((c) => c.title).join(' › ')} · ${grown.toast}`,
  );

  // Solmuvalitsin: tulkinta 23 (symbolinen, tarinaverkko) ja koodi 43 (π-data), joihin ei ole laskettua särmää
  // polulta. Valinta lisätään murupolun loppuun askeleena ”valittu käyttäjän toimesta”, eikä se ole laskettu yhteys.
  const pick = async (q, key) => {
    await noToast(page);
    await scrollTop(page);
    if (!(await page.isVisible('[data-testid="matrix-picker-input"]'))) await page.click('[data-testid="matrix-picker"] > summary');
    await page.fill('[data-testid="matrix-picker-input"]', q);
    const item = page.locator(`[data-testid="matrix-pick"][data-key="${key}"]`);
    await item.waitFor({ timeout: 5000 });
    const offered = await page.$$eval('[data-testid="matrix-pick"]', (els) => els.map((e) => e.getAttribute('data-key')));
    if (q === '23') {
      await layoutAt(page, 'solmuvalitsin');
      await shot(page, '18-matriisi-valitsin');
    }
    await item.click();
    await page.waitForTimeout(300);
    const crumbTitles = await page.$$eval('[data-testid^="matrix-crumb-"]', (els) => els.map((e) => e.getAttribute('title') || ''));
    return {
      offered,
      crumbs: await crumbsOf(page),
      lastTitleAttr: crumbTitles[crumbTitles.length - 1] || '',
      banner: norm(await page.textContent('[data-testid="matrix-realm-banner"]').catch(() => '')),
      focus: await focusTitle(page),
      pickerOpen: await page.isVisible('[data-testid="matrix-picker-input"]'),
    };
  };
  const g23 = await pick('23', 'gloss:g-23');
  const g23Code = await group(page, 'Koodi');
  const g23Last = g23.crumbs[g23.crumbs.length - 1];
  check(
    'matriisi: solmuvalitsin avaa tulkinnan 23 (Tarinaverkko · symbolinen, kerrosvaihto näkyy)',
    g23.offered.includes('code:23') &&
      g23.crumbs.length === 5 &&
      g23Last?.meta === 'Tarinaverkko · valittu' &&
      /Tarinaverkko · Symbolinen: valittu käyttäjän toimesta \(solmuvalitsin\)/.test(g23.lastTitleAttr) &&
      /Siirryt piin todellisesta datasta symboliseen tarinaverkkoon\./.test(g23.banner) &&
      /Kerrosvaihto askeleessa 4: valittu käyttäjän toimesta \(solmuvalitsin\)/.test(g23.banner) &&
      g23Code.rows.some((r) => r.key === 'code:23') &&
      !g23.pickerOpen,
    `${g23.focus} · ${g23Last?.meta} · ${g23.banner.slice(0, 90)} · ${g23.offered.slice(0, 4).join(' ')}`,
  );
  await layoutAt(page, 'tulkinta 23 (valittu)');
  await edgeRowsAt(page, 'tulkinta 23 (valittu)');
  await scrollTop(page);
  await page.waitForTimeout(150);
  await noToast(page);
  await shot(page, '18a-matriisi-tulkinta-23');
  const c43 = await pick('43', 'code:43');
  const c43Last = c43.crumbs[c43.crumbs.length - 1];
  const c43All = (await groupsOf(page)).find((g) => /^Kaikki osumat \(\d+\)$/.test(g.name));
  check(
    'matriisi: solmuvalitsin avaa koodin 43 (π-data, paluu tarinaverkosta näkyy)',
    c43.crumbs.length === 6 &&
      c43Last?.meta === 'π-data · valittu' &&
      /^43\b/.test(c43.focus) &&
      /Palaat tarinaverkosta piin todelliseen dataan\./.test(c43.banner) &&
      !!c43All &&
      c43All.rows.length > 0 &&
      c43All.rows.every((r) => /^hit:43@\d+$/.test(r.key)),
    `${c43.focus} · ${c43Last?.meta} · ${c43.banner.slice(0, 60)} · ${c43All?.name}`,
  );
  await layoutAt(page, 'koodi 43 (valittu)');
  await edgeRowsAt(page, 'koodi 43 (valittu)');

  // Koodi 629: ”Näytä kaikki (1 040)” piirtää rivit vaiheittain ja näyttää lopulta kaikki 1 040 riviä.
  const errsBefore629 = errors.length;
  await pick('629', 'code:629');
  const all629 = async () =>
    page.evaluate(() => {
      const g = [...document.querySelectorAll('[data-testid="matrix-edges"] .mx-group')].find((x) =>
        /^Kaikki osumat \(\d+\)$/.test((x.querySelector('.mx-group-name')?.textContent || '').trim()),
      );
      if (!g) return null;
      const body = g.querySelector('.mx-group-body');
      return {
        name: g.querySelector('.mx-group-name').textContent.trim(),
        rows: g.querySelectorAll('[data-testid="matrix-edge"]').length,
        drawing: body?.getAttribute('data-drawing') === 'true',
        progress: !!g.querySelector('[data-testid="matrix-edges-progress"]'),
        showAll: [...g.querySelectorAll('button')].map((b) => b.textContent.replace(/\s+/g, ' ').trim()).find((t) => /^Näytä kaikki/.test(t)) || null,
      };
    });
  const g629a = await all629();
  const t629 = Date.now();
  if (g629a?.showAll) {
    await page
      .locator('[data-testid="matrix-edges"] .mx-group', { has: page.locator('.mx-group-name', { hasText: /^Kaikki osumat \(1040\)$/ }) })
      .locator('button', { hasText: /^Näytä kaikki/ })
      .click();
  }
  await page.waitForFunction(
    () => {
      const g = [...document.querySelectorAll('[data-testid="matrix-edges"] .mx-group')].find((x) => /^Kaikki osumat/.test(x.textContent.trim()));
      return g && !g.querySelector('[data-testid="matrix-edges-progress"]') && g.querySelectorAll('[data-testid="matrix-edge"]').length >= 1040;
    },
    null,
    { timeout: 60000 },
  ).catch(() => undefined);
  const ms629 = Date.now() - t629;
  const g629b = await all629();
  check(
    'matriisi: koodi 629 ”Näytä kaikki (1 040)” näyttää lopulta 1 040 riviä ilman konsolivirheitä',
    g629a?.name === 'Kaikki osumat (1040)' &&
      g629a.rows === 12 &&
      /^Näytä kaikki \(1.040\)$/.test(g629a.showAll || '') &&
      g629b?.rows === 1040 &&
      !g629b.drawing &&
      !g629b.progress &&
      errors.length === errsBefore629,
    `${g629a?.rows} → ${g629b?.rows} riviä ${ms629} ms · ${g629a?.showAll}`,
  );
  // Suunnan vaihto säilyttää näytettyjen rivien määrän (rivit piirretään uudelleen vaiheittain).
  await page.click('[data-testid="matrix-dir-432"]');
  await page.waitForFunction(
    () => {
      const g = [...document.querySelectorAll('[data-testid="matrix-edges"] .mx-group')].find((x) => /^Kaikki osumat/.test(x.textContent.trim()));
      return g && !g.querySelector('[data-testid="matrix-edges-progress"]') && g.querySelectorAll('[data-testid="matrix-edge"]').length >= 1040;
    },
    null,
    { timeout: 60000 },
  ).catch(() => undefined);
  const g629c = await all629();
  await page.click('[data-testid="matrix-dir-234"]');
  await page.waitForTimeout(300);
  check(
    'matriisi: suunnan vaihto 234 → 432 säilyttää näytetyt 1 040 riviä',
    g629c?.rows === 1040 && !g629c.progress && errors.length === errsBefore629,
    `432: ${g629c?.rows} riviä`,
  );
  await layoutAt(page, 'koodi 629 kaikki osumat');

  // Tapahtumapaneelin ”Avaa matriisissa”: tapahtuma avautuu matriisiin valittuna solmuna (paneeli sulkeutuu).
  const crumbsBeforeEvent = (await crumbsOf(page)).length;
  await page.click('[data-testid="open-panel"]');
  await page.click('.panel-head >> text=Tapahtumat');
  await page.waitForSelector('[data-testid="event-open-matrix"]');
  await page.click('[data-testid="event-open-matrix"]');
  await page.waitForSelector('[data-testid="matrix-focus"]');
  await page.waitForTimeout(300);
  const evCrumbs = await crumbsOf(page);
  const evFocus = await focusTitle(page);
  const panelOpen = await page.isVisible('.panel-body');
  check(
    'matriisi: tapahtumapaneelin ”Avaa matriisissa” lisää tapahtuman polulle valittuna solmuna',
    evCrumbs.length === crumbsBeforeEvent + 1 &&
      evCrumbs[evCrumbs.length - 1].meta === 'Tarinaverkko · valittu' &&
      /Testitapahtuma/.test(evFocus) &&
      (await page.getAttribute('[data-testid="tab-matrix"]', 'aria-current')) === 'page' &&
      !panelOpen,
    `${crumbsBeforeEvent} → ${evCrumbs.length} murua · ${evFocus}`,
  );
  await layoutAt(page, 'tapahtuma (valittu)');
  page.off('request', onRequest);

  const badRows = edgeRowLog.filter((l) => l.issues.length);
  check(
    `matriisi: jokainen yhteysrivi näyttää yhteyden tyypin ja kerroksen (${edgeRowLog.reduce((a, l) => a + l.n, 0)} riviä)`,
    !badRows.length && edgeRowLog.every((l) => l.n > 0),
    badRows.map((l) => `${l.label}: ${l.issues.slice(0, 2).join('; ')}`).join(' | '),
  );
  const bad412 = layoutLog.filter((l) => l.issues.length);
  check(
    `matriisi 412 px: ei vaakaylivuotoa eikä leikkautuvia nimilappuja (${layoutLog.length} näkymää)`,
    !bad412.length,
    bad412.map((l) => `${l.label}: ${l.issues.slice(0, 2).join('; ')}`).join(' | '),
  );
  check('matriisi: ei verkkopyyntöjä sovelluksen ulkopuolelle', external.length === 0, external.slice(0, 3).join(' | '));

  // 360 px: sama matriisipolku uudessa kontekstissa (tyhjä localStorage), vain asettelun tarkistus.
  const ctx360 = await browser.newContext({
    viewport: { width: 360, height: 800 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-A146B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36',
  });
  const p3 = await ctx360.newPage();
  if (NO_WORKER)
    await p3.addInitScript(() => {
      window.Worker = function () {
        throw new Error('Worker estetty testissä');
      };
    });
  p3.on('pageerror', (e) => errors.push(`360: ${e}`));
  p3.on('console', (m) => m.type() === 'error' && errors.push(`360: ${m.text()}`));
  const SHOTS360 = process.env.PI_ATLAS_SHOTS_360;
  const shot360 = async (name) => SHOTS360 && p3.screenshot({ path: path.join(SHOTS360, `360-${name}.jpg`), type: 'jpeg', quality: 80 });
  await p3.goto(BASE + '#matriisi', { waitUntil: 'load' });
  await p3.waitForSelector('[data-testid="matrix-identifiers"]', { timeout: 30000 });
  await p3.waitForTimeout(400);
  const log360 = [];
  const at360 = async (label) => {
    log360.push({ label, issues: [...(await layoutIssues(p3)), ...(await tabbarIssues(p3))] });
    await shot360(label.replace(/[^a-z0-9]+/gi, '-'));
  };
  await at360('juuri');
  await scrollTo(p3, '[data-testid="matrix-identifiers"]');
  await at360('lahtotunnisteet');
  await p3.click('[data-testid="matrix-first-route"]');
  await p3.waitForSelector('[data-testid="matrix-crumb-5"]');
  await scrollTop(p3);
  await at360('testireitti');
  await scrollTo(p3, '[data-testid="matrix-junction"]');
  await at360('haarat');
  await scrollTo(p3, '[data-testid="matrix-net"]');
  await at360('verkko');
  await p3.click('[data-testid="matrix-dir-432"]');
  await openKey(p3, 'path:polku-b');
  await at360('polku-b-432');
  await p3.click('[data-testid="matrix-dir-234"]');
  await p3.click('[data-testid="matrix-crumb-4"]');
  await openKey(p3, 'homonyms:HANNA');
  await scrollTo(p3, '[data-testid="matrix-focus"]');
  await at360('samannimiset');
  await p3.click('[data-testid="matrix-root"]');
  await openKey(p3, 'hit:432@858511');
  await openKey(p3, 'hit:42662@858610');
  await scrollTo(p3, '[data-testid="matrix-net"]');
  await at360('osuma-verkko');
  await p3.click('[data-testid="matrix-369"]');
  await p3.waitForSelector('[data-testid="matrix-369-result"]', { timeout: 30000 });
  await p3.waitForTimeout(1000);
  await scrollTo(p3, '[data-testid="matrix-369-result"]');
  await at360('369');
  await p3.click('[data-testid="matrix-jumps"]');
  await p3.click('[data-testid="matrix-jump-hyppy-2-3-4"]');
  await p3.waitForSelector('[data-testid="matrix-jump-result"]');
  await p3.waitForTimeout(300);
  await at360('hyppy');
  await openKey(p3, 'code:42662');
  await p3.click('[data-testid="matrix-view-lista"]');
  await at360('koodi-lista');
  await p3.click('[data-testid="matrix-save"]');
  await scrollTop(p3);
  await at360('tallennus');
  await p3.click('[data-testid="matrix-save-confirm"]');
  await p3.click('[data-testid="matrix-sub-reitit"]');
  await p3.waitForSelector('[data-testid="matrix-saved-route"]');
  await at360('reitit');
  await p3.selectOption('#mx-route-r', '200');
  await p3.click('[data-testid="matrix-route-run"]');
  await p3.waitForSelector('[data-testid="matrix-route-result"]', { timeout: 120000 });
  await p3.waitForTimeout(1000);
  await scrollTo(p3, '[data-testid="matrix-route-result"]');
  await at360('reittitesti');
  await p3.click('[data-testid="matrix-sub-tarina"]');
  await p3.click('[data-testid="matrix-add-person"]');
  await at360('tarina');
  await p3.click('[data-testid="matrix-sub-loki"]');
  await at360('loki');
  // Murun napautus alasivulla (Loki) sulkee alasivun ja näyttää fokuksen; sitten solmuvalitsin 360 px:ssä.
  const nCrumbs360 = (await crumbsOf(p3)).length;
  await p3.click(`[data-testid="matrix-crumb-${nCrumbs360 - 1}"]`);
  await p3.waitForSelector('[data-testid="matrix-focus"]', { timeout: 5000 }).catch(() => undefined);
  const crumbClosesSub = (await p3.isVisible('[data-testid="matrix-focus"]')) && !(await p3.isVisible('[data-testid="matrix-log"]'));
  await p3.click('[data-testid="matrix-picker"] > summary');
  await p3.fill('[data-testid="matrix-picker-input"]', '23');
  await p3.waitForSelector('[data-testid="matrix-pick"][data-key="gloss:g-23"]');
  await scrollTo(p3, '[data-testid="matrix-picker"]');
  await at360('valitsin');
  await p3.click('[data-testid="matrix-pick"][data-key="gloss:g-23"]');
  await p3.waitForTimeout(300);
  const meta360 = (await crumbsOf(p3)).map((c) => c.meta);
  await scrollTop(p3);
  await at360('valittu-tulkinta-23');
  check(
    'matriisi 360 px: murun napautus Loki-sivulla näyttää fokuksen, ja solmuvalitsin avaa tulkinnan 23',
    crumbClosesSub && meta360.length === nCrumbs360 + 1 && meta360[meta360.length - 1] === 'Tarinaverkko · valittu',
    `${nCrumbs360} → ${meta360.length} murua · ${meta360[meta360.length - 1]}`,
  );
  const bad360 = log360.filter((l) => l.issues.length);
  check(
    `matriisi 360 px: ei vaakaylivuotoa, välilehdet mahtuvat (${log360.length} näkymää)`,
    !bad360.length,
    bad360.map((l) => `${l.label}: ${l.issues.slice(0, 2).join('; ')}`).join(' | '),
  );
  await ctx360.close();
  check('matriisi: ei konsolivirheitä (412 ja 360 px)', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} tarkistusta ok`);
  process.exit(failed ? 1 : 0);
})();
