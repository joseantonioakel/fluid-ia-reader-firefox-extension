import type { RateLimit } from '../providers/types';

/**
 * Planificador por proveedor: limita la concurrencia y el ritmo de peticiones,
 * y reduce la concurrencia a la mitad ante cada 429, recuperándola tras una
 * ventana sin errores.
 */
export class ProviderScheduler {
  private tokens: number;
  private lastRefill: number;
  private active = 0;
  private queue: (() => void)[] = [];
  private currentConcurrency: number;
  private readonly baseConcurrency: number;
  private lastThrottleAt = 0;

  constructor(
    private readonly limit: RateLimit,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.baseConcurrency = Math.max(1, limit.concurrency);
    this.currentConcurrency = this.baseConcurrency;
    this.tokens = limit.requestsPerMinute ?? Number.POSITIVE_INFINITY;
    this.lastRefill = this.now();
  }

  get concurrency(): number {
    return this.currentConcurrency;
  }

  /** Señala un 429: la concurrencia baja a la mitad. */
  notifyThrottled(): void {
    this.currentConcurrency = Math.max(1, Math.floor(this.currentConcurrency / 2));
    this.lastThrottleAt = this.now();
  }

  /** Tras 60 s sin throttling, se recupera un escalón de concurrencia. */
  private maybeRecover(): void {
    if (this.currentConcurrency >= this.baseConcurrency) return;
    if (this.lastThrottleAt === 0) return;
    if (this.now() - this.lastThrottleAt < 60_000) return;
    this.currentConcurrency = Math.min(this.baseConcurrency, this.currentConcurrency + 1);
    this.lastThrottleAt = this.now();
  }

  private refill(): void {
    const rpm = this.limit.requestsPerMinute;
    if (rpm == null) return;
    const elapsed = this.now() - this.lastRefill;
    if (elapsed <= 0) return;
    this.tokens = Math.min(rpm, this.tokens + (elapsed / 60_000) * rpm);
    this.lastRefill = this.now();
  }

  /** Milisegundos que faltan para disponer de un token. */
  private delayUntilToken(): number {
    const rpm = this.limit.requestsPerMinute;
    if (rpm == null) return 0;
    this.refill();
    if (this.tokens >= 1) return 0;
    return Math.ceil(((1 - this.tokens) / rpm) * 60_000);
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    this.maybeRecover();
    await this.acquireSlot();
    try {
      const wait = this.delayUntilToken();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      this.refill();
      if (this.limit.requestsPerMinute != null) this.tokens -= 1;
      return await task();
    } finally {
      this.releaseSlot();
    }
  }

  private acquireSlot(): Promise<void> {
    if (this.active < this.currentConcurrency) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private releaseSlot(): void {
    this.active -= 1;
    while (this.active < this.currentConcurrency) {
      const next = this.queue.shift();
      if (!next) break;
      next();
    }
  }
}

const schedulers = new Map<string, ProviderScheduler>();

export function getScheduler(providerId: string, limit: RateLimit): ProviderScheduler {
  let scheduler = schedulers.get(providerId);
  if (!scheduler) {
    scheduler = new ProviderScheduler(limit);
    schedulers.set(providerId, scheduler);
  }
  return scheduler;
}

/** Backoff exponencial con jitter: 250 ms → 1 s → 4 s. */
export function backoffDelay(attempt: number): number {
  const base = 250 * 4 ** attempt;
  return base + Math.random() * base * 0.25;
}

export async function withRetry<T>(
  task: () => Promise<T>,
  options: {
    attempts: number;
    isRetryable(error: unknown): boolean;
    onThrottle?(): void;
    signal?: AbortSignal;
  },
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < options.attempts; attempt += 1) {
    if (options.signal?.aborted) throw new DOMException('Operación cancelada', 'AbortError');
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      if (!options.isRetryable(error) || attempt === options.attempts - 1) throw error;
      if ((error as { code?: string }).code === 'rate-limit') options.onThrottle?.();
      await new Promise((resolve) => setTimeout(resolve, backoffDelay(attempt)));
    }
  }
  throw lastError;
}
