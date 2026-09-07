// Site IP Badge - background service worker (Manifest V3).
//
// Records the server IP of every main-frame response (chrome.webRequest
// onResponseStarted -> details.ip) in chrome.storage.session, keyed by tab id
// and host, and answers GET_IP requests from the content script. Session
// storage survives the service worker being suspended and is wiped when the
// browser closes. If no connection IP is known for a tab/host (session
// restore, bfcache, mocked responses...) it optionally falls back to a DNS
// over HTTPS lookup against dns.google.

'use strict';

const DEFAULT_SETTINGS = { position: 'right', fontSize: 12, dnsFallback: true };
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

// --- 1. Observe main-frame responses -------------------------------------
// Listener registered at top level so Chrome can wake the worker for it.
chrome.webRequest.onResponseStarted.addListener(
  (details) => {
    if (details.tabId < 0) return;
    const host = hostOf(details.url);
    if (!host) return;
    const ip = details.ip || null;
    (async () => {
      if (ip) {
        await writeHost(details.tabId, host, { ip, source: 'connection', ts: Date.now() });
        return;
      }
      // No IP: response served from the HTTP cache (or intercepted). Keep a
      // previous connection IP for the same host if we have one.
      const tab = await readTab(details.tabId);
      const prev = tab.hosts[host];
      if (prev && prev.ip) {
        await writeHost(details.tabId, host, { ...prev, ts: Date.now(), stale: true });
      }
    })().catch(() => {});
  },
  { urls: ['<all_urls>'], types: ['main_frame'] }
);

// --- 2. DNS over HTTPS fallback -----------------------------------------
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

async function getSettings() {
  try {
    const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
    return { ...DEFAULT_SETTINGS, ...stored };
  } catch (_) {
    return { ...DEFAULT_SETTINGS };
  }
}

// --- 3. Answer the content script ----------------------------------------
async function handleGetIp(sender) {
  const tabId = sender.tab && sender.tab.id;
  const pageUrl = sender.url || (sender.tab && sender.tab.url) || '';
  const host = hostOf(pageUrl);
  if (tabId == null || tabId < 0 || !host) return { ip: null, host: null, source: 'none' };

  const literal = literalIp(host);
  if (literal) return { ip: literal, host, source: 'literal' };

  const tab = await readTab(tabId);
  const entry = tab.hosts[host];
  if (entry && entry.ip) {
    return { ip: entry.ip, host, source: entry.source, stale: !!entry.stale };
  }

  const settings = await getSettings();
  if (!settings.dnsFallback) return { ip: null, host, source: 'none' };

  const ip = await resolveDns(host);
  if (!ip) return { ip: null, host, source: 'none' };
  await writeHost(tabId, host, { ip, source: 'dns', ts: Date.now() });
  return { ip, host, source: 'dns' };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'GET_IP') return false;
  handleGetIp(sender).then(sendResponse, () => sendResponse({ ip: null, host: null, source: 'none' }));
  return true; // keep the channel open for the async response
});

// --- 4. Housekeeping -----------------------------------------------------
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(tabKey(tabId)).catch(() => {});
});

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});
