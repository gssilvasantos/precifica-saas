import { RateLimiter } from './rate-limiter';

describe('RateLimiter', () => {
  it('executa imediatamente enquanto houver tokens disponíveis', async () => {
    const limiter = new RateLimiter({ requestsPerInterval: 3, intervalMs: 1000 });
    const start = Date.now();

    await limiter.schedule(async () => 'a');
    await limiter.schedule(async () => 'b');
    await limiter.schedule(async () => 'c');

    expect(Date.now() - start).toBeLessThan(100);
  });

  it('bloqueia até liberar um token quando a cota se esgota', async () => {
    const limiter = new RateLimiter({ requestsPerInterval: 1, intervalMs: 100 });

    await limiter.schedule(async () => 'first'); // consome o único token inicial

    const start = Date.now();
    await limiter.schedule(async () => 'second'); // precisa esperar o refill
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(80); // margem de tolerância abaixo de 100ms
  });

  it('devolve o valor de retorno da função agendada', async () => {
    const limiter = new RateLimiter({ requestsPerInterval: 5, intervalMs: 1000 });

    const result = await limiter.schedule(async () => 42);

    expect(result).toBe(42);
  });

  it('propaga erro lançado pela função agendada, sem quebrar o limiter', async () => {
    const limiter = new RateLimiter({ requestsPerInterval: 5, intervalMs: 1000 });

    await expect(limiter.schedule(async () => {
      throw new Error('falhou');
    })).rejects.toThrow('falhou');

    // O limiter continua utilizável após um erro — não trava.
    const result = await limiter.schedule(async () => 'ok');
    expect(result).toBe('ok');
  });
});
