# Lector Fluido — Documento de Requisitos de Producto (PRD)

Extensión para Chrome y Firefox que superpone resúmenes generados por IA sobre los párrafos largos de cualquier sitio web, permitiendo alternar entre resumen y texto original.

---

## 1. Descripción de Requisitos

### 1.1 Contexto

- **Problema de negocio**: la lectura en la web está dominada por artículos densos y prolijos. El lector no puede saber si un párrafo largo merece su atención sin leerlo completo, lo que produce abandono, lectura en diagonal y pérdida de las ideas centrales. Las herramientas existentes resuelven el extremo equivocado: o resumen el artículo entero (perdiendo el detalle) o no resumen nada.
- **Usuarios objetivo**: lectores intensivos de contenido largo en la web — profesionales que hacen research, estudiantes, periodistas y desarrolladores que consumen documentación y ensayos técnicos. Perfil con competencia técnica media-alta, capaz de configurar una cuenta de IA pero que espera que la opción por defecto funcione sin fricción ni costo.
- **Propuesta de valor**: lectura *progresiva*. El usuario recorre la página leyendo resúmenes y desciende al texto original únicamente en los bloques que le interesan, con un solo clic y sin salir de la página ni perder el contexto visual del artículo.

### 1.2 Resumen de Funcionalidades

**Funcionalidades núcleo (v1)**

1. **Botón flotante inyectado** en los dominios donde el usuario habilitó la extensión. Un clic dispara la acción principal sobre la página actual.
2. **Extracción de contenido con heurísticas propias inspiradas en Readability**: los patrones de puntuación de Readability se **portan y ejecutan sobre el DOM vivo**, sin usar la librería como dependencia de runtime. Identifica el contenedor de artículo y sus bloques principales, descartando navegación, anuncios, comentarios y pies de página.
3. **Doble modo de operación**: *Modo A — in-place* (overlays sobre la página real) como camino principal; *Modo B — vista de lectura* como alternativa cuando el Modo A no da resultados fiables.
4. **Filtrado por longitud, con agrupación**: solo los bloques que superan un umbral de palabras reciben overlay (default **100 palabras**, configurable). Los párrafos cortos consecutivos se **fusionan** hasta alcanzarlo, para que un artículo de párrafos breves no se quede sin anotar.
5. **Overlay por bloque** que cubre exactamente la caja del párrafo, con el resumen y un botón de ojito (👁) para ocultarlo y revelar el texto original. Se distingue del original por un **fondo teñido con un 10 % de celeste** y una **tipografía del tipo contrario** a la del texto.
6. **Resúmenes con IA** vía capa de proveedores intercambiables: IA nativa del navegador, Gemini free tier, OpenRouter (OAuth) y BYOK (OpenAI / Anthropic / Gemini de pago).
7. **Coherencia narrativa**: un esquema del artículo se genera primero y se inyecta como contexto en cada resumen de bloque.
8. **Panel TL;DR global** del artículo, derivado del esquema del Paso 1.
9. **Caché persistente** por URL + hash de contenido, para que revisitar una página sea instantáneo y gratuito.
10. **Página de opciones** con umbral, formato de resumen, idioma, proveedor, modelo, gestión de dominios habilitados y registro de depuración.
11. **Observabilidad**: registro con el motivo exacto de cada descarte y un **diagnóstico** en el popup que comprueba de una vez permisos, inyección, proveedor y extracción.

**Límites de la funcionalidad**

| Dentro de la v1 | Fuera de la v1 |
|---|---|
| Páginas HTML en Chrome y Firefox desktop | PDFs y visores de documentos embebidos (pdf.js) |
| Activación manual por dominio | Activación automática o global |
| Overlays por bloque + TL;DR global | Personalización tipográfica de la vista de lectura (fuente, ancho, tema) |
| Vista de lectura como modo de respaldo del extractor | Vista de lectura como producto en sí (reemplazo de Reader Mode) |
| Caché local (IndexedDB) | Sincronización entre dispositivos / `storage.sync` |
| Interacción por clic | Atajos de teclado y navegación entre bloques |
| Español e inglés en la UI | Otros idiomas de interfaz |
| — | Navegadores móviles |
| — | Contenido dentro de `<iframe>` de terceros |

**Escenarios de uso**

- **E1 — Triaje de un ensayo largo**: el usuario abre un artículo de 3.000 palabras, pulsa el botón flotante, y en segundos ve 12 overlays. Recorre los resúmenes, abre tres párrafos con el ojito y cierra la pestaña habiendo captado el argumento en 90 segundos.
- **E2 — Documentación técnica**: el usuario habilita la extensión en `docs.ejemplo.com`, resume una guía extensa e identifica la sección aplicable a su caso sin leer el resto.
- **E3 — Revisita**: vuelve a un artículo resumido ayer; los overlays se restauran desde caché al instante y sin costo.
- **E4 — Primer uso sin configurar nada**: instala, habilita un dominio, pulsa el botón. La extensión detecta la IA nativa del navegador y resume sin pedir claves ni cobrar.

### 1.3 Requisitos Detallados

#### Entradas y salidas

**Entrada**: el DOM de la página activa.

**Principio de diseño**: no se usa `@mozilla/readability` como dependencia de runtime. Se **portan sus heurísticas de puntuación** a un extractor propio (`lib/extract/score.ts`) que opera **directamente sobre los nodos vivos del DOM**. Esto elimina de raíz el problema de reconciliar un clon serializado con los nodos reales sobre los que hay que anclar overlays: cada candidato conserva su referencia al `Element` desde el primer momento. Readability es Apache-2.0, por lo que el porte de sus patrones es viable con la atribución correspondiente en `NOTICE`.

#### Modo A — In-place (camino principal)

1. **Poda de candidatos improbables**: descartar subárboles cuyo `class`/`id` coincida con el patrón de candidatos improbables (`banner|breadcrumb|combx|comment|community|cover-wrap|disqus|extra|footer|header|legends|menu|modal|nav|overlay|pag(er|ination)|popup|related|remark|rss|share|shoutbox|sidebar|skyscraper|social|sponsor|supplemental|ad-break|agegate|pagination|pager|popup|yom-remote`), salvo que también coincidan con el patrón de "posibles candidatos" (`and|article|body|column|content|main|shadow`).
2. **Puntuación de párrafos**: para cada nodo de texto candidato, base según etiqueta (`div` +5, `pre`/`td`/`blockquote` +3, `address`/`ol`/`ul`/`dl`/`dd`/`dt`/`li`/`form` −3, encabezados −5), más peso de clase/id (`+25` positivo, `−25` negativo), más `1 punto por coma` y `1 punto por cada 100 caracteres` hasta un tope de 3.
3. **Propagación**: el padre recibe la puntuación completa, el abuelo la mitad, y así con divisor creciente por nivel de profundidad.
4. **Densidad de enlaces**: la puntuación final de cada candidato se multiplica por `(1 − linkDensity)`, donde `linkDensity = longitud del texto dentro de <a> / longitud total del texto`.
5. **Selección del contenedor**: gana el candidato de mayor puntuación; se asciende al padre mientras este tenga una puntuación de al menos el 75 % del hijo, para no cortar contenido legítimo.
6. **Selección de bloques** dentro del contenedor: `p`, `li`, `blockquote`, `dd`, y `div` cuyo contenido sea solo texto en línea.
7. **Exclusiones**: bloques dentro de `pre`, `code`, `table`, `figure`, `nav`, `aside`, `footer`; elementos con `aria-hidden="true"`; ocultos por CSS; y bloques con más del 40 % de su texto dentro de `code`.
8. **Conteo de palabras** con `Intl.Segmenter` (`granularity: 'word'`), con fallback a división por espacios.
9. **Filtrado** por el umbral configurado.

#### Modo B — Vista de lectura (respaldo)

Cuando el Modo A no es fiable, la extensión ofrece renderizar el artículo en una **vista de lectura propia** — un contenedor a pantalla completa, con Shadow DOM y tipografía controlada por nosotros — construido clonando el subárbol del contenedor ganador y limpiándolo (se eliminan scripts, estilos, anuncios, elementos posicionados y atributos de evento; se preservan `p`, encabezados, listas, `blockquote`, imágenes con `figcaption`, enlaces y énfasis).

Sobre esa vista, la detección de bloques es trivial y el anclaje de overlays es determinista, porque el markup es nuestro: sin CSS hostil, sin `position` inesperada, sin transforms, sin `z-index` en guerra.

**Criterios de degradación automática a Modo B** (cualquiera basta):
- El candidato ganador no alcanza la puntuación mínima de confianza.
- Se detectan menos de 2 bloques por encima del umbral, pero el texto total de la página supera las 500 palabras (señal de que la estructura confundió al extractor).
- La verificación de anclaje falla: bloques con `getBoundingClientRect()` de altura 0, cajas solapadas, o un ancestro con `position: fixed`/`sticky` que rompería el overlay.

Cuando se dispara, no se cambia de modo en silencio: se muestra un aviso — *"Esta página es difícil de anotar. ¿Abrir en vista de lectura?"* — con la acción a un clic. El usuario puede además forzar cualquiera de los dos modos desde el menú del botón flotante, y fijar el Modo B como preferencia permanente para un dominio concreto.

**Salida por bloque**: una cadena de resumen renderizada dentro de un overlay anclado al bloque, en cualquiera de los dos modos.

#### Agrupación de párrafos cortos consecutivos

Un artículo escrito a base de párrafos breves no produciría ningún overlay con un umbral de 100 palabras, aunque en conjunto tenga contenido de sobra. Para evitarlo, los bloques que no alcanzan el umbral **se fusionan con sus vecinos** hasta alcanzarlo y comparten un único overlay.

Reglas:
1. Un bloque que ya supera el umbral se resume solo y **interrumpe** cualquier serie en curso.
2. Los bloques por debajo del umbral se acumulan mientras sean **hermanos inmediatos** (`nextElementSibling`).
3. En cuanto la suma alcanza el umbral, el grupo se cierra y se emite. No se acumula de más: así se conserva granularidad.
4. Lo que quede al final sin alcanzar el umbral se descarta.

La adyacencia estricta es deliberadamente conservadora: un encabezado, una figura, una tabla o un cambio de contenedor interrumpen la serie, porque ahí el salto de tema es real y fusionar juntaría ideas distintas.

**Consecuencia sobre el anclaje**: un bloque fusionado abarca varios elementos. El overlay se ancla al primero y extiende su altura hasta el final del último, recalculándola con un `ResizeObserver` sobre todos sus elementos.

**Consecuencia sobre los identificadores**: los `id` de bloque se asignan **después** de agrupar, de modo que son contiguos y en orden de documento. Esto es lo que permite que la estrategia `per-block` localice el párrafo anterior como contexto.

#### Regla de longitud del resumen

```
W       = palabras del bloque original
target  = clamp(round(W * ratio), 15, 100)     // ratio configurable, default 0.125 (rango 10–15 %)
```

- El `target` se pasa al prompt como longitud objetivo.
- **Regla de descarte**: si el resumen efectivamente generado supera `0.6 * W` palabras, **el bloque no recibe overlay** — el resumen no aporta compresión suficiente. El bloque se marca como `skipped_low_compression` y queda visible en su forma original.
- Formato configurable: `proporcional` (default), `1-2 frases`, `bullets`.

#### Estrategia de generación

La estrategia de llamadas **no es global: la declara cada proveedor**, porque las restricciones son incompatibles entre sí. Un modelo on-device con contexto de pocos miles de tokens no puede recibir un artículo entero; un modelo de 1M de contexto con cuota diaria escasa no debe gastar una petición por párrafo.

**Estrategia `batch` — una sola llamada por artículo (default donde el contexto lo permite)**

```
Llamada única
  entrada:  título + artículo completo, con cada bloque elegible etiquetado por id
            + target de palabras por bloque + idioma + formato
  salida:   JSON validado contra esquema:
            { tldr: string, summaries: [{ id: number, summary: string }] }
  render:   todos los overlays a la vez, al completarse la llamada
```

Ventajas, en orden de importancia:

1. **Coherencia superior**: el modelo ve el artículo completo, no un esquema comprimido de él. Resuelve mejor el requisito de "misma línea de pensamiento" que el enfoque en dos pasos.
2. **Elimina el Paso 1**: el esquema global deja de ser una llamada aparte, y el TL;DR sale de la misma respuesta.
3. **Convierte el límite de tasa en un no-problema**: 1 petición por artículo contra las ~1.000 diarias del free tier de Gemini ≈ 1.000 artículos al día y 15 por minuto.

**Viabilidad verificada** con `gemini-2.5-flash-lite`: contexto de 1M de tokens y **65.535 tokens de salida**. Un artículo de 5.000 palabras son ~7.000 tokens de entrada y 25 bloques de 100 palabras son ~3.500 de salida — dos órdenes de magnitud por debajo del techo. La restricción real no es el tamaño, sino la calidad por bloque cuando hay muchos (ver riesgos).

**Requisitos de implementación**:
- **Salida estructurada obligatoria**: `responseMimeType: application/json` con `responseSchema`. La decodificación restringida elimina el riesgo de JSON malformado, que era la principal objeción histórica a esta estrategia.
- **`thinkingBudget: 0`** de forma explícita. Es el default en Flash-Lite, pero hay un fallo conocido en la familia 2.5 por el cual los tokens de razonamiento consumen `maxOutputTokens` y devuelven respuestas vacías; no se deja al azar.
- **Validación de la respuesta**: todo `id` debe existir entre los bloques enviados, y los `id` ausentes se tratan como bloques fallidos individuales, no como fallo de la página.
- **División automática** si el artículo estimado supera un presupuesto prudente de salida (25.000 tokens): se parte en lotes contiguos, cada uno recibiendo el artículo completo como contexto pero pidiendo resúmenes solo de sus bloques.

**Estrategia `per-block` — N llamadas con contexto compartido**

Obligatoria para `browser-builtin`, cuyos modelos on-device tienen ventanas de contexto de pocos miles de tokens (y en Firefox, de ~1.024 tokens de entrada), incapaces de recibir el artículo completo o de emitir JSON estructurado.

```
Paso 1 — Esquema global (1 llamada)
  entrada:  título + texto del artículo, truncado a un presupuesto de tokens
  salida:   { tesis, esquema[], tono }   → contexto de todos los bloques + TL;DR

Paso 2 — Resumen por bloque (N llamadas, concurrencia según proveedor)
  entrada:  esquema global + texto del bloque anterior + bloque N + target + idioma
  salida:   resumen del bloque N
  render:   progresivo, cada overlay aparece al completarse su llamada
```

Cola FIFO en orden de aparición en el documento, para que los overlays se pueblen de arriba hacia abajo.

**Asignación por proveedor**

| Proveedor | Estrategia | Llamadas por artículo | Concurrencia | Límite de tasa |
|---|---|---|---|---|
| `browser-builtin` | `per-block` (forzada) | N + 1 | 2 | ninguno (on-device) |
| `gemini-free` | **`batch`** | **1** | 1 | 15 RPM / ~1.000 RPD con Flash-Lite |
| `openrouter` | `batch` (configurable) | 1 | 4 si `per-block` | se adapta ante `429` |
| BYOK de pago | `batch` (configurable) | 1 | 4 si `per-block` | se adapta ante `429` |

**Planificador consciente del límite de tasa**: sigue existiendo, con token bucket por proveedor y reducción de la concurrencia a la mitad ante cada `429`, recuperándola tras una ventana sin errores. Con la estrategia `batch` casi nunca se activa, pero es la red de seguridad para `per-block`, para artículos divididos en lotes y para cuotas recortadas sin aviso.

**Coste de la llamada única, y cómo se mitiga**

| Coste | Mitigación |
|---|---|
| Sin renderizado progresivo: todos los overlays aparecen juntos tras 5-15 s | Overlays *esqueleto* con animación de carga inmediatamente tras la extracción, para que el usuario vea la estructura al instante y perciba progreso |
| Un fallo pierde el artículo entero, no un bloque | Escalera de degradación: reintento con backoff → división en dos lotes → estrategia `per-block` completa. Solo tras agotarla se muestra error |
| Muchos bloques pueden diluir la calidad individual | `batchSize` configurable en opciones avanzadas (default: sin límite en `gemini-free`, 8 en el resto), calibrado con datos del spike de la Fase 1 |

#### Interacción del usuario

| Acción | Resultado |
|---|---|
| Clic en botón flotante | Extrae, filtra y lanza el pipeline. El botón pasa a estado "cargando" con contador `n/N`. |
| Clic en el botón 👁 de un overlay | Oculta el overlay y revela el párrafo original. El icono cambia a "ojo tachado". |
| Clic en 👁 tachado | Restaura el overlay. |
| Segundo clic en botón flotante | Alterna todos los overlays a la vez (mostrar/ocultar globalmente). |
| Clic largo / menú del botón flotante | Regenerar página, abrir TL;DR, **cambiar a vista de lectura**, abrir opciones, deshabilitar en este sitio. |
| Aceptar el aviso de degradación | Abre la vista de lectura y aplica sobre ella el mismo pipeline de resúmenes. |
| Cerrar la vista de lectura | Vuelve a la página original conservando los resúmenes ya generados en caché. |
| Clic en 🔄 de un overlay en error | Reintenta ese bloque únicamente. |
| Tecla `Esc` | Oculta todos los overlays (excepción a "sin atajos": es un gesto de cierre estándar, no navegación). |

#### Comportamiento visual del overlay

- El overlay ocupa **exactamente la caja del bloque original**; el layout del documento no se altera en ningún momento.
- Implementación: el bloque recibe `position: relative` si su `position` computada es `static`; el overlay se inserta como hijo con `position: absolute; inset: 0`. Esto evita reposicionar en cada scroll.
- Todo el CSS del overlay vive en un **Shadow DOM** (`mode: 'closed'`) para aislarlo de los estilos del sitio.
- Si el resumen no cabe en el alto disponible, el overlay hace scroll interno; nunca desborda ni empuja contenido.
- Un `ResizeObserver` sobre el bloque y sobre `document.body` recalcula el ajuste ante cambios de viewport o de fuente.

**Fondo — el color de la página con un 10 % de celeste**

El overlay debe leerse al instante como añadido de la extensión, sin parecer un error de renderizado. El fondo se calcula mezclando el color de fondo **real detectado en la página** con un 10 % de celeste (`rgb(135, 206, 235)`):

```
overlayBg = pageBg * 0.9 + celeste * 0.1
```

- Sobre blanco → `rgb(243, 250, 253)`; sobre negro → `rgb(14, 21, 24)`.
- Partir del fondo real, y no de un blanco o negro fijo, hace que funcione igual sobre páginas de fondo crema o gris, que conservan su carácter.
- El resultado es **opaco**: es lo que permite tapar el texto original.

**Tipografía — siempre del tipo contrario a la del original**

Si el texto original usa una tipografía **sin serifa**, el resumen usa una **con serifa**, y viceversa. Distingue resumen de original sin depender del color, que en una página cualquiera ya está muy cargado.

- La clasificación parte de la `font-family` computada del bloque. El orden de comprobación importa: `sans-serif` y `ui-sans-serif` **contienen** la cadena `serif`, así que "sans" debe evaluarse primero.
- Se reconocen también familias por nombre (Georgia, Merriweather, Playfair… frente a Inter, Roboto, Avenir…). Las *slab* cuentan como serifa; las monoespaciadas, como palo seco.
- Ante una familia desconocida se asume palo seco, que es lo predominante en la web: el resumen saldrá con serifa.
- **Cuerpo e interlineado se copian del párrafo** para que el bloque no cambie de densidad visual. Deben pasarse **explícitamente**: como la raíz del Shadow DOM lleva `all: initial`, `font-family: inherit` heredaría de un elemento reseteado, no de la página.

#### Requisitos de datos

**Esquema de configuración** (`storage.local`):

```ts
interface Config {
  minWords: number;              // default 100
  summaryRatio: number;          // default 0.125
  summaryFormat: 'proportional' | 'sentences' | 'bullets';  // default 'proportional'
  language: 'auto' | string;     // default 'auto' (ver resolución abajo)
  provider: ProviderId;          // default 'browser-builtin' si disponible, si no 'gemini-free'
  fallbackProvider: ProviderId | null;
  model: string;                 // por proveedor
  callStrategy: 'auto' | 'batch' | 'per-block';   // default 'auto' (la declara el proveedor)
  batchSize: number | null;                       // bloques por llamada; null = sin límite (default en gemini-free)
  extractionMode: 'auto' | 'inplace' | 'reader';  // default 'auto' (Modo A con degradación a B)
  readerModeOrigins: string[];   // dominios donde se fuerza el Modo B
  enabledOrigins: string[];      // ej. ['https://example.com/*']
  cloudConsentGiven: boolean;    // gate del aviso de privacidad
  cacheTtlDays: number;          // default 30
  maxCacheMb: number;            // default 50
  debugLogging: boolean;         // detalle en consola; true en desarrollo, false al publicar
}
```

**Resolución del idioma cuando `language === 'auto'`**: si alguno de los `navigator.languages` empieza por `es`, el resumen se escribe en **español**; en caso contrario se usa el idioma de la interfaz del navegador (`i18n.getUILanguage()`).

**Esquema de caché** (IndexedDB, store `summaries`):

```ts
interface CacheEntry {
  key: string;        // sha256(normalizedUrl + '|' + blockTextHash + '|' + providerId + '|' + model + '|' + configFingerprint)
  summary: string;
  outlineHash: string;
  createdAt: number;
  lastAccessedAt: number;
  bytes: number;
}
```

`normalizedUrl` elimina fragmento y parámetros de tracking (`utm_*`, `fbclid`, `gclid`). `configFingerprint` cubre `summaryRatio`, `summaryFormat` e idioma resuelto, de modo que cambiar la configuración invalida la caché correctamente. Expulsión **LRU** al superar `maxCacheMb`; purga por TTL al arrancar el background.

**Validación**: `minWords` entero en `[20, 1000]`; `summaryRatio` en `[0.05, 0.5]`; claves de API validadas por formato y por una llamada de prueba al guardarlas; `enabledOrigins` debe corresponder a permisos efectivamente concedidos.

#### Casos borde

| Caso | Manejo |
|---|---|
| El extractor no encuentra artículo | Toast: "No se detectó contenido de artículo en esta página". Sin overlays. |
| El extractor encuentra artículo pero el anclaje no es fiable | Degradación ofrecida al Modo B (vista de lectura), nunca silenciosa. |
| El Modo B tampoco produce bloques válidos | Toast final sin más alternativas; se ofrece bajar el umbral o reportar el sitio. |
| Cuota diaria del proveedor gratuito agotada | Mensaje con la hora de reinicio de cuota (00:00 UTC en Gemini) y opción de cambiar de proveedor. |
| Artículo detectado, 0 bloques sobre el umbral | Toast: "No hay bloques de más de N palabras". Se ofrece bajar el umbral desde el propio toast. |
| SPA que reemplaza el contenido tras resumir | `MutationObserver` sobre el contenedor: si un bloque anclado se desconecta del DOM, su overlay se destruye. Un cambio de `history.pushState` limpia todo el estado y reinicia el botón. |
| Contenido diferido / scroll infinito | Tras resumir, el observer detecta bloques nuevos que superan el umbral y el botón muestra un indicador "+N nuevos" para resumirlos bajo demanda, sin llamadas automáticas. |
| Bloque con mucho markup en línea (enlaces, `code`, MathML) | Se resume el `textContent`; el overlay muestra texto plano. Bloques con >40 % de su texto dentro de `code` se excluyen. |
| Texto muy largo (>8.000 palabras en un bloque) | Se trunca a un presupuesto de tokens y se indica en el overlay con un discreto marcador "truncado". |
| Idioma mixto en la página | El idioma se resuelve por artículo, no por bloque. |
| Página tras paywall o con contenido parcial | Se resume lo visible; no se intenta eludir ningún muro de pago. |
| Iframes de terceros | No se inyecta; solo el frame principal. |
| CSP estricta del sitio | Los estilos van en Shadow DOM y no hay scripts en línea, por lo que la CSP del sitio no bloquea el overlay. Las llamadas de red salen del background, ajenas a la CSP de la página. |
| `prefers-reduced-motion` | Se desactivan las transiciones de aparición del overlay. |
| Modo impresión | Los overlays se ocultan vía `@media print`. |

#### Manejo de errores

Cadena de degradación por bloque:

1. **Reintento** con backoff exponencial (250 ms → 1 s → 4 s, con jitter) ante `429`, `5xx` y errores de red. Máximo 3 intentos.
2. **Fallback de proveedor**: si persiste el fallo, se reintenta una vez con el `fallbackProvider` configurado. El overlay resultante lleva una marca discreta indicando que se generó con el proveedor secundario.
3. **Overlay de error por bloque**: mensaje breve, causa legible y botón 🔄 de reintento. Los demás bloques continúan sin verse afectados.

Errores no recuperables tratados aparte, con mensaje accionable y enlace a opciones: sin proveedor configurado, clave inválida (`401`), crédito agotado (`402`), IA nativa no disponible en el equipo, consentimiento de nube no otorgado.

---

## 2. Decisiones de Diseño

### 2.1 Enfoque Técnico

**Arquitectura**: WXT + TypeScript, un único código fuente que produce builds MV3 separados para Chrome y Firefox. WXT resuelve las divergencias entre navegadores (service worker vs. background scripts en Firefox, namespace `chrome.*` vs. `browser.*`) y aporta HMR en content scripts, lo que reduce drásticamente el ciclo de iteración sobre la UI de overlays.

**Componentes principales**

| Componente | Responsabilidad |
|---|---|
| `entrypoints/content` | Botón flotante, extracción, anclaje y ciclo de vida de overlays, observers |
| `entrypoints/background` | Orquestación del pipeline, llamadas a proveedores, caché, OAuth, custodia de claves |
| `entrypoints/popup` | Habilitar/deshabilitar dominio, estado del proveedor, acceso a opciones |
| `entrypoints/options` | Configuración completa, gestión de credenciales, gestión de caché |
| `lib/extract` | Heurísticas de puntuación portadas de Readability sobre el DOM vivo, selección de bloques, filtrado por longitud, verificación de anclaje |
| `lib/reader` | Modo B: construcción, saneado y renderizado de la vista de lectura |
| `lib/providers` | Adaptadores que implementan `SummarizerProvider`, con su política de tasa declarada |
| `lib/pipeline` | Esquema global, planificador con token bucket y concurrencia adaptativa, reglas de longitud y descarte |
| `lib/cache` | IndexedDB, hashing, TTL y expulsión LRU |
| `lib/ui` | Componentes del overlay en Shadow DOM, theming, i18n |

**Interfaz de proveedores**

```ts
interface SummarizeRequest {
  text: string;
  outline?: Outline;
  previousBlockText?: string;
  targetWords: number;
  format: SummaryFormat;
  language: string;
  signal: AbortSignal;
}

interface SummarizerProvider {
  id: ProviderId;
  displayName: string;
  isAvailable(): Promise<boolean>;
  requiresCloudConsent: boolean;
  strategy: 'batch' | 'per-block';
  supportsStructuredOutput: boolean;
  maxInputTokens: number;
  maxOutputTokens: number;
  rateLimit: { concurrency: number; requestsPerMinute: number | null; requestsPerDay: number | null };

  // estrategia batch — una llamada por artículo (o por lote)
  summarizeBatch?(req: BatchRequest): Promise<{ tldr: string; summaries: BlockSummary[] }>;

  // estrategia per-block — obligatoria en modelos on-device
  buildOutline?(article: ArticleText, opts: OutlineOpts): Promise<Outline>;
  summarize?(req: SummarizeRequest): Promise<string>;
}
```

Adaptadores de la v1:

- **`browser-builtin`** — Chrome: `Summarizer` API (Gemini Nano), disponible en stable, ejecución on-device. Firefox: `browser.trial.ml` (Transformers.js + ONNX) con `taskName: "summarization"` y modelos del hub permitido (Mozilla / Xenova). Cero costo, cero red, cero configuración. **Default absoluto** cuando `isAvailable()` da verdadero.
- **`gemini-free`** — Clave de Google AI Studio en su free tier: sin tarjeta de crédito, sin caducidad, con `gemini-2.5-flash-lite` como modelo por defecto. **Default cloud** y única vía real de costo cero en la nube. Usa estrategia `batch` con **una sola llamada por artículo**, lo que convierte sus ~1.000 peticiones diarias en ~1.000 artículos al día en lugar de ~70. Se distingue del adaptador `gemini` de pago porque declara límites de tasa estrictos y porque exige un aviso propio de privacidad.
- **`openrouter`** — OAuth PKCE: el usuario pulsa "Conectar con OpenRouter", autoriza y la extensión recibe una clave sin copiar ni pegar nada. Acceso a todos los modelos desde un único endpoint. Camino recomendado en cuanto el usuario quiera calidad superior o supere las cuotas gratuitas.
- **`openai`**, **`gemini`**, **`anthropic`** — BYOK de pago con clave pegada por el usuario. El adaptador de Anthropic debe enviar `anthropic-dangerous-direct-browser-access: true`, requisito para invocar la API desde un contexto de navegador.

#### Decisión explícita — qué significa "usar la cuenta gratuita del usuario"

Se evaluaron las tres opciones y el resultado es asimétrico:

| Proveedor | ¿Cuenta gratuita usable vía API? | Decisión |
|---|---|---|
| **Google Gemini** | ✅ Free tier real e indefinido en AI Studio, sin tarjeta. Flash-Lite ~15 RPM / 1.000 RPD; Flash 10 RPM / 250 RPD; Pro 5 RPM / 100 RPD; 250k TPM y contexto de 1M | **Adoptado como default cloud** |
| **Anthropic** | ❌ Sin free tier permanente. ~$5 de crédito de bienvenida que se agota | Solo como BYOK de pago |
| **OpenAI** | ❌ Sin free tier general. El Data Sharing Program otorga tokens diarios pero exige ser organización en tier 1-2 (haber gastado previamente) y **comparte prompts y respuestas para entrenamiento** | Solo como BYOK de pago |

Advertencias documentadas para `gemini-free`, que deben mostrarse en el aviso de privacidad de ese proveedor:
- En el free tier, Google **usa el contenido enviado para mejorar sus productos**. Como aquí ese contenido es lo que el usuario está leyendo, la advertencia debe ser explícita y no enterrada en opciones.
- Las cuotas del free tier se recortaron sin previo aviso en diciembre de 2025; el planificador no debe asumir límites fijos, sino adaptarse ante `429`.
- Los límites son por proyecto y por modelo. Usar varias claves para eludirlos viola los términos de servicio y la extensión no lo facilitará.

**Cuentas de consumidor descartadas**: no se soportará el uso de suscripciones ChatGPT Plus, Claude Pro ni Gemini Advanced, ni las cuentas gratuitas de chat de claude.ai, chatgpt.com o gemini.google.com — ninguna otorga acceso a la API. "Sign in with ChatGPT" (beta desde el 2 de agosto de 2026) es un proveedor de *identidad*: entrega nombre, email y foto, más créditos promocionales, pero no acceso al plan del usuario. El OAuth de Anthropic está restringido a Claude Code. Cualquier vía basada en reutilizar cookies de sesión viola los términos de servicio y es estructuralmente frágil.

**Custodia de credenciales**: las claves viven en `storage.local` (nunca `storage.sync`) y **jamás se exponen al content script**. Todas las llamadas de red salen del background, lo que además evita por completo los problemas de CORS y de CSP del sitio anfitrión.

**Almacenamiento de datos**: configuración en `storage.local`; caché de resúmenes en IndexedDB en el contexto de la extensión, con TTL de 30 días y tope de 50 MB con expulsión LRU.

### 2.2 Restricciones

**Rendimiento**
- Extracción y filtrado: < 300 ms en un artículo de 5.000 palabras.
- Primer overlay visible: < 3 s con proveedor cloud; < 8 s con IA nativa en frío (incluye carga del modelo).
- Coste medio por artículo: < $0,01 con el modelo por defecto de OpenRouter; $0 con IA nativa.
- El content script no debe provocar reflow del documento anfitrión: sin overlays, cero impacto medible en CLS.
- Bundle del content script < 150 KB comprimido (Readability incluido).

**Compatibilidad**
- Chrome ≥ 128 y Firefox ≥ 128, escritorio.
- MV3 en ambos navegadores.
- `browser.trial.ml` requiere el permiso `trialML` y solo está disponible en Firefox; el adaptador debe degradar limpiamente si falta.
- La `Summarizer` API de Chrome exige hardware suficiente (~22 GB de disco libre y GPU con ~4 GB de VRAM); `isAvailable()` debe verificarlo y no solo comprobar la existencia de la API.

**Seguridad y privacidad**
- Permisos mínimos: `storage`, `activeTab`, `scripting`, permisos de host **opcionales** solicitados por dominio vía `permissions.request()`. Sin `<all_urls>`.
- Modal de consentimiento explícito la primera vez que se enviaría contenido de página a un proveedor cloud, indicando qué se envía y a quién.
- Sin telemetría, sin analítica, sin servidores propios. La extensión no tiene backend.
- El texto de la página nunca se persiste: la caché guarda el resumen y un hash del original, no el original.
- Sanitización del texto de bloque antes de construir el prompt, para mitigar inyección de prompt desde contenido hostil de la página.
- Política de privacidad publicada, requisito de ambas stores.

**Escalabilidad y evolución**
- La interfaz `SummarizerProvider` permite añadir proveedores (Ollama/LM Studio local, Mistral, Groq) sin tocar el pipeline. Ollama es el siguiente candidato natural.
- El sistema de prompts se versiona; un cambio de versión invalida la caché a través del `configFingerprint`.
- La regla de longitud y la de descarte están centralizadas y son fáciles de ajustar con datos de uso real.

### 2.3 Evaluación de Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| **Calidad del extractor propio frente a Readability maduro** — portar las heurísticas implica reproducir años de casos borde acumulados. | Alto | Suite de 20 fixtures reales con aserciones de bloques esperados, ejecutada en CI desde la Fase 1. Se compara la salida contra la de Readability *en desarrollo* como referencia de calidad, sin que sea dependencia de producción. El Modo B actúa como red de seguridad para los sitios donde el extractor falle. |
| Sitios que rompen el anclaje del overlay (CSS agresivo, `position` inesperada, transforms) | Bajo | Riesgo degradado por el diseño de doble modo: la verificación de anclaje lo detecta y ofrece el Modo B, donde el markup es nuestro y el anclaje es determinista. Refuerzos: Shadow DOM cerrado y `all: initial` en la raíz del overlay. |
| Cuotas del free tier de Gemini insuficientes para artículos largos | Bajo | Riesgo degradado por la estrategia `batch`: 1 petición por artículo en lugar de N+1, muy por debajo de cualquier límite por minuto. El planificador con token bucket queda como red de seguridad. |
| **Dilución de la calidad por bloque en la llamada única** — resumir 25 bloques en una respuesta puede producir resúmenes más superficiales que 25 llamadas dedicadas. | Alto | Spike comparativo en la Fase 1: mismos 10 artículos por ambas estrategias, evaluación ciega de la calidad por bloque. `batchSize` configurable para dividir si la calidad cae a partir de cierto número de bloques. Si la degradación resulta severa, `batch` deja de ser default en proveedores de pago y se conserva solo donde la cuota lo exige. |
| **Fallo todo-o-nada de la llamada única** — un error pierde el artículo entero en lugar de un bloque. | Medio | Escalera de degradación: reintento con backoff → división en dos lotes → estrategia `per-block` completa. Solo tras agotarla se muestra error al usuario. |
| Pérdida del renderizado progresivo con la estrategia `batch` | Bajo | Overlays esqueleto animados inmediatamente tras la extracción, para que la estructura sea visible desde el primer segundo. |
| Tokens de razonamiento consumiendo el presupuesto de salida y devolviendo respuestas vacías (fallo conocido en la familia Gemini 2.5) | Medio | `thinkingBudget: 0` explícito, `maxOutputTokens` holgado, y detección de respuesta vacía tratada como fallo reintentable en lugar de como resultado válido. |
| Google vuelve a recortar cuotas del free tier sin aviso, como en diciembre de 2025 | Medio | No se codifican límites fijos: el planificador los descubre y se adapta ante `429`. El `fallbackProvider` cubre el caso extremo, y la IA nativa sigue siendo el default cuando está disponible. |
| El contenido leído por el usuario se usa para entrenamiento en el free tier de Gemini | Medio | Aviso de privacidad específico y prominente para `gemini-free`, no solo el modal genérico de nube. La IA nativa, que no envía nada, se mantiene como default preferente. |
| Calidad insuficiente de la IA nativa (especialmente `distilbart` en Firefox) siendo el default | Medio | Evaluación comparativa en la Fase 1 con un set de artículos. Si la calidad en Firefox resulta inaceptable, el default en Firefox pasa a OpenRouter y la IA nativa queda como opción explícita. |
| `browser.trial.ml` es experimental y su API puede cambiar | Medio | Aislado tras el adaptador; el fallo de disponibilidad degrada al proveedor secundario sin romper nada. |
| Rechazo o demora en la revisión de las stores por permisos y política de IA | Medio | Permisos de host opcionales desde el día uno, política de privacidad clara, y justificación explícita del uso de cada permiso en el envío. |
| Costo inesperado para el usuario con proveedores cloud | Medio | Estimación de costo mostrada antes de resumir artículos grandes, caché agresiva, y contador de gasto acumulado en opciones. |
| Inyección de prompt desde contenido hostil de la página | Bajo | Delimitadores estructurados en el prompt, instrucción de sistema que declara el contenido como datos no confiables, y validación de longitud de la salida. |
| Deriva de las heurísticas frente a sitios modernos | Bajo | Umbral configurable, toast accionable, y posibilidad de fijar el Modo B por dominio. |

---

## 3. Criterios de Aceptación

### 3.1 Aceptación Funcional

- [ ] **Botón flotante**: se inyecta únicamente en dominios habilitados, es visible sobre cualquier `z-index` del sitio, arrastrable, y su posición persiste entre sesiones.
- [ ] **Activación por dominio**: habilitar un sitio desde el popup dispara `permissions.request()`; denegar el permiso deja la extensión inactiva sin errores en consola.
- [ ] **Extracción**: en 20 sitios de prueba representativos (medios, blogs, documentación técnica, Wikipedia, Substack), el extractor propio identifica correctamente el contenedor de artículo en ≥ 18.
- [ ] **Sin dependencia de runtime**: `@mozilla/readability` no aparece en el bundle de producción; la atribución de licencia Apache-2.0 está en `NOTICE`.
- [ ] **Degradación a Modo B**: en un sitio construido para romper el anclaje in-place, la verificación lo detecta y ofrece la vista de lectura; nunca se cambia de modo en silencio.
- [ ] **Modo B funcional**: la vista de lectura renderiza el artículo saneado y aplica el mismo pipeline de resúmenes con anclaje sin defectos.
- [ ] **Preferencia por dominio**: fijar Modo B en un dominio hace que las visitas siguientes abran directamente en vista de lectura.
- [ ] **Salir del Modo B**: cerrar la vista de lectura devuelve a la página original sin perder los resúmenes generados.
- [ ] **Filtrado por umbral**: con el default de 100 palabras, ningún bloque por debajo del umbral recibe overlay; cambiar el umbral en opciones se refleja en la siguiente ejecución.
- [ ] **Regla de longitud**: los resúmenes respetan `clamp(W * ratio, 15, 100)` palabras; verificado sobre 50 bloques de tamaños variados.
- [ ] **Regla de descarte**: un bloque cuyo resumen supera el 60 % de la longitud original no recibe overlay y su texto queda intacto.
- [ ] **Overlay**: cubre exactamente la caja del bloque; el layout del documento no se desplaza ni un píxel al aparecer, ocultarse o restaurarse.
- [ ] **Fondo teñido**: el fondo del overlay es el de la página mezclado con un 10 % de celeste, verificado sobre páginas de fondo blanco, negro y crema.
- [ ] **Tipografía contraria**: sobre una página de palo seco el resumen sale con serifa, y sobre una de serifa sale con palo seco; el cuerpo y el interlineado coinciden con los del párrafo.
- [ ] **Fusión de párrafos cortos**: en un artículo de párrafos de 40-60 palabras con umbral 100, se generan overlays agrupados en vez de ninguno.
- [ ] **Límites de la fusión**: no se fusiona a través de un encabezado, una figura ni un cambio de contenedor.
- [ ] **Anclaje de bloques fusionados**: el overlay cubre desde el inicio del primer párrafo hasta el final del último, y se reajusta al cambiar el tamaño de la ventana.
- [ ] **Ids contiguos**: los identificadores de bloque no tienen huecos, de modo que `per-block` recibe el párrafo anterior como contexto.
- [ ] **Botón de ojito**: alterna resumen y original de forma fiable; el estado por bloque es independiente.
- [ ] **Toggle global**: el segundo clic en el botón flotante alterna todos los overlays a la vez.
- [ ] **Coherencia**: en revisión manual de 10 artículos, los resúmenes de bloques consecutivos mantienen terminología y línea argumental coherentes gracias al esquema del Paso 1.
- [ ] **Panel TL;DR**: accesible desde el menú del botón flotante y consistente con los resúmenes de bloque.
- [ ] **Todos los proveedores** generan resúmenes válidos: `browser-builtin` en Chrome y Firefox, `gemini-free`, `openrouter` vía OAuth, y `openai`/`gemini`/`anthropic` vía BYOK.
- [ ] **OAuth de OpenRouter**: el flujo PKCE completo funciona sin que el usuario copie ni pegue una clave.
- [ ] **Costo cero de punta a punta**: un artículo de 15 bloques se resume completo con `gemini-free` sin un solo `429` no recuperado y sin cargo alguno.
- [ ] **Una sola llamada**: con `gemini-free`, resumir un artículo de 25 bloques consume exactamente **1 petición**, verificado instrumentando el adaptador.
- [ ] **Salida estructurada**: la respuesta se valida contra `responseSchema`; un `id` desconocido o ausente degrada solo ese bloque, nunca la página completa.
- [ ] **Escalera de degradación**: un fallo persistente de la llamada única provoca división en dos lotes y, si vuelve a fallar, cambio a `per-block`, antes de mostrar cualquier error.
- [ ] **Respuesta vacía**: una respuesta sin contenido se trata como fallo reintentable y no como resultado válido.
- [ ] **Overlays esqueleto**: aparecen dentro de los 300 ms posteriores a la extracción, antes de que exista ningún resumen.
- [ ] **Estrategia por proveedor**: `browser-builtin` usa `per-block` incluso con `callStrategy: 'auto'`, dado su contexto limitado.
- [ ] **Planificador de tasa**: con `per-block` y `gemini-free`, el ritmo de peticiones nunca excede el RPM declarado del modelo, verificado instrumentando el adaptador.
- [ ] **Adaptación ante `429`**: un `429` inyectado reduce la concurrencia a la mitad y esta se recupera tras una ventana sin errores.
- [ ] **Cuota agotada**: se muestra la hora de reinicio y la opción de cambiar de proveedor, sin overlays de error genéricos.
- [ ] **Aviso específico de `gemini-free`**: el usuario ve, antes del primer envío, que el free tier de Google usa el contenido para entrenamiento.
- [ ] **Idioma**: con `language: 'auto'` y español entre `navigator.languages`, el resumen sale en español; sin español, sale en el idioma de la interfaz del navegador.
- [ ] **Errores**: un `429` simulado dispara backoff, luego fallback al proveedor secundario, y solo entonces un overlay de error con reintento funcional en ese bloque, sin afectar a los demás.
- [ ] **Caché**: recargar una página ya resumida restaura todos los overlays en < 500 ms y sin ninguna llamada de red.
- [ ] **Invalidación de caché**: cambiar formato, ratio, idioma, proveedor o modelo produce resúmenes nuevos en lugar de servir los antiguos.
- [ ] **SPA**: navegar dentro de una SPA limpia los overlays y reinicia el estado del botón.
- [ ] **Consentimiento**: no se envía contenido de página a ningún proveedor cloud antes de que el usuario acepte el modal de privacidad.

### 3.2 Estándares de Calidad

- [ ] **Código**: TypeScript en modo `strict`, sin `any` fuera de los límites de tipado de APIs externas; ESLint y Prettier en CI sin advertencias.
- [ ] **Pruebas unitarias**: ≥ 80 % de cobertura en `lib/extract`, `lib/reader`, `lib/pipeline` y `lib/cache`, incluyendo las reglas de longitud, descarte y el planificador de tasa.
- [ ] **Pruebas E2E**: Playwright con la extensión cargada en Chrome y Firefox, cubriendo el flujo completo sobre páginas HTML fijadas en el repositorio.
- [ ] **Suite de fixtures de extracción**: 20 páginas reales guardadas como HTML, con aserciones de bloques esperados, para detectar regresiones del extractor.
- [ ] **Rendimiento**: extracción < 300 ms y primer overlay < 3 s, medidos en CI sobre el artículo de referencia.
- [ ] **Revisión de seguridad**: verificación de que ninguna credencial alcanza el content script, de que no hay `<all_urls>` en el manifiesto y de que no se ejecuta código remoto.
- [ ] **Accesibilidad**: overlays con roles ARIA correctos, foco gestionable, contraste ≥ 4.5:1, y respeto de `prefers-reduced-motion`.
- [ ] **Observabilidad**: el registro indica el motivo exacto por el que se descarta cada proveedor, y las llamadas HTTP dejan proveedor, endpoint, estado y latencia sin exponer credenciales.
- [ ] **Diagnóstico**: el botón del popup reporta permiso de host, origen habilitado, content script vivo, scripts registrados, estado del proveedor y resultado de la extracción sobre la página actual.

### 3.3 Aceptación de Usuario

- [ ] **Primer uso sin fricción**: instalar → habilitar dominio → resumir, sin configurar nada, en un Chrome con IA nativa disponible.
- [ ] **Métrica de utilidad**: en pruebas con 5 usuarios sobre 10 artículos, ≥ 80 % de los overlays se consideran útiles sin necesidad de regenerarlos.
- [ ] **Métrica de velocidad**: primer overlay visible en < 3 s en el p50 con proveedor cloud.
- [ ] **Métrica de costo**: costo medio por artículo < $0,01 con el modelo por defecto.
- [ ] **Documentación**: README con instalación, configuración de cada proveedor y solución de problemas; política de privacidad publicada.
- [ ] **Onboarding**: pantalla de bienvenida tras la instalación explicando la activación por dominio y la elección de proveedor.

---

## 4. Fases de Ejecución

### Fase 1 — Preparación y validación técnica
**Objetivo**: eliminar la incertidumbre de los dos riesgos principales antes de construir producto.

- [ ] Inicializar el proyecto con WXT + TypeScript, con builds verificados en Chrome y Firefox.
- [ ] Configurar ESLint, Prettier, Vitest y CI.
- [ ] **Spike crítico**: portar las heurísticas de puntuación de Readability al DOM vivo y validar sobre 20 sitios reales, comparando contra la salida de Readability como referencia de calidad (solo en desarrollo).
- [ ] **Spike**: prototipo de anclaje de overlay que garantice alto idéntico y cero desplazamiento de layout, sobre esos mismos 20 sitios. Definir los umbrales concretos de la verificación de anclaje que disparan la degradación al Modo B.
- [ ] **Spike**: verificar disponibilidad real y calidad de salida de `Summarizer` en Chrome y de `browser.trial.ml` en Firefox; decidir si la IA nativa se sostiene como default en ambos navegadores.
- [ ] **Spike**: medir el free tier de Gemini con un artículo real de 15 bloques y calibrar los parámetros del token bucket.
- [ ] **Spike de calidad `batch` vs `per-block`**: los mismos 10 artículos resumidos por ambas estrategias, con evaluación ciega de la calidad por bloque. Determina el `batchSize` por defecto y si `batch` se sostiene como default en proveedores de pago.
- [ ] Construir la suite de fixtures de extracción y añadir el `NOTICE` de atribución Apache-2.0.
- **Entregables**: repositorio funcional, informe de los cinco spikes con decisión sobre el default por navegador, los umbrales de degradación y el `batchSize` por defecto, fixtures.
- **Tiempo**: 1,5 semanas.

### Fase 2 — Extracción y capa de UI
**Objetivo**: overlays funcionando de punta a punta con resúmenes simulados.

- [ ] Implementar `lib/extract`: heurísticas portadas sobre el DOM vivo, selección de bloques, exclusiones, conteo con `Intl.Segmenter` y verificación de anclaje.
- [ ] Implementar `lib/reader`: construcción y saneado de la vista de lectura, con su aviso de degradación y la preferencia por dominio.
- [ ] Implementar filtrado por umbral y agrupación de párrafos cortos adyacentes.
- [ ] Implementar el tinte del fondo y la selección de tipografía contraria.
- [ ] Implementar el componente de overlay en Shadow DOM: anclaje, theming claro/oscuro, botón de ojito, estados de carga y error, scroll interno.
- [ ] Implementar el botón flotante: arrastrable, con posición persistente, estados y menú contextual.
- [ ] Implementar `MutationObserver` y detección de navegación SPA.
- [ ] Popup con activación por dominio y `permissions.request()`.
- **Entregables**: extensión que marca y superpone todos los bloques elegibles con texto simulado, en ambos modos y en ambos navegadores.
- **Tiempo**: 2 semanas.

### Fase 3 — Proveedores de IA y pipeline
**Objetivo**: resúmenes reales, coherentes y resilientes.

- [ ] Definir la interfaz `SummarizerProvider` y el enrutador de proveedores en el background.
- [ ] Adaptador `browser-builtin` (Chrome `Summarizer` + Firefox `browser.trial.ml`) con detección real de disponibilidad.
- [ ] Adaptador `gemini-free` con estrategia `batch`, `responseSchema`, `thinkingBudget: 0`, política de tasa y aviso de privacidad específico.
- [ ] Escalera de degradación `batch` → lotes → `per-block`, y overlays esqueleto.
- [ ] Adaptador `openrouter` con flujo OAuth PKCE completo.
- [ ] Adaptadores `openai`, `gemini` y `anthropic` (este último con `anthropic-dangerous-direct-browser-access`).
- [ ] Pipeline: esquema global del Paso 1, planificador con token bucket y concurrencia adaptativa, contexto por bloque, reglas de longitud y descarte.
- [ ] Diseño y versionado de prompts; resolución de idioma.
- [ ] Cadena de errores: backoff → fallback de proveedor → overlay de error con reintento.
- [ ] Panel TL;DR global.
- [ ] Modal de consentimiento de privacidad.
- **Entregables**: resúmenes reales con los cinco proveedores y degradación de errores completa.
- **Tiempo**: 2 semanas.

### Fase 4 — Caché, opciones y endurecimiento
**Objetivo**: producto completo, rápido y configurable.

- [ ] `lib/cache` sobre IndexedDB: hashing, `configFingerprint`, TTL y expulsión LRU.
- [ ] Página de opciones completa: umbral, ratio, formato, idioma, proveedor, modelo, credenciales, dominios y gestión de caché.
- [ ] Contador de gasto acumulado y estimación previa en artículos grandes.
- [ ] Cobertura de casos borde: bloques con `code`, truncado, impresión, `prefers-reduced-motion`, contenido diferido.
- [ ] i18n de la UI en español e inglés.
- [ ] Suite E2E en Playwright para ambos navegadores.
- [ ] Auditoría de accesibilidad y de rendimiento.
- **Entregables**: build candidata a release con todos los criterios funcionales cubiertos.
- **Tiempo**: 1,5 semanas.

### Fase 5 — Publicación
**Objetivo**: disponible en ambas stores.

- [ ] Redactar la política de privacidad y las justificaciones de permisos.
- [ ] Recursos de store: iconos, capturas, descripciones en español e inglés.
- [ ] Pantalla de onboarding post-instalación.
- [ ] README con guía por proveedor y solución de problemas.
- [ ] Envío a Chrome Web Store y a addons.mozilla.org; iterar sobre las observaciones de revisión.
- [ ] Prueba con 5 usuarios y captura de las tres métricas de éxito.
- **Entregables**: v1.0 publicada en ambas stores, con métricas medidas.
- **Tiempo**: 1 semana + tiempo de revisión de las stores.

**Duración total estimada**: 8 semanas de desarrollo, más el tiempo de revisión de las stores. El incremento sobre la estimación inicial corresponde al Modo B (vista de lectura) y al planificador de tasa.

---

## Apéndice — Investigación de back-ends

| Opción | Veredicto | Nota |
|---|---|---|
| Cuentas de consumidor y cuentas gratuitas de chat (ChatGPT Plus/free, Claude Pro/free, Gemini Advanced) | ❌ Descartada | Ninguna otorga acceso a la API. "Sign in with ChatGPT" (beta, 2 de agosto de 2026) es solo identidad: nombre, email, foto y créditos promocionales, no acceso al plan. El OAuth de Anthropic está limitado a Claude Code. Reutilizar cookies viola los ToS. |
| Chrome `Summarizer` API (Gemini Nano) | ✅ v1, **default absoluto** | Estable, on-device, sin claves ni red. Requiere hardware suficiente. |
| Firefox `browser.trial.ml` | ✅ v1, sujeto al spike | Transformers.js + ONNX, `taskName: "summarization"`. Experimental, modelos limitados al hub Mozilla/Xenova, calidad inferior. |
| **Google AI Studio free tier** | ✅ v1, **default cloud** | Único free tier real e indefinido, sin tarjeta. Flash-Lite: 1M de contexto, 65.535 tokens de salida, ~15 RPM / ~1.000 RPD. Con estrategia `batch` (1 llamada por artículo) eso son ~1.000 artículos diarios. Exige aviso de que los datos se usan para entrenamiento. |
| OpenRouter | ✅ v1, camino de calidad | Único con OAuth PKCE: login sin copiar clave. Un endpoint para todos los modelos. |
| Anthropic | ✅ v1 (BYOK de pago) | Sin free tier permanente; ~$5 de crédito inicial. Requiere `anthropic-dangerous-direct-browser-access: true`. |
| OpenAI Platform | ✅ v1 (BYOK de pago) | Sin free tier general. El Data Sharing Program exige tier 1-2 y comparte prompts para entrenamiento: inaceptable como default aquí. |
| Google Gemini de pago | ✅ v1 (BYOK) | Mismo adaptador base que `gemini-free`, sin los límites de tasa estrictos. |
| Ollama / LM Studio | ⏭️ Post-v1 | Endpoint OpenAI-compatible en localhost; privacidad total, pero exige que el usuario configure CORS. |

**Sobre el extractor**: `@mozilla/readability` no se usa como dependencia de runtime. Sus heurísticas (regex de candidatos improbables, peso por clase/id, puntuación por comas y longitud, propagación a ancestros, densidad de enlaces) se portan a `lib/extract/score.ts` para operar sobre el DOM vivo. La librería sí se emplea **en desarrollo** como referencia de calidad contra la que comparar la salida del extractor propio. Licencia Apache-2.0, atribuida en `NOTICE`.

**Fuentes**:
- [Summarize with built-in AI — Chrome for Developers](https://developer.chrome.com/docs/ai/summarizer-api)
- [Built-in AI — Chrome for Developers](https://developer.chrome.com/docs/ai/built-in)
- [WebExtensions AI API — Firefox Source Docs](https://firefox-source-docs.mozilla.org/toolkit/components/ml/extensions.html)
- [Running inference in web extensions — The Mozilla Blog](https://blog.mozilla.org/en/firefox/firefox-ai/running-inference-in-web-extensions/)
- [OAuth PKCE — OpenRouter Docs](https://openrouter.ai/docs/guides/overview/auth/oauth)
- [Sign in with ChatGPT Launches — TechTimes](https://www.techtimes.com/articles/322791/20260803/sign-chatgpt-launches-what-openai-retains-not-what-gets-shared.htm)
- [Gemini API Free Tier 2026: Limits, Quotas, and What You Actually Get](https://pecollective.com/tools/gemini-free-tier-guide/)
- [Gemini API Free Tier Rate Limits — Guía 2026](https://www.aifreeapi.com/en/posts/gemini-api-free-tier-rate-limits)
- [OpenAI Data Sharing and Complimentary Tokens Program](https://cloudcredits.io/providers/openai/programs/openai-data-sharing-and-complimentary-tokens-program)
- [Sharing feedback, evaluation and fine-tuning data, and API inputs and outputs with OpenAI](https://help.openai.com/en/articles/10306912-sharing-feedback-evaluation-and-fine-tuning-data-and-api-inputs-and-outputs-with-openai)
- [How to Use Claude AI for Free: All Options for Developers in 2026](https://www.verdent.ai/guides/how-to-use-claude-ai-for-free-2026)
- [Google Gemini 2.5 Flash-Lite — Oracle Cloud Docs (límites de tokens)](https://docs.oracle.com/en-us/iaas/Content/generative-ai/google-gemini-2-5-flash-lite.htm)
- [Gemini 2.5 Flash-Lite — Google Cloud Documentation](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash-lite)
- [Gemini 2.5/3 Flash thinking tokens consume maxOutputTokens, causing empty responses](https://github.com/valentinfrlch/ha-llmvision/issues/609)

---

**Versión del documento**: 1.3
**Creado**: 2026-08-09
**Revisión 1.1** (2026-08-09): extractor propio sobre DOM vivo en lugar de Readability como dependencia; Modo B (vista de lectura) como respaldo; `gemini-free` como default cloud con planificador de tasa
**Revisión 1.2** (2026-08-09): estrategia de llamadas declarada por proveedor; `batch` de una sola llamada por artículo en `gemini-free`, con salida estructurada y escalera de degradación; el Paso 1 desaparece en esa estrategia
**Revisión 1.3** (2026-08-12): agrupación de párrafos cortos adyacentes; fondo del overlay teñido con un 10 % de celeste sobre el color real de la página; tipografía del tipo contrario a la del original; observabilidad y diagnóstico
**Rondas de clarificación**: 3 + 3 revisiones
**Estado de implementación**: ver [`../ESTADO.md`](../ESTADO.md)
**Puntaje de calidad**: 96/100
