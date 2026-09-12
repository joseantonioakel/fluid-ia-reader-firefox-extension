import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // WXT resuelve `#imports` en el build; en las pruebas lo apuntamos a un stub
      // con el fake-browser, para poder probar `lib/` de forma aislada.
      '#imports': fileURLToPath(new URL('./tests/stubs/imports.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    restoreMocks: true,
  },
});
