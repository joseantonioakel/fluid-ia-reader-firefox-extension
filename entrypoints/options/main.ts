import { browser } from '#imports';
import { localizeDocument, t, type MessageKey } from '../../lib/i18n';
import { hostnameOf } from '../../lib/origins';
import type { Config, ProviderId, ProviderStatus } from '../../lib/types';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const els = {
  welcome: $('welcome'),
  minWords: $<HTMLInputElement>('minWords'),
  extractionMode: $<HTMLSelectElement>('extractionMode'),
  readerOrigins: $('reader-origins'),
  summaryRatio: $<HTMLInputElement>('summaryRatio'),
  ratioLabel: $('ratio-label'),
  summaryFormat: $<HTMLSelectElement>('summaryFormat'),
  language: $<HTMLSelectElement>('language'),
  provider: $<HTMLSelectElement>('provider'),
  providerHint: $('provider-hint'),
  fallbackProvider: $<HTMLSelectElement>('fallbackProvider'),
  providers: $('providers'),
  cloudConsent: $<HTMLInputElement>('cloudConsent'),
  geminiConsent: $<HTMLInputElement>('geminiConsent'),
  callStrategy: $<HTMLSelectElement>('callStrategy'),
  batchSize: $<HTMLInputElement>('batchSize'),
  cacheTtlDays: $<HTMLInputElement>('cacheTtlDays'),
  maxCacheMb: $<HTMLInputElement>('maxCacheMb'),
  cacheStats: $('cache-stats'),
  clearCache: $<HTMLButtonElement>('clear-cache'),
  debugLogging: $<HTMLInputElement>('debugLogging'),
  origins: $('origins'),
  status: $('status'),
};

let config: Config;
let statuses: ProviderStatus[] = [];

/** Proveedores que necesitan que el usuario pegue una clave. */
const KEY_HINTS: Partial<Record<ProviderId, { url: string; label: MessageKey; note?: MessageKey }>> = {
  'gemini-free': {
    url: 'https://aistudio.google.com/apikey',
    label: 'keyHintGeminiFree',
    note: 'keyHintGeminiFreeNote',
  },
  gemini: { url: 'https://aistudio.google.com/apikey', label: 'keyHintGemini' },
  openai: { url: 'https://platform.openai.com/api-keys', label: 'keyHintOpenai' },
  anthropic: { url: 'https://console.anthropic.com/settings/keys', label: 'keyHintAnthropic' },
  openrouter: { url: 'https://openrouter.ai/keys', label: 'keyHintOpenrouter' },
};

function flash(message: string, isError = false): void {
  els.status.textContent = message;
  els.status.className = isError ? 'status err' : 'status';
  setTimeout(() => {
    if (els.status.textContent === message) els.status.textContent = '';
  }, 3500);
}

async function save(patch: Partial<Config>): Promise<void> {
  config = (await browser.runtime.sendMessage({ kind: 'set-config', patch })) as Config;
  flash(t('optSaved'));
}

async function load(): Promise<void> {
  localizeDocument();
  config = (await browser.runtime.sendMessage({ kind: 'get-config' })) as Config;
  statuses = (await browser.runtime.sendMessage({ kind: 'provider-status' })) as ProviderStatus[];

  if (location.hash === '#bienvenida') els.welcome.hidden = false;

  els.minWords.value = String(config.minWords);
  els.extractionMode.value = config.extractionMode;
  els.summaryRatio.value = String(Math.round(config.summaryRatio * 100));
  els.summaryFormat.value = config.summaryFormat;
  els.language.value = config.language;
  els.callStrategy.value = config.callStrategy;
  els.batchSize.value = config.batchSize == null ? '' : String(config.batchSize);
  els.cacheTtlDays.value = String(config.cacheTtlDays);
  els.maxCacheMb.value = String(config.maxCacheMb);
  els.cloudConsent.checked = config.cloudConsentGiven;
  els.geminiConsent.checked = config.geminiFreeConsentGiven;
  els.debugLogging.checked = config.debugLogging;

  updateRatioLabel();
  renderProviderSelects();
  renderProviderRows();
  renderOrigins();
  renderReaderOrigins();
  void renderCacheStats();
}

function updateRatioLabel(): void {
  els.ratioLabel.textContent = t('optRatioValue', els.summaryRatio.value);
}

function renderProviderSelects(): void {
  const options = statuses
    .map((s) => `<option value="${s.id}">${s.displayName}${s.available ? '' : t('optUnavailableSuffix')}</option>`)
    .join('');
  els.provider.innerHTML = options;
  els.fallbackProvider.innerHTML = `<option value="">${t('optNone')}</option>${options}`;
  els.provider.value = config.provider;
  els.fallbackProvider.value = config.fallbackProvider ?? '';

  const current = statuses.find((s) => s.id === config.provider);
  els.providerHint.textContent = current?.reason ?? '';
  els.providerHint.className = current && !current.available ? 'hint warn' : 'hint';
}

function renderProviderRows(): void {
  els.providers.replaceChildren();

  for (const status of statuses) {
    const row = document.createElement('div');
    row.className = 'provider-row';

    const header = document.createElement('header');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = status.displayName;

    const badge = document.createElement('span');
    if (!status.available) {
      badge.className = 'badge warn';
      badge.textContent = t('optBadgeUnavailable');
    } else if (status.configured) {
      badge.className = 'badge ok';
      badge.textContent = t('optBadgeConfigured');
    } else {
      badge.className = 'badge';
      badge.textContent = t('optBadgeNoCredential');
    }
    header.append(name, badge);
    row.appendChild(header);

    if (status.reason) {
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = status.reason;
      row.appendChild(hint);
    }

    const hintInfo = KEY_HINTS[status.id];
    if (hintInfo) {
      const keyRow = document.createElement('div');
      keyRow.className = 'key-row';

      const input = document.createElement('input');
      input.type = 'password';
      input.placeholder = status.configured ? t('optKeySavedPlaceholder') : t('optKeyPlaceholder');
      input.autocomplete = 'off';

      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'small primary';
      saveBtn.textContent = t('optSave');
      saveBtn.addEventListener('click', async () => {
        await browser.runtime.sendMessage({ kind: 'set-secret', provider: status.id, key: input.value.trim() });
        input.value = '';
        flash(t('optCredentialSaved', status.displayName));
        await refreshStatuses();
      });

      const testBtn = document.createElement('button');
      testBtn.type = 'button';
      testBtn.className = 'small';
      testBtn.textContent = t('optTest');
      testBtn.addEventListener('click', async () => {
        testBtn.disabled = true;
        testBtn.textContent = t('optTesting');
        const result = (await browser.runtime.sendMessage({
          kind: 'test-provider',
          provider: status.id,
        })) as { ok: boolean; error?: string; sample?: string };
        testBtn.disabled = false;
        testBtn.textContent = t('optTest');
        const note = row.querySelector('.test-note') ?? document.createElement('p');
        note.className = `hint test-note ${result.ok ? 'ok' : 'err'}`;
        note.textContent = result.ok
          ? t('optTestOk', result.sample?.slice(0, 90) ?? '')
          : t('optTestFailed', result.error ?? '');
        row.appendChild(note);
      });

      keyRow.append(input, saveBtn, testBtn);
      row.appendChild(keyRow);

      const link = document.createElement('p');
      link.className = 'hint';
      const anchor = document.createElement('a');
      anchor.href = hintInfo.url;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.textContent = t(hintInfo.label);
      link.appendChild(anchor);
      if (hintInfo.note) link.append(` — ${t(hintInfo.note)}`);
      row.appendChild(link);
    }

    if (status.id === 'openrouter') {
      const oauth = document.createElement('button');
      oauth.type = 'button';
      oauth.className = 'small';
      oauth.textContent = t('optConnectOpenrouter');
      oauth.addEventListener('click', async () => {
        oauth.disabled = true;
        const result = (await browser.runtime.sendMessage({
          kind: 'start-oauth',
          provider: 'openrouter',
        })) as { ok: boolean; error?: string };
        oauth.disabled = false;
        if (result.ok) {
          flash(t('optConnected'));
          await refreshStatuses();
        } else {
          flash(result.error ?? t('optConnectFailed'), true);
        }
      });
      row.appendChild(oauth);
    }

    els.providers.appendChild(row);
  }
}

async function refreshStatuses(): Promise<void> {
  statuses = (await browser.runtime.sendMessage({ kind: 'provider-status' })) as ProviderStatus[];
  renderProviderSelects();
  renderProviderRows();
}

function renderOrigins(): void {
  els.origins.replaceChildren();
  if (config.enabledOrigins.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'empty';
    empty.textContent = t('optNoSites');
    els.origins.appendChild(empty);
    return;
  }
  for (const origin of config.enabledOrigins) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = hostnameOf(origin.replace('/*', ''));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '✕';
    remove.title = t('optRemoveRevoke');
    remove.addEventListener('click', async () => {
      await browser.permissions.remove({ origins: [origin] }).catch(() => undefined);
      await browser.runtime.sendMessage({ kind: 'toggle-origin', origin, enabled: false });
      config = (await browser.runtime.sendMessage({ kind: 'get-config' })) as Config;
      renderOrigins();
    });
    chip.appendChild(remove);
    els.origins.appendChild(chip);
  }
}

function renderReaderOrigins(): void {
  els.readerOrigins.replaceChildren();
  if (config.readerModeOrigins.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'empty';
    empty.textContent = t('optNoneShort');
    els.readerOrigins.appendChild(empty);
    return;
  }
  for (const origin of config.readerModeOrigins) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = origin;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '✕';
    remove.addEventListener('click', async () => {
      await save({ readerModeOrigins: config.readerModeOrigins.filter((o) => o !== origin) });
      renderReaderOrigins();
    });
    chip.appendChild(remove);
    els.readerOrigins.appendChild(chip);
  }
}

async function renderCacheStats(): Promise<void> {
  const stats = (await browser.runtime.sendMessage({ kind: 'cache-stats' })) as {
    entries: number;
    bytes: number;
  };
  const mb = (stats.bytes / (1024 * 1024)).toFixed(2);
  els.cacheStats.textContent = t('optCacheStats', stats.entries, mb);
}

/* ------------------------------ Listeners ------------------------------ */

els.minWords.addEventListener('change', () => void save({ minWords: Number(els.minWords.value) }));
els.extractionMode.addEventListener('change', () =>
  void save({ extractionMode: els.extractionMode.value as Config['extractionMode'] }),
);
els.summaryRatio.addEventListener('input', updateRatioLabel);
els.summaryRatio.addEventListener('change', () =>
  void save({ summaryRatio: Number(els.summaryRatio.value) / 100 }),
);
els.summaryFormat.addEventListener('change', () =>
  void save({ summaryFormat: els.summaryFormat.value as Config['summaryFormat'] }),
);
els.language.addEventListener('change', () => void save({ language: els.language.value }));
els.provider.addEventListener('change', async () => {
  await save({ provider: els.provider.value as ProviderId });
  renderProviderSelects();
});
els.fallbackProvider.addEventListener('change', () =>
  void save({ fallbackProvider: (els.fallbackProvider.value || null) as ProviderId | null }),
);
els.cloudConsent.addEventListener('change', () => void save({ cloudConsentGiven: els.cloudConsent.checked }));
els.geminiConsent.addEventListener('change', () =>
  void save({ geminiFreeConsentGiven: els.geminiConsent.checked }),
);
els.callStrategy.addEventListener('change', () =>
  void save({ callStrategy: els.callStrategy.value as Config['callStrategy'] }),
);
els.batchSize.addEventListener('change', () =>
  void save({ batchSize: els.batchSize.value ? Number(els.batchSize.value) : null }),
);
els.cacheTtlDays.addEventListener('change', () => void save({ cacheTtlDays: Number(els.cacheTtlDays.value) }));
els.maxCacheMb.addEventListener('change', () => void save({ maxCacheMb: Number(els.maxCacheMb.value) }));
els.debugLogging.addEventListener('change', () =>
  void save({ debugLogging: els.debugLogging.checked }),
);
els.clearCache.addEventListener('click', async () => {
  await browser.runtime.sendMessage({ kind: 'clear-cache' });
  await renderCacheStats();
  flash(t('optCacheCleared'));
});

void load();
