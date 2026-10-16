// Päästä päähän -savutesti ja kuvakaappaukset puhelinkoossa (Chromium/Playwright).
// Käyttö: npm run build && npx vite preview --port 4173 &  sitten  npm run e2e
// Playwright ei ole projektin riippuvuus: asenna se tarvittaessa (npm i -D playwright) tai aja NODE_PATH=$(npm root -g).
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
      /Oma testitulkinta/.test(savedTxt),
    savedTxt.slice(0, 120),
  );
  await layoutAt(page, 'reitit');

  // Reittitesti R = 200: lukitus ennen ensimmäistä ajoa, sitten ajo.
  await page.selectOption('#mx-route-r', '200');
  await page.click('[data-testid="matrix-route-lock"]');
  await page.waitForFunction(() => /Määritelty ennen löydöstä/.test(document.querySelector('[data-testid="matrix-route-timing"]')?.textContent || ''), null, { timeout: 10000 });
  await page.click('[data-testid="matrix-route-run"]');
  await page.waitForSelector('[data-testid="matrix-route-result"]', { timeout: 120000 });
  await page.waitForTimeout(1000); // tulos vieritetään näkyviin pehmeästi
  const rres = await mtext(page, '[data-testid="matrix-route-result"]');
  const mcw = await mtext(page, '[data-testid="matrix-route-mc-warning"]');
  check(
    'matriisi: reittitesti R = 200 näyttää p:n ja määritelmän',
    /p \(Monte Carlo\)\s*\d,\d+/.test(rres) &&
      /Testisuure: lyhin ikkuna reitille 629 → 42662 → 72552 → 432/.test(rres) &&
      /R = 200 kertaa/.test(rres) &&
      /Määritelty ennen löydöstä \(lukittu\)/.test(rres) &&
      /Matriisin reittitestejä ajettu 1\./.test(mcw),
    (rres.match(/p \(Monte Carlo\).{0,40}/) || [''])[0],
  );
  await layoutAt(page, 'reittitesti');
  await scrollTo(page, '[data-testid="matrix-route-result"]');
  await page.waitForTimeout(200);
  await noToast(page);
  await shot(page, '16-matriisi-reitit');

  // Testit-välilehti: matriisin reittitestit omalla rivillään, testilaskuri ennallaan.
  await page.click('[data-testid="tab-tests"]');
  await page.waitForSelector('[data-testid="tests-matrix-runs"]');
  const tl = await mtext(page, '[data-testid="tests-view"]');
  check(
    'Testit: matriisin reittitestit erillisellä rivillä',
    /Matriisin reittitestejä: 1 \(ks\. Matriisi → Reitit\)/.test(tl) && /Ajettu 3 testiä/.test(tl),
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
    afterReload.persons === 8 && afterReload.saved === 1 && afterReload.runs === 1 && afterReload.trail.join(' ') === 'root hit:432@858511 hit:42662@858610 name:HANNA',
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
  // Takaisin: alapaneelin Matriisi-painike avaa saman osuman reittinä juuri → koodi → osuma.
  await page.click('.sheet-head');
  await page.waitForSelector('[data-testid="hit-open-matrix"]');
  await page.click('[data-testid="hit-open-matrix"]');
  await page.waitForSelector('[data-testid="matrix-crumb-2"]');
  await page.waitForTimeout(250);
  const back = await crumbsOf(page);
  check(
    'matriisi: osuman Matriisi-painike avaa reitin juuri → koodi → osuma',
    back.length === 3 && /HANNA 42662/.test(back[1].title) && /^42662 @858.610$/.test(back[2].title) && /^π-data · Matemaattinen$/.test(back[2].meta),
    back.map((c) => c.title).join(' › '),
  );
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
