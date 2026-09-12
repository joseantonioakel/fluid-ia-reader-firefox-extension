import { describe, expect, it, vi } from 'vitest';
import { ProviderScheduler, backoffDelay, withRetry } from '../lib/pipeline/scheduler';
import { ProviderError } from '../lib/providers/types';

describe('ProviderScheduler', () => {
  it('respeta el límite de concurrencia', async () => {
    const scheduler = new ProviderScheduler({ concurrency: 2, requestsPerMinute: null, requestsPerDay: null });
    let active = 0;
    let peak = 0;

    const task = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
    };

    await Promise.all(Array.from({ length: 8 }, () => scheduler.run(task)));
    expect(peak).toBe(2);
  });

  it('reduce la concurrencia a la mitad ante un 429', () => {
    const scheduler = new ProviderScheduler({ concurrency: 4, requestsPerMinute: null, requestsPerDay: null });
    expect(scheduler.concurrency).toBe(4);
    scheduler.notifyThrottled();
    expect(scheduler.concurrency).toBe(2);
    scheduler.notifyThrottled();
    expect(scheduler.concurrency).toBe(1);
    // Nunca baja de 1: siempre debe poder avanzar.
    scheduler.notifyThrottled();
    expect(scheduler.concurrency).toBe(1);
  });

  it('espacia las peticiones según el RPM declarado', async () => {
    let now = 0;
    const clock = () => now;
    // 60 RPM = 1 petición por segundo, con el bucket lleno al inicio.
    const scheduler = new ProviderScheduler(
      { concurrency: 1, requestsPerMinute: 60, requestsPerDay: null },
      clock,
    );

    vi.useFakeTimers();
    try {
      const started: number[] = [];
      const run = async () => {
        for (let i = 0; i < 3; i += 1) {
          await scheduler.run(async () => {
            started.push(now);
          });
        }
      };
      const promise = run();
      // Consume el bucket inicial (60 tokens) sin esperas.
      await vi.runAllTimersAsync();
      await promise;
      expect(started).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('agota el bucket y entonces espera', async () => {
    let now = 0;
    // 2 RPM: el bucket arranca con 2 tokens, la tercera petición debe esperar.
    const scheduler = new ProviderScheduler(
      { concurrency: 1, requestsPerMinute: 2, requestsPerDay: null },
      () => now,
    );

    let waited = 0;
    const originalSetTimeout = globalThis.setTimeout;
    // @ts-expect-error sustitución controlada para medir la espera
    globalThis.setTimeout = (fn: () => void, ms?: number) => {
      waited += ms ?? 0;
      now += ms ?? 0;
      return originalSetTimeout(fn, 0);
    };
    try {
      await scheduler.run(async () => undefined);
      await scheduler.run(async () => undefined);
      await scheduler.run(async () => undefined);
      // La tercera exige esperar a que se rellene un token: 30 s a 2 RPM.
      expect(waited).toBeGreaterThan(0);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
  });
});

describe('backoffDelay', () => {
  it('crece exponencialmente: 250 ms → 1 s → 4 s', () => {
    expect(backoffDelay(0)).toBeGreaterThanOrEqual(250);
    expect(backoffDelay(0)).toBeLessThan(320);
    expect(backoffDelay(1)).toBeGreaterThanOrEqual(1000);
    expect(backoffDelay(1)).toBeLessThan(1300);
    expect(backoffDelay(2)).toBeGreaterThanOrEqual(4000);
    expect(backoffDelay(2)).toBeLessThan(5100);
  });
});

describe('withRetry', () => {
  it('reintenta los errores marcados como reintentables', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new ProviderError('temporal', 'network', true);
        return 'ok';
      },
      { attempts: 3, isRetryable: (e) => e instanceof ProviderError && e.retryable },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('no reintenta un error de credencial', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new ProviderError('401', 'unauthorized', false);
        },
        { attempts: 3, isRetryable: (e) => e instanceof ProviderError && e.retryable },
      ),
    ).rejects.toThrow('401');
    expect(calls).toBe(1);
  });

  it('avisa del throttling para que el planificador reaccione', async () => {
    const onThrottle = vi.fn();
    await expect(
      withRetry(
        async () => {
          throw new ProviderError('429', 'rate-limit', true);
        },
        { attempts: 2, isRetryable: () => true, onThrottle },
      ),
    ).rejects.toThrow('429');
    expect(onThrottle).toHaveBeenCalled();
  });
});
