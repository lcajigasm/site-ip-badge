# PUBLISH.md — Publicar una extensión en la Chrome Web Store

Tutorial paso a paso para publicar (y actualizar) esta extensión. Referencia oficial: <https://developer.chrome.com/docs/webstore/publish>.

## 1. Cuenta de desarrollador (una sola vez)

1. Entra en el **Developer Dashboard**: <https://chrome.google.com/webstore/devconsole> con la cuenta de Google que será la propietaria. Recomendación: usar una cuenta dedicada, no la personal, y añadir después la personal como colaborador.
2. Paga la **tasa de registro única de 5 USD**.
3. Activa la **verificación en dos pasos** en la cuenta de Google. Sin 2FA no se puede publicar.
4. Rellena la pestaña **Account**: nombre de publicador visible, email de contacto (se muestra públicamente en la ficha) y **verifica el email**.
5. Opcional pero recomendado: verifica un dominio propio en Search Console y asócialo como sitio del publicador. Da badge de "verificado" y confianza en la revisión.
6. Si vendes en la UE: declara si eres "comerciante" (trader) o no. Para una extensión gratuita sin monetizar, "no comerciante".

Límite inicial: **2 extensiones publicadas** por cuenta nueva; se puede pedir ampliación desde el dashboard.

## 2. Preparar el paquete

1. `manifest.json` debe tener `manifest_version: 3`, `name`, `version` (formato `1.0.0`, máx. 4 números), `description` (≤132 caracteres) e `icons` con al menos **128x128** (también 16, 32, 48).
2. Pide solo los permisos que usas. Cada permiso "sensible" (`<all_urls>`, `webRequest`, `tabs`, `scripting`…) alarga la revisión y hay que justificarlo después.
3. No incluyas código remoto (`<script src="https://…">`, `eval`, cargar JS desde la red). MV3 lo prohíbe y es motivo de rechazo automático.
4. Sin `node_modules`, `.git`, tests, source maps ni ficheros ocultos en el zip.
5. Comprime **el contenido** de la carpeta, no la carpeta:

   ```sh
   cd src && zip -r ../dist/site-ip-badge-$(jq -r .version manifest.json).zip . -x '.*' -x '__MACOSX/*'
   ```

   `manifest.json` debe quedar en la raíz del zip.
6. Prueba el zip: descomprímelo en otra carpeta y cárgalo en `chrome://extensions` → "Load unpacked". Si arranca ahí, arrancará en la store.

## 3. Material de la ficha (Store Listing)

Prepáralo antes de subir; el formulario no deja enviar sin ello.

| Elemento | Requisito |
|---|---|
| Icono de tienda | 128x128 PNG, con ~16 px de margen transparente. |
| Capturas | 1–5, **1280x800** o 640x400, PNG/JPEG, sin transparencias. Mínimo 1. |
| Small promo tile | 440x280 (opcional, pero mejora la visibilidad). |
| Marquee | 1440x560 (opcional). |
| Descripción corta | La del manifest, ≤132 caracteres. |
| Descripción larga | Texto plano, sin HTML. Qué hace, cómo se usa, qué NO hace. |
| Categoría | Developer Tools. |
| Idioma | Al menos uno; puedes añadir más con `_locales/`. |
| URL de política de privacidad | Obligatoria si pides `<all_urls>`/`webRequest`. Vale un `PRIVACY.md` en GitHub o una página estática. |
| URL de soporte / homepage | Repositorio GitHub. |

Política de privacidad mínima válida para esta extensión:

> Esta extensión no recopila, almacena ni transmite datos personales. La IP del sitio se obtiene localmente de la respuesta HTTP y se guarda solo en memoria de sesión del navegador. Si la IP no está disponible se consulta el nombre de dominio a `dns.google` (Google Public DNS); no se envía ninguna otra información.

## 4. Subir y rellenar

1. Dashboard → **Add new item** → **Choose file** → sube el zip. Si el manifest tiene errores los verás aquí.
2. Pestaña **Store listing**: rellena todo lo de la tabla anterior.
3. Pestaña **Privacy**:
   - **Single purpose**: una frase. Ej.: "Mostrar la dirección IP del servidor del sitio web actual en la esquina de la página."
   - **Permission justification**: una línea por permiso. Ej.:
     - `webRequest`: "Leer la IP del servidor desde `onResponseStarted` para el documento principal de cada pestaña."
     - `<all_urls>`: "Necesario para observar las respuestas de cualquier sitio e inyectar el badge."
     - `storage`: "Guardar la IP por pestaña en `storage.session` y preferencias del usuario."
   - **Remote code**: "No, I am not using remote code."
   - **Data usage**: marcar que no se recopila ningún dato; aceptar las certificaciones de uso limitado.
4. Pestaña **Distribution**: gratuita, visibilidad **Public** (o **Unlisted** para una primera prueba con amigos: solo accesible por URL), todas las regiones.
5. Pestaña **Test instructions**: no hace falta login; escribe "Abrir cualquier web https, la IP aparece abajo a la derecha."
6. Guarda como borrador. Comprueba que arriba a la derecha no hay avisos rojos.

## 5. Enviar a revisión

1. **Submit for review**. En el diálogo, deja marcado "Publish automatically after review" o desmárcalo para publicar a mano después (tienes 30 días antes de que vuelva a borrador).
2. Tiempos habituales: horas a 2–3 días. Con `<all_urls>` + `webRequest` cuenta con el extremo largo. Estado visible en el dashboard y por email (activa notificaciones en **Account**).
3. Si rechazan: el email cita el apartado de la política incumplido. Corrige, sube nuevo zip **con `version` incrementada** y reenvía. Motivos típicos: permisos sin justificar, descripción vaga, capturas engañosas, nombre que imita a otra extensión.

## 6. Actualizar una versión ya publicada

1. Sube el zip con `version` mayor que la publicada (si no, la subida falla).
2. Pestaña **Package** → **Upload new package**.
3. Revisa que la ficha sigue correcta y **Submit for review**. Los usuarios reciben la actualización automáticamente en unas horas tras aprobarse.
4. Si algo sale mal: **Rollback** desde el menú del item devuelve la versión anterior sin nueva revisión.
5. Cambios que **no** tocan permisos/manifest a veces pasan por revisión acelerada ("skip review" para cambios elegibles).

## 7. Publicar desde CI (opcional)

La Chrome Web Store tiene API. Pasos resumidos:

1. Google Cloud Console → crea proyecto → habilita **Chrome Web Store API** → credenciales OAuth 2.0 (tipo Desktop) → obtén `client_id`, `client_secret` y un `refresh_token` con scope `https://www.googleapis.com/auth/chromewebstore`.
2. Guarda los tres como secretos en GitHub Actions.
3. Usa `chrome-webstore-upload-cli`:

   ```sh
   npx chrome-webstore-upload-cli@3 upload --source dist/site-ip-badge-1.0.0.zip --extension-id <ID> --auto-publish
   ```

El `<ID>` de la extensión aparece en el dashboard y en la URL de la ficha una vez creado el item (la primera subida hay que hacerla a mano).

## Checklist rápido antes de cada envío

- [ ] `version` incrementada.
- [ ] `manifest.json` en la raíz del zip.
- [ ] Sin código remoto, sin `eval`, sin `node_modules`.
- [ ] Zip probado como "unpacked".
- [ ] Justificación de permisos actualizada si cambiaron.
- [ ] Capturas reflejan la UI actual.
- [ ] Política de privacidad accesible (200 OK).
