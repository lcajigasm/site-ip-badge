# Site IP Badge — Privacy Policy

Site IP Badge does not collect, store or transmit any personal data.

The IP address shown on each page is read locally from the HTTP response the browser already received (`chrome.webRequest.onResponseStarted`) and kept only in the browser's session memory (`chrome.storage.session`), which is cleared when the browser closes. Your preferences (badge position, font size, DNS fallback on/off, details on/off, list of sites where the badge is hidden) are stored with `chrome.storage.sync`. The hosting provider shown next to the IP is derived locally from the response headers the browser already received.

The extension can make two kinds of network request, both to Google Public DNS (`https://dns.google/resolve`): the optional DNS fallback, which sends the host name of a page when its connection IP is unknown (for example a tab restored after a restart) and can be switched off in the options; and the reverse DNS lookup in the toolbar popup, which sends the IP address only when you click "Look up". No other information is sent.

There is no analytics, telemetry, advertising or remote code.

Contact: dev@cajigas.es
