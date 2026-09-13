# Lector Fluido

Extensión para **Firefox y Chrome** que superpone resúmenes generados por IA sobre los párrafos largos
de cualquier web. Un clic en el ojito (👁) revela el texto original.

Firefox es el objetivo prioritario: `npm run dev` y `npm run build` apuntan a Firefox.

> **¿Retomando el proyecto?** Empieza por [`docs/ESTADO.md`](docs/ESTADO.md): qué está hecho, qué está
> verificado y qué hay que hacer a continuación.

| Documento | Para qué |
|---|---|
| [`docs/ESTADO.md`](docs/ESTADO.md) | Situación actual, qué falta verificar y siguientes pasos |
| [`docs/DECISIONES.md`](docs/DECISIONES.md) | Por qué el proyecto es como es, y qué reconsiderar si cambian las circunstancias |
| [`docs/prds/lector-fluido-v1.3-prd.md`](docs/prds/lector-fluido-v1.3-prd.md) | Especificación completa y criterios de aceptación |
| Este README | Uso, depuración y funcionamiento |

---

## Puesta en marcha

```bash
npm install

npm run dev          # Firefox con recarga en caliente
npm run dev:chrome   # Chrome

npm run build        # .output/firefox-mv3
npm run build:chrome # .output/chrome-mv3
npm run build:all

npm test             # 162 pruebas
npm run compile      # typecheck sin emitir
```

### Cargar el build manualmente

- **Firefox**: `about:debugging` → *Este Firefox* → *Cargar complemento temporal* → elegir
  `.output/firefox-mv3/manifest.json`.
- **Chrome y Chromium** (Brave, Edge, Vivaldi…): `chrome://extensions` → *Modo desarrollador* →
  *Cargar descomprimida* → `.output/chrome-mv3`. Para empaquetar: `npm run zip:chrome`.

---

## Idiomas

La interfaz está en **español, inglés, francés y alemán** y sigue el idioma del navegador; si el
navegador está en otro idioma, sale en español. Los textos viven en `public/_locales/<idioma>/messages.json`.
El idioma de los **resúmenes** es independiente y se elige en Opciones.

## Cómo se usa

1. Abre un artículo y pulsa el **icono de la extensión** en la barra: activa el sitio actual.
   Esto solicita el permiso de host **solo para ese dominio**.
2. Aparece una **pestaña 📖 pegada al borde derecho** de la ventana (se puede arrastrar en
   vertical). Al pasar el ratón se despliega con la etiqueta y el menú. Púlsala.
3. Cada párrafo recibe un overlay con su resumen. Los que no llegan al umbral se agrupan con sus
   vecinos (de 2 a 5) y, si aun así queda alguno suelto, se une al bloque adyacente con menos
   palabras: ningún párrafo del artículo se queda sin resumir. El overlay ocupa la caja del
   párrafo y **reduce el cuerpo del texto lo justo para que el resumen quepa**; solo si ni con el
   mínimo legible cabe, la caja pasa a tener scroll.
   - **⚠** aparece cuando el texto original del bloque incurre en una **falacia lógica**. Al pasar el
     ratón o clicar muestra cuál es, el fragmento exacto y por qué. Solo con proveedores en la nube en
     modo batch; se desactiva en Opciones.
   - **👁** alterna entre resumen y texto original, bloque a bloque.
   - **Segundo clic** en la pestaña (o `Esc`) alterna todos a la vez.
   - **⋮** (o clic derecho en la pestaña) abre el menú: TL;DR global, regenerar, vista de lectura,
     opciones, deshabilitar el sitio.

---

## Depuración

El registro detallado viene **activado por defecto** (Opciones → Avanzado → *Registro detallado*).
Los avisos y errores se emiten siempre, esté activado o no.

### Dónde mirar cada consola

| Parte | Firefox | Chrome |
|---|---|---|
| **Content script** | F12 en la propia página | F12 en la propia página |
| **Background** | `about:debugging` → *Este Firefox* → *Inspeccionar* | `chrome://extensions` → *service worker* |
| **Popup / Opciones** | Clic derecho sobre la ventana → *Inspeccionar* | Ídem |

Filtra por `[Lector Fluido]`. Cada resumen lleva un id corto (`bg:a3f9`) para poder seguir una
ejecución completa entre mensajes.

### Si no pasa nada al pulsar

**Empieza siempre por el botón `Diagnóstico` del popup.** Comprueba de una vez el permiso de host, si
el origen está habilitado, si el content script responde, qué scripts hay registrados, el estado del
proveedor (disponible / con credencial / con consentimiento) y **el resultado de la extracción sobre
esa página concreta**: qué contenedor se detectó, su puntuación, cuántos bloques candidatos hay, el
mayor de ellos y el motivo de degradación.

Lista los problemas concretos en el propio popup y vuelca las tablas completas en su consola. Responde
directamente a *"¿por qué no me sale ningún overlay aquí?"* — la causa más común es que ningún bloque
llega a las 100 palabras del umbral, y el diagnóstico lo dice con el número exacto.

Si el diagnóstico sale limpio pero no ves el botón flotante, mira la consola de la página: deberían
aparecer `[Lector Fluido] content activo` y `botón flotante insertado`. Si no están, el script no se
está inyectando en esa pestaña; recárgala.

> El content script vive en un mundo aislado, así que `__lectorFluido` **no** es accesible desde la
> consola normal de la página. En Chrome puedes alcanzarlo seleccionando el contexto de la extensión en
> el desplegable de DevTools y llamando a `__lectorFluido.debug()`. En Firefox usa el botón Diagnóstico,
> que expone la misma información por un canal que sí funciona.

### Qué se registra

- **Extracción**: contenedor elegido, puntuación, candidatos, cuántos superan el umbral, motivo de
  degradación y duración.
- **Proveedores**: cuáles se descartan y **por qué** (sin credencial, sin consentimiento, no disponible).
- **Estrategia**: lotes planificados y sus tamaños, o concurrencia en modo per-block.
- **HTTP**: proveedor, endpoint, estado y latencia de cada petición. Nunca la credencial ni el cuerpo.
- **Resultado**: resúmenes, fallos, aciertos de caché, número de llamadas y bloques descartados por
  compresión insuficiente.

## Proveedores de IA

| Proveedor | Coste | Llamadas por artículo | Notas |
|---|---|---|---|
| **IA del navegador** (default) | Gratis | N + 1 | On-device, nada sale del equipo. Chrome: Summarizer API (Gemini Nano). Firefox: `browser.trial.ml` con `distilbart` |
| **Gemini free tier** (default nube) | Gratis | **1** | Clave de [AI Studio](https://aistudio.google.com/apikey) sin tarjeta. ~1.000 artículos/día |
| **OpenRouter** | De pago | 1 | Botón *Conectar*: OAuth PKCE, sin copiar la clave |
| OpenAI / Anthropic / Gemini de pago | De pago | 1 | BYOK |

### Sobre el coste cero

Solo **Gemini** ofrece un free tier de API real e indefinido. Anthropic no tiene free tier permanente
(solo ~$5 de crédito inicial) y OpenAI tampoco: su Data Sharing Program exige ser organización en tier
1-2 y comparte los prompts para entrenamiento. Las cuentas de *chat* (ChatGPT Plus, Claude Pro, Gemini
Advanced) **no dan acceso a la API** en ningún caso.

> ⚠️ En el free tier de Gemini, Google **usa el contenido enviado para mejorar sus productos**. Como
> ese contenido es lo que estás leyendo, la extensión exige un consentimiento explícito y aparte antes
> de usarlo.

---

## Cómo funciona

### Extracción — dos modos

**Modo A (in-place)** es el camino principal. Las heurísticas de Readability están **portadas a
`lib/extract/score.ts`** y se ejecutan sobre el DOM vivo, de modo que cada candidato conserva su
referencia al `Element` real sobre el que anclar el overlay. Readability **no** es dependencia de
runtime; se usa solo en tests como referencia de calidad (ver `NOTICE`).

**Modo B (vista de lectura)** es el respaldo. Se activa cuando el Modo A no es fiable:

- el candidato ganador no alcanza la puntuación mínima de confianza,
- hay menos de 2 bloques elegibles pero más de 500 palabras en la página, o
- la verificación de anclaje falla (altura 0, cajas solapadas, ancestro `fixed`/`sticky`).

Nunca cambia de modo en silencio: avisa y ofrece el cambio a un clic, con opción de fijarlo por dominio.

### Agrupación de párrafos cortos

Los párrafos que no llegan al umbral por sí solos se **fusionan con sus vecinos inmediatos** hasta
alcanzarlo, y comparten un único overlay. La fusión es deliberadamente conservadora: solo entre
hermanos adyacentes, así que un encabezado, una figura o un cambio de contenedor la interrumpen —
ahí el salto de tema es real y juntarlos mezclaría ideas distintas.

### Aspecto del overlay

- **Fondo**: el color de fondo real de la página teñido con un **10 % de celeste**. Opaco, para tapar
  el texto original, pero reconocible al instante como añadido de la extensión. Funciona igual sobre
  fondos blancos, negros o crema.
- **Tipografía**: siempre del tipo **contrario** al del texto original — serifa si la página usa palo
  seco, y palo seco si la página usa serifa. Distingue resumen de original sin depender del color.
  El cuerpo y el interlineado se copian del párrafo para que el bloque no cambie de densidad.

### Longitud del resumen

```
target = clamp(palabras_del_bloque × ratio, 15, 100)   // ratio default 0.125
```

Si el resumen generado supera el **60 %** del original, ese bloque **no recibe overlay**: el texto
queda intacto porque la compresión no compensa.

### Estrategia de llamadas

La declara cada proveedor, porque sus restricciones son incompatibles:

- **`batch`** — una sola llamada por artículo, con el texto completo como contexto y salida
  estructurada (`responseSchema` en Gemini, `json_schema` en OpenAI/OpenRouter, `tool_choice` en
  Anthropic). Da mejor coherencia que un esquema comprimido y convierte el límite de tasa en un
  no-problema.
- **`per-block`** — obligatoria en la IA del navegador, cuya ventana de contexto no admite el artículo
  completo. Genera primero un esquema global y luego un resumen por bloque.

**Escalera de degradación**: reintento con backoff → división del lote en dos → `per-block` completo →
proveedor de respaldo. Solo al agotarla se muestra error, y siempre por bloque.

### Otros detalles

- **Credenciales**: viven en `storage.local` y **nunca** llegan al content script. Todas las llamadas
  de red salen del background, lo que además evita CORS y la CSP del sitio.
- **Permisos**: sin `<all_urls>`. Los host permissions son opcionales y por dominio; el content script
  se registra en tiempo de ejecución con `scripting.registerContentScripts`.
- **Caché**: IndexedDB indexada por URL normalizada + hash del bloque + huella de configuración.
  Cambiar formato, ratio, idioma, proveedor o modelo la invalida. Se guarda el resumen y un hash, nunca
  el texto original. TTL de 30 días y expulsión LRU.
- **Idioma**: `auto` → español si aparece entre los idiomas preferidos; si no, el de la interfaz.
- **Aislamiento visual**: todos los overlays viven en Shadow DOM cerrado con `all: initial`. El overlay
  ocupa exactamente la caja del párrafo, así que el layout no se desplaza nunca.

---

## Publicación y privacidad

- Política de privacidad: [`PRIVACY.md`](PRIVACY.md) (español e inglés).
- Textos y datos de la ficha de addons.mozilla.org: [`docs/amo/LISTING.md`](docs/amo/LISTING.md).
- Instrucciones de compilación para los revisores de AMO: [`docs/amo/BUILD.md`](docs/amo/BUILD.md).
- Paquete y código fuente para el envío: `npm run zip` genera ambos en `.output/`.

## Estructura

```
entrypoints/
  background.ts        orquestación, red, credenciales, caché, OAuth
  content.ts           botón flotante, overlays, observers, degradación a Modo B
  popup/               activar el sitio actual, estado del proveedor
  options/             configuración completa
lib/
  extract/             heurísticas portadas + selección de bloques + verificación de anclaje
  reader/              Modo B: construcción y saneado de la vista de lectura
  providers/           un adaptador por proveedor, con su política de tasa
  pipeline/            estrategias batch/per-block, prompts, planificador
  ui/                  overlay, botón flotante, avisos, tema
  cache.ts config.ts origins.ts oauth.ts words.ts types.ts
tests/                 162 pruebas, incluida la comparación contra Readability
```

---

## Estado

Implementado y verificado: builds de Firefox y Chrome, typecheck limpio y 162 pruebas en verde.

Pendiente de validación **con tráfico real**, que exige credenciales y navegador:

- calidad de `batch` (25 bloques en una llamada) frente a `per-block`, para fijar el `batchSize` default;
- calidad real de `distilbart` en Firefox, que puede devolver resúmenes en inglés;
- comportamiento del extractor sobre las 20 páginas reales de la suite de fixtures.
