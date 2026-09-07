// Produces the Chrome Web Store screenshots (1280x800, no alpha) in docs/screenshots.
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const EXT = path.resolve(__dirname, '../src');
const OUT = path.resolve(__dirname, '../docs/screenshots');
const BADGE = '#site-ip-badge-host .badge';
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const ctx = await chromium.launchPersistentContext('', {
    executablePath: process.env.BROWSER_PATH || chromium.executablePath(), headless: true,
    args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1,
  });
  await new Promise((r) => setTimeout(r, 1000));
  const page = await ctx.newPage();
  const shots = [
    ['01-example-com.png', 'https://example.com/'],
    ['02-wikipedia.png', 'https://www.wikipedia.org/'],
    ['03-github.png', 'https://github.com/'],
  ];
  for (const [file, url] of shots) {
    await page.goto(url, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForSelector(BADGE, { timeout: 8000 });
    await page.screenshot({ path: path.join(OUT, file), omitBackground: false });
    console.log('saved', file);
  }
  // hover state (moved to the left)
  await page.goto('https://example.com/');
  await page.waitForSelector(BADGE);
  await page.hover(BADGE);
  await new Promise((r) => setTimeout(r, 300));
  await page.screenshot({ path: path.join(OUT, '04-hover-left.png') });
  console.log('saved 04-hover-left.png');
  // popup for the example.com tab
  const swp = ctx.serviceWorkers()[0];
  const exTab = await swp.evaluate(async () => (await chrome.tabs.query({})).find((t) => t.url && t.url.startsWith('https://example.com')).id);
  const pp = await ctx.newPage();
  await pp.setViewportSize({ width: 330, height: 300 });
  await pp.goto(`chrome-extension://${new URL(swp.url()).host}/popup.html?tab=${exTab}`);
  await pp.waitForSelector('#main:not([hidden])');
  await pp.click('#ptrBtn').catch(() => {});
  await new Promise((r) => setTimeout(r, 1200));
  await pp.screenshot({ path: path.join(OUT, '06-popup.png') });
  console.log('saved 06-popup.png');
  await pp.close();
  // options page
  const sw = ctx.serviceWorkers()[0];
  const extId = new URL(sw.url()).host;
  const op = await ctx.newPage();
  await op.setViewportSize({ width: 520, height: 420 });
  await op.goto(`chrome-extension://${extId}/options.html`);
  await op.screenshot({ path: path.join(OUT, '05-options.png') });
  console.log('saved 05-options.png');
  await ctx.close();
})().catch((e) => { console.error(e); process.exit(1); });
