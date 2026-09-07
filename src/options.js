'use strict';

const DEFAULT_SETTINGS = { position: 'right', fontSize: 12, dnsFallback: true, showDetails: true, disabledHosts: [] };

function localize() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const msg = chrome.i18n.getMessage(el.dataset.i18n);
    if (msg) el.textContent = msg;
  });
}

function load() {
  chrome.storage.sync.get(DEFAULT_SETTINGS, (s) => {
    document.getElementById('position').value = s.position === 'left' ? 'left' : 'right';
    document.getElementById('fontSize').value = Number(s.fontSize) || DEFAULT_SETTINGS.fontSize;
    document.getElementById('dnsFallback').checked = s.dnsFallback !== false;
    document.getElementById('showDetails').checked = s.showDetails !== false;
    document.getElementById('disabledHosts').value = (Array.isArray(s.disabledHosts) ? s.disabledHosts : []).join('\n');
  });
}

function parseHosts(text) {
  const seen = new Set();
  return String(text || '')
    .split(/[\n,;\s]+/)
    .map((h) => h.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
    .filter((h) => h && !seen.has(h) && seen.add(h));
}

let savedTimer = null;
function save() {
  const fontSize = Math.min(32, Math.max(8, Number(document.getElementById('fontSize').value) || DEFAULT_SETTINGS.fontSize));
  const settings = {
    position: document.getElementById('position').value === 'left' ? 'left' : 'right',
    fontSize,
    dnsFallback: document.getElementById('dnsFallback').checked,
    showDetails: document.getElementById('showDetails').checked,
    disabledHosts: parseHosts(document.getElementById('disabledHosts').value),
  };
  chrome.storage.sync.set(settings, () => {
    const saved = document.getElementById('saved');
    saved.hidden = false;
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => (saved.hidden = true), 1200);
  });
}

localize();
load();
['position', 'fontSize', 'dnsFallback', 'showDetails', 'disabledHosts'].forEach((id) => {
  document.getElementById(id).addEventListener('change', save);
});
