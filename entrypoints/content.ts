import { defineContentScript, browser } from '#imports';
import { t } from '../lib/i18n';
import { createLogger, initLogging } from '../lib/log';
import { extract, type ExtractedBlock, type ExtractionResult } from '../lib/extract/blocks';
import { openReaderView, type ReaderView } from '../lib/reader';
import { FloatingButton, type FabAction, type FabPosition } from '../lib/ui/fab';
import { BlockOverlay } from '../lib/ui/overlay';
import { detectTheme, type Theme } from '../lib/ui/theme';
import { showToast } from '../lib/ui/toast';
import type { ArticlePayload, BlockSummary, Config, SummarizeResult } from '../lib/types';
import { targetWordsFor } from '../lib/words';

const log = createLogger('content');

export default defineContentScript({
  // Registrado en tiempo de ejecución desde el background: los host permissions
  // son opcionales y se conceden por dominio.
  registration: 'runtime',
  matches: [],
  runAt: 'document_idle',
  main() {
    if (window.top !== window.self) {
      log.debug('ignorado: no es el frame principal', location.href);
      return;
    }
    const flag = window as unknown as { __lectorFluido?: LectorFluido };
    if (flag.__lectorFluido) {
      log.debug('ya estaba cargado en esta página; no se duplica');
      return;
    }
    const instance = new LectorFluido();
    // Accesible desde la consola de la página para inspeccionar el estado.
    flag.__lectorFluido = instance;
    void instance.start();
  },
});

const FAB_POSITION_KEY = 'fabPosition';

class LectorFluido {
  private theme: Theme = detectTheme();
  private fab: FloatingButton | null = null;
  private overlays = new Map<number, BlockOverlay>();
  private blocks = new Map<number, ExtractedBlock>();
  private reader: ReaderView | null = null;
  private busy = false;
  private allHidden = false;
  private lastUrl = location.href;
  private tldr: string | null = null;
  private observer: MutationObserver | null = null;
  private currentRoot: (ParentNode & Element) | null = null;

  async start(): Promise<void> {
    await initLogging('content');
    log.info('iniciado en', location.href, '· tema', this.theme.dark ? 'oscuro' : 'claro');

    try {
      const position = await this.loadPosition();
      this.fab = new FloatingButton({
        theme: this.theme,
        initialPosition: position,
        onPrimary: () => void this.onPrimary(),
        onMove: (p) => void browser.storage.local.set({ [FAB_POSITION_KEY]: p }),
        getMenu: () => this.buildMenu(),
      });
      log.info('botón flotante insertado', position);
    } catch (error) {
      log.error('no se pudo crear el botón flotante', error);
    }

    browser.runtime.onMessage.addListener((message: { kind: string; summaries?: BlockSummary[] }) => {
      log.debug('← mensaje', message.kind);
      if (message.kind === 'ping') return Promise.resolve({ alive: true, url: location.href });
      // El content script vive en un mundo aislado: este canal es la única forma
      // fiable de leer su estado desde el popup en Firefox y en Chrome.
      if (message.kind === 'debug-extract') return Promise.resolve(this.inspect());
      if (message.kind === 'partial' && message.summaries) this.applySummaries(message.summaries, false);
      if (message.kind === 'run-on-tab') void this.onPrimary();
      return undefined;
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.overlays.size > 0 && !this.allHidden) this.toggleAll();
    });

    this.watchNavigation();
  }

  /**
   * Estado de la extracción sobre esta página. Responde a la pregunta habitual
   * de "¿por qué no me sale ningún overlay aquí?".
   *
   * Accesible por el botón Diagnóstico del popup en ambos navegadores, y desde
   * la consola como `__lectorFluido.inspect()` en Chrome (seleccionando el
   * contexto de la extensión en el desplegable de DevTools).
   */
  inspect(): Record<string, unknown> {
    // Umbral 1 para ver TODOS los candidatos, no solo los que pasan el filtro.
    const result = extract(document.body, { minWords: 1, skipAnchorCheck: true });
    const palabras = result.blocks.map((b) => b.words).sort((a, b) => b - a);
    return {
      url: location.href,
      overlaysVisibles: this.overlays.size,
      ocultos: this.allHidden,
      modoLectura: Boolean(this.reader),
      ocupado: this.busy,
      contenedor: result.container
        ? `${result.container.tagName}.${result.container.className || '(sin clase)'}`
        : null,
      puntuación: Math.round(result.score),
      bloquesCandidatos: result.totalCandidates,
      palabrasArtículo: result.totalWords,
      motivoDegradación: result.degradeReason,
      bloquesFusionados: result.blocks.filter((b) => b.merged).length,
      bloqueMayor: palabras[0] ?? 0,
      top10PalabrasPorBloque: palabras.slice(0, 10),
    };
  }

  /** Volcado directo en consola, útil desde el contexto de la extensión. */
  debug(): Record<string, unknown> {
    const state = this.inspect();
    console.table(state);
    return state;
  }

  /**
   * Altura del widget en el borde derecho. Por defecto, hacia la mitad de la
   * ventana: es donde menos tapa (ni cabeceras ni pies) y donde se ven las
   * pestañas laterales habituales.
   */
  private async loadPosition(): Promise<FabPosition> {
    const stored = await browser.storage.local.get(FAB_POSITION_KEY);
    const value = stored[FAB_POSITION_KEY] as Partial<FabPosition> | undefined;
    if (typeof value?.bottom === 'number' && Number.isFinite(value.bottom)) return { bottom: value.bottom };
    return { bottom: Math.max(80, Math.round(window.innerHeight * 0.45)) };
  }

  private async getConfig(): Promise<Config> {
    return (await browser.runtime.sendMessage({ kind: 'get-config' })) as Config;
  }

  /* --------------------------- Acción principal --------------------------- */

  private async onPrimary(): Promise<void> {
    if (this.busy) return;
    // Segundo clic con overlays presentes: alterna todos a la vez.
    if (this.overlays.size > 0) {
      this.toggleAll();
      return;
    }
    await this.run();
  }

  private async run(forceMode?: 'inplace' | 'reader'): Promise<void> {
    this.busy = true;
    this.fab?.setBusy(0, 0);

    try {
      const config = await this.getConfig();
      const origin = location.hostname;
      const preferReader =
        forceMode === 'reader' ||
        config.extractionMode === 'reader' ||
        config.readerModeOrigins.includes(origin);

      const root: ParentNode & Element = document.body;
      const started = performance.now();
      const result = extract(root, { minWords: config.minWords });

      log.info('extracción', {
        ms: Math.round(performance.now() - started),
        contenedor: result.container
          ? `${result.container.tagName}.${result.container.className || '(sin clase)'}`
          : null,
        puntuación: Math.round(result.score),
        candidatos: result.totalCandidates,
        sobreUmbral: result.blocks.length,
        fusionados: result.blocks.filter((b) => b.merged).length,
        umbral: config.minWords,
        palabrasArtículo: result.totalWords,
        motivoDegradación: result.degradeReason,
        modoForzado: forceMode ?? '(auto)',
      });

      if (!result.container) {
        log.warn('sin contenedor de artículo: la puntuación no bastó para identificar contenido');
        this.fail(t('errNoArticle'));
        return;
      }

      if (preferReader) {
        log.info('usando Modo B (vista de lectura)');
        await this.runInReader(result, config);
        return;
      }

      if (result.degradeReason && forceMode !== 'inplace' && config.extractionMode === 'auto') {
        log.warn('degradación ofrecida por:', result.degradeReason);
        this.offerReaderView(result, config);
        return;
      }

      if (result.blocks.length === 0) {
        log.warn(
          `ningún bloque supera ${config.minWords} palabras ` +
            `(candidatos: ${result.totalCandidates}, mayor bloque: ` +
            `${Math.max(0, ...result.blocks.map((b) => b.words))} palabras)`,
        );
        this.noBlocks(config, result);
        return;
      }

      this.currentRoot = root;
      await this.summarize(result, config);
    } catch (error) {
      log.error('fallo en run()', error);
      this.fail(error instanceof Error ? error.message : String(error));
    } finally {
      this.busy = false;
      if (this.overlays.size === 0) this.fab?.setIdle();
    }
  }

  /* ------------------------------- Modo B ------------------------------- */

  private offerReaderView(result: ExtractionResult, config: Config): void {
    const reasons: Record<string, string> = {
      'low-score': t('degradeLowScore'),
      'too-few-blocks': t('degradeTooFewBlocks'),
      'anchor-unsafe': t('degradeAnchorUnsafe'),
    };
    const reason = reasons[result.degradeReason ?? ''] ?? t('degradeDefault');
    this.fab?.setIdle();
    showToast(
      this.theme,
      t('degradePrompt', reason),
      [
        { label: t('degradeOpenReader'), onSelect: () => void this.run('reader') },
        { label: t('degradeTryAnyway'), onSelect: () => void this.run('inplace') },
        {
          label: t('degradeAlwaysHere'),
          onSelect: () => {
            void browser.runtime.sendMessage({
              kind: 'set-config',
              patch: { readerModeOrigins: [...config.readerModeOrigins, location.hostname] },
            });
            void this.run('reader');
          },
        },
      ],
      15_000,
    );
  }

  private async runInReader(result: ExtractionResult, config: Config): Promise<void> {
    if (!result.container) return;
    this.clearOverlays();
    this.reader = openReaderView({
      title: result.title,
      container: result.container,
      theme: this.theme,
      onClose: () => {
        this.clearOverlays();
        this.reader = null;
        this.fab?.setIdle();
      },
    });

    // Sobre nuestro propio markup el anclaje es determinista.
    const inner = extract(this.reader.root, { minWords: config.minWords, skipAnchorCheck: true });
    if (inner.blocks.length === 0) {
      this.noBlocks(config, inner);
      return;
    }
    this.currentRoot = this.reader.root;
    await this.summarize(inner, config);
  }

  /* ------------------------------ Resumen ------------------------------ */

  private async summarize(result: ExtractionResult, config: Config): Promise<void> {
    this.blocks.clear();
    this.overlays.clear();
    this.tldr = null;
    this.lastFormat = config.summaryFormat;

    // Overlays esqueleto inmediatos: la estructura se ve antes de que exista
    // ningún resumen, que es lo que compensa la falta de render progresivo.
    for (const block of result.blocks) {
      this.blocks.set(block.id, block);
      this.overlays.set(
        block.id,
        new BlockOverlay(block.id, block.elements, this.theme, {
          onRetry: (id) => void this.retryBlock(id),
        }),
      );
    }
    this.fab?.setBusy(0, result.blocks.length);
    this.observeMutations();

    const article: ArticlePayload = {
      title: result.title,
      fullText: result.fullText,
      url: location.href,
      lang: document.documentElement.lang || navigator.language,
      blocks: result.blocks.map((b) => ({
        id: b.id,
        text: b.text,
        words: b.words,
        targetWords: targetWordsFor(b.words, config.summaryRatio),
      })),
    };

    log.info('→ background: resumir', {
      bloques: article.blocks.length,
      palabras: article.blocks.reduce((s, b) => s + b.words, 0),
      objetivos: article.blocks.map((b) => b.targetWords),
    });

    const response = (await browser.runtime.sendMessage({ kind: 'summarize', article })) as SummarizeResult;

    if (!response.ok) {
      log.error('el background no pudo resumir:', response.code, response.error);
      this.handleFailure(response.code, response.error);
      return;
    }

    log.info('← background', {
      resúmenes: response.summaries.length,
      fallidos: response.failed.length,
      deCaché: response.fromCache,
      llamadas: response.calls,
      proveedor: response.providerUsed,
      estrategia: response.strategyUsed,
    });

    this.applySummaries(response.summaries, true);
    this.tldr = response.tldr;

    if (response.usedFallback) {
      for (const overlay of this.overlays.values()) overlay.markFallback(t('overlayFallbackLabel'));
    }

    for (const failure of response.failed) {
      this.overlays.get(failure.id)?.setError(failure.error);
    }

    // Los bloques sin resumen ni error no comprimían lo suficiente: se retiran
    // y su texto original queda intacto.
    const answered = new Set([...response.summaries.map((s) => s.id), ...response.failed.map((f) => f.id)]);
    const descartados: number[] = [];
    for (const [id, overlay] of [...this.overlays]) {
      if (!answered.has(id)) {
        descartados.push(id);
        overlay.destroy();
        this.overlays.delete(id);
      }
    }
    if (descartados.length) {
      log.info(
        `${descartados.length} bloques sin overlay por compresión insuficiente (>60 % del original):`,
        descartados,
      );
    }

    const shown = this.overlays.size;
    log.info(`${shown} overlays visibles`);
    this.fab?.setIdle(shown > 0 ? t('fabSummaryCount', shown) : undefined);
    if (shown === 0) {
      showToast(this.theme, t('noneCompressed'));
    }
  }

  private applySummaries(summaries: BlockSummary[], final: boolean): void {
    const config = this.lastFormat;
    for (const { id, summary } of summaries) {
      const overlay = this.overlays.get(id);
      if (!overlay) continue;
      overlay.setSummary(summary, config === 'bullets' ? 'bullets' : 'text');
    }
    if (!final) {
      const done = [...this.overlays.values()].filter((o) => o.getState() === 'ready').length;
      this.fab?.setBusy(done, this.overlays.size);
    }
  }

  private lastFormat: Config['summaryFormat'] = 'proportional';

  private async retryBlock(id: number): Promise<void> {
    const block = this.blocks.get(id);
    const overlay = this.overlays.get(id);
    if (!block || !overlay) return;
    overlay.setLoading();

    const config = await this.getConfig();
    const article: ArticlePayload = {
      title: document.title,
      fullText: block.text,
      url: location.href,
      lang: document.documentElement.lang || navigator.language,
      blocks: [
        {
          id: block.id,
          text: block.text,
          words: block.words,
          targetWords: targetWordsFor(block.words, config.summaryRatio),
        },
      ],
    };
    const response = (await browser.runtime.sendMessage({ kind: 'summarize', article })) as SummarizeResult;
    if (!response.ok) {
      overlay.setError(response.error);
      return;
    }
    const summary = response.summaries.find((s) => s.id === id);
    if (summary) overlay.setSummary(summary.summary, config.summaryFormat === 'bullets' ? 'bullets' : 'text');
    else overlay.setError(t('blockNoSummary'));
  }

  /* ------------------------------ Errores ------------------------------ */

  private handleFailure(code: string, message: string): void {
    this.clearOverlays();
    const openOptions = {
      label: t('actionOpenOptions'),
      onSelect: () => void browser.runtime.sendMessage({ kind: 'open-options' }).catch(() => undefined),
    };

    const texts: Record<string, string> = {
      'no-provider': t('errNoProvider'),
      unauthorized: t('errUnauthorized'),
      quota: t('errQuota'),
      'rate-limit': t('errRateLimit'),
      unavailable: t('errUnavailable'),
      'empty-response': t('errEmptyResponse'),
    };

    showToast(this.theme, texts[code] ?? t('errGeneric', message), [openOptions], 14_000);
    this.fab?.setIdle();
  }

  private fail(message: string): void {
    showToast(this.theme, message);
    this.fab?.setIdle();
  }

  private noBlocks(config: Config, result: ExtractionResult): void {
    this.fab?.setIdle();
    const actions: FabAction[] = [];
    if (config.minWords > 40 && result.totalCandidates > 0) {
      const lowered = Math.max(40, Math.round(config.minWords / 2));
      actions.push({
        label: t('noBlocksLowerThreshold', lowered),
        onSelect: () => {
          void browser.runtime
            .sendMessage({ kind: 'set-config', patch: { minWords: lowered } })
            .then(() => this.run());
        },
      });
    }
    showToast(this.theme, t('noBlocksMessage', config.minWords), actions, 12_000);
  }

  /* ------------------------------- Estado ------------------------------- */

  private toggleAll(): void {
    this.allHidden = !this.allHidden;
    for (const overlay of this.overlays.values()) overlay.setHidden(this.allHidden);
    this.fab?.setIdle(this.allHidden ? t('fabShowSummaries') : t('fabSummaryCount', this.overlays.size));
  }

  private clearOverlays(): void {
    for (const overlay of this.overlays.values()) overlay.destroy();
    this.overlays.clear();
    this.blocks.clear();
    this.allHidden = false;
    this.observer?.disconnect();
    this.observer = null;
  }

  private buildMenu(): FabAction[] {
    const actions: FabAction[] = [];
    if (this.overlays.size > 0) {
      actions.push({
        label: this.allHidden ? t('menuShowAll') : t('menuHideAll'),
        onSelect: () => this.toggleAll(),
      });
      actions.push({ label: t('menuRegenerate'), onSelect: () => void this.regenerate() });
    }
    if (this.tldr) {
      actions.push({ label: t('menuTldr'), onSelect: () => this.showTldr() });
    }
    if (!this.reader) {
      actions.push({ label: t('menuReader'), onSelect: () => void this.run('reader'), separatorBefore: true });
    }
    actions.push({
      label: t('menuOptions'),
      onSelect: () => void browser.runtime.sendMessage({ kind: 'open-options' }).catch(() => undefined),
      separatorBefore: true,
    });
    actions.push({
      label: t('menuDisableSite'),
      onSelect: () => {
        void browser.runtime.sendMessage({
          kind: 'toggle-origin',
          origin: `${location.protocol}//${location.hostname}/*`,
          enabled: false,
        });
        this.clearOverlays();
        this.fab?.destroy();
        this.fab = null;
      },
    });
    return actions;
  }

  private showTldr(): void {
    if (!this.tldr) return;
    showToast(this.theme, this.tldr, [], 30_000);
  }

  private async regenerate(): Promise<void> {
    this.clearOverlays();
    await this.run(this.reader ? 'reader' : 'inplace');
  }

  /* --------------------- SPAs y contenido dinámico --------------------- */

  private observeMutations(): void {
    this.observer?.disconnect();
    if (!this.currentRoot) return;
    this.observer = new MutationObserver(() => {
      // Si un bloque anclado desaparece del DOM, su overlay deja de tener sentido.
      for (const [id, overlay] of [...this.overlays]) {
        if (!overlay.isConnected()) {
          overlay.destroy();
          this.overlays.delete(id);
        }
      }
      if (this.overlays.size === 0) this.fab?.setIdle();
    });
    this.observer.observe(this.currentRoot, { childList: true, subtree: true });
  }

  /** Una navegación de SPA limpia el estado y reinicia el botón. */
  private watchNavigation(): void {
    const check = () => {
      if (location.href === this.lastUrl) return;
      this.lastUrl = location.href;
      this.reader?.close();
      this.reader = null;
      this.clearOverlays();
      this.tldr = null;
      this.fab?.setIdle();
    };
    window.addEventListener('popstate', check);
    for (const method of ['pushState', 'replaceState'] as const) {
      const original = history[method];
      history[method] = function patched(this: History, ...args: Parameters<History['pushState']>) {
        const result = original.apply(this, args);
        setTimeout(check, 0);
        return result;
      } as History[typeof method];
    }
  }
}
