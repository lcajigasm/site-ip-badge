// Site IP Badge - background service worker (Manifest V3).
//
// Records the server IP of every main-frame response (chrome.webRequest
// onResponseStarted -> details.ip) in chrome.storage.session, keyed by tab id
// and host, together with the hosting provider / CDN detected from the
// response headers, and answers requests from the content script and the
// popup. Session storage survives the service worker being suspended and is
// wiped when the browser closes. If no connection IP is known for a tab/host
// (session restore, bfcache, mocked responses...) it optionally falls back to
// a DNS over HTTPS lookup against dns.google. Reverse DNS is on demand only.

'use strict';

const DEFAULT_SETTINGS = { position: 'right', fontSize: 12, dnsFallback: true, showDetails: true, disabledHosts: [] };
const MAX_HOSTS_PER_TAB = 6;
const DOH_ENDPOINT = 'https://dns.google/resolve';

function tabKey(tabId) {
  return 'tab:' + tabId;
}

function hostOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.hostname;
  } catch (_) {
    return null;
  }
}

// Returns the address if `host` is an IP literal (URL.hostname keeps the
// brackets around IPv6 literals), otherwise null.
function literalIp(host) {
  if (!host) return null;
  if (host.startsWith('[') && host.endsWith(']')) return host.slice(1, -1);
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return host;
  return null;
}

async function readTab(tabId) {
  const key = tabKey(tabId);
  const res = await chrome.storage.session.get(key);
  return res[key] || { hosts: {} };
}

async function writeHost(tabId, host, entry) {
  const key = tabKey(tabId);
  const tab = await readTab(tabId);
  tab.hosts[host] = entry;
  // Keep only the most recent hosts per tab (prerender, bfcache, redirects
  // can leave a few behind).
  const hosts = Object.entries(tab.hosts).sort((a, b) => b[1].ts - a[1].ts);
  tab.hosts = Object.fromEntries(hosts.slice(0, MAX_HOSTS_PER_TAB));
  await chrome.storage.session.set({ [key]: tab });
}

// --- 1. Provider / CDN detection from response headers -------------------
// [header name, value pattern or null, label]. First match wins, so the more
// specific signals come first.
const PROVIDER_RULES = [
  ['cf-ray', null, 'Cloudflare'],
  ['server', /^cloudflare/i, 'Cloudflare'],
  ['x-amz-cf-id', null, 'CloudFront'],
  ['x-amz-cf-pop', null, 'CloudFront'],
  ['via', /cloudfront/i, 'CloudFront'],
  ['x-cache', /cloudfront/i, 'CloudFront'],
  ['server', /^AmazonS3/i, 'Amazon S3'],
  ['x-fastly-request-id', null, 'Fastly'],
  ['x-served-by', /^cache-/i, 'Fastly'],
  ['x-akamai-transformed', null, 'Akamai'],
  ['x-akamai-request-id', null, 'Akamai'],
  ['server', /AkamaiGHost|AkamaiNetStorage/i, 'Akamai'],
  ['x-vercel-id', null, 'Vercel'],
  ['server', /^Vercel/i, 'Vercel'],
  ['x-nf-request-id', null, 'Netlify'],
  ['server', /^Netlify/i, 'Netlify'],
  ['x-github-request-id', null, 'GitHub'],
  ['server', /^GitHub\.com/i, 'GitHub'],
  ['server', /^(gws|ESF|GSE|sffe|gvs|Google Frontend|UploadServer)/i, 'Google'],
  ['via', /1\.1 google/i, 'Google'],
  ['x-azure-ref', null, 'Azure Front Door'],
  ['x-msedge-ref', null, 'Azure Front Door'],
  ['fly-request-id', null, 'Fly.io'],
  ['via', /vegur/i, 'Heroku'],
  ['server', /^Cowboy/i, 'Heroku'],
  ['x-render-origin-server', null, 'Render'],
  ['server', /^BunnyCDN/i, 'Bunny CDN'],
  ['cdn-pullzone', null, 'Bunny CDN'],
  ['x-iinfo', null, 'Imperva'],
  ['x-cdn', /imperva|incapsula/i, 'Imperva'],
  ['x-sucuri-id', null, 'Sucuri'],
  ['x-shopify-stage', null, 'Shopify'],
  ['x-shopid', null, 'Shopify'],
  ['x-wix-request-id', null, 'Wix'],
  ['server', /^Squarespace/i, 'Squarespace'],
  ['x-litespeed-cache', null, 'LiteSpeed'],
  ['server', /^LiteSpeed/i, 'LiteSpeed'],
  ['via', /varnish/i, 'Varnish'],
];

// headers: [{name, value}] as delivered by webRequest. Returns
// { provider, server } where either may be null.
function detectProvider(headers) {
  const map = {};
  for (const h of headers || []) {
    if (h && h.name) map[h.name.toLowerCase()] = h.value || '';
  }
  let provider = null;
  for (const [name, pattern, label] of PROVIDER_RULES) {
    if (!(name in map)) continue;
    if (pattern && !pattern.test(map[name])) continue;
    provider = label;
    break;
  }
  const server = map.server ? map.server.slice(0, 80) : null;
  return { provider, server };
}

// --- 2. Observe main-frame responses -------------------------------------
// Listener registered at top level so Chrome can wake the worker for it.
chrome.webRequest.onResponseStarted.addListener(
  (details) => {
    if (details.tabId < 0) return;
    const host = hostOf(details.url);
    if (!host) return;
    const ip = details.ip || null;
    const { provider, server } = detectProvider(details.responseHeaders);
    const status = details.statusCode || null;
    (async () => {
      if (ip) {
        await writeHost(details.tabId, host, { ip, source: 'connection', ts: Date.now(), provider, server, status });
        return;
      }
      // No IP: response served from the HTTP cache (or intercepted). Keep a
      // previous connection IP for the same host if we have one.
      const tab = await readTab(details.tabId);
      const prev = tab.hosts[host];
      if (prev && prev.ip) {
        await writeHost(details.tabId, host, { ...prev, ts: Date.now(), stale: true, provider: provider || prev.provider, server: server || prev.server, status });
      }
    })().catch(() => {});
  },
  { urls: ['<all_urls>'], types: ['main_frame'] },
  ['responseHeaders']
);

// --- 3. DNS over HTTPS ---------------------------------------------------
async function resolveDns(host) {
  for (const type of ['A', 'AAAA']) {
    try {
      const url = DOH_ENDPOINT + '?name=' + encodeURIComponent(host) + '&type=' + type;
      const res = await fetch(url, { cache: 'no-store', headers: { accept: 'application/dns-json' } });
      if (!res.ok) continue;
      const json = await res.json();
      const wanted = type === 'A' ? 1 : 28;
      const answer = (json.Answer || []).find((a) => a.type === wanted && a.data);
      if (answer) return answer.data;
    } catch (_) {
      // network error, try next record type
    }
  }
  return null;
}

// Reverse lookup (PTR) of an IPv4/IPv6 address. On demand only (popup).
function reverseName(ip) {
  if (ip.includes(':')) {
    // expand IPv6 to 32 nibbles
    const [head, tail = ''] = ip.split('::');
    const h = head ? head.split(':') : [];
    const t = tail ? tail.split(':') : [];
    const groups = [...h, ...new Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
    if (groups.length !== 8) return null;
    const hex = groups.map((g) => g.padStart(4, '0')).join('');
    return hex.split('').reverse().join('.') + '.ip6.arpa';
  }
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  return parts.reverse().join('.') + '.in-addr.arpa';
}

async function reverseDns(ip) {
  const name = reverseName(String(ip).trim());
  if (!name) return null;
  try {
    const url = DOH_ENDPOINT + '?name=' + encodeURIComponent(name) + '&type=PTR';
    const res = await fetch(url, { cache: 'no-store', headers: { accept: 'application/dns-json' } });
    if (!res.ok) return null;
    const json = await res.json();
    const answer = (json.Answer || []).find((a) => a.type === 12 && a.data);
    return answer ? answer.data.replace(/\.$/, '') : null;
  } catch (_) {
    return null;
  }
}

async function getSettings() {
  try {
    const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
    return { ...DEFAULT_SETTINGS, ...stored };
  } catch (_) {
    return { ...DEFAULT_SETTINGS };
  }
}

// --- 4. Answer the content script and the popup --------------------------
function pick(entry) {
  return { provider: entry.provider || null, server: entry.server || null, status: entry.status || null };
}

async function lookup(tabId, pageUrl) {
  const host = hostOf(pageUrl);
  if (tabId == null || tabId < 0 || !host) return { ip: null, host: null, source: 'none' };

  const tab = await readTab(tabId);
  const entry = tab.hosts[host] || {};

  const literal = literalIp(host);
  if (literal) return { ip: literal, host, source: 'literal', ...pick(entry) };

  if (entry.ip) {
    return { ip: entry.ip, host, source: entry.source, stale: !!entry.stale, ...pick(entry) };
  }

  const settings = await getSettings();
  if (!settings.dnsFallback) return { ip: null, host, source: 'none', ...pick(entry) };

  const ip = await resolveDns(host);
  if (!ip) return { ip: null, host, source: 'none', ...pick(entry) };
  await writeHost(tabId, host, { ...entry, ip, source: 'dns', ts: Date.now() });
  return { ip, host, source: 'dns', ...pick(entry) };
}

function handleGetIp(sender) {
  const tabId = sender.tab && sender.tab.id;
  const pageUrl = sender.url || (sender.tab && sender.tab.url) || '';
  return lookup(tabId, pageUrl);
}

// Popup: info for an arbitrary tab (the active one).
async function handleGetTabInfo(message) {
  const tab = await chrome.tabs.get(message.tabId);
  const info = await lookup(tab.id, tab.url || '');
  return { ...info, tabId: tab.id, url: tab.url || '' };
}

const NONE = { ip: null, host: null, source: 'none' };

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return false;
  let job;
  switch (message.type) {
    case 'GET_IP':
      job = handleGetIp(sender);
      break;
    case 'GET_TAB_INFO':
      job = handleGetTabInfo(message);
      break;
    case 'REVERSE_DNS':
      job = reverseDns(message.ip).then((name) => ({ name }));
      break;
    default:
      return false;
  }
  job.then(sendResponse, () => sendResponse(message.type === 'REVERSE_DNS' ? { name: null } : NONE));
  return true; // keep the channel open for the async response
});

// --- 5. Housekeeping -----------------------------------------------------
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(tabKey(tabId)).catch(() => {});
});
