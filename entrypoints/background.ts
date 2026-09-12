import { defineBackground, browser } from '#imports';
import { cacheStats, clearCache, pruneCache } from '../lib/cache';
import { getConfig, getSecret, resolveLanguage, setConfig, setSecret } from '../lib/config';
import { t, uiLanguage } from '../lib/i18n';
import { createLogger, initLogging, newRunId } from '../lib/log';
import { runOpenRouterOAuth } from '../lib/oauth';
import { injectIntoTab, listRegisteredScripts, originPatternFor, syncContentScripts } from '../lib/origins';
import { summarizeArticle } from '../lib/pipeline';
import { PROVIDER_ORDER, getProvider } from '../lib/providers';
import type {
  ArticlePayload,
  BlockSummary,
  Diagnosis,
  Message,
  ProviderId,
  ProviderStatus,
} from '../lib/types';

const log = createLogger('bg');

export default defineBackground(() => {
  void initLogging('background');

  /** Una operación en curso por pestaña, cancelable si se relanza. */
  const running = new Map<number, AbortController>();

  browser.runtime.onInstalled.addListener(async (details) => {
    const config = await getConfig();
    const granted = await syncContentScripts(config.enabledOrigins);
    log.info('onInstalled', { reason: details.reason, orígenes: config.enabledOrigins, registrados: granted });
    void pruneCache(config);
    if (details.reason === 'install') {
      void browser.tabs.create({ url: browser.runtime.getURL('/options.html#bienvenida') });
    }
  });

  browser.runtime.onStartup.addListener(async () => {
    const config = await getConfig();
    const granted = await syncContentScripts(config.enabledOrigins);
    log.info('onStartup', { orígenes: config.enabledOrigins, registrados: granted });
    void pruneCache(config);
  });

  // Si el usuario revoca permisos desde el gestor del navegador, dejamos de inyectar.
  browser.permissions.onRemoved?.addListener(async () => {
    const config = await getConfig();
    const granted = await syncContentScripts(config.enabledOrigins);
    if (granted.length !== config.enabledOrigins.length) {
      await setConfig({ enabledOrigins: granted });
    }
  });

  browser.action?.onClicked?.addListener(async (tab) => {
    if (tab.id != null) await browser.tabs.sendMessage(tab.id, { kind: 'run-on-tab' }).catch(() => undefined);
  });

  browser.runtime.onMessage.addListener((message: Message, sender) => {
    log.debug('← mensaje', message.kind, { desdePestaña: sender.tab?.id ?? '(popup/opciones)' });
    switch (message.kind) {
      case 'diagnose':
        return handleDiagnose(message.tabId);
      case 'summarize':
        return handleSummarize(message.article, sender.tab?.id);
      case 'get-config':
        return getConfig();
      case 'set-config':
        return handleSetConfig(message.patch);
      case 'provider-status':
        return handleProviderStatus();
      case 'clear-cache':
        return clearCache().then(() => ({ ok: true }));
      case 'cache-stats':
        return cacheStats();
      case 'start-oauth':
        return handleOAuth();
      case 'set-secret':
        return setSecret(message.provider, message.key).then(() => ({ ok: true }));
      case 'test-provider':
        return handleTestProvider(message.provider);
      case 'toggle-origin':
        // El popup no es una pestaña: prevalece el tabId que envía explícitamente.
        return handleToggleOrigin(message.origin, message.enabled, message.tabId ?? sender.tab?.id);
      case 'open-options':
        return browser.runtime.openOptionsPage().then(() => ({ ok: true }));
      default:
        return undefined;
    }
  });

  async function handleSetConfig(patch: Parameters<typeof setConfig>[0]) {
    const config = await setConfig(patch);
    if (patch.enabledOrigins) await syncContentScripts(config.enabledOrigins);
    return config;
  }

  async function handleToggleOrigin(origin: string, enabled: boolean, tabId?: number) {
    const config = await getConfig();
    const set = new Set(config.enabledOrigins);
    if (enabled) set.add(origin);
    else set.delete(origin);
    const next = await setConfig({ enabledOrigins: [...set] });
    const registered = await syncContentScripts(next.enabledOrigins);

    let injected = false;
    if (enabled) {
      if (tabId == null) {
        log.warn(
          'No llegó tabId al activar el origen: no se puede inyectar en la pestaña abierta. ' +
            'Hará falta recargar la página.',
        );
      } else {
        injected = await injectIntoTab(tabId);
      }
    }

    log.info('toggle-origin', { origin, enabled, tabId, registrados: registered, inyectado: injected });
    return { ok: true, enabledOrigins: next.enabledOrigins, injected };
  }

  /** Comprueba de una vez todo lo que puede impedir que la extensión actúe. */
  async function handleDiagnose(tabId?: number): Promise<Diagnosis> {
    const config = await getConfig();
    const tab = tabId != null ? await browser.tabs.get(tabId).catch(() => undefined) : undefined;
    const url = tab?.url ?? null;
    const pattern = url ? originPatternFor(url) : null;

    const permissionGranted = pattern
      ? await browser.permissions.contains({ origins: [pattern] }).catch(() => false)
      : false;
    const originEnabled = pattern ? config.enabledOrigins.includes(pattern) : false;

    let contentScriptAlive = false;
    let extraction: Record<string, unknown> | null = null;
    if (tabId != null) {
      contentScriptAlive = await browser.tabs
        .sendMessage(tabId, { kind: 'ping' })
        .then(() => true)
        .catch(() => false);
      if (contentScriptAlive) {
        extraction = await browser.tabs
          .sendMessage(tabId, { kind: 'debug-extract' })
          .then((r) => r as Record<string, unknown>)
          .catch(() => null);
      }
    }

    const provider = getProvider(config.provider);
    const availability = await provider.isAvailable();
    const secret = provider.requiresApiKey ? await getSecret(config.provider) : 'n/a';
    const providerConfigured = !provider.requiresApiKey || Boolean(secret);
    const consentOk =
      (!provider.requiresCloudConsent || config.cloudConsentGiven) &&
      (config.provider !== 'gemini-free' || config.geminiFreeConsentGiven);

    const problems: string[] = [];
    if (!url) problems.push(t('diagUrlUnreadable'));
    else if (!pattern) problems.push(t('diagNotHttp'));
    if (pattern && !permissionGranted) problems.push(t('diagNoHostPermission'));
    if (pattern && permissionGranted && !originEnabled) problems.push(t('diagNotEnabled'));
    if (pattern && permissionGranted && originEnabled && !contentScriptAlive) {
      problems.push(t('diagContentScriptDead'));
    }
    if (!availability.available) problems.push(t('diagProviderUnavailable', availability.reason ?? t('diagNoReason')));
    if (!providerConfigured) problems.push(t('diagMissingCredential'));
    if (!consentOk) problems.push(t('diagMissingConsent'));
    if (extraction && extraction.contenedor === null) {
      problems.push(t('diagNoArticle'));
    } else if (extraction && (extraction.bloqueMayor as number) < config.minWords) {
      problems.push(t('diagBelowThreshold', String(extraction.bloqueMayor), config.minWords));
    }

    const diagnosis: Diagnosis = {
      version: browser.runtime.getManifest().version,
      url,
      originPattern: pattern,
      permissionGranted,
      originEnabled,
      contentScriptAlive,
      registeredScripts: await listRegisteredScripts(),
      provider: config.provider,
      providerAvailable: availability.available,
      providerConfigured,
      providerReason: availability.reason,
      consentOk,
      extraction,
      problems,
    };

    log.info('diagnóstico', diagnosis);
    if (problems.length) log.warn('problemas detectados', problems);
    return diagnosis;
  }

  async function handleSummarize(article: ArticlePayload, tabId?: number) {
    const config = await getConfig();
    const runId = newRunId();
    const runLog = log.child(runId);

    if (tabId != null) {
      running.get(tabId)?.abort();
    }
    const controller = new AbortController();
    if (tabId != null) running.set(tabId, controller);

    const language = resolveLanguage(config, article.lang ? [article.lang] : [], browser.i18n.getUILanguage());

    runLog.info('resumir', {
      url: article.url,
      título: article.title,
      bloques: article.blocks.length,
      palabras: article.blocks.reduce((s, b) => s + b.words, 0),
      proveedor: config.provider,
      respaldo: config.fallbackProvider,
      estrategia: config.callStrategy,
      idioma: language,
    });

    const onPartial = (summaries: BlockSummary[]) => {
      if (tabId == null || summaries.length === 0) return;
      runLog.debug('→ parcial', summaries.length, 'resúmenes');
      void browser.tabs
        .sendMessage(tabId, { kind: 'partial', summaries })
        .catch((e) => runLog.warn('no se pudo enviar el parcial a la pestaña', e));
    };

    try {
      const result = await runLog.timed('pipeline', () =>
        summarizeArticle(article, config, language, {
          getSecret,
          onPartial,
          signal: controller.signal,
          log: runLog,
        }),
      );
      if (result.ok) {
        runLog.info('resultado', {
          resúmenes: result.summaries.length,
          fallidos: result.failed.length,
          deCaché: result.fromCache,
          llamadas: result.calls,
          proveedor: result.providerUsed,
          respaldo: result.usedFallback,
          estrategia: result.strategyUsed,
        });
      } else {
        runLog.warn('falló', result.code, result.error);
      }
      void pruneCache(config);
      return result;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return { ok: false, error: t('errCancelled'), code: 'unknown' };
      }
      return { ok: false, error: error instanceof Error ? error.message : String(error), code: 'unknown' };
    } finally {
      if (tabId != null && running.get(tabId) === controller) running.delete(tabId);
    }
  }

  async function handleProviderStatus(): Promise<ProviderStatus[]> {
    const out: ProviderStatus[] = [];
    for (const id of PROVIDER_ORDER) {
      const provider = getProvider(id);
      const availability = await provider.isAvailable();
      const key = provider.requiresApiKey ? await getSecret(id) : 'n/a';
      out.push({
        id,
        displayName: provider.displayName,
        available: availability.available,
        configured: !provider.requiresApiKey || Boolean(key),
        reason: availability.reason,
      });
    }
    return out;
  }

  async function handleOAuth() {
    try {
      const key = await runOpenRouterOAuth();
      await setSecret('openrouter', key);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Prueba de humo: una llamada mínima para validar la credencial. */
  async function handleTestProvider(id: ProviderId) {
    const config = await getConfig();
    const provider = getProvider(id);
    if (!provider) return { ok: false, error: t('popupProviderUnknown') };

    const availability = await provider.isAvailable();
    if (!availability.available) return { ok: false, error: availability.reason ?? t('testUnavailable') };

    const apiKey = provider.requiresApiKey ? await getSecret(id) : null;
    if (provider.requiresApiKey && !apiKey) return { ok: false, error: t('testMissingCredential') };

    // El texto de prueba y el idioma del resumen siguen al de la interfaz.
    const language = uiLanguage();
    const text = t('testSampleText');
    const article: ArticlePayload = {
      title: t('testSampleTitle'),
      fullText: text,
      blocks: [{ id: 0, text, words: 40, targetWords: 15 }],
      url: 'https://example.invalid/prueba',
      lang: language,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    try {
      const result = await summarizeArticle(
        article,
        { ...config, provider: id, fallbackProvider: null, cloudConsentGiven: true, geminiFreeConsentGiven: true },
        language,
        { getSecret, signal: controller.signal },
      );
      if (!result.ok) return { ok: false, error: result.error };
      return { ok: true, sample: result.summaries[0]?.summary ?? '' };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      clearTimeout(timeout);
    }
  }
});
