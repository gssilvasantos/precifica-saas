import { isRateLimitError, withRetry } from './with-retry';

describe('withRetry', () => {
  it('retorna o valor na primeira tentativa quando não há erro', async () => {
    const fn = jest.fn().mockResolvedValue('ok');

    const result = await withRetry(fn);

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retenta até dar certo, respeitando maxAttempts', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('falha 1'))
      .mockRejectedValueOnce(new Error('falha 2'))
      .mockResolvedValueOnce('ok');

    const result = await withRetry(fn, { maxAttempts: 3, backoffMs: [1, 1, 1] });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('lança o último erro após esgotar maxAttempts', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('sempre falha'));

    await expect(withRetry(fn, { maxAttempts: 2, backoffMs: [1, 1] })).rejects.toThrow('sempre falha');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('não retenta quando shouldRetry retorna false — lança na primeira falha', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('erro definitivo'));

    await expect(withRetry(fn, { maxAttempts: 3, shouldRetry: () => false })).rejects.toThrow('erro definitivo');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('isRateLimitError', () => {
  it('reconhece um Error com mensagem contendo HTTP 429', () => {
    expect(isRateLimitError(new Error('Nuvemshop retornou HTTP 429 (rate limit)'))).toBe(true);
  });

  it('não reconhece outros códigos HTTP', () => {
    expect(isRateLimitError(new Error('Nuvemshop retornou HTTP 500'))).toBe(false);
  });

  it('não reconhece valores que não são Error', () => {
    expect(isRateLimitError('HTTP 429')).toBe(false);
    expect(isRateLimitError(null)).toBe(false);
  });
});
