# Estado del proyecto

> Documento de continuidad. Léelo antes de retomar el trabajo.
> Última actualización: **2026-09-03**.

**Lector Fluido** es una extensión para Firefox y Chrome que superpone resúmenes generados por IA
sobre los párrafos largos de cualquier web. Firefox es el objetivo prioritario.

- Especificación: [`prds/lector-fluido-v1.3-prd.md`](prds/lector-fluido-v1.3-prd.md)
- Por qué las cosas son como son: [`DECISIONES.md`](DECISIONES.md)
- Cómo usarla y depurarla: [`../README.md`](../README.md)

---

## Situación en una frase

La v1 está **implementada por completo y verificada estáticamente**, pero **nunca se ha ejecutado en
un navegador ni ha hecho una sola llamada real a un proveedor de IA**.

| | |
|---|---|
| Código | ~5.150 líneas de TypeScript en `lib/` y `entrypoints/` |
| Pruebas | 165, en 14 ficheros, todas en verde |
| Typecheck | `tsc --noEmit` limpio, modo `strict` |
| Builds | Firefox MV3 y Chrome MV3 correctos, ~107 kB |
| Ejecución real | **Sin verificar** |

---

## Qué está verificado, y cómo

| Área | Cómo se comprobó |
|---|---|
| Heurísticas de extracción | 20 pruebas unitarias + **4 comparando contra `@mozilla/readability`** sobre un artículo realista con navegación, sidebar, comentarios y pie |
| Fusión de párrafos cortos | 22 pruebas: dónde **no** debe fusionar (encabezado, figura, contenedor distinto), el tope de 5 en la acumulación, y el rescate que une cada resto al vecino adyacente con menos palabras |
| Degradación al Modo B | 6 pruebas: bloque invisible retirado con ids contiguos, par solapado, más de un tercio inseguro, ancestro sticky ya no degrada, puntuación baja con evidencia buena da aviso y no bloqueo, cobertura |
| Detección de falacias | 4 pruebas del prompt y los esquemas, 5 del parseo (`coerceFallacies`), 1 de la huella de caché y 8 del overlay: emblemas, popover por hover, fijado por clic, Escape, cierre al ocultar |
| Mensajería compatible con Chrome | 6 pruebas que simulan el comportamiento estricto de Chrome (`sendResponse` + `true`), incluidos errores y mensajes ajenos |
| Internacionalización | 10 pruebas: los cuatro catálogos tienen las mismas claves y los mismos marcadores `$n`, sustitución de `t()`, marcado ligero sin innerHTML y relleno de páginas por `data-i18n` |
| Encaje del overlay | 10 pruebas sobre el factor de interlineado, el relleno derivado del párrafo y el host fuera de flujo. **El ajuste de cuerpo real no se puede probar en jsdom** (no calcula layout) |
| Reglas de longitud y descarte | 11 pruebas sobre `clamp(15,100)` y el corte del 60 % |
| Planificador de tasa | 8 pruebas: concurrencia, token bucket, reducción ante 429, backoff |
| Parsing de respuestas | 11 pruebas: JSON envuelto en ```` ``` ````, ids en texto, respuestas vacías, mapeo de códigos HTTP |
| Tipografía contraria | 11 pruebas, incluida la trampa de que `sans-serif` contiene la cadena `serif` |
| Tinte celeste | 5 pruebas con valores exactos |
| Patrones de origen | 5 pruebas, incluida la separación entre subdominios |
| Manifiestos | Inspeccionados a mano en ambos navegadores tras cada build |

## Qué NO está verificado

Esto es lo que hay que atacar primero. Nada de lo siguiente se ha ejecutado nunca:

1. **Ninguna llamada real a ningún proveedor.** Los cuatro adaptadores HTTP (Gemini, OpenRouter,
   OpenAI, Anthropic) están escritos **contra la documentación de cada API, no probados contra ella**.
   Los formatos de petición y respuesta pueden estar mal.
2. **La IA local.** Ni la `Summarizer` API de Chrome ni `browser.trial.ml` de Firefox se han invocado.
   La forma de la respuesta de Firefox (`readFirefoxOutput`) es una suposición razonada con tres
   variantes de fallback.
3. **El OAuth PKCE de OpenRouter.** Flujo completo sin ejecutar.
4. **El renderizado de los overlays.** No se ha visto un overlay en pantalla: ni el anclaje, ni el
   tinte celeste, ni la tipografía contraria, ni el span de los bloques fusionados, ni el **ajuste
   de cuerpo** que reduce el texto hasta que cabe (depende de `scrollHeight`, imposible en jsdom).
   Tampoco la pestaña lateral: su plegado por hover y la apertura del menú hacia abajo cerca del
   borde superior.
7. **La calidad de la detección de falacias.** El prompt pide listón alto, pero no se ha medido ni la
   precisión ni si la cita literal coincide con el original. Ningún emblema se ha visto en pantalla.
8. **La interfaz en otro idioma.** Los catálogos en, fr y de existen y son consistentes, pero no se ha
   abierto la extensión con el navegador en esos idiomas. Las traducciones las hizo el asistente sin
   revisión nativa.
5. **La inyección del content script.** Se corrigió un bug que la impedía (ver más abajo), pero la
   corrección **no está confirmada en navegador**.
   Tampoco se ha ejecutado en Chrome: la mensajería se reescribió para que funcione ahí (D15), pero
   solo está probada con una simulación del comportamiento de Chrome.
6. **El extractor sobre páginas reales.** Solo se ha probado contra fixtures sintéticos. El PRD pide
   una suite de 20 páginas reales que no existe todavía.

---

## Siguientes pasos, por orden

### 1. Confirmar que arranca (bloqueante para todo lo demás)

```bash
npm install && npm run build
```
Cargar en `about:debugging` → *Cargar complemento temporal* → `.output/firefox-mv3/manifest.json`.

Abrir un artículo, activar el sitio desde el icono de la barra, y comprobar que aparece el botón
flotante. Si no aparece: botón **Diagnóstico** del popup, que reporta permiso, origen habilitado,
content script vivo, scripts registrados, estado del proveedor y resultado de la extracción.

### 2. Validar un proveedor de punta a punta

El camino más corto es `gemini-free`: clave gratuita en [AI Studio](https://aistudio.google.com/apikey)
sin tarjeta. En Opciones hay que **aceptar los dos consentimientos** (nube y free tier de Gemini) o el
pipeline descartará el proveedor — lo dirá en la consola del background con el motivo exacto.

El botón **Probar** de cada proveedor en Opciones hace una llamada mínima aislada: es la forma más
rápida de detectar un formato de petición equivocado sin depender del resto del pipeline.

### 3. Los spikes que pide el PRD (Fase 1)

Ninguno está hecho. En orden de valor:

- **Calidad `batch` vs `per-block`**: los mismos 10 artículos por ambas estrategias, evaluación ciega
  por bloque. Determina el `batchSize` por defecto y si `batch` se sostiene en proveedores de pago.
  Es el riesgo alto pendiente: 25 bloques en una respuesta pueden salir más superficiales.
- **Suite de 20 páginas reales** guardadas como HTML, con aserciones de bloques esperados. Es la red
  de seguridad contra regresiones del extractor.
- **Calidad de `distilbart` en Firefox**: es un modelo entrenado en inglés; si devuelve resúmenes en
  inglés sobre texto en español, la IA local deja de ser aceptable como default en Firefox y hay que
  degradar a `gemini-free`.
- **Umbrales de degradación al Modo B**: los valores de `DEGRADE` (puntuación < 20 con menos de 3
  bloques o cobertura < 50 %; cobertura < 40 % con más de 500 palabras; más de un tercio de bloques
  inseguros) están puestos por criterio, no medidos.

### 4. Antes de publicar

De la Fase 5 está hecho lo que no necesita ejecutar la extensión:

- Política de privacidad bilingüe (`PRIVACY.md`), textos de la ficha y notas para el revisor
  (`docs/amo/LISTING.md`), instrucciones de compilación (`docs/amo/BUILD.md`), licencia MIT y
  metadatos en `package.json`.
- `npm run zip` genera el paquete y el zip de fuentes; `addons-linter` lo valida sin errores ni
  avisos. `strict_min_version` subió a **140** (142 en Android) porque `data_collection_permissions`
  no existe antes.

Falta lo que sí necesita verla funcionar: **capturas de pantalla** (AMO exige al menos una) y un
**icono definitivo** en lugar del marcador de `public/icon/`. Y el onboarding.

---

## Riesgos abiertos

| Riesgo | Estado |
|---|---|
| Los adaptadores HTTP nunca se han ejecutado | **Alto.** Es lo primero que hay que despejar |
| Dilución de calidad con 25 bloques en una llamada | **Alto.** Sin medir; spike pendiente |
| Fidelidad del extractor portado sobre webs reales | **Medio.** Coincide con Readability en fixtures; sin probar en producción |
| `browser.trial.ml` es experimental y su API puede cambiar | **Medio.** Aislado tras el adaptador; degrada al proveedor de respaldo |
| Google recortó cuotas del free tier sin aviso en dic-2025 | **Medio.** El planificador las descubre ante 429 en vez de codificarlas |
| `registration: 'runtime'` de WXT | **Bajo.** El build genera el fichero y el manifiesto queda con `content_scripts: []`, que es lo esperado |

---

## Bugs encontrados y corregidos

Quedan aquí porque son fallos de los que no protege el compilador y conviene no reintroducir:

1. **El content script nunca se inyectaba al activar un sitio.** El popup mandaba `toggle-origin` al
   background, que leía `sender.tab?.id` — pero **el popup no es una pestaña**, así que llegaba
   `undefined` y `injectIntoTab` no se ejecutaba. El botón flotante solo aparecía tras recargar,
   mientras el popup afirmaba que ya estaba listo. Ahora el `tabId` viaja explícito en el mensaje y el
   texto de confirmación depende de si la inyección ocurrió de verdad.
2. **El overlay no heredaba la tipografía de la página.** Usaba `font-family: inherit`, pero el host
   lleva `all: initial`, así que heredaba de un elemento reseteado y salía con la fuente inicial del
   navegador. Familia, cuerpo e interlineado se pasan ahora explícitamente por variables CSS.
3. **Los ids de bloque tenían huecos.** Se asignaban antes de filtrar por umbral, así que
   `byId.get(block.id - 1)` casi nunca encontraba el párrafo anterior y el modo `per-block` perdía su
   contexto. Con la fusión, los ids se asignan después de agrupar y son contiguos.
4. **Backticks dentro de un comentario CSS** en una plantilla literal cerraban la cadena. Lo detecta
   el compilador, pero cuesta leerlo en el error.

---

## Historial

| Fecha | Qué pasó |
|---|---|
| 2026-08-09 | PRD v1.0 tras 3 rondas de clarificación. Investigación de back-ends: se descartan las cuentas de consumidor |
| 2026-08-09 | PRD v1.1: extractor propio sobre DOM vivo, Modo B como respaldo, `gemini-free` como default cloud |
| 2026-08-09 | PRD v1.2: estrategia por proveedor, `batch` de una llamada, escalera de degradación |
| 2026-08-09 | Implementación completa: builds, typecheck y 63 pruebas |
| 2026-08-10 | Logging y diagnóstico. Se encuentra y corrige el bug del `tabId`. 68 pruebas |
| 2026-08-10 | Fondo con 10 % de celeste, tipografía contraria, fusión de párrafos cortos. 97 pruebas |
| 2026-08-12 | Documentación de continuidad (este documento, `DECISIONES.md`, PRD v1.3) |
| 2026-09-13 | Icono distinto por tipo de falacia: lista cerrada de 16 tipos + `other` en el esquema (`kind`), catálogo en `lib/fallacies.ts`. 165 pruebas |
| 2026-09-13 | Degradación al Modo B por evidencia (D17): anclaje por bloque, sin regla sticky/fixed, umbrales por cobertura, informe de bloques inseguros en log y diagnóstico, aviso no bloqueante. 162 pruebas |
| 2026-09-13 | Detección de falacias lógicas por bloque (D16): el modelo las devuelve en el JSON batch, se cachean, y el overlay muestra emblemas ⚠ con popover (nombre, cita literal, por qué). Opción para desactivarla. 156 pruebas |
| 2026-09-12 | Compatibilidad real con Chrome/Chromium: listeners de mensajes vía `sendResponse` (antes devolvían promesas, que Chrome ignora), keepalive del service worker, idioma de salida acotado en la Summarizer API. 138 pruebas |
| 2026-09-12 | Preparación para AMO: política de privacidad, ficha, instrucciones de compilación, metadatos, `addons-linter` limpio, mínimo Firefox 140. Repositorio publicado en GitHub |
| 2026-09-12 | Internacionalización con `browser.i18n`: 190 claves en es, en, fr y de; manifiesto, popup, opciones, content script y mensajes de error del background. 132 pruebas |
| 2026-09-03 | Encaje del overlay (cuerpo que se reduce hasta caber, host fuera de flujo, relleno del párrafo), pestaña lateral compacta en el borde derecho, fusión en dos fases: acumulación de 2–5 párrafos y rescate de restos hacia el vecino más pequeño, para que ningún párrafo quede sin resumir. 116 pruebas |
