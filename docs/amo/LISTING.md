# Ficha de addons.mozilla.org (AMO)

Textos y datos para el formulario de envío. Lo que AMO pide en inglés va en inglés; el español es
para la localización de la ficha (AMO permite ficha por idioma).

## Envío

| Campo | Valor |
|---|---|
| Archivo | `.output/lector-fluido-<versión>-firefox.zip` (`npm run zip`) |
| Código fuente | `.output/lector-fluido-<versión>-sources.zip`. **Obligatorio**: el paquete está compilado con Vite/WXT. Instrucciones para el revisor en [`BUILD.md`](BUILD.md) |
| Canal | *Listed* para publicar en AMO; *Unlisted* para uso propio firmado |
| Licencia | MIT (fichero `LICENSE` en el repositorio) |
| Política de privacidad | Contenido de [`PRIVACY.md`](../../PRIVACY.md), sección en inglés. AMO la exige por la recogida opcional de `websiteContent` |
| Página del proyecto | https://github.com/joseantonioakel/fluid-ia-reader-firefox-extension |
| Soporte | https://github.com/joseantonioakel/fluid-ia-reader-firefox-extension/issues |
| Categorías | *Feeds, News & Blogging* y *Other* |
| Etiquetas | summarizer, reading, ai, articles, accessibility |

## Nombre

Lector Fluido

## Resumen (máximo 250 caracteres)

**en**
> Overlays AI summaries on the long paragraphs of any article, right where they are. On-device AI by default; bring your own key for Gemini, OpenAI, Anthropic or OpenRouter. One click shows the original.

**es**
> Superpone resúmenes con IA sobre los párrafos largos de cualquier artículo, en su sitio. IA local por defecto; con tu propia clave, Gemini, OpenAI, Anthropic u OpenRouter. Un clic muestra el original.

## Descripción

**en**

> **Read long articles faster without losing the thread.**
>
> Lector Fluido finds the long paragraphs of the page you are reading and replaces each one, in place, with a short summary. The layout does not move: the summary occupies exactly the box of the original paragraph, in a slightly different typeface and background so you always know what is a summary. One click on the eye icon brings back the original text of that paragraph; a second click on the side tab, or Esc, toggles all of them.
>
> **Private by default.** The extension runs only on the sites you enable, one by one, and uses the AI built into your browser, so the text never leaves your computer. If you want better quality, configure a cloud provider with your own API key: Google Gemini (free tier available, no credit card), OpenAI, Anthropic or OpenRouter. Nothing is sent to the cloud until you explicitly accept the privacy notice. There is no server of ours in between and no telemetry.
>
> **Features**
> - Summaries anchored to each paragraph, with short paragraphs grouped so nothing is left out.
> - Logical fallacy detection: a ⚠ badge on blocks whose original text commits one, with the exact quote and why (cloud providers only).
> - Overall TL;DR of the article.
> - Reader view for pages where in-place overlays are not safe.
> - Adjustable summary length, format (paragraph, sentences, bullet points) and language.
> - Local cache so the same article is never summarized twice.
> - Interface in English, Spanish, French and German.
>
> **Permissions.** Access to a site is requested only when you enable it. See the privacy policy for what each permission is used for.

**es**

> **Lee artículos largos más rápido sin perder el hilo.**
>
> Lector Fluido localiza los párrafos largos de la página que estás leyendo y sustituye cada uno, en su sitio, por un resumen breve. El diseño no se mueve: el resumen ocupa exactamente la caja del párrafo original, con una tipografía y un fondo ligeramente distintos para que siempre sepas qué es resumen. Un clic en el ojo devuelve el texto original de ese párrafo; un segundo clic en la pestaña lateral, o Esc, los alterna todos.
>
> **Privado por defecto.** La extensión solo se ejecuta en los sitios que habilitas, uno a uno, y usa la IA integrada en tu navegador, así que el texto no sale de tu equipo. Si quieres más calidad, configura un proveedor en la nube con tu propia clave: Google Gemini (con nivel gratuito, sin tarjeta), OpenAI, Anthropic u OpenRouter. No se envía nada a la nube hasta que aceptas expresamente el aviso de privacidad. No hay ningún servidor nuestro en medio ni telemetría.
>
> **Funciones**
> - Resúmenes anclados a cada párrafo; los párrafos cortos se agrupan para que ninguno quede fuera.
> - Detección de falacias lógicas: un emblema ⚠ en los bloques cuyo texto original incurre en una, con la cita exacta y el porqué (solo proveedores en la nube).
> - Resumen global (TL;DR) del artículo.
> - Vista de lectura para páginas donde superponer no es seguro.
> - Longitud, formato (párrafo, frases, viñetas) e idioma del resumen ajustables.
> - Caché local: el mismo artículo nunca se resume dos veces.
> - Interfaz en español, inglés, francés y alemán.
>
> **Permisos.** El acceso a un sitio se pide solo cuando lo habilitas. La política de privacidad explica para qué sirve cada permiso.

## Notas de la versión 0.1.0

**en**
> First public release. In-place summaries with on-device AI or your own API key (Gemini, OpenAI, Anthropic, OpenRouter), reader view fallback, TL;DR, local cache, interface in en/es/fr/de.

**es**
> Primera versión pública. Resúmenes en el sitio con IA local o tu propia clave (Gemini, OpenAI, Anthropic, OpenRouter), vista de lectura de respaldo, TL;DR, caché local, interfaz en es/en/fr/de.

## Notas para el revisor (campo "Notes to Reviewer")

> Source code is attached; build steps are in `docs/amo/BUILD.md` inside the archive (Node 22+, `npm ci`, `npm run build`; output in `.output/firefox-mv3/`). The bundle is produced by WXT (Vite); there is no obfuscation, only standard minification.
>
> **Permissions**
> - `optional_host_permissions: *://*/*` — access is requested per site, from the toolbar popup, only when the user enables that site. The content script is registered at runtime (`scripting.registerContentScripts`) for enabled origins only; the manifest declares no static `content_scripts`.
> - `storage` — settings, enabled origins, cached summaries and the user's API keys. Keys never leave the background script.
> - `activeTab` + `scripting` — to inject the content script into the current tab right after the user enables the site, without a reload.
> - `identity` — only for OpenRouter's OAuth PKCE flow (`identity.launchWebAuthFlow`), which lets the user obtain an API key without copying it.
> - `trialML` (optional) — Firefox's built-in summarization model; requested only if the user picks the on-device provider.
>
> **Remote code**: none. **Network**: only to the AI provider the user configures (generativelanguage.googleapis.com, api.openai.com, api.anthropic.com, openrouter.ai), and only after the user accepts the privacy consent in Options. No analytics, no server of our own.
>
> **Data collection**: `data_collection_permissions.required: none`; `optional: websiteContent` because page text is sent to the chosen cloud provider only when the user opts in.
>
> **To test with the cloud path**: Options → provider "Google Gemini (free)" → paste a free AI Studio key → tick both consents. Then enable any article page from the toolbar popup and click the side tab. Without a key, the default provider is the browser's on-device AI.

## Capturas de pantalla

Pendientes. AMO pide al menos una; recomendadas 3 o 4 a 1280×800 o 1440×900:

1. Un artículo con varios overlays visibles y la pestaña lateral desplegada.
2. El mismo párrafo con el original restaurado (botón del ojo) junto a otro resumido.
3. El popup con un sitio habilitado.
4. La página de opciones, sección de proveedores.

## Icono

Los iconos de `public/icon/` (16 a 128 px) son marcadores de posición generados. AMO muestra el de
128 px en la ficha; conviene sustituirlo por un icono definitivo antes de publicar en el canal
*listed*.
