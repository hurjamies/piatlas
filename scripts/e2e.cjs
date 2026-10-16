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
  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} tarkistusta ok`);
  process.exit(failed ? 1 : 0);
})();
