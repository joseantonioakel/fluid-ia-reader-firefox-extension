# Registro de decisiones

> Por qué el proyecto es como es. Sirve para no volver a discutir lo ya decidido, y para saber qué
> habría que reconsiderar si cambian las circunstancias.
> Última actualización: **2026-08-12**.

---

## D1 — WXT + TypeScript, con Firefox como objetivo prioritario

Un solo código fuente produce builds MV3 separados. WXT resuelve las divergencias entre navegadores
(service worker en Chrome vs. background scripts en Firefox, `chrome.*` vs. `browser.*`) y da HMR en
content scripts, que es donde más se itera.

`npm run dev` y `npm run build` apuntan a Firefox; Chrome usa los scripts `:chrome`.

**Reconsiderar si**: se abandona el soporte de Firefox, en cuyo caso WXT deja de aportar lo principal.

---

## D2 — Las heurísticas de Readability se portan; la librería no se distribuye

`@mozilla/readability` opera sobre un **clon** del documento y devuelve HTML serializado, sin
referencias a los nodos vivos. Como el producto necesita anclar overlays sobre elementos reales, usar
la librería obligaría a reconciliar el clon con el DOM original: era el riesgo técnico número uno.

Sus patrones de puntuación (regex de candidatos improbables con su escape hatch, peso ±25 por
class/id, +1 por coma y +1 por cada 100 caracteres hasta 3, propagación al padre completa y al abuelo
la mitad, multiplicador por densidad de enlaces) están portados a `lib/extract/score.ts` y se ejecutan
sobre el DOM vivo. Cada candidato conserva su `Element`.

Readability sigue siendo **dependencia de desarrollo**: `tests/extract-vs-readability.test.ts` compara
la salida del extractor propio contra la suya como referencia de calidad. Licencia Apache-2.0,
atribuida en `NOTICE`.

**Consecuencia**: si la comparación empieza a fallar, el porte ha perdido fidelidad.

---

## D3 — Doble modo de extracción, con degradación explícita

El Modo A (overlays in-place) es el camino principal. El Modo B (vista de lectura propia, con el
artículo saneado dentro de un Shadow DOM) es el respaldo para páginas donde el anclaje no es fiable.

Se degrada cuando la puntuación del candidato no llega al mínimo, cuando hay menos de 2 bloques
elegibles pero más de 500 palabras en la página, o cuando la verificación de anclaje falla (altura 0,
cajas solapadas, ancestro `fixed`/`sticky`).

**Nunca en silencio**: se avisa y se ofrece el cambio a un clic, con opción de fijarlo por dominio.
Cambiar de modo sin avisar haría que el usuario no entendiera por qué la página se ve distinta.

**Pendiente**: los umbrales están puestos por criterio, no medidos.

---

## D4 — La estrategia de llamadas la declara cada proveedor

No es una preferencia global porque las restricciones son incompatibles entre sí.

- **`batch`** — una llamada por artículo, con el texto completo como contexto y salida estructurada.
  Da mejor coherencia que un esquema comprimido, elimina el paso previo de generar el esquema, y
  convierte el límite de tasa en un no-problema (~1.000 artículos/día en el free tier de Gemini en vez
  de ~70).
- **`per-block`** — **obligatoria** en la IA local: sus ventanas de contexto son de pocos miles de
  tokens (en Firefox, ~1.024 de entrada) y no emiten JSON estructurado.

La objeción histórica a la llamada única era el JSON malformado. La decodificación restringida la
elimina: `responseSchema` en Gemini, `json_schema` en OpenAI/OpenRouter, `tool_choice` en Anthropic.

**Coste aceptado**: se pierde el renderizado progresivo. Se compensa con overlays esqueleto inmediatos.
**Riesgo abierto**: 25 bloques en una respuesta pueden dar resúmenes más superficiales. Sin medir.

---

## D5 — `gemini-free` es el único costo-cero en la nube

Investigado en agosto de 2026:

| Proveedor | Free tier de API | Decisión |
|---|---|---|
| Google AI Studio | Real e indefinido, sin tarjeta. Flash-Lite ~15 RPM / ~1.000 RPD, 1M de contexto, 65.535 tokens de salida | **Default cloud** |
| Anthropic | No existe de forma permanente; ~$5 de crédito inicial | Solo BYOK de pago |
| OpenAI | No general. El Data Sharing Program exige ser organización en tier 1-2 y **comparte los prompts para entrenamiento** | Solo BYOK de pago |

Las cuentas de *chat* (ChatGPT Plus, Claude Pro, Gemini Advanced) **no dan acceso a la API**.
"Sign in with ChatGPT" (beta desde el 2-08-2026) es un proveedor de identidad: entrega nombre, email y
foto más créditos promocionales, no acceso al plan. Reutilizar cookies de sesión viola los ToS.

**Contrapartida asumida**: en el free tier, Google usa el contenido para mejorar sus productos. Como
ese contenido es lo que el usuario está leyendo, hay un consentimiento **específico y aparte** del
genérico de nube. El usuario fue informado y aceptó.

**Reconsiderar si**: Google vuelve a recortar cuotas (ya lo hizo sin aviso en diciembre de 2025). El
planificador las descubre ante `429` en vez de codificarlas, precisamente por esto.

---

## D6 — Permisos por dominio, sin `<all_urls>`

Los host permissions son **opcionales** y se piden uno a uno desde el popup. Como consecuencia, el
content script no puede declararse en el manifiesto: se registra en tiempo de ejecución con
`scripting.registerContentScripts` para los orígenes concedidos.

Facilita mucho la revisión en las stores y es coherente con el producto: nadie quiere resúmenes en su
banca online.

**Trampa conocida**: `permissions.request()` debe salir de un gesto del usuario, así que se invoca en
el popup y no en el background. Y el popup **no es una pestaña**, de modo que `sender.tab` llega
`undefined`: el `tabId` tiene que viajar explícito en el mensaje. Aquí ya se coló un bug (ver
`ESTADO.md`).

---

## D7 — Las credenciales nunca salen del background

Viven en `storage.local`, jamás en `storage.sync`, y no se exponen al content script. Todas las
llamadas de red salen del background.

Beneficio secundario: se esquivan por completo el CORS y la CSP del sitio anfitrión.

---

## D8 — Caché por huella de configuración

IndexedDB indexada por `sha256(url normalizada + hash del bloque + huella de config)`. La huella
incluye versión de prompts, formato, ratio, idioma, proveedor y modelo, así que cambiar cualquiera de
ellos regenera en vez de servir resúmenes obsoletos.

Se guarda **el resumen y un hash**, nunca el texto original de la página. TTL de 30 días, expulsión
LRU al superar el tope.

---

## D9 — Regla de descarte por compresión insuficiente

`target = clamp(palabras × ratio, 15, 100)`. Si el resumen generado supera el **60 %** del original,
ese bloque **no recibe overlay** y su texto queda intacto: resumir sin comprimir solo añade ruido.

El mínimo de 15 palabras crea un caso patológico deliberado — un bloque de 20 palabras nunca podrá
comprimir lo suficiente y siempre se descartará. Es correcto: no merece resumen.

---

## D10 — La fusión de párrafos cortos es conservadora a propósito

Los párrafos que no llegan al umbral se agrupan con sus vecinos hasta alcanzarlo y comparten un
overlay, que se ancla al primero y se extiende hasta el final del último con un `ResizeObserver`.

Solo se fusionan **hermanos inmediatos** (`nextElementSibling`). Un encabezado, una figura, una tabla
o un cambio de contenedor interrumpen la serie, porque ahí el salto de tema es real y juntarlos
mezclaría ideas distintas. Tres pruebas fijan ese límite.

El grupo se cierra en cuanto alcanza el umbral, en vez de acumular toda la serie: da más granularidad.

La agrupación va en dos fases, y **ningún párrafo del artículo se queda sin resumir**:

1. **Acumulación**: los cortos adyacentes se juntan de **2 a 5**. El tope de 5 evita que una ristra de
   líneas sueltas acabe en un único resumen que mezcle demasiadas ideas.
2. **Rescate**: lo que no se sostiene solo (un corto suelto, una serie cortada antes de tiempo) **se une
   al bloque adyacente con menos palabras**, sea el anterior o el siguiente; en empate, el anterior. Se
   sostiene solo un grupo que llega al umbral, o que junta al menos dos párrafos y la mitad del umbral.
   Solo queda solo el que no tiene ningún vecino adyacente (entre dos encabezados, por ejemplo), y aun
   así se resume. En este rescate el tope de 5 puede superarse: antes eso que dejar un párrafo fuera.

La adyacencia sigue siendo de hermanos inmediatos en las dos fases: un encabezado sigue separando. La
regla del 60 % (D9) actúa después, así que un bloque que no comprima se queda sin overlay igual.

---

## D11 — Bloques anidados: gana el contenedor exterior

Un `<blockquote>` con un `<p>` dentro se anota entero, no su hijo. Evita resumir —y pagar— el mismo
texto dos veces. Una prueba lo fija explícitamente.

---

## D12 — El overlay se distingue por fondo y tipografía, no por color de texto

- **Fondo**: el color de fondo **real** de la página teñido con un 10 % de celeste. No un blanco o
  negro fijo, para que funcione también sobre crema o gris. Opaco, que es lo que permite tapar el
  original.
- **Tipografía**: siempre del tipo **contrario** al del párrafo — serifa si la página usa palo seco y
  viceversa. Distingue resumen de original sin depender del color, que ya está muy cargado.

El overlay ocupa exactamente la caja del párrafo: el layout no se desplaza nunca, ni al aparecer ni al
ocultarse. Todo vive en Shadow DOM cerrado con `all: initial`.

**Encaje**: el resumen debe caber siempre en la caja del párrafo, así que:

- Arranca con un cuerpo del **92 %** del original y, si desborda, se reduce hasta un **60 %** (primero
  una aproximación analítica, porque el área del texto crece con el cuadrado del cuerpo, y luego en
  pasos de 4 %). Solo si ni así cabe, la caja pasa a tener scroll. El interlineado se copia de la
  página como factor, acotado a 1,2–1,5, para que encoja junto con el cuerpo.
- El **host va fuera de flujo** (`position: absolute`). Un `<span>` vacío en flujo tiene altura de
  línea propia y podía estirar la última línea del párrafo.
- El relleno se deriva del **padding del propio párrafo**, con un mínimo para que el texto no toque el
  borde, y la alineación y dirección del texto se copian del original.
- La cabecera (etiqueta y botones) **flota** a la derecha en vez de ocupar una fila: el texto fluye a
  su alrededor y aprovecha toda la caja.
- La barra de acento es una sombra interior y no ocupa sitio; un halo de 2 px del propio fondo tapa
  las esquinas que el radio dejaría al descubierto.
- En bloques fusionados la caja cubre la **unión** de todos los elementos, medida respecto al padding
  box del ancla (el origen de las coordenadas absolutas), no solo la altura hasta el último.

**Trampa**: por ese `all: initial`, `font-family: inherit` **no** hereda de la página. Familia, cuerpo
e interlineado se pasan explícitamente por variables CSS.

---

## D17 — Degradación al Modo B por evidencia, no por sospecha

La vista de lectura se ofrecía demasiado: saltaba en páginas donde la agrupación de párrafos funcionaba
bien. Las tres reglas se rehicieron con un principio: **la puntuación del contenedor es un indicio;
los bloques encontrados y la cobertura (palabras de los bloques entre palabras del contenedor) son la
evidencia.** Solo se bloquea cuando la evidencia también es mala. Umbrales en `DEGRADE`
(`lib/extract/blocks.ts`), puestos por criterio y pendientes de medir.

- **Anclaje por bloque, no por página.** Antes, un solo párrafo con caja 0 (un acordeón cerrado, una
  pestaña oculta, un "leer más" plegado: pasan la comprobación de visibilidad porque el `display:
  none` está en un ancestro) degradaba la página entera. Ahora se retira solo ese bloque, y de un par
  solapado solo el segundo. Los ids se reasignan para que sigan contiguos. Solo si más de un tercio
  de los bloques es inseguro se propone la vista de lectura; si no, se sigue in-place con un aviso.
- **La regla de ancestros `fixed` o `sticky` desaparece.** No protegía de nada: el overlay se
  posiciona en absoluto dentro del propio párrafo y se mueve con él. Y las columnas pegajosas son
  habituales; era la fuente más probable de falsas alarmas.
- **`low-score` solo bloquea con evidencia débil**: menos de 3 bloques o cobertura menor del 50 %.
  Con puntuación baja pero bloques de sobra, se sigue in-place con aviso.
- **`too-few-blocks` se mide por cobertura**: más de 500 palabras y menos de 2 bloques o cobertura
  menor del 40 %. Es la medida real de "el extractor se está perdiendo el artículo".
- **Se registra qué bloque falla y por qué** (`unsafeBlocks`, con ancla, motivo y palabras) en el log
  de extracción y en el diagnóstico del popup. Antes la verificación devolvía un booleano y no había
  forma de saber cuál de las reglas había saltado en una página concreta.
- **Aviso no bloqueante** (`warnings`) en vez de la pregunta previa cuando hay dudas pero se puede
  seguir: se resume y un toast de 12 s ofrece la vista de lectura. La pregunta bloqueante queda solo
  para los casos en que seguir saldría mal.

---

## D16 — Detección de falacias: solo en batch, con listón alto y cita literal

El modelo devuelve, dentro del mismo JSON estructurado del modo batch, una lista `fallacies` por
bloque con `name`, `quote` y `explanation`. No hay una segunda llamada: el coste extra son los tokens
de salida de los pocos bloques que tienen alguna.

- **Solo en batch.** El prompt per-block devuelve texto plano y la IA local no razona sobre
  argumentos. Con esos proveedores no hay emblemas, y la opción lo dice.
- **Listón alto.** El prompt pide "solo falacias evidentes que un lector atento aceptaría", máximo 3
  por bloque, y recuerda que la mayoría de los bloques no tienen. Un detector que ve falacias en todo
  es peor que ninguno. `coerceFallacies` recorta a 3 y acota longitudes por si el modelo se excede.
- **La cita es literal y sin traducir**, para que el lector la encuentre en el original. El nombre y
  la explicación van en el idioma del resumen.
- **Se cachean con el resumen**, y activar o desactivar la detección cambia la huella de la caché:
  una entrada sin falacias no dice si no las hay o si nadie las buscó.
- **El esquema estricto exige `fallacies` siempre** (OpenAI `strict` obliga a que todo esté en
  `required`), así que con la detección desactivada el prompt pide lista vacía.
- **UI**: un emblema ⚠ por falacia en la cabecera del overlay; hover o foco abre el popover, clic lo
  fija, Esc o clic fuera lo cierran. El popover es hermano de la caja dentro del Shadow DOM, no hijo,
  porque la caja recorta con `overflow: hidden` y el popover debe sobresalir del párrafo. Color ámbar,
  distinto del acento (información) y del error.
- Se activa por defecto (`detectFallacies: true`). Es la razón de ser de la función y su coste es
  pequeño; quien no lo quiera lo desactiva en Opciones.

---

## D15 — Mensajería con `sendResponse`, no con promesas devueltas

WXT expone en Chrome el objeto `chrome` tal cual, sin polyfill. Un listener de `runtime.onMessage`
que devuelve una promesa responde en Firefox, pero en Chrome el emisor recibe `undefined` y la
extensión parece muerta: el popup nunca sabe si el sitio se activó, el content script nunca recibe el
resumen. Todos los listeners pasan por `onMessage()` (`lib/messaging.ts`), que acepta manejadores con
promesas y por debajo llama a `sendResponse` y devuelve `true`, que es lo que entienden los dos
navegadores. Un manejador que revienta responde con `{ ok: false, error }` en vez de dejar al emisor
esperando. Seis pruebas simulan el comportamiento estricto de Chrome.

En Chrome el background es un service worker que muere a los 30 s sin actividad; una llamada a un
proveedor puede superarlo. `keepAliveWhile()` hace una llamada trivial a la API cada 20 s mientras
haya resúmenes en curso. En Firefox es inocua.

La Summarizer API de Chrome solo admite `en`, `es` y `ja` como idioma de salida; para los demás se
omite el parámetro y el resumen sale en el idioma del texto. Es una degradación, no un fallo.

---

## D14 — Internacionalización con `browser.i18n`, sin selector propio de idioma

Se usa el mecanismo estándar de las extensiones: catálogos en `public/_locales/<idioma>/messages.json`
y `browser.i18n.getMessage`, envuelto en `t()` (`lib/i18n.ts`). El navegador elige el idioma; si no
hay catálogo para el suyo, cae en `es` (`default_locale`). Idiomas: **es, en, fr, de**.

- **No hay selector de idioma de interfaz** en Opciones. `browser.i18n` no permite cambiarlo en
  tiempo de ejecución; hacerlo exigiría cargar los catálogos a mano y reimplementar la sustitución.
  El idioma de los **resúmenes** sí se elige, y es una cosa distinta.
- **`MessageKey` se deriva del catálogo español** con `typeof import(...)`: una clave inexistente no
  compila. Una prueba exige que los otros tres catálogos tengan las mismas claves y los mismos
  marcadores `$1`, `$2`.
- **Los errores se traducen donde nacen** (background, proveedores, pipeline), no en la UI, porque
  muchos llegan como texto libre (`reason`, `failed[].error`). `browser.i18n` está disponible en todos
  los contextos, así que no hace falta transportar códigos.
- **Marcado ligero** (`**negrita**`, `` `código` ``) para los pocos textos con énfasis. Se resuelve
  construyendo nodos, nunca con `innerHTML`.
- Los **nombres de idioma** del selector de resúmenes van en su propio idioma (Español, English…) y
  no se traducen. Los nombres de proveedor son marcas y tampoco.
- Los **logs siguen en español**: son para desarrollo, no para el usuario.
- **Una clave sin traducción sale como tal** en pantalla en vez de un hueco vacío: se ve y se arregla.

**Trampa**: `const t = theme` en el mismo ámbito oculta `t()`. Pasó dos veces al introducirlo.

---

## D13 — Logging activo por defecto, con diagnóstico integrado

Mientras la extensión esté en desarrollo, el detalle viene activado (`debugLogging: true`). Los avisos
y errores se emiten siempre.

Lo que más valor dio: registrar **por qué** se descarta cada proveedor. "No hay proveedor configurado"
era indepurable; ahora dice *"gemini-free: falta el consentimiento específico del free tier"*.

El botón **Diagnóstico** del popup existe porque el content script vive en un mundo aislado y
`__lectorFluido` **no** es accesible desde la consola de la página en Firefox. El diagnóstico expone
la misma información por un canal que funciona en ambos navegadores.

**Antes de publicar**: pasar el default a `false`.

---

## D14 — En las pruebas, `#imports` se resuelve con un alias propio

El plugin oficial `WxtVitest` no es compatible con Vitest 2: hace que ni siquiera un test trivial
registre suites. Se sustituyó por un alias en `vitest.config.ts` que apunta a `tests/stubs/imports.ts`,
con el `fakeBrowser` de WXT.

Ventaja secundaria: las pruebas quedan independientes del pipeline de la extensión.

**Reconsiderar si**: se actualiza a Vitest 3, donde el plugin oficial probablemente funcione.
