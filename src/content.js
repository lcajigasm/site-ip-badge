// Site IP Badge - content script.
//
// Asks the service worker for the IP of the server that served this document
// and paints a small fixed badge in the bottom-right corner, inside a
// Shadow DOM so page CSS cannot restyle it and the badge cannot leak styles
// into the page. Hovering moves it to the other corner, click copies the IP,
// double click hides it until the next reload.

(() => {
  'use strict';

  if (window.top !== window) return; // top frame only
  const root = document.documentElement;
  if (!root || root.namespaceURI !== 'http://www.w3.org/1999/xhtml') return; // XML / SVG docs

  const HOST_ID = 'site-ip-badge-host';
  const DEFAULT_SETTINGS = { position: 'right', fontSize: 12, dnsFallback: true };
  const JUMP_COOLDOWN_MS = 1200;

  const STYLE = `
    :host { all: initial; }
    .badge {
      all: initial;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      box-sizing: border-box;
      padding: 4px 8px;
      border: 1px solid #8a8a8a;
      border-bottom: 0;
      border-radius: 4px 4px 0 0;
      background: rgba(245, 245, 245, 0.95);
      color: #222;
      font: var(--sib-font-size, 12px)/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      white-space: nowrap;
      cursor: default;
      user-select: none;
      -webkit-user-select: none;
      pointer-events: auto;
      box-shadow: 0 0 3px rgba(0, 0, 0, 0.15);
    }
    .badge.dns { border-style: dashed; color: #444; }
    .badge.unknown { color: #888; }
    .badge.copied { background: #dff5e1; border-color: #4caf50; }
    .tag {
      all: initial;
      font: 0.75em/1 system-ui, sans-serif;
      font-weight: 700;
      letter-spacing: 0.04em;
      padding: 2px 4px;
      border-radius: 3px;
      background: #666;
      color: #fff;
    }
    @media (prefers-color-scheme: dark) {
      .badge { background: rgba(32, 32, 32, 0.95); color: #eee; border-color: #777; }
      .badge.dns { color: #ccc; }
      .badge.copied { background: #1f3d24; border-color: #4caf50; }
    }
    @media print { .badge { display: none; } }
  `;

  const i18n = (key, subs) => {
    try {
      return chrome.i18n.getMessage(key, subs) || key;
    } catch (_) {
      return key;
    }
  };

  const isIPv6 = (ip) => ip.includes(':');
  const formatIp = (ip) => (isIPv6(ip) ? '[' + ip + ']' : ip);

  function getSettings() {
    return new Promise((resolve) => {
      try {
        chrome.storage.sync.get(DEFAULT_SETTINGS, (stored) => {
          if (chrome.runtime.lastError || !stored) return resolve({ ...DEFAULT_SETTINGS });
          resolve({ ...DEFAULT_SETTINGS, ...stored });
        });
      } catch (_) {
        resolve({ ...DEFAULT_SETTINGS });
      }
    });
  }

  function getIp() {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: 'GET_IP' }, (response) => {
          if (chrome.runtime.lastError) return resolve(null);
          resolve(response || null);
        });
      } catch (_) {
        resolve(null); // extension context invalidated (updated/reloaded)
      }
    });
  }

  function applyHostStyle(host, side) {
    const set = (prop, value) => host.style.setProperty(prop, value, 'important');
    set('all', 'initial');
    set('position', 'fixed');
    set('bottom', '0');
    set('top', 'auto');
    set('z-index', '2147483647');
    set('margin', '0');
    set('padding', '0');
    set('line-height', '0');
    set('pointer-events', 'auto');
    set('display', 'block');
    set('width', 'auto');
    set('height', 'auto');
    set('max-width', '100vw');
    if (side === 'left') {
      set('left', '1%');
      set('right', 'auto');
    } else {
      set('right', '1%');
      set('left', 'auto');
    }
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
    }
    return Promise.resolve(legacyCopy(text));
  }

  function legacyCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      (document.body || root).appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    } catch (_) {
      /* ignore */
    }
  }

  function render(info, settings) {
    if (document.getElementById(HOST_ID)) return;

    const host = document.createElement('div');
    host.id = HOST_ID;
    host.setAttribute('data-site-ip-badge', '');
    let side = settings.position === 'left' ? 'left' : 'right';
    applyHostStyle(host, side);

    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    shadow.appendChild(style);

    const badge = document.createElement('div');
    badge.className = 'badge';
    badge.setAttribute('role', 'status');
    badge.style.setProperty('--sib-font-size', Number(settings.fontSize) + 'px');

    const ipSpan = document.createElement('span');
    ipSpan.className = 'ip';
    badge.appendChild(ipSpan);

    const ip = info && info.ip ? String(info.ip) : null;
    const source = info ? info.source : 'none';
    const pageHost = (info && info.host) || location.hostname;

    if (ip) {
      ipSpan.textContent = formatIp(ip);
      if (source === 'dns') {
        badge.classList.add('dns');
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = 'DNS';
        badge.appendChild(tag);
        badge.title = i18n('badgeTitleDns', [pageHost]);
      } else if (source === 'literal') {
        badge.title = i18n('badgeTitleLiteral', [pageHost]);
      } else {
        badge.title = i18n(info.stale ? 'badgeTitleCached' : 'badgeTitleConnection', [pageHost]);
      }
      badge.title += '\n' + i18n('badgeHint');
    } else {
      badge.classList.add('unknown');
      ipSpan.textContent = 'IP ?';
      badge.title = i18n('badgeTitleUnknown', [pageHost]) + '\n' + i18n('badgeHint');
    }

    // Hover: jump to the other corner so the badge never hides content.
    // A short cooldown after each jump lets the user follow it and click.
    let lastJump = 0;
    badge.addEventListener('mouseenter', () => {
      const now = Date.now();
      if (now - lastJump < JUMP_COOLDOWN_MS) return;
      lastJump = now;
      side = side === 'right' ? 'left' : 'right';
      applyHostStyle(host, side);
    });

    // Click: copy. Double click: hide until reload.
    let clickTimer = null;
    badge.addEventListener('click', () => {
      if (!ip) return;
      clearTimeout(clickTimer);
      clickTimer = setTimeout(() => {
        copyText(ip).then(() => {
          badge.classList.add('copied');
          setTimeout(() => badge.classList.remove('copied'), 900);
        });
      }, 220);
    });
    badge.addEventListener('dblclick', () => {
      clearTimeout(clickTimer);
      host.remove();
    });

    shadow.appendChild(badge);
    (document.body || root).appendChild(host);
  }

  Promise.all([getSettings(), getIp()]).then(([settings, info]) => {
    if (!settings.dnsFallback && !(info && info.ip)) {
      // User disabled the fallback and nothing is cached: stay out of the way.
      if (!info || info.source === 'none') render(info, settings);
      return;
    }
    render(info, settings);
  });
})();
