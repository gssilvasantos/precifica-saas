import { getRateLimitConfig, DEFAULT_RATE_LIMIT } from './marketplace-rate-limits';

function requisicoesPorMinuto(config: { requestsPerInterval: number; intervalMs: number }): number {
  return (config.requestsPerInterval / config.intervalMs) * 60_000;
}

// O teto do plano base do Tiny/Olist é 60 req/min, e o token é da CONTA
// inteira — o painel do Olist e o app do lojista consomem da mesma cota. Rodar
// a 100% do limite foi o que tirou a integração do ar (135 syncs falhando com
// "API Bloqueada" entre 31/07 e 09/08/2026, zero produto importado).
//
// Este teste existe para que voltar a 60 req/min seja uma DECISÃO, não um
// ajuste distraído: quem subir o número tem que apagar este teste e explicar.
const TETO_DO_PLANO_BASE = 60;
const FOLGA_MINIMA = 0.2; // 20% da cota reservados para o resto da conta

describe('limite de requisições do Olist', () => {
  it('fica abaixo do teto do plano base, com folga para o próprio lojista', () => {
    const porMinuto = requisicoesPorMinuto(getRateLimitConfig('OLIST'));

    expect(porMinuto).toBeLessThanOrEqual(TETO_DO_PLANO_BASE * (1 - FOLGA_MINIMA));
    // Folga não pode virar lentidão gratuita: abaixo disto, um catálogo de
    // 1.800 SKUs passa de uma hora e volta a sobrepor a janela do scheduler.
    expect(porMinuto).toBeGreaterThan(30);
  });

  it('não estoura o teto por rajada inicial', () => {
    // Bucket de 1 token = espaçamento estrito. O bloqueio do Tiny é por janela
    // de minuto, então uma rajada só antecipa o estouro.
    expect(getRateLimitConfig('OLIST').requestsPerInterval).toBe(1);
  });

  it('canal desconhecido cai no fail-safe conservador', () => {
    expect(getRateLimitConfig('CANAL_QUE_NAO_EXISTE')).toEqual(DEFAULT_RATE_LIMIT);
    expect(requisicoesPorMinuto(DEFAULT_RATE_LIMIT)).toBeLessThanOrEqual(TETO_DO_PLANO_BASE);
  });
});
