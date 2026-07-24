import { AnthropicCampaignAdvisor } from './anthropic-campaign-advisor.service';
import { CampaignOptimizationRequest } from '../../../../shared/contracts/campaign-optimization-advisor.port';

describe('AnthropicCampaignAdvisor (Fase 4 — sugestão via IA)', () => {
  const originalEnv = process.env;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    process.env = { ...originalEnv, ANTHROPIC_API_KEY: 'test-key' };
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  function fakeRequest(overrides: Partial<CampaignOptimizationRequest> = {}): CampaignOptimizationRequest {
    return {
      tenantId: 'tenant-1',
      targetRoas: 3,
      tacos: 0.08,
      campaigns: [
        {
          campaignId: 'camp-1',
          channelCode: 'MERCADO_LIVRE',
          name: 'Campanha 1',
          status: 'ACTIVE',
          totals: { spend: 100, revenueAds: 80, clicks: 40, impressions: 1000 },
          roas: 0.8,
          tier: 'CUSTO_PERDIDO',
          recommendation: 'Baixo volume e ROAS ruim — candidata a pausar.',
        },
      ],
      ...overrides,
    };
  }

  function mockAnthropicResponse(toolInput: unknown) {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'tool_use', name: 'suggest_campaign_actions', input: toolInput }],
        stop_reason: 'tool_use',
      }),
    });
  }

  it('lança erro explícito se ANTHROPIC_API_KEY não está configurada', async () => {
    process.env = { ...originalEnv };
    delete process.env.ANTHROPIC_API_KEY;
    const advisor = new AnthropicCampaignAdvisor();

    await expect(advisor.suggestActions(fakeRequest())).rejects.toThrow(/ANTHROPIC_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sai cedo sem chamar a API quando não há campanhas para avaliar', async () => {
    const advisor = new AnthropicCampaignAdvisor();

    const result = await advisor.suggestActions(fakeRequest({ campaigns: [] }));

    expect(result.suggestions).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('feliz: devolve a sugestão validada quando a resposta é bem formada', async () => {
    mockAnthropicResponse({
      suggestions: [
        { campaignId: 'camp-1', actionType: 'PAUSE_CAMPAIGN', reasoning: 'ROAS de 0.8 está bem abaixo da meta de 3.', confidenceScore: 0.82 },
      ],
    });
    const advisor = new AnthropicCampaignAdvisor();

    const result = await advisor.suggestActions(fakeRequest());

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]).toMatchObject({ campaignId: 'camp-1', actionType: 'PAUSE_CAMPAIGN', confidenceScore: 0.82 });
  });

  it('descarta (não lança) sugestão com campaignId que não estava na lista enviada', async () => {
    mockAnthropicResponse({
      suggestions: [{ campaignId: 'camp-inexistente', actionType: 'PAUSE_CAMPAIGN', reasoning: 'ROAS de 0.5 muito baixo.', confidenceScore: 0.9 }],
    });
    const advisor = new AnthropicCampaignAdvisor();

    const result = await advisor.suggestActions(fakeRequest());

    expect(result.suggestions).toEqual([]);
  });

  it('descarta sugestão com actionType não suportado', async () => {
    mockAnthropicResponse({
      suggestions: [{ campaignId: 'camp-1', actionType: 'REDUCE_BID', reasoning: 'ROAS caindo, lance deveria cair 10%.', confidenceScore: 0.7 }],
    });
    const advisor = new AnthropicCampaignAdvisor();

    const result = await advisor.suggestActions(fakeRequest());

    expect(result.suggestions).toEqual([]);
  });

  it('descarta sugestão com reasoning genérico (sem número concreto)', async () => {
    mockAnthropicResponse({
      suggestions: [{ campaignId: 'camp-1', actionType: 'PAUSE_CAMPAIGN', reasoning: 'A campanha não está performando bem.', confidenceScore: 0.7 }],
    });
    const advisor = new AnthropicCampaignAdvisor();

    const result = await advisor.suggestActions(fakeRequest());

    expect(result.suggestions).toEqual([]);
  });

  it('descarta sugestão com confidenceScore fora de 0-1', async () => {
    mockAnthropicResponse({
      suggestions: [{ campaignId: 'camp-1', actionType: 'PAUSE_CAMPAIGN', reasoning: 'ROAS de 0.8 abaixo da meta 3.', confidenceScore: 1.5 }],
    });
    const advisor = new AnthropicCampaignAdvisor();

    const result = await advisor.suggestActions(fakeRequest());

    expect(result.suggestions).toEqual([]);
  });

  it('lança erro se a API HTTP devolver status de erro', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'internal error' });
    const advisor = new AnthropicCampaignAdvisor();

    await expect(advisor.suggestActions(fakeRequest())).rejects.toThrow(/HTTP 500/);
  });

  it('lança erro se a resposta não contiver um bloco tool_use', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ content: [{ type: 'text', text: 'recuso responder' }], stop_reason: 'end_turn' }) });
    const advisor = new AnthropicCampaignAdvisor();

    await expect(advisor.suggestActions(fakeRequest())).rejects.toThrow(/não devolveu uma chamada da tool/);
  });

  it('lista vazia de sugestões é um resultado válido, não um erro', async () => {
    mockAnthropicResponse({ suggestions: [] });
    const advisor = new AnthropicCampaignAdvisor();

    const result = await advisor.suggestActions(fakeRequest());

    expect(result.suggestions).toEqual([]);
  });
});
