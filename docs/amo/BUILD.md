# Building Lector Fluido from source

These instructions are for addons.mozilla.org reviewers and for anyone who wants to reproduce the
published package bit for bit. The extension is bundled with [WXT](https://wxt.dev) (Vite +
esbuild). There is no obfuscation, only standard minification.

## Requirements

| Tool | Version used for the published build |
|---|---|
| Node.js | 22 LTS or newer (built with 25.5.0) |
| npm | 10 or newer (built with 11.8.0) |
| OS | macOS 26; any Linux or Windows with the same Node works |

No global tools are needed. Everything is a local dev dependency installed by `npm ci`.

## Steps

```bash
npm ci                      # installs the exact versions in package-lock.json and runs `wxt prepare`
npm run build               # Firefox build → .output/firefox-mv3/
```

`.output/firefox-mv3/` contains the exact files of the submitted package: `manifest.json`,
`background.js`, `content-scripts/content.js`, `popup.html`, `options.html`, `chunks/`, `assets/`,
`_locales/` and `icon/`.

To produce the same zip that was uploaded:

```bash
npm run zip                 # → .output/lector-fluido-<version>-firefox.zip and -sources.zip
```

For the Chrome build: `npm run build:chrome` → `.output/chrome-mv3/`.

## Verifying

```bash
npm test                    # unit tests (vitest, jsdom)
npm run compile             # wxt prepare + tsc --noEmit
npx addons-linter .output/lector-fluido-<version>-firefox.zip
```

## Source layout

| Path | Built into |
|---|---|
| `entrypoints/background.ts` | `background.js` |
| `entrypoints/content.ts` | `content-scripts/content.js` |
| `entrypoints/popup/` | `popup.html`, `chunks/popup-*.js`, `assets/popup-*.css` |
| `entrypoints/options/` | `options.html`, `chunks/options-*.js`, `assets/options-*.css` |
| `lib/` | shared code, inlined into the bundles above |
| `public/` | copied verbatim: `_locales/`, `icon/` |
| `wxt.config.ts` | `manifest.json` |

## Notes for the reviewer

- The manifest declares no static `content_scripts`. The content script is registered at runtime
  with `scripting.registerContentScripts` for the origins the user enables, and injected into the
  active tab with `scripting.executeScript` right after enabling.
- Network requests go only to the AI provider the user configures, and only after the privacy
  consent in Options. Endpoints: `generativelanguage.googleapis.com`, `api.openai.com`,
  `api.anthropic.com`, `openrouter.ai`.
- API keys are kept in `storage.local` and used only from the background script.
- `identity` is used solely for OpenRouter's OAuth PKCE flow (`lib/oauth.ts`).
