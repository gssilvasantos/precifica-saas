import {
  calculateRoas,
  calculateTacos,
  classifyCampaignHealth,
  determineAlertAction,
  shouldSuggestPauseAction,
  DEFAULT_CAMPAIGN_HEALTH_THRESHOLDS,
} from './ads-metrics';

describe('ads-metrics (domain, funções puras)', () => {
  describe('calculateRoas', () => {
    it('calcula receita/gasto quando há investimento', () => {
      expect(calculateRoas({ spend: 100, revenueAds: 450 })).toBe(4.5);
    });

    it('devolve null (não zero) quando spend é 0 — "sem investimento" != "investimento sem retorno"', () => {
      expect(calculateRoas({ spend: 0, revenueAds: 0 })).toBeNull();
    });
  });

  describe('calculateTacos', () => {
    it('calcula gasto de ads sobre a receita TOTAL do tenant (ads + orgânica)', () => {
      expect(calculateTacos(200, 10000)).toBe(0.02);
    });

    it('devolve null quando o tenant não teve receita nenhuma no período', () => {
      expect(calculateTacos(200, 0)).toBeNull();
    });
  });

  describe('classifyCampaignHealth', () => {
    it('classifica ESTRELA: ROAS saudável + volume relevante', () => {
      const result = classifyCampaignHealth({ spend: 100, revenueAds: 500, clicks: 50, impressions: 2000 });
      expect(result.tier).toBe('ESTRELA');
    });

    it('classifica PONTO_DE_ATENCAO: volume alto mas ROAS abaixo do saudável', () => {
      const result = classifyCampaignHealth({ spend: 100, revenueAds: 150, clicks: 50, impressions: 2000 });
      expect(result.tier).toBe('PONTO_DE_ATENCAO');
    });

    it('classifica CUSTO_PERDIDO: baixo volume e ROAS ruim', () => {
      const result = classifyCampaignHealth({ spend: 50, revenueAds: 40, clicks: 5, impressions: 200 });
      expect(result.tier).toBe('CUSTO_PERDIDO');
    });

    it('classifica SEM_DADOS quando não há gasto no período (nunca CUSTO_PERDIDO por ausência de dado)', () => {
      const result = classifyCampaignHealth({ spend: 0, revenueAds: 0, clicks: 0, impressions: 0 });
      expect(result.tier).toBe('SEM_DADOS');
    });

    it('classifica PONTO_DE_ATENCAO (não ESTRELA) quando ROAS parece bom mas volume ainda é baixo demais para confiar', () => {
      const result = classifyCampaignHealth({ spend: 10, revenueAds: 100, clicks: 2, impressions: 30 });
      expect(result.tier).toBe('PONTO_DE_ATENCAO');
    });

    it('respeita thresholds customizados em vez dos DEFAULT_*', () => {
      const looseThresholds = { roasHealthy: 1, minClicksForSignal: 1 };
      const result = classifyCampaignHealth({ spend: 100, revenueAds: 150, clicks: 5, impressions: 200 }, looseThresholds);
      expect(result.tier).toBe('ESTRELA');
    });

    it('DEFAULT_CAMPAIGN_HEALTH_THRESHOLDS é o valor usado quando nenhum threshold é passado', () => {
      const spy = classifyCampaignHealth({ spend: 100, revenueAds: 500, clicks: 50, impressions: 1000 });
      const explicit = classifyCampaignHealth(
        { spend: 100, revenueAds: 500, clicks: 50, impressions: 1000 },
        DEFAULT_CAMPAIGN_HEALTH_THRESHOLDS,
      );
      expect(spy).toEqual(explicit);
    });
  });

  describe('determineAlertAction', () => {
    it('ALERT: degradou para CUSTO_PERDIDO e ainda não tinha sido alertado', () => {
      expect(determineAlertAction(null, 'CUSTO_PERDIDO')).toBe('ALERT');
      expect(determineAlertAction('ESTRELA', 'CUSTO_PERDIDO')).toBe('ALERT');
      expect(determineAlertAction('PONTO_DE_ATENCAO', 'CUSTO_PERDIDO')).toBe('ALERT');
    });

    it('NONE: continua CUSTO_PERDIDO mas já foi alertado antes — não repete o alerta', () => {
      expect(determineAlertAction('CUSTO_PERDIDO', 'CUSTO_PERDIDO')).toBe('NONE');
    });

    it('RESET: recuperou de CUSTO_PERDIDO — limpa o estado para poder alertar de novo no futuro', () => {
      expect(determineAlertAction('CUSTO_PERDIDO', 'ESTRELA')).toBe('RESET');
      expect(determineAlertAction('CUSTO_PERDIDO', 'PONTO_DE_ATENCAO')).toBe('RESET');
      expect(determineAlertAction('CUSTO_PERDIDO', 'SEM_DADOS')).toBe('RESET');
    });

    it('NONE: nunca foi alertado e continua saudável — nada a fazer', () => {
      expect(determineAlertAction(null, 'ESTRELA')).toBe('NONE');
      expect(determineAlertAction(null, 'PONTO_DE_ATENCAO')).toBe('NONE');
      expect(determineAlertAction(null, 'SEM_DADOS')).toBe('NONE');
    });
  });

  describe('shouldSuggestPauseAction', () => {
    it('true só para CUSTO_PERDIDO', () => {
      expect(shouldSuggestPauseAction('CUSTO_PERDIDO')).toBe(true);
    });

    it('false para os demais tiers (ESTRELA/PONTO_DE_ATENCAO/SEM_DADOS)', () => {
      expect(shouldSuggestPauseAction('ESTRELA')).toBe(false);
      expect(shouldSuggestPauseAction('PONTO_DE_ATENCAO')).toBe(false);
      expect(shouldSuggestPauseAction('SEM_DADOS')).toBe(false);
    });
  });
});
