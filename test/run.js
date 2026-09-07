// End-to-end checks for Site IP Badge (TODO.md §3).
//
//   npm test                         # Chrome for Testing bundled with Playwright
//   BROWSER_PATH=/Applications/Brave\ Browser.app/Contents/MacOS/Brave\ Browser npm test
//   EXT=/path/to/unzipped/package npm test   # verify the store zip instead of src/
//
// Branded Google Chrome >= 137 ignores --load-extension, so use Chrome for
// Testing, Chromium, Brave or Edge for automated runs.

'use strict';
const { chromium } = require('playwright');
const http = require('http');
const path = require('path');
const net = require('net');

const EXT = process.env.EXT ? path.resolve(process.env.EXT) : path.resolve(__dirname, '../src');
const HOST_SEL = '#site-ip-badge-host';
const BADGE_SEL = '#site-ip-badge-host .badge';
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const IPV6 = /^\[[0-9a-f:.]+\]$/i;

const results = [];
function record(name, ok, detail = '', skipped = false) {
  results.push({ name, ok, detail, skipped });
  const mark = skipped ? 'SKIP' : ok ? 'PASS' : 'FAIL';
  console.log(`${mark}  ${name}${detail ? '  — ' + detail : ''}`);
}
async function check(name, fn) {
  try {
    const r = await fn();
    if (r && r.skip) return record(name, true, r.skip, true);
    record(name, true, typeof r === 'string' ? r : '');
  } catch (e) {
    record(name, false, (e && e.message) || String(e));
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function badgeText(page) {
  const el = await page.$(BADGE_SEL);
  if (!el) return null;
  return (await el.$eval('.ip', (e) => e.textContent)).trim();
}
async function badgeInfo(page) {
  const el = await page.$(BADGE_SEL);
  if (!el) return null;
  return el.evaluate((b) => ({
    ip: b.querySelector('.ip').textContent.trim(),
    dns: b.classList.contains('dns'),
    unknown: b.classList.contains('unknown'),
    title: b.title,
    side: b.getRootNode().host.style.left === 'auto' ? 'right' : 'left',
    fontSize: getComputedStyle(b).fontSize,
    details: b.querySelector('.details') ? b.querySelector('.details').textContent : null,
  }));
}
async function badgeCenter(page) {
  const b = await page.$eval(BADGE_SEL, (e) => e.getBoundingClientRect().toJSON());
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
async function mouseTo(page) {
  const c = await badgeCenter(page);
  await page.mouse.move(c.x, c.y);
}
async function waitBadge(page, timeout = 5000) {
  await page.waitForSelector(BADGE_SEL, { timeout });
  return badgeInfo(page);
}

function startLocalServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      if (req.url.startsWith('/iframe')) {
        res.end(`<!doctype html><title>iframe host</title><h1>Local page with a heavy iframe</h1>
          <iframe src="https://example.com/" width="900" height="500"></iframe>
          <iframe src="https://www.wikipedia.org/" width="900" height="500"></iframe>`);
      } else if (req.url.startsWith('/redirect')) {
        res.writeHead(301, { Location: 'https://example.com/' }); res.end();
      } else if (req.url.startsWith('/cf')) {
        res.setHeader('Server', 'cloudflare');
        res.setHeader('CF-RAY', '8d1234567890abcd-MAD');
        res.end('<!doctype html><title>cf</title><p>pretend cloudflare</p>');
      } else if (req.url.startsWith('/csp')) {
        res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'none'; script-src 'none'; img-src 'none'");
        res.end('<!doctype html><title>strict csp</title><p>Strict CSP page</p>');
      } else {
        res.end('<!doctype html><title>local</title><p>local page</p>');
      }
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

(async () => {
  const { server, port } = await startLocalServer();
  const server6 = await new Promise((resolve) => {
    const s = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>v6</title><p>ipv6 loopback</p>'); });
    s.on('error', () => resolve(null));
    s.listen(0, '::1', () => resolve(s));
  });
  const local = (p) => `http://127.0.0.1:${port}${p}`;
  const executablePath = process.env.BROWSER_PATH || chromium.executablePath();
  const headless = process.env.HEADED ? false : true;
  console.log('browser:', executablePath);

  const ctx = await chromium.launchPersistentContext('', {
    executablePath, headless,
    args: [...(headless ? ['--headless=new'] : []), `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    viewport: { width: 1280, height: 800 },
  });
  await sleep(1000);
  let sw = ctx.serviceWorkers()[0];
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 10000 });
  const extId = new URL(sw.url()).host;
  const swErrors = [];
  sw.on('console', (m) => { if (m.type() === 'error') swErrors.push(m.text()); });
  const pageErrors = [];
  ctx.on('page', (p) => {
    const isWeb = () => /^https?:/.test(p.url()); // ignore browser-internal pages (e.g. Brave's serviceworker-internals)
    p.on('pageerror', (e) => { if (isWeb()) pageErrors.push(`${p.url()} :: ${e.message}`); });
    p.on('console', (m) => { if (isWeb() && m.type() === 'error' && /extension|site-ip|runtime\.lastError/i.test(m.text())) pageErrors.push(`${p.url()} :: ${m.text()}`); });
  });
  console.log('extension id:', extId);

  const stopServiceWorker = async () => {
    const p = await ctx.newPage();
    await p.goto('chrome://serviceworker-internals/');
    await sleep(300);
    const btn = p.getByRole('button', { name: 'Stop' });
    const n = await btn.count();
    for (let i = 0; i < n; i++) { try { await btn.nth(i).click({ timeout: 1000 }); } catch (_) {} }
    await sleep(500);
    const status = await p.evaluate(() => (document.body.innerText.match(/Running Status: \w+/g) || []).join(','));
    await p.close();
    return status;
  };

  const page = await ctx.newPage();

  // 1. IPv4 site: badge equals the IP Playwright saw for the main document.
  await check('IPv4 site (example.com)', async () => {
    const resp = await page.goto('https://example.com/');
    const addr = await resp.serverAddr();
    const b = await waitBadge(page);
    assert(IPV4.test(b.ip), `badge is not IPv4: ${b.ip}`);
    assert(!b.dns, 'badge should be the connection IP, not DNS');
    assert(!addr || addr.ipAddress === b.ip, `badge ${b.ip} != connection ${addr && addr.ipAddress}`);
    return `${b.ip} (connection)`;
  });

  // 2. IPv6-only site.
  await check('IPv6-only site (ipv6.google.com)', async () => {
    const p = await ctx.newPage(); // own tab: a failed navigation must not leak into later tests
    let resp;
    try { resp = await p.goto('https://ipv6.google.com/', { timeout: 10000 }); }
    catch (e) { await p.close().catch(() => {}); return { skip: 'no IPv6 connectivity on this network: ' + e.message.split('\n')[0] }; }
    const addr = await resp.serverAddr();
    const b = await waitBadge(p);
    await p.close();
    assert(IPV6.test(b.ip), `badge is not bracketed IPv6: ${b.ip}`);
    assert(!addr || `[${addr.ipAddress}]` === b.ip, `badge ${b.ip} != connection ${addr && addr.ipAddress}`);
    return b.ip;
  });

  await check('IPv6 connection via local [::1] server', async () => {
    if (!server6) return { skip: 'no ::1 loopback available' };
    await page.goto(`http://[::1]:${server6.address().port}/`);
    const b = await waitBadge(page);
    assert(b.ip === '[::1]', `expected [::1], got ${b.ip}`);
    assert(!b.dns, 'should be the connection IP');
    return b.ip;
  });

  // 3. SPA navigation via history.pushState: badge must stay.
  await check('SPA pushState keeps the badge', async () => {
    await page.goto('https://example.com/');
    const before = await waitBadge(page);
    await page.evaluate(() => { history.pushState({}, '', '/app/route/1'); history.pushState({}, '', '/app/route/2'); });
    await sleep(500);
    const after = await badgeInfo(page);
    assert(after && after.ip === before.ip, `badge changed: ${before.ip} -> ${after && after.ip}`);
    return after.ip;
  });

  // 4. 301 redirects (http -> https, and cross-host from the local server).
  await check('301 redirect http://example.com -> https', async () => {
    const resp = await page.goto('http://example.com/');
    const addr = await resp.serverAddr();
    const b = await waitBadge(page);
    assert(page.url().startsWith('https://'), 'did not land on https');
    assert(!addr || addr.ipAddress === b.ip, `badge ${b.ip} != final connection ${addr && addr.ipAddress}`);
    return `${page.url()} -> ${b.ip}`;
  });
  await check('301 redirect local -> example.com shows the final host IP', async () => {
    const resp = await page.goto(local('/redirect'));
    const addr = await resp.serverAddr();
    const b = await waitBadge(page);
    assert(b.ip !== '127.0.0.1', 'badge still shows the redirecting server');
    assert(!addr || addr.ipAddress === b.ip, `badge ${b.ip} != final connection ${addr && addr.ipAddress}`);
    return b.ip;
  });

  // 5. Strict CSP pages.
  await check('Strict CSP (github.com)', async () => {
    const resp = await page.goto('https://github.com/');
    const addr = await resp.serverAddr();
    const b = await waitBadge(page);
    assert(!addr || addr.ipAddress === b.ip, `badge ${b.ip} != connection ${addr && addr.ipAddress}`);
    return b.ip;
  });
  await check("Strict CSP (default-src 'none', local)", async () => {
    await page.goto(local('/csp'));
    const b = await waitBadge(page);
    assert(b.ip === '127.0.0.1', `expected 127.0.0.1, got ${b.ip}`);
    const bg = await page.$eval(BADGE_SEL, (e) => getComputedStyle(e).backgroundColor);
    assert(bg && bg !== 'rgba(0, 0, 0, 0)', 'badge unstyled under CSP: ' + bg);
    return `styled (${bg})`;
  });

  // 6. Heavy iframes: badge shows the main_frame IP, not the iframe's.
  await check('Iframes do not override the main_frame IP', async () => {
    await page.goto(local('/iframe'));
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    const b = await waitBadge(page);
    assert(b.ip === '127.0.0.1', `expected 127.0.0.1 (main frame), got ${b.ip}`);
    const inFrames = await page.evaluate(() => document.querySelectorAll('#site-ip-badge-host').length);
    assert(inFrames === 1, 'badge host count ' + inFrames);
    const frameBadges = [];
    for (const f of page.frames()) if (f !== page.mainFrame()) frameBadges.push(await f.$(HOST_SEL));
    assert(frameBadges.every((x) => !x), 'badge injected inside an iframe');
    return '127.0.0.1, no badge inside iframes';
  });

  // 7. Hover moves the badge, click copies, double click hides.
  await check('Hover moves badge to the other corner', async () => {
    await page.goto('https://example.com/');
    const b = await waitBadge(page);
    assert(b.side === 'right', 'initial side ' + b.side);
    await mouseTo(page); // raw mouse: Playwright's hit-target check cannot follow a badge that jumps away
    await sleep(200);
    const after = await badgeInfo(page);
    assert(after.side === 'left', 'side after hover ' + after.side);
    // Within the cooldown the badge must stay put so it can be clicked.
    await mouseTo(page);
    await sleep(200);
    assert((await badgeInfo(page)).side === 'left', 'badge jumped back during cooldown');
    await sleep(1300);
    await page.mouse.move(5, 5);
    await mouseTo(page);
    await sleep(200);
    assert((await badgeInfo(page)).side === 'right', 'badge did not jump after cooldown');
    return 'right -> left, stays during cooldown, jumps again after it';
  });
  await check('Click copies the IP to the clipboard', async () => {
    try { await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://example.com' }); }
    catch (e) { return { skip: 'cannot grant clipboard permissions: ' + e.message.split('\n')[0] }; }
    await page.goto('https://example.com/');
    const b = await waitBadge(page);
    await page.evaluate(() => navigator.clipboard.writeText('sentinel'));
    await mouseTo(page); await sleep(150); // jumps to the other corner
    const c = await badgeCenter(page);
    await page.mouse.click(c.x, c.y); // follow it and click within the cooldown
    await sleep(600);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    assert(clip === b.ip, `clipboard "${clip}" != ${b.ip}`);
    return clip;
  });
  await check('Double click hides the badge until reload', async () => {
    await page.goto('https://example.com/');
    await waitBadge(page);
    await mouseTo(page); await sleep(150);
    const c = await badgeCenter(page);
    await page.mouse.dblclick(c.x, c.y);
    await sleep(400);
    assert(!(await page.$(HOST_SEL)), 'badge still present after dblclick');
    await page.reload();
    await waitBadge(page);
    return 'hidden, back after reload';
  });

  // 8. Options: position left, font size, stored in storage.sync.
  await check('Options (storage.sync): left corner + font size 16', async () => {
    await sw.evaluate(() => chrome.storage.sync.set({ position: 'left', fontSize: 16 }));
    await page.goto('https://example.com/');
    const b = await waitBadge(page);
    assert(b.side === 'left', 'side ' + b.side);
    assert(b.fontSize === '16px', 'font size ' + b.fontSize);
    await sw.evaluate(() => chrome.storage.sync.set({ position: 'right', fontSize: 12 }));
    return 'applied';
  });
  await check('Options page loads and localizes', async () => {
    const p = await ctx.newPage();
    await p.goto(`chrome-extension://${extId}/options.html`);
    const text = await p.evaluate(() => document.body.innerText);
    assert(/Corner|Esquina/.test(text), 'options text: ' + text.slice(0, 80));
    const val = await p.$eval('#dnsFallback', (e) => e.checked);
    assert(val === true, 'dnsFallback default should be on');
    assert(await p.$('#disabledHosts') && await p.$('#showDetails'), 'new options missing');
    await p.close();
    return 'ok';
  });

  // 9. Service worker asleep: stop it, then navigate.
  await check('Cold service worker (stopped) still yields the IP', async () => {
    const status = await stopServiceWorker();
    assert(/STOPPED/.test(status), 'could not stop SW: ' + status);
    const resp = await page.goto('https://www.wikipedia.org/');
    const addr = await resp.serverAddr();
    const b = await waitBadge(page);
    assert(!b.dns && !b.unknown, 'badge fell back: ' + JSON.stringify(b));
    assert(!addr || addr.ipAddress === b.ip, `badge ${b.ip} != connection ${addr && addr.ipAddress}`);
    return `${b.ip} after ${status}`;
  });
  await check('Cold service worker + reload of an already open tab', async () => {
    await page.goto('https://example.org/');
    await waitBadge(page);
    const status = await stopServiceWorker();
    await page.reload();
    const b = await waitBadge(page);
    assert(IPV4.test(b.ip) || IPV6.test(b.ip), 'bad badge ' + b.ip);
    return `${b.ip} after ${status}`;
  });

  // 10. Session restore / cache: no connection IP -> DNS fallback with tag.
  await check('DNS fallback when the response never hit the network', async () => {
    const p = await ctx.newPage();
    await p.route('https://example.net/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>mock</title><p>mocked</p>' }));
    await p.goto('https://example.net/');
    const b = await waitBadge(p, 8000);
    await p.close();
    assert(b.dns, 'expected DNS-tagged badge, got ' + JSON.stringify(b));
    assert(IPV4.test(b.ip) || IPV6.test(b.ip), 'bad DNS ip ' + b.ip);
    return `${b.ip} (DNS tag)`;
  });
  await check('DNS fallback disabled -> "IP ?" badge, no fetch', async () => {
    await sw.evaluate(() => chrome.storage.sync.set({ dnsFallback: false }));
    const p = await ctx.newPage();
    await p.route('https://example.net/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><p>mocked</p>' }));
    await p.goto('https://example.net/?nofallback');
    const b = await waitBadge(p, 8000);
    await p.close();
    await sw.evaluate(() => chrome.storage.sync.set({ dnsFallback: true }));
    assert(b.unknown && b.ip === 'IP ?', 'unexpected badge ' + JSON.stringify(b));
    return 'IP ? shown';
  });
  await check('resolveDns() returns A/AAAA via dns.google', async () => {
    const ip = await sw.evaluate(() => resolveDns('example.com'));
    assert(ip && (IPV4.test(ip) || ip.includes(':')), 'resolveDns -> ' + ip);
    return ip;
  });
  await check('IP-literal hosts are shown directly', async () => {
    await page.goto(local('/'));
    const b = await waitBadge(page);
    assert(b.ip === '127.0.0.1' && !b.dns, JSON.stringify(b));
    return b.ip;
  });

  // 10b. Provider / protocol details.
  await check('Provider + protocol details from response headers (local Cloudflare-like)', async () => {
    await page.goto(local('/cf'));
    const b = await waitBadge(page);
    assert(b.details && b.details.includes('Cloudflare'), 'details: ' + b.details);
    assert(b.details.includes('http/1.1'), 'protocol missing: ' + b.details);
    return b.details;
  });
  await check('Provider detected on github.com', async () => {
    await page.goto('https://github.com/');
    const b = await waitBadge(page);
    assert(b.details && /GitHub|Fastly/.test(b.details), 'details: ' + b.details);
    return b.details;
  });
  await check('detectProvider() rules', async () => {
    const r = await sw.evaluate(() => [
      detectProvider([{ name: 'X-Amz-Cf-Id', value: 'abc' }]).provider,
      detectProvider([{ name: 'Via', value: '1.1 varnish' }, { name: 'X-Served-By', value: 'cache-mad22' }]).provider,
      detectProvider([{ name: 'Server', value: 'nginx/1.25' }]).provider,
      detectProvider([{ name: 'Server', value: 'nginx/1.25' }]).server,
      detectProvider([{ name: 'x-vercel-id', value: 'cdg1::abc' }]).provider,
    ]);
    assert(r[0] === 'CloudFront' && r[1] === 'Fastly' && r[2] === null && r[3] === 'nginx/1.25' && r[4] === 'Vercel', JSON.stringify(r));
    return r.filter(Boolean).join(', ');
  });
  await check('showDetails=false hides the details span', async () => {
    await sw.evaluate(() => chrome.storage.sync.set({ showDetails: false }));
    await page.goto(local('/cf'));
    const b = await waitBadge(page);
    await sw.evaluate(() => chrome.storage.sync.set({ showDetails: true }));
    assert(b.details === null, 'details still shown: ' + b.details);
    return 'hidden';
  });

  // 10c. Reverse DNS.
  await check('reverseDns() resolves PTR via dns.google', async () => {
    const r = await sw.evaluate(async () => [await reverseDns('8.8.8.8'), reverseName('2001:4860:4860::8888'), reverseName('1.2.3')]);
    assert(r[0] === 'dns.google', 'PTR 8.8.8.8 -> ' + r[0]);
    assert(r[1] === '8.8.8.8.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.6.8.4.0.6.8.4.1.0.0.2.ip6.arpa', 'ipv6 name ' + r[1]);
    assert(r[2] === null, 'bad ipv4 should be null');
    return r[0];
  });

  // 10d. Per-site disable list.
  await check('disabledHosts hides the badge (with subdomains) and reacts live', async () => {
    await page.goto('https://example.com/');
    await waitBadge(page);
    await sw.evaluate(() => chrome.storage.sync.set({ disabledHosts: ['example.com'] }));
    await sleep(400);
    assert(!(await page.$(HOST_SEL)), 'badge not removed live after disabling');
    await page.goto('https://www.example.com/');
    await sleep(1200);
    assert(!(await page.$(HOST_SEL)), 'badge shown on subdomain of a disabled host');
    await sw.evaluate(() => chrome.storage.sync.set({ disabledHosts: [] }));
    await sleep(400);
    const b = await waitBadge(page);
    return 'hidden live, hidden on www., back when re-enabled: ' + b.ip;
  });

  // 10e. Popup.
  await check('Popup shows host, IP, provider, protocol and toggles hide-on-site', async () => {
    await page.goto(local('/cf'));
    await waitBadge(page);
    const tabId = await sw.evaluate(async () => (await chrome.tabs.query({}))
      .find((t) => t.url && t.url.includes('/cf')).id);
    const pop = await ctx.newPage();
    await pop.goto(`chrome-extension://${extId}/popup.html?tab=${tabId}`);
    await pop.waitForSelector('#main:not([hidden])', { timeout: 5000 });
    await sleep(300);
    const read = () => pop.evaluate(() => ({
      host: document.getElementById('host').textContent,
      ip: document.getElementById('ip').textContent,
      provider: document.getElementById('provider').hidden ? null : document.getElementById('provider').textContent,
      protocol: document.getElementById('protocol').hidden ? null : document.getElementById('protocol').textContent,
      server: document.getElementById('serverRow').hidden ? null : document.getElementById('server').textContent,
      status: document.getElementById('status').hidden ? null : document.getElementById('status').textContent,
      source: document.getElementById('source').textContent,
    }));
    const v = await read();
    assert(v.host === '127.0.0.1' && v.ip === '127.0.0.1', JSON.stringify(v));
    assert(v.provider === 'Cloudflare', 'provider ' + v.provider);
    assert(v.protocol === 'http/1.1', 'protocol ' + v.protocol);
    assert(v.server === 'cloudflare' && v.status === 'HTTP 200', JSON.stringify(v));
    // toggle hide -> badge disappears in the page, list updated
    await pop.click('#hide');
    await sleep(500);
    assert(!(await page.$(HOST_SEL)), 'badge still shown after popup hide toggle');
    const list = await sw.evaluate(() => chrome.storage.sync.get('disabledHosts').then((o) => o.disabledHosts));
    assert(list.includes('127.0.0.1'), 'list ' + JSON.stringify(list));
    await pop.click('#hide');
    await sleep(500);
    assert(await page.$(HOST_SEL), 'badge did not come back');
    await pop.close();
    return `${v.ip} · ${v.provider} · ${v.protocol} · ${v.status}`;
  });
  await check('Popup on a non-web tab shows the empty state', async () => {
    const blank = await ctx.newPage();
    await blank.goto('chrome://version/');
    // chrome:// is outside <all_urls>, so the extension sees no URL for that tab.
    const tabId = await sw.evaluate(async () => (await chrome.tabs.query({})).find((t) => !t.url).id);
    const pop = await ctx.newPage();
    await pop.goto(`chrome-extension://${extId}/popup.html?tab=${tabId}`);
    await pop.waitForSelector('#empty:not([hidden])', { timeout: 5000 });
    await pop.close(); await blank.close();
    return 'ok';
  });

  // 11. Non-web pages: nothing injected, nothing thrown.
  await check('about:blank, chrome://, file:// are left alone', async () => {
    const p = await ctx.newPage();
    await p.goto('about:blank'); await sleep(300);
    assert(!(await p.$(HOST_SEL)), 'badge on about:blank');
    await p.goto('chrome://version/'); await sleep(300);
    assert(!(await p.$(HOST_SEL)), 'badge on chrome://');
    await p.goto('file://' + path.resolve(__dirname, 'fixtures/local.html')); await sleep(300);
    assert(!(await p.$(HOST_SEL)), 'badge on file://');
    await p.close();
    return 'no badge, no errors';
  });

  // 12. Tab cleanup.
  await check('storage.session entry removed when the tab closes', async () => {
    const p = await ctx.newPage();
    await p.goto('https://example.com/');
    await waitBadge(p);
    const keysBefore = await sw.evaluate(() => chrome.storage.session.get(null).then((o) => Object.keys(o)));
    await p.close();
    await sleep(500);
    const keysAfter = await sw.evaluate(() => chrome.storage.session.get(null).then((o) => Object.keys(o)));
    assert(keysAfter.length < keysBefore.length, `keys ${keysBefore.length} -> ${keysAfter.length}`);
    return `${keysBefore.length} -> ${keysAfter.length} keys`;
  });

  // 13. Errors.
  await check('No service worker errors', async () => {
    assert(swErrors.length === 0, swErrors.join(' | '));
    return 'clean';
  });
  await check('No extension-related page errors', async () => {
    assert(pageErrors.length === 0, pageErrors.join(' | '));
    return 'clean';
  });
  await check('chrome://extensions reports no errors for the extension', async () => {
    const p = await ctx.newPage();
    await p.goto(`chrome://extensions/?errors=${extId}`);
    await sleep(800);
    const text = await p.evaluate(() => {
      const walk = (n) => { let t = n.innerText || ''; for (const e of n.querySelectorAll('*')) if (e.shadowRoot) t += ' ' + walk(e.shadowRoot); return t; };
      return walk(document.body).replace(/\s+/g, ' ');
    });
    await p.close();
    assert(!/Uncaught|TypeError|ReferenceError|Error:/.test(text), 'errors page: ' + text.slice(0, 300));
    return 'clean';
  });

  await ctx.close();
  server.close();
  if (server6) server6.close();

  const failed = results.filter((r) => !r.ok);
  const skipped = results.filter((r) => r.skipped);
  console.log(`\n${results.length - failed.length - skipped.length} passed, ${failed.length} failed, ${skipped.length} skipped`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
