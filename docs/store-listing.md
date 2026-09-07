# Chrome Web Store listing — Site IP Badge

## Basics

| Field | Value |
|---|---|
| Name | Site IP Badge |
| Category | Developer Tools |
| Language | English (Spanish included via `_locales/es`) |
| Short description (manifest, ≤132) | Shows the IP address and hosting provider of the server behind the current website in the bottom-right corner. Click to copy. |
| Homepage / support | https://github.com/lcajigasm/site-ip-badge |
| Privacy policy URL | https://github.com/lcajigasm/site-ip-badge/blob/main/PRIVACY.md |
| Store icon | `docs/store/icon128-store.png` (128×128, 16 px transparent margin) |
| Screenshots | `docs/screenshots/store-0[1-5]-*.png` (1280×800, with zoomed badge inset); raw captures in the same folder |

## Detailed description (plain text)

Site IP Badge shows the IP address of the server that delivered the page you are looking at, as a small badge in the bottom-right corner of every http/https page.

What it does
• Shows the real IP of the connection (IPv4 or IPv6), taken from the response the browser received. It reflects CDNs, load balancers and redirects, not just what DNS says.
• Hover the badge and it jumps to the other corner so it never hides what you are reading.
• Click the badge to copy the IP. Double click to hide it until the page is reloaded.
• If the connection IP is not available (a tab restored after restarting the browser, a page served from cache), it can resolve the host name through DNS over HTTPS and shows a "DNS" tag so you know the difference. This fallback can be switched off.
• Shows who is behind the IP: the hosting provider or CDN (Cloudflare, Fastly, CloudFront, Akamai, Vercel, Netlify, GitHub, Google and more) detected from the response headers, plus the HTTP protocol (h2, h3).
• Toolbar popup with the details of the current tab: host, IP and its source, provider, Server header, HTTP status, protocol, copy, on-demand reverse DNS, and a switch to hide the badge on that site.
• Options: corner (left/right), font size, DNS fallback on/off, details on/off, list of sites where the badge is hidden.

What it does not do
• No analytics, no telemetry, no accounts, no remote code.
• It never sends the pages you visit anywhere. The only network requests are the optional DNS fallback (host name to dns.google) and the reverse DNS lookup in the popup (IP to dns.google, only when you click).

Built as a Manifest V3 replacement for the discontinued "Website IP" extension. Open source.

## Privacy tab

**Single purpose:** Show the IP address of the server of the current website in a corner of the page.

**Permission justifications**

- `webRequest`: read `details.ip` and the response headers (to detect the hosting provider / CDN) from `onResponseStarted` for the main-frame document of each tab. Observation only; nothing is blocked or modified.
- `<all_urls>` (host permission): needed to observe the main-frame response of any site and to inject the badge on any http/https page.
- `storage`: keep the IP and provider per tab in `storage.session` (cleared when the browser closes) and the user preferences (including the hidden-sites list) in `storage.sync`.

**Remote code:** No, I am not using remote code.

**Data usage:** The extension does not collect or transmit user data. Certify the limited-use disclosures.

## Distribution

Free, Public, all regions.

## Test instructions for reviewers

No login needed. Open any https page (for example https://example.com): the server IP appears in the bottom-right corner. Move the mouse over it and it jumps to the bottom-left. Click copies the IP; double click hides it. The toolbar icon opens a popup with the details of the tab (provider, protocol, reverse DNS) and a link to the options.
