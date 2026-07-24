import { Injectable, Logger } from '@nestjs/common';
import { requireAiEnv } from '../../../../shared/infrastructure/ai/ai-env';
import {
  CampaignOptimizationAdvisor,
  CampaignOptimizationActionType,
  CampaignOptimizationRequest,
  CampaignOptimizationResponse,
  CampaignOptimizationSuggestion,
} from '../../../../shared/contracts/campaign-optimization-advisor.port';

// Fase 4 (sugestão via IA) — adapter Anthropic da porta
// CampaignOptimizationAdvisor. Único lugar do sistema que conhece o formato
// da API da Anthropic (mesma disciplina de MercadoLivreApiClient para o
// canal de ads: o "formato bruto do provedor" nunca vaza para
// AdsAiOptimizationService).
//
// fetch puro em vez do SDK oficial (@anthropic-ai/sdk) — decisão deliberada,
// não descuido: a API da Anthropic é um POST JSON simples com um header de
// autenticação (nada como a assinatura SigV4 que justificou usar o SDK da
// AWS para o R2), e evitar a dependência nova mantém este adapter no mesmo
// estilo dos outros clients HTTP do projeto (MercadoLivreApiClient,
// NuvemshopApiClient), todos sobre fetch. Se o SDK oficial vier a ganhar
// funcionalidade que valha a pena (streaming, retry configurável), trocar é
// uma mudança isolada a este arquivo.
//
// Structured output via tool-use (não "peça JSON no prompt e faça regex
// depois"): a Anthropic valida a resposta contra o JSON Schema da tool antes
// de devolver — reduz (mas não elimina, ver validateSuggestion) a
// necessidade de validação do nosso lado.
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_API_VERSION = '2023-06-01';
const MAX_TOKENS = 4096;
const TOOL_NAME = 'suggest_campaign_actions';

// Enum fechado de propósito (ver comentário na porta): hoje só PAUSE_CAMPAIGN
// tem um método de escrita implementado em AdsActionCapableProvider — pedir
// à IA por ações que não sabemos executar geraria sugestões que
// AdsActionDispatcherService só descartaria depois (FAILED por "nenhum
// provider sabe executar"). Melhor nunca oferecer a opção.
const SUPPORTED_ACTION_TYPES: readonly CampaignOptimizationActionType[] = ['PAUSE_CAMPAIGN'];

const MIN_CONFIDENCE_FOR_STRUCTURAL_VALIDITY = 0; // validação estrutural só (0-1); o filtro de negócio (ADS_AI_MIN_CONFIDENCE) é feito por AdsAiOptimizationService, não aqui.

const SYSTEM_PROMPT = `Você é um analista de mídia paga (ads) que assiste um dono de e-commerce brasileiro a
decidir o que fazer com campanhas de anúncios patrocinados. Você NUNCA executa ações —
você só recomenda, e um humano decide se aplica.

REGRA MAIS IMPORTANTE: seja conservador. Errar por excesso de cautela (deixar de
sugerir algo que ajudaria) é MUITO menos custoso do que errar por excesso de
agressividade (sugerir pausar uma campanha que na verdade estava se recuperando, ou
reduzir o lance de uma campanha sazonalmente lenta que vai vender bem no fim de semana).
Na dúvida, não sugira nada para aquela campanha.

CONTEXTO QUE VOCÊ RECEBE, por campanha, nos últimos 30 dias (agregado do período, não
série diária):
- nome, canal, status atual
- spend, revenueAds, clicks, impressions
- roas (receita_ads / spend; null se spend = 0)
- tier já classificado por regra determinística: ESTRELA, PONTO_DE_ATENCAO,
  CUSTO_PERDIDO ou SEM_DADOS (campanhas SEM_DADOS não são enviadas a você — dado
  insuficiente não é sinal)
- meta de ROAS do tenant (targetRoas) — o número abaixo do qual a campanha está
  destruindo margem, não só "abaixo do ideal"
- TACOS atual do tenant (gasto de ads / receita total), se disponível

O QUE VOCÊ PODE SUGERIR (actionType), no máximo um por campanha:
- PAUSE_CAMPAIGN: só quando o tier já é CUSTO_PERDIDO E o ROAS está claramente abaixo
  da meta (não só levemente) — pausar é a ação mais drástica disponível, use com
  parcimônia. Esta é a ÚNICA ação disponível nesta versão do sistema.

O QUE VOCÊ NUNCA FAZ:
- Nunca sugere ação para uma campanha que não está na lista recebida
- Nunca inventa um campaignId que não estava na lista que você recebeu
- Nunca devolve confidenceScore acima de 0.5 se o padrão observado for ambíguo ou
  contraditório entre as métricas (ex.: ROAS ruim mas volume de cliques crescendo forte)
- Se nenhuma campanha justificar uma ação, devolva a lista de sugestões vazia — isso
  é o resultado CORRETO e esperado na maioria das execuções, não uma falha sua

FORMATO DE SAÍDA: responda SOMENTE com uma chamada da ferramenta
"${TOOL_NAME}", no schema JSON fornecido. Todo campo "reasoning" deve
citar pelo menos um número concreto dos dados que você recebeu (ROAS, spend,
percentual) — nunca uma justificativa genérica como "a campanha não está performando
bem".`;

// AnthropicToolUseBlock ESTENDE (não apenas se parece com) o tipo genérico de
// bloco abaixo — precisa herdar a mesma assinatura de índice `[key: string]:
// unknown` para que o type predicate em `suggestActions` (block is
// AnthropicToolUseBlock) seja estruturalmente atribuível ao parâmetro
// genérico que o .find() recebe; sem a assinatura de índice compartilhada, o
// TypeScript rejeita o predicate (TS2677) mesmo os campos sendo compatíveis.
interface AnthropicContentBlock {
  type: string;
  [key: string]: unknown;
}

interface AnthropicToolUseBlock extends AnthropicContentBlock {
  type: 'tool_use';
  name: string;
  input: unknown;
}

interface AnthropicMessageResponse {
  content?: AnthropicContentBlock[];
  stop_reason?: string;
}

@Injectable()
export class AnthropicCampaignAdvisor implements CampaignOptimizationAdvisor {
  private readonly logger = new Logger(AnthropicCampaignAdvisor.name);

  async suggestActions(request: CampaignOptimizationRequest): Promise<CampaignOptimizationResponse> {
    if (request.campaigns.length === 0) {
      return { suggestions: [] };
    }

    const apiKey = requireAiEnv('ANTHROPIC_API_KEY');
    const model = process.env.ADS_AI_MODEL || 'claude-sonnet-4-5';

    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_API_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: this.buildUserMessage(request) }],
        tools: [this.buildToolDefinition()],
        tool_choice: { type: 'tool', name: TOOL_NAME },
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Anthropic API retornou HTTP ${response.status}: ${body}`);
    }

    const payload = (await response.json()) as AnthropicMessageResponse;
    const toolUse = (payload.content || []).find((block): block is AnthropicToolUseBlock => block.type === 'tool_use');
    if (!toolUse) {
      // Modelo respondeu sem chamar a tool (ex.: recusou, ou stop_reason
      // diferente do esperado) — tratado como falha explícita, nunca como
      // "sem sugestões" silencioso, para que AdsAiOptimizationService
      // registre isso como uma falha de ciclo, não como um resultado normal.
      throw new Error(`Anthropic API não devolveu uma chamada da tool "${TOOL_NAME}" (stop_reason: ${payload.stop_reason ?? 'desconhecido'}).`);
    }

    return this.parseAndValidate(toolUse.input, request);
  }

  private buildUserMessage(request: CampaignOptimizationRequest): string {
    const campaignsData = request.campaigns.map((c) => ({
      campaignId: c.campaignId,
      channelCode: c.channelCode,
      name: c.name,
      status: c.status,
      tier: c.tier,
      roas: c.roas,
      spend: c.totals.spend,
      revenueAds: c.totals.revenueAds,
      clicks: c.totals.clicks,
      impressions: c.totals.impressions,
    }));
    return JSON.stringify({ targetRoas: request.targetRoas, tacos: request.tacos, campaigns: campaignsData });
  }

  private buildToolDefinition() {
    return {
      name: TOOL_NAME,
      description: 'Devolve sugestões conservadoras de ação para as campanhas de ads recebidas, ou uma lista vazia se nenhuma justificar ação.',
      input_schema: {
        type: 'object',
        properties: {
          suggestions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                campaignId: { type: 'string', description: 'Deve ser exatamente um dos campaignId recebidos no input.' },
                actionType: { type: 'string', enum: SUPPORTED_ACTION_TYPES as unknown as string[] },
                reasoning: { type: 'string', minLength: 20, description: 'Precisa citar pelo menos um número concreto dos dados recebidos.' },
                confidenceScore: { type: 'number', minimum: 0, maximum: 1 },
                metadata: { type: 'object', description: 'Contexto quantitativo opcional que embasou a sugestão.' },
              },
              required: ['campaignId', 'actionType', 'reasoning', 'confidenceScore'],
            },
          },
        },
        required: ['suggestions'],
      },
    };
  }

  // Segunda camada de validação, mesmo já passando pelo JSON Schema da
  // Anthropic — mesma disciplina de "nunca confiar cegamente numa resposta
  // externa" já usada em MercadoLivreApiClient (pickString/pickNumber).
  // O schema garante FORMA; esta função garante que o CONTEÚDO faz sentido
  // no nosso domínio (campaignId pertence à lista enviada, actionType é algo
  // que sabemos executar).
  private parseAndValidate(rawInput: unknown, request: CampaignOptimizationRequest): CampaignOptimizationResponse {
    if (typeof rawInput !== 'object' || rawInput === null || !Array.isArray((rawInput as { suggestions?: unknown }).suggestions)) {
      throw new Error('Resposta da Anthropic fora do formato esperado: "suggestions" ausente ou não é um array.');
    }

    const knownCampaignIds = new Set(request.campaigns.map((c) => c.campaignId));
    const rawSuggestions = (rawInput as { suggestions: unknown[] }).suggestions;
    const suggestions: CampaignOptimizationSuggestion[] = [];

    for (const raw of rawSuggestions) {
      const suggestion = this.validateSuggestion(raw, knownCampaignIds);
      if (suggestion) {
        suggestions.push(suggestion);
      }
    }

    return { suggestions };
  }

  private validateSuggestion(raw: unknown, knownCampaignIds: Set<string>): CampaignOptimizationSuggestion | null {
    if (typeof raw !== 'object' || raw === null) {
      this.logger.warn('Sugestão descartada: item não é um objeto.');
      return null;
    }
    const s = raw as Record<string, unknown>;

    const campaignId = typeof s.campaignId === 'string' ? s.campaignId : null;
    if (!campaignId || !knownCampaignIds.has(campaignId)) {
      this.logger.warn(`Sugestão descartada: campaignId "${String(s.campaignId)}" não pertence à lista enviada.`);
      return null;
    }

    const actionType = typeof s.actionType === 'string' ? s.actionType : null;
    if (!actionType || !SUPPORTED_ACTION_TYPES.includes(actionType as CampaignOptimizationActionType)) {
      this.logger.warn(`Sugestão descartada para ${campaignId}: actionType "${String(s.actionType)}" não é suportado.`);
      return null;
    }

    const reasoning = typeof s.reasoning === 'string' ? s.reasoning : null;
    if (!reasoning || reasoning.length < 20 || !/\d/.test(reasoning)) {
      this.logger.warn(`Sugestão descartada para ${campaignId}: reasoning ausente, curto demais, ou sem número concreto.`);
      return null;
    }

    const confidenceScore = typeof s.confidenceScore === 'number' ? s.confidenceScore : NaN;
    if (Number.isNaN(confidenceScore) || confidenceScore < MIN_CONFIDENCE_FOR_STRUCTURAL_VALIDITY || confidenceScore > 1) {
      this.logger.warn(`Sugestão descartada para ${campaignId}: confidenceScore inválido (${String(s.confidenceScore)}).`);
      return null;
    }

    const metadata = typeof s.metadata === 'object' && s.metadata !== null ? (s.metadata as Record<string, unknown>) : undefined;

    return {
      campaignId,
      actionType: actionType as CampaignOptimizationActionType,
      reasoning,
      confidenceScore,
      metadata,
    };
  }
}
