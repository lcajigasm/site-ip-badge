# Site IP Badge — Privacy Policy

Site IP Badge does not collect, store or transmit any personal data.

The IP address shown on each page is read locally from the HTTP response the browser already received (`chrome.webRequest.onResponseStarted`) and kept only in the browser's session memory (`chrome.storage.session`), which is cleared when the browser closes. Your preferences (badge position, font size, DNS fallback on/off) are stored with `chrome.storage.sync`.

The only network request the extension can make on its own is the optional DNS fallback: if the connection IP of a page is unknown (for example a tab restored after a restart), the host name of that page is sent to Google Public DNS (`https://dns.google/resolve`) to obtain an address. No other information is sent, and the fallback can be switched off in the options.

There is no analytics, telemetry, advertising or remote code.

Contact: dev@cajigas.es
