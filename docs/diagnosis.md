# Diagnóstico de "Website IP" 1.5.5 (ghbmhlgniedlklkpimlibbaoomlpacmk)

Fecha: 2026-09-07. Paquete obtenido del servidor de actualizaciones de Chrome
(`clients2.google.com/service/update2/crx?...x=id%3Dghbmhlgniedlklkpimlibbaoomlpacmk`),
CRX3 de 56 KB. Ficha de la store: última actualización 28 may 2024, ~60.000 usuarios.

## Contenido del paquete

| Fichero | Tamaño | Qué es |
|---|---|---|
| `manifest.json` | 827 B | **Manifest V3**, `minimum_chrome_version: 88` |
| `background.js` | 1,4 KB | service worker minificado |
| `ip.js` | 1,5 KB | content script (usa jQuery) + lógica del popup |
| `jquery.ip.js` | 94 KB | jQuery **1.7.2** (2012), inyectado en todas las páginas |
| `css/ip.css`, `css/popup.css` | | estilos del badge (`#chrome_websiteIP`, `z-index: 9999`) |
| `popup.html` | | un botón Enable/Disable |
| `images/icon{16,48,128}.png` | | |

Permisos: `storage`, `tabs`, `webRequest`; `host_permissions: *://*/*`. Content script en `document_end`, solo top frame.

## Cómo obtiene la IP

```js
var e = {};                                   // mapa url -> ip EN MEMORIA del service worker
chrome.webRequest.onCompleted.addListener(r => { e[r.url] = r.ip; },
  { urls: ["<all_urls>"], types: ["main_frame"] });
chrome.runtime.onMessage.addListener((r, t, o) => {          // "getIP"
  var a = t.tab.url;
  o({ domainToIP: e[a] !== undefined ? e[a] : null });
});
```

El content script hace `sendMessage({name:"getIP"})` y pinta `'<div id="chrome_websiteIP">' + ip + '</div>'` con jQuery; `mouseover` alterna las clases `_right`/`_left`.

No usa ningún servicio externo para resolver la IP: la fuente es `details.ip` de `webRequest`, la misma que usa la reescritura.

## Hipótesis del TODO, contrastadas

1. **`manifest_version: 2` → descartada.** La 1.5.5 ya es MV3. No hay bloqueo por deprecación de MV2.
2. **Estado en memoria del service worker → confirmada estructuralmente.** El mapa `url → ip` es una variable global del SW. Chrome termina el SW tras ~30 s sin eventos y en cada arranque el mapa vuelve a `{}`. Cualquier consulta que no venga precedida por un `onCompleted` en la *misma* vida del SW devuelve `null`, y el content script pinta literalmente el texto `null`. Casos: pestañas restauradas al abrir Chrome, páginas restauradas desde bfcache, prerender/prefetch (la respuesta no genera evento con esa URL), o cuando `tab.url` no coincide exactamente con la URL de la petición.
3. **Dependencia de un servicio externo → descartada.** No hay `fetch` a ninguna API.

## Reproducción en Chrome for Testing 153 (Playwright, `--load-extension`)

Con el SW vivo la 1.5.5 **sí funciona** en este banco de pruebas: example.com, github.com, wikipedia.org, redirecciones 301, URL con `#hash`, `pushState`, e incluso navegando con el SW parado desde `chrome://serviceworker-internals` (el evento `onCompleted` despierta al SW antes de que el content script pregunte). Es decir, en una sesión recién abierta el fallo no es inmediato; aparece con el uso real:

- **Restaurar sesión / reabrir Chrome:** las pestañas se cargan, `onCompleted` puede llegar antes de que el SW haya registrado el listener en ese arranque o el documento sale de caché sin `ip` (`details.ip` es `undefined` cuando `fromCache`), y el mapa queda sin entrada → `null`.
- **Caché HTTP:** `onCompleted` con `fromCache: true` no trae `ip`; la extensión guarda `undefined` y muestra `null`.
- **Carrera de arranque:** si el SW estaba dormido, el mensaje `getIP` del content script y el evento `onCompleted` se encolan y el orden de despacho no está garantizado; si el mensaje llega primero, `null`.
- Sin fallback de ningún tipo y sin comprobación de host: cuando falla, no hay forma de recuperar.

## Otros hallazgos

- `background.js` construye en cada `tabs.onUpdated` un objeto con `platform`, `referer`, `user_id` (UUID aleatorio persistido en `storage.local` como `wip`), `timestamp`, `uri`, `domain`, `locale` y `user_agent`. En 1.5.5 no se envía a ningún sitio (queda en una variable global `p`), pero es el esqueleto de una telemetría de navegación por usuario. Motivo suficiente para no reutilizar el código.
- Inyecta jQuery 1.7.2 completo (94 KB) en cada página solo para `append` y `mouseover`, y usa `.live()`, eliminado en jQuery 1.9.
- El badge se cuelga del DOM de la página con un `<div>` normal: cualquier CSS de la página que afecte a `div` o a `#chrome_websiteIP` puede romperlo, y `z-index: 9999` queda por debajo de muchos overlays.
- El popup mezcla su lógica con el content script (`ip.js` se carga en ambos contextos).
- Contacto del autor en la ficha: `websiteip865@gmail.com`. Sin repositorio público.

## Decisiones para la reescritura

- Fuente: `webRequest.onResponseStarted` (`details.ip`), igual que el original pero persistido en `chrome.storage.session` por `tabId` **y host**, así sobrevive a que el SW se duerma y no depende de que la URL coincida exactamente.
- Si `details.ip` viene vacío (caché) se conserva la última IP de conexión conocida para ese host en esa pestaña y se marca como `stale`.
- Fallback DNS over HTTPS (`dns.google`) solo cuando no hay IP de conexión, marcado visualmente con la etiqueta `DNS` y desactivable en opciones.
- Badge en Shadow DOM con estilos propios y `z-index` máximo; sin jQuery; sin telemetría de ningún tipo.
- Nombre distinto ("Site IP Badge") para evitar suplantación.
