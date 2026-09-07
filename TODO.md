# TODO — website-ip

## Goal

**Publicar una extensión Chrome (Manifest V3) propia que muestre la IP del sitio actual en la esquina inferior derecha de cada página, reemplazando a [Website IP](https://chromewebstore.google.com/detail/website-ip/ghbmhlgniedlklkpimlibbaoomlpacmk) (v1.5.5, última actualización mayo 2024, ~60k usuarios), que ha dejado de funcionar.**

Criterio de "hecho": instalada desde la Chrome Web Store, al abrir cualquier `http(s)://` aparece la IP (v4 o v6) del servidor que sirvió el documento principal, se aparta al pasar el ratón por encima y no rompe ninguna página.

---

## 0. Diagnóstico (30 min)

- [x] Descargar el `.crx` de la extensión original (p. ej. con CRX Extractor / `chrome://extensions` → modo desarrollador → carpeta del perfil) y leer `manifest.json`.
- [x] Anotar causa probable del fallo. Hipótesis, por orden:
  1. `manifest_version: 2` → Chrome 138+ desactiva MV2 sin opción de reactivar. Reescritura obligatoria.
  2. MV3 con background persistente simulado: el service worker se duerme y pierde el mapa `tabId → ip` guardado en memoria.
  3. Depende de un servicio externo (DNS API, dominio caído) para resolver la IP.
- [x] Guardar los hallazgos en `docs/diagnosis.md` (qué API usaba para obtener la IP, qué permisos pedía).

## 1. Diseño (MV3)

Fuente de la IP: `chrome.webRequest.onResponseStarted` → `details.ip`. Es la IP real de la conexión, funciona con IPv4/IPv6, no necesita red extra ni permisos de bloqueo (solo observación, permitido en MV3).

```
manifest.json
  manifest_version: 3
  permissions: ["webRequest", "storage"]
  host_permissions: ["<all_urls>"]
  background: { service_worker: "background.js" }
  content_scripts: [{ matches: ["http://*/*","https://*/*"], js: ["content.js"], css: ["content.css"], run_at: "document_idle" }]
```

Flujo:

1. `background.js`: listener de `onResponseStarted` filtrado a `types: ["main_frame"]`. Guarda `{ [tabId]: { ip, host, ts } }` en `chrome.storage.session` (sobrevive a que el SW se duerma; se borra al cerrar el navegador).
2. `content.js`: al cargar, `chrome.runtime.sendMessage({ type: "GET_IP" })`. El SW responde leyendo `storage.session` por `sender.tab.id`.
3. `content.js` pinta un `<div>` fijo abajo-derecha dentro de un **Shadow DOM** (evita que el CSS de la página lo rompa y viceversa). `pointer-events` + `mouseenter` → cambia a abajo-izquierda.
4. Fallback si no hay IP cacheada (p. ej. pestaña restaurada de sesión, bfcache): el SW hace `fetch("https://dns.google/resolve?name=<host>&type=A")` y devuelve la primera respuesta. Marcar visualmente que es DNS y no la IP de conexión.
5. Limpiar entrada en `chrome.tabs.onRemoved`.

Decisiones:

- [x] Sin build step: JS plano, sin dependencias. Estructura: `src/` + `scripts/zip.sh`.
- [x] Sin telemetría, sin fetch salvo el fallback → política de privacidad de una línea.
- [x] Nombre distinto al original para evitar rechazo por suplantación (p. ej. "Site IP Badge").

## 2. Implementación

- [x] `src/manifest.json` según diseño. Icons 16/32/48/128.
- [x] `src/background.js`: listener top-level (obligatorio en MV3, no dentro de async), `storage.session`, `onMessage`, `tabs.onRemoved`.
- [x] `src/content.js` + `src/content.css`: badge en Shadow DOM, IPv6 con `[...]`, click → copia IP al portapapeles, doble clic → oculta hasta recarga.
- [x] Manejar `about:blank`, `chrome://`, `file://` (no inyectar / no fallar).
- [x] `options.html` mínimo: posición (izq/der), tamaño de fuente, activar/desactivar fallback DNS. Guardar en `storage.sync`.
- [x] `scripts/zip.sh`: genera `dist/site-ip-badge-<version>.zip` a partir de `src/`.

## 3. Verificación

- [x] Cargar `src/` descomprimida en `chrome://extensions` (modo desarrollador).
- [x] Probar: sitio IPv4, sitio solo IPv6 (`ipv6.google.com`), SPA con navegación por `history.pushState` (la IP no debe cambiar ni desaparecer), redirecciones 301, página con CSP estricta (p. ej. github.com), iframe pesado (la IP debe ser la del `main_frame`, no del iframe).
- [x] Dejar el navegador inactivo >30 s, volver a la pestaña, recargar: la IP debe seguir apareciendo (SW dormido).
- [x] Restaurar sesión tras cerrar Chrome: debe entrar el fallback DNS.
- [x] `chrome://extensions` → "Errors" vacío. Consola de la página sin errores propios.
- [~] Probar en Chrome estable, Brave y Edge. → Verificado en Chrome for Testing 153 y Brave (suite `test/run.js`). Chrome estable ≥137 ignora `--load-extension`: cargar `src/` a mano en `chrome://extensions`. Edge no instalado.

## 4. Publicación

- [x] Repositorio público y release v1.0.0 con el zip e instrucciones de instalación: https://github.com/lcajigasm/site-ip-badge/releases/tag/v1.0.0
- [ ] Seguir `PUBLISH.md`. Paquete listo en `dist/site-ip-badge-1.0.0.zip`; textos, justificación de permisos y capturas en `docs/store-listing.md`, `docs/screenshots/`, `docs/store/`. Falta: cuenta de desarrollador (tasa 5 USD, 2FA), subir y enviar a revisión.
- [ ] Tras publicar: escribir reseña/aviso en la ficha de la extensión original si hay canal de contacto (`websiteip865@gmail.com`) para redirigir usuarios; opcional.

---

## 5. Versión 1.1.0 (añadido 2026-09-07)

- [x] Detección de proveedor / CDN a partir de las cabeceras de respuesta y protocolo HTTP (h2/h3) junto a la IP.
- [x] Popup en el icono: host, IP y origen, proveedor, cabecera `Server`, estado HTTP, protocolo, copiar, DNS inverso bajo demanda, ocultar en este sitio.
- [x] Lista de sitios donde no mostrar el badge (opciones y popup), con efecto inmediato.

## Fuera de alcance (por ahora)

- Firefox / Safari (webRequest está disponible en Firefox, migración fácil más adelante).
- Mostrar geolocalización / ASN de la IP.
- Historial de IPs por dominio.
