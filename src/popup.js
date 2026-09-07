'use strict';

const $ = (id) => document.getElementById(id);
const t = (key, subs) => chrome.i18n.getMessage(key, subs) || key;

function localize() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const msg = chrome.i18n.getMessage(el.dataset.i18n);
    if (msg) el.textContent = msg;
  });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const msg = chrome.i18n.getMessage(el.dataset.i18nTitle);
    if (msg) el.title = msg;
  });
}

const send = (message) =>
  new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (r) => resolve(chrome.runtime.lastError ? null : r));
    } catch (_) {
      resolve(null);
    }
  });

const askPage = (tabId) =>
  new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, { type: 'GET_PAGE_INFO' }, (r) => resolve(chrome.runtime.lastError ? null : r));
    } catch (_) {
      resolve(null);
    }
  });

async function currentTab() {
  // ?tab=<id> lets the page be opened outside the popup (tests, debugging).
  const forced = new URLSearchParams(location.search).get('tab');
  if (forced) return chrome.tabs.get(Number(forced));
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function hostDisabled(list, host) {
  return (list || []).some((h) => {
    const d = String(h || '').trim().toLowerCase();
    return d && (host === d || host.endsWith('.' + d));
  });
}

const formatIp = (ip) => (ip.includes(':') ? '[' + ip + ']' : ip);

async function main() {
  localize();
  $('options').addEventListener('click', () => chrome.runtime.openOptionsPage());

  const tab = await currentTab();
  const info = tab ? await send({ type: 'GET_TAB_INFO', tabId: tab.id }) : null;
  if (!info || !info.host) {
    $('empty').hidden = false;
    return;
  }
  $('main').hidden = false;
  const host = info.host.toLowerCase();
  $('host').textContent = host;

  if (info.ip) {
    $('ip').textContent = formatIp(info.ip);
    const src = $('source');
    if (info.source === 'dns') {
      src.textContent = t('popupSourceDns');
      src.classList.add('dns');
    } else if (info.source === 'literal') {
      src.textContent = t('popupSourceLiteral');
    } else {
      src.textContent = info.stale ? t('popupSourceCached') : t('popupSourceConnection');
      src.classList.add('ok');
    }
    $('ip').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(info.ip);
        $('copied').hidden = false;
        setTimeout(() => ($('copied').hidden = true), 1200);
      } catch (_) {
        /* ignore */
      }
    });
    $('ptrBtn').addEventListener('click', async () => {
      $('ptrBtn').disabled = true;
      $('ptr').textContent = '…';
      const r = await send({ type: 'REVERSE_DNS', ip: info.ip });
      $('ptr').textContent = (r && r.name) || t('popupNoPtr');
      $('ptrBtn').hidden = true;
    });
  } else {
    $('ip').textContent = 'IP ?';
    $('source').textContent = t('popupSourceNone');
    $('ptrRow').hidden = true;
  }

  if (info.provider) {
    $('provider').textContent = info.provider;
    $('provider').hidden = false;
  }
  if (info.status) {
    $('status').textContent = 'HTTP ' + info.status;
    $('status').hidden = false;
  }
  if (info.server) {
    $('server').textContent = info.server;
    $('serverRow').hidden = false;
  }

  const page = await askPage(tab.id);
  if (page && page.protocol) {
    $('protocol').textContent = page.protocol;
    $('protocol').hidden = false;
  }

  // Hide-on-this-site toggle, stored in sync settings as a host list.
  const { disabledHosts = [] } = await chrome.storage.sync.get({ disabledHosts: [] });
  $('hide').checked = hostDisabled(disabledHosts, host);
  $('hideLabel').textContent = t('popupHideOnHost', [host]);
  $('hide').addEventListener('change', async () => {
    const { disabledHosts: cur = [] } = await chrome.storage.sync.get({ disabledHosts: [] });
    const next = cur.filter((h) => String(h).trim().toLowerCase() !== host);
    if ($('hide').checked) next.push(host);
    await chrome.storage.sync.set({ disabledHosts: next });
  });
}

main();
