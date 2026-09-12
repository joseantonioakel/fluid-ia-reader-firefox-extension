import { browser } from '#imports';
import { localizeDocument, t } from '../../lib/i18n';
import { createLogger, initLogging } from '../../lib/log';
import { hostnameOf, originPatternFor } from '../../lib/origins';
import type { Config, Diagnosis, ProviderStatus } from '../../lib/types';

const log = createLogger('popup');

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const hostnameEl = $('hostname');
const siteNote = $('site-note');
const enabledEl = $<HTMLInputElement>('enabled');
const providerName = $('provider-name');
const providerState = $('provider-state');
const runBtn = $<HTMLButtonElement>('run');
const optionsBtn = $<HTMLButtonElement>('options');
const diagnoseBtn = $<HTMLButtonElement>('diagnose');
const diagnosisEl = $('diagnosis');

async function activeTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function init(): Promise<void> {
  localizeDocument();
  await initLogging('popup');
  const tab = await activeTab();
  const url = tab?.url ?? '';
  const pattern = originPatternFor(url);
  log.info('pestaña activa', { id: tab?.id, url, pattern });

  hostnameEl.textContent = pattern ? hostnameOf(url) : t('popupNotAvailableHere');

  const config = (await browser.runtime.sendMessage({ kind: 'get-config' })) as Config;
  await renderProvider(config);

  if (!pattern) {
    enabledEl.disabled = true;
    siteNote.textContent = t('popupOnlyHttp');
    return;
  }

  const granted = await browser.permissions.contains({ origins: [pattern] });
  const enabled = granted && config.enabledOrigins.includes(pattern);
  enabledEl.checked = enabled;
  runBtn.disabled = !enabled;
  siteNote.textContent = enabled ? t('popupSiteActive') : t('popupSiteInactive');

  enabledEl.addEventListener('change', () => void onToggle(pattern, tab?.id));
  runBtn.addEventListener('click', () => void onRun(tab?.id, pattern));
}

async function onToggle(pattern: string, tabId?: number): Promise<void> {
  const wantEnabled = enabledEl.checked;
  log.info('toggle-origin', { pattern, wantEnabled, tabId });

  if (wantEnabled) {
    // permissions.request DEBE salir del gesto del usuario en el popup,
    // no del background: por eso se pide aquí.
    const granted = await browser.permissions.request({ origins: [pattern] });
    log.info('permissions.request →', granted);
    if (!granted) {
      enabledEl.checked = false;
      siteNote.textContent = t('popupPermissionDenied');
      return;
    }
  } else {
    await browser.permissions.remove({ origins: [pattern] }).catch((e) => log.warn('permissions.remove', e));
  }

  // El tabId viaja explícitamente: el popup no es una pestaña, así que en el
  // background `sender.tab` sería undefined y nunca se inyectaría el script.
  const result = await browser.runtime.sendMessage({
    kind: 'toggle-origin',
    origin: pattern,
    enabled: wantEnabled,
    tabId,
  });
  log.info('toggle-origin →', result);

  runBtn.disabled = !wantEnabled;
  const injected = (result as { injected?: boolean } | undefined)?.injected;
  siteNote.textContent = wantEnabled
    ? injected
      ? t('popupInjected')
      : t('popupReloadNeeded')
    : t('popupDisabled');
}

async function onRun(tabId?: number, pattern?: string | null): Promise<void> {
  if (tabId == null) return;
  try {
    await browser.tabs.sendMessage(tabId, { kind: 'run-on-tab' });
    window.close();
    return;
  } catch (error) {
    log.warn('el content script no respondió; se inyecta y se reintenta', error);
  }

  // La pestaña estaba abierta desde antes de activar el sitio: se inyecta ahora.
  if (pattern) {
    await browser.runtime.sendMessage({ kind: 'toggle-origin', origin: pattern, enabled: true, tabId });
  }
  try {
    await browser.tabs.sendMessage(tabId, { kind: 'run-on-tab' });
    window.close();
  } catch (error) {
    log.error('sigue sin responder tras inyectar', error);
    siteNote.textContent = t('popupLoadFailed');
    siteNote.className = 'note warn';
  }
}

async function renderProvider(config: Config): Promise<void> {
  const statuses = (await browser.runtime.sendMessage({ kind: 'provider-status' })) as ProviderStatus[];
  const current = statuses.find((s) => s.id === config.provider);
  providerName.textContent = current?.displayName ?? config.provider;

  if (!current) {
    providerState.textContent = t('popupProviderUnknown');
    providerState.className = 'note warn';
    return;
  }
  if (!current.available) {
    providerState.textContent = current.reason ?? t('popupProviderUnavailable');
    providerState.className = 'note warn';
    return;
  }
  if (!current.configured) {
    providerState.textContent = t('popupMissingCredential');
    providerState.className = 'note warn';
    return;
  }
  const consentMissing =
    (config.provider === 'gemini-free' && !config.geminiFreeConsentGiven) ||
    (config.provider !== 'browser-builtin' && !config.cloudConsentGiven);
  if (consentMissing) {
    providerState.textContent = t('popupMissingConsent');
    providerState.className = 'note warn';
    return;
  }
  providerState.textContent = current.reason ?? t('popupReady');
  providerState.className = current.reason ? 'note' : 'note ok';
}

optionsBtn.addEventListener('click', () => {
  void browser.runtime.openOptionsPage();
  window.close();
});

/**
 * Diagnóstico: comprueba de una vez todo lo que puede impedir que la extensión
 * "haga algo" y lo deja tanto en pantalla como en la consola del popup.
 */
diagnoseBtn.addEventListener('click', async () => {
  diagnoseBtn.disabled = true;
  diagnoseBtn.textContent = t('popupChecking');
  const tab = await activeTab();
  const diagnosis = (await browser.runtime.sendMessage({ kind: 'diagnose', tabId: tab?.id })) as Diagnosis;

  console.group('%c[Lector Fluido] Diagnóstico', 'color:#2f6bff;font-weight:bold');
  console.table(diagnosis as unknown as Record<string, unknown>);
  if (diagnosis.extraction) {
    console.log('Extracción en esta página:');
    console.table(diagnosis.extraction);
  }
  if (diagnosis.problems.length) console.warn('Problemas detectados:', diagnosis.problems);
  else console.log('Sin problemas detectados.');
  console.groupEnd();

  diagnoseBtn.disabled = false;
  diagnoseBtn.textContent = t('popupDiagnose');
  diagnosisEl.hidden = false;
  diagnosisEl.textContent = diagnosis.problems.length
    ? t('popupDiagnosisProblems', diagnosis.problems.join(' · '))
    : t('popupDiagnosisOk');
  diagnosisEl.className = diagnosis.problems.length ? 'note warn' : 'note ok';
});

void init();
