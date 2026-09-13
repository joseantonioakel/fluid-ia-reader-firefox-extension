import { defineConfig } from 'wxt';

// Firefox es el objetivo prioritario: `npm run dev` y `npm run build` apuntan a Firefox.
// Chrome se construye con los scripts `:chrome`.
export default defineConfig({
  srcDir: '.',
  outDir: '.output',
  manifestVersion: 3,

  manifest: ({ browser }) => ({
    // Nombre y descripción salen de `public/_locales/<idioma>/messages.json`;
    // el navegador elige el idioma y cae en `default_locale` si no hay catálogo.
    name: '__MSG_extensionName__',
    short_name: '__MSG_extensionName__',
    description: '__MSG_extensionDescription__',
    default_locale: 'es',
    homepage_url: 'https://github.com/joseantonioakel/fluid-ia-reader-firefox-extension',

    // Permisos mínimos. Los host permissions son OPCIONALES y se piden por dominio
    // desde el popup; por eso el content script se registra en tiempo de ejecución.
    // `identity` habilita el OAuth PKCE de OpenRouter (login sin copiar la clave).
    permissions: ['storage', 'activeTab', 'scripting', 'identity'],
    optional_permissions: browser === 'firefox' ? ['trialML'] : [],
    optional_host_permissions: ['*://*/*'],

    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: 'lector-fluido@jakel.dev',
              // 140 es la primera versión que entiende data_collection_permissions;
              // con un mínimo inferior, addons-linter lo marca como clave no soportada.
              strict_min_version: '140.0',
              // Obligatorio para extensiones nuevas en AMO desde el 3-11-2025.
              // Con IA local no sale nada del equipo: por eso `required: none`.
              // El contenido de la página solo se transmite si el usuario
              // configura un proveedor en la nube, así que va en `optional`.
              data_collection_permissions: {
                required: ['none'],
                optional: ['websiteContent'],
              },
            },
            // En Android el soporte llegó en 142.
            gecko_android: { strict_min_version: '142.0' },
          },
        }
      : {
          minimum_chrome_version: '128',
        }),

    action: {
      default_title: '__MSG_extensionName__',
    },
  }),
});
