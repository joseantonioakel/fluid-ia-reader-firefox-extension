# Política de privacidad · Privacy Policy

**Lector Fluido** · Última actualización / Last updated: 2026-09-12

[Español](#español) · [English](#english)

---

## Español

### Resumen

- La extensión **no tiene servidor propio** y **no recoge telemetría**. Nadie que no seas tú ve lo que lees.
- Por defecto usa la **IA local del navegador**: el texto no sale de tu equipo.
- El texto de una página **solo se envía a un proveedor de IA en la nube si tú lo configuras** y aceptas
  expresamente el aviso de privacidad en Opciones. Sin ese consentimiento, no se envía nada.
- Solo actúa en los **sitios que tú habilitas** uno a uno. En el resto de la web no se ejecuta.

### Qué datos trata la extensión

| Dato | Dónde se guarda | Para qué | Sale de tu equipo |
|---|---|---|---|
| Texto de los párrafos de la página que resumes | Memoria, mientras dura la operación | Generar los resúmenes | **Solo** si configuraste un proveedor en la nube y diste tu consentimiento |
| Resúmenes generados | Caché local (IndexedDB del navegador) | No pagar dos veces el mismo artículo | No |
| Claves de API que introduces | Almacenamiento local de la extensión (`storage.local`) | Autenticarte ante el proveedor que elegiste | Solo hacia ese proveedor, en cada petición |
| Lista de sitios habilitados y tus ajustes | Almacenamiento local de la extensión | Funcionamiento | No |
| Posición del botón flotante | Almacenamiento local de la extensión | Recordarla | No |

No se recogen datos de navegación, identificadores, direcciones IP ni estadísticas de uso. La
extensión no carga scripts ni recursos de terceros.

### Proveedores de IA en la nube

Si configuras uno de estos proveedores, el texto de los párrafos que resumes se envía directamente
desde tu navegador a sus servidores, bajo **sus** condiciones y políticas de privacidad:

- Google Gemini (AI Studio): https://ai.google.dev/gemini-api/terms
- OpenAI: https://openai.com/policies/privacy-policy
- Anthropic: https://www.anthropic.com/privacy
- OpenRouter: https://openrouter.ai/privacy

**Aviso específico sobre el nivel gratuito de Google Gemini**: según las condiciones de Google, en el
nivel gratuito el contenido enviado **puede usarse para entrenar y mejorar sus productos**. Como ese
contenido es el texto de las páginas que lees, la extensión te pide un consentimiento separado y
explícito para este proveedor. Si no quieres que ocurra, usa la IA local o un proveedor de pago.

La extensión también solicita un resumen global (TL;DR) del artículo, que se envía junto con los
párrafos. Las peticiones incluyen el título de la página y su URL como contexto.

### Conexión con OpenRouter

El botón *Conectar* abre una página de OpenRouter para autorizar a la extensión (OAuth PKCE). La clave
que devuelve OpenRouter se guarda en el almacenamiento local de la extensión, igual que las claves
introducidas a mano. Puedes revocarla desde tu cuenta de OpenRouter.

### Permisos que pide la extensión y por qué

- **Acceso a los sitios web que tú habilites** (permiso de host opcional, sitio a sitio): para leer los
  párrafos y superponer los resúmenes. Se pide desde el icono de la barra y puedes retirarlo en
  Opciones o en el gestor de complementos.
- **Almacenamiento**: ajustes, sitios habilitados, caché de resúmenes y claves.
- **Pestaña activa** y **scripting**: para insertar el botón flotante en la pestaña en la que activas
  la extensión sin tener que recargarla.
- **Identidad** (`identity`): únicamente para el flujo de autorización de OpenRouter.
- **IA local de Firefox** (`trialML`, opcional): para usar el modelo de resumen integrado en Firefox.

### Tus derechos y cómo ejercerlos

- **Borrar los resúmenes en caché**: Opciones → Avanzado → *Vaciar caché*.
- **Borrar una clave de API**: Opciones → proveedor → guardar el campo vacío.
- **Dejar de enviar texto a la nube**: cambia el proveedor a la IA local o desmarca el consentimiento.
- **Borrarlo todo**: desinstalar la extensión elimina su almacenamiento local.

### Menores

La extensión no está dirigida a menores de 16 años y no recoge datos de nadie.

### Cambios

Los cambios de esta política se publican en este mismo fichero, en el repositorio del proyecto, con la
fecha de actualización al principio.

### Contacto

Abre una incidencia en el repositorio del proyecto:
https://github.com/joseantonioakel/fluid-ia-reader-firefox-extension/issues

---

## English

### Summary

- The extension has **no server of its own** and **collects no telemetry**. Nobody but you sees what you read.
- By default it uses the **browser's on-device AI**: the text never leaves your computer.
- Page text is **only sent to a cloud AI provider if you configure one** and explicitly accept the
  privacy notice in Options. Without that consent, nothing is sent.
- It only runs on the **sites you enable**, one by one. It does not execute on the rest of the web.

### What data the extension handles

| Data | Where it is stored | Purpose | Leaves your device |
|---|---|---|---|
| Text of the paragraphs of the page you summarize | In memory, for the duration of the operation | Generating the summaries | **Only** if you configured a cloud provider and gave consent |
| Generated summaries | Local cache (browser IndexedDB) | Not paying twice for the same article | No |
| API keys you enter | The extension's local storage (`storage.local`) | Authenticating with the provider you chose | Only to that provider, with each request |
| List of enabled sites and your settings | The extension's local storage | Operation | No |
| Position of the floating button | The extension's local storage | Remembering it | No |

No browsing data, identifiers, IP addresses or usage statistics are collected. The extension loads
no third-party scripts or resources.

### Cloud AI providers

If you configure one of these providers, the text of the paragraphs you summarize is sent directly
from your browser to their servers, under **their** terms and privacy policies:

- Google Gemini (AI Studio): https://ai.google.dev/gemini-api/terms
- OpenAI: https://openai.com/policies/privacy-policy
- Anthropic: https://www.anthropic.com/privacy
- OpenRouter: https://openrouter.ai/privacy

**Specific notice about the Google Gemini free tier**: under Google's terms, content sent on the free
tier **may be used to train and improve its products**. Since that content is the text of the pages
you read, the extension asks for a separate, explicit consent for this provider. If you do not want
this, use the on-device AI or a paid provider.

The extension also requests an overall summary (TL;DR) of the article, sent together with the
paragraphs. Requests include the page title and URL as context.

### Connecting with OpenRouter

The *Connect* button opens an OpenRouter page to authorize the extension (OAuth PKCE). The key
returned by OpenRouter is stored in the extension's local storage, just like manually entered keys.
You can revoke it from your OpenRouter account.

### Permissions the extension requests and why

- **Access to the websites you enable** (optional host permission, site by site): to read the
  paragraphs and overlay the summaries. It is requested from the toolbar icon and can be removed in
  Options or in the add-ons manager.
- **Storage**: settings, enabled sites, summary cache and keys.
- **Active tab** and **scripting**: to insert the floating button into the tab where you enable the
  extension without reloading it.
- **Identity**: only for the OpenRouter authorization flow.
- **Firefox on-device AI** (`trialML`, optional): to use the summarization model built into Firefox.

### Your rights and how to exercise them

- **Delete cached summaries**: Options → Advanced → *Clear cache*.
- **Delete an API key**: Options → provider → save the field empty.
- **Stop sending text to the cloud**: switch the provider to the on-device AI or untick the consent.
- **Delete everything**: uninstalling the extension removes its local storage.

### Children

The extension is not directed at children under 16 and collects data from no one.

### Changes

Changes to this policy are published in this same file, in the project repository, with the update
date at the top.

### Contact

Open an issue in the project repository:
https://github.com/joseantonioakel/fluid-ia-reader-firefox-extension/issues
