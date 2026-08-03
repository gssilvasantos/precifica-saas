import {
  CommissionBase,
  FeeRulePayload,
  FeeTier,
  ShippingBand,
  ShippingPolicyPayload,
} from './marketplace-rule.entity';

const COMMISSION_BASES: readonly CommissionBase[] = ['ITEM_PRICE', 'ITEM_PRICE_PLUS_SHIPPING'];

// Cada ruleType tem um validador próprio, aplicado ANTES de qualquer
// persistência — é isso que garante que o JSONB flexível de MarketplaceRule
// nunca vira lixo estruturado (seção 3.4 do documento de arquitetura do
// módulo). Validação manual e explícita em vez de uma lib nova: são poucos
// campos, e o erro precisa ser legível para quem for revisar um candidato
// PENDENTE_VALIDACAO.
export class InvalidRulePayloadError extends Error {
  constructor(reason: string) {
    super(`Payload de regra inválido: ${reason}`);
    this.name = 'InvalidRulePayloadError';
  }
}

// Limite superior de sanidade para comissão. Ver
// docs/marketplace-fee-model-architecture.md, §3.2: a unidade é FRAÇÃO
// (0.14 = 14%). O validador antigo aceitava 0 a 100, o que fazia um
// percentual cru (14) passar como se fosse 1400% — e os dois consumidores
// (motor de preço e motor de promoções) tratam o valor como fração. Era um
// bug latente esperando a primeira regra real ser importada; rejeitar aqui
// transforma isso em falha barulhenta no momento da importação.
const MAX_COMMISSION_FRACTION = 1;

function requireNonNegativeNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new InvalidRulePayloadError(`${field} precisa ser um número >= 0`);
  }
  return value;
}

function validateCommissionFraction(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new InvalidRulePayloadError(`${field} precisa ser um número >= 0`);
  }
  if (value > MAX_COMMISSION_FRACTION) {
    throw new InvalidRulePayloadError(
      `${field} precisa ser uma FRAÇÃO entre 0 e 1 (0.14 = 14%) — recebido ${value}. ` +
        'Se o valor veio como percentual da API do canal, o provider precisa dividir por 100 antes de montar o candidato.',
    );
  }
  return value;
}

function validateTier(raw: unknown, index: number): FeeTier {
  if (typeof raw !== 'object' || raw === null) {
    throw new InvalidRulePayloadError(`tiers[${index}] precisa ser um objeto`);
  }
  const candidate = raw as Record<string, unknown>;

  const minPrice = requireNonNegativeNumber(candidate.minPrice, `tiers[${index}].minPrice`);

  let maxPrice: number | null;
  if (candidate.maxPrice === null || candidate.maxPrice === undefined) {
    maxPrice = null;
  } else {
    maxPrice = requireNonNegativeNumber(candidate.maxPrice, `tiers[${index}].maxPrice`);
    if (maxPrice <= minPrice) {
      throw new InvalidRulePayloadError(
        `tiers[${index}]: maxPrice (${maxPrice}) precisa ser maior que minPrice (${minPrice})`,
      );
    }
  }

  return {
    minPrice,
    maxPrice,
    commissionPct: validateCommissionFraction(candidate.commissionPct, `tiers[${index}].commissionPct`),
    fixedFeeAmount: requireNonNegativeNumber(candidate.fixedFeeAmount, `tiers[${index}].fixedFeeAmount`),
    // Tarifa que o plano do canal isenta (Amazon: R$2/item no Individual).
    // Ausente = 0, o que descreve corretamente os canais sem plano.
    planWaivablePerItemFee:
      candidate.planWaivablePerItemFee === undefined
        ? undefined
        : requireNonNegativeNumber(candidate.planWaivablePerItemFee, `tiers[${index}].planWaivablePerItemFee`),
  };
}

// A tabela precisa cobrir TODA a reta de preços a partir de 0, sem buraco e
// sem sobreposição — do contrário existiria um preço para o qual o sistema
// não sabe a comissão, e "não sei" no meio de um cálculo de piso vira um
// número inventado. Melhor rejeitar a regra inteira na importação.
function validateTierContinuity(tiers: FeeTier[]): void {
  if (tiers.length === 0) {
    throw new InvalidRulePayloadError('tiers precisa ter pelo menos uma faixa');
  }

  const sorted = [...tiers].sort((a, b) => a.minPrice - b.minPrice);

  if (sorted[0].minPrice !== 0) {
    throw new InvalidRulePayloadError(
      `a primeira faixa precisa começar em 0 (recebido ${sorted[0].minPrice}) — do contrário existe preço sem comissão definida`,
    );
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i];
    const next = sorted[i + 1];
    if (current.maxPrice === null) {
      throw new InvalidRulePayloadError(
        `só a última faixa pode ter maxPrice null — a faixa que começa em ${current.minPrice} não é a última`,
      );
    }
    if (current.maxPrice !== next.minPrice) {
      throw new InvalidRulePayloadError(
        `faixas precisam ser contíguas: a que termina em ${current.maxPrice} não encosta na que começa em ${next.minPrice}`,
      );
    }
  }

  if (sorted[sorted.length - 1].maxPrice !== null) {
    throw new InvalidRulePayloadError(
      `a última faixa precisa ter maxPrice null (sem teto) — recebido ${sorted[sorted.length - 1].maxPrice}`,
    );
  }
}

// Compatibilidade retroativa: regras gravadas no formato escalar antigo
// ({ commissionPct, fixedFeeAmount }) são normalizadas para uma tabela de
// uma faixa só, cobrindo toda a reta. Isso evita migração de dado — a
// normalização acontece na LEITURA, então o contentHash de uma regra
// antiga continua batendo com ela mesma e o sync não gera versão nova
// falsa.
//
// A conversão de unidade NÃO é feita aqui de propósito: um payload antigo
// com commissionPct = 11.5 é ambíguo (11,5% ou 1150%?), e adivinhar seria
// pior que falhar. Ele é rejeitado pelo validador de fração, com mensagem
// dizendo o que fazer — regra antiga inválida precisa ser reimportada, o
// que o provider faz sozinho no próximo sync.
function normalizeLegacyScalarPayload(candidate: Record<string, unknown>): FeeTier[] {
  return [
    {
      minPrice: 0,
      maxPrice: null,
      commissionPct: validateCommissionFraction(candidate.commissionPct, 'commissionPct'),
      fixedFeeAmount: requireNonNegativeNumber(candidate.fixedFeeAmount, 'fixedFeeAmount'),
    },
  ];
}

export function validateFeeRulePayload(raw: unknown): FeeRulePayload {
  if (typeof raw !== 'object' || raw === null) {
    throw new InvalidRulePayloadError('payload precisa ser um objeto');
  }
  const candidate = raw as Record<string, unknown>;

  const tiers = Array.isArray(candidate.tiers)
    ? candidate.tiers.map((tier, index) => validateTier(tier, index))
    : normalizeLegacyScalarPayload(candidate);

  validateTierContinuity(tiers);
  tiers.sort((a, b) => a.minPrice - b.minPrice);

  if (candidate.listingTypeId !== undefined && typeof candidate.listingTypeId !== 'string') {
    throw new InvalidRulePayloadError('listingTypeId, quando presente, precisa ser string');
  }
  // Ausente = ITEM_PRICE (6 dos 7 canais mapeados). Só a Amazon precisa
  // declarar ITEM_PRICE_PLUS_SHIPPING explicitamente.
  const commissionBase = (candidate.commissionBase as CommissionBase | undefined) ?? 'ITEM_PRICE';
  if (!COMMISSION_BASES.includes(commissionBase)) {
    throw new InvalidRulePayloadError(
      `commissionBase precisa ser um de: ${COMMISSION_BASES.join(', ')} — recebido ${String(candidate.commissionBase)}`,
    );
  }
  if (
    candidate.commissionCapAmount !== undefined &&
    candidate.commissionCapAmount !== null &&
    (typeof candidate.commissionCapAmount !== 'number' || candidate.commissionCapAmount <= 0)
  ) {
    throw new InvalidRulePayloadError('commissionCapAmount, quando presente, precisa ser número > 0 ou null');
  }
  if (candidate.referencePrice !== undefined && typeof candidate.referencePrice !== 'number') {
    throw new InvalidRulePayloadError('referencePrice, quando presente, precisa ser número');
  }

  return {
    tiers,
    commissionBase,
    listingTypeId: candidate.listingTypeId as string | undefined,
    commissionCapAmount: (candidate.commissionCapAmount as number | null | undefined) ?? null,
    referencePrice: candidate.referencePrice as number | undefined,
  };
}

function validateShippingBand(raw: unknown, index: number): ShippingBand {
  if (typeof raw !== 'object' || raw === null) {
    throw new InvalidRulePayloadError(`bands[${index}] precisa ser um objeto`);
  }
  const candidate = raw as Record<string, unknown>;

  const minPrice = requireNonNegativeNumber(candidate.minPrice, `bands[${index}].minPrice`);

  let maxPrice: number | null;
  if (candidate.maxPrice === null || candidate.maxPrice === undefined) {
    maxPrice = null;
  } else {
    maxPrice = requireNonNegativeNumber(candidate.maxPrice, `bands[${index}].maxPrice`);
    if (maxPrice <= minPrice) {
      throw new InvalidRulePayloadError(
        `bands[${index}]: maxPrice (${maxPrice}) precisa ser maior que minPrice (${minPrice})`,
      );
    }
  }

  if (typeof candidate.freeShippingRequired !== 'boolean') {
    throw new InvalidRulePayloadError(`bands[${index}].freeShippingRequired precisa ser boolean`);
  }

  const channelSubsidyPct = requireNonNegativeNumber(candidate.channelSubsidyPct, `bands[${index}].channelSubsidyPct`);
  if (channelSubsidyPct > 1) {
    throw new InvalidRulePayloadError(
      `bands[${index}].channelSubsidyPct precisa ser uma FRAÇÃO entre 0 e 1 (0.6 = 60%) — recebido ${channelSubsidyPct}`,
    );
  }

  let channelSubsidyCapAmount: number | null = null;
  if (candidate.channelSubsidyCapAmount !== null && candidate.channelSubsidyCapAmount !== undefined) {
    channelSubsidyCapAmount = requireNonNegativeNumber(
      candidate.channelSubsidyCapAmount,
      `bands[${index}].channelSubsidyCapAmount`,
    );
  }

  return { minPrice, maxPrice, freeShippingRequired: candidate.freeShippingRequired, channelSubsidyPct, channelSubsidyCapAmount };
}

// Mesma exigência de cobertura total da FEE_RULE, pelo mesmo motivo:
// existir um preço para o qual não se sabe quem paga o frete significaria
// adivinhar no meio do cálculo de piso.
function validateBandContinuity(bands: ShippingBand[]): void {
  if (bands.length === 0) {
    throw new InvalidRulePayloadError('bands precisa ter pelo menos uma faixa');
  }

  const sorted = [...bands].sort((a, b) => a.minPrice - b.minPrice);

  if (sorted[0].minPrice !== 0) {
    throw new InvalidRulePayloadError(
      `a primeira faixa de frete precisa começar em 0 (recebido ${sorted[0].minPrice})`,
    );
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].maxPrice === null) {
      throw new InvalidRulePayloadError(
        `só a última faixa de frete pode ter maxPrice null — a que começa em ${sorted[i].minPrice} não é a última`,
      );
    }
    if (sorted[i].maxPrice !== sorted[i + 1].minPrice) {
      throw new InvalidRulePayloadError(
        `faixas de frete precisam ser contíguas: a que termina em ${sorted[i].maxPrice} não encosta na que começa em ${sorted[i + 1].minPrice}`,
      );
    }
  }

  if (sorted[sorted.length - 1].maxPrice !== null) {
    throw new InvalidRulePayloadError('a última faixa de frete precisa ter maxPrice null (sem teto)');
  }
}

export function validateShippingPolicyPayload(raw: unknown): ShippingPolicyPayload {
  if (typeof raw !== 'object' || raw === null) {
    throw new InvalidRulePayloadError('payload precisa ser um objeto');
  }
  const candidate = raw as Record<string, unknown>;

  if (!Array.isArray(candidate.bands)) {
    throw new InvalidRulePayloadError('bands precisa ser um array de faixas de frete');
  }

  const bands = candidate.bands.map((band, index) => validateShippingBand(band, index));
  validateBandContinuity(bands);
  bands.sort((a, b) => a.minPrice - b.minPrice);

  return { bands };
}

// Registro simples ruleType -> validador. Novo ruleType = nova entrada aqui,
// nunca uma tabela nova (a tabela MarketplaceRule já é genérica).
export const RULE_PAYLOAD_VALIDATORS: Record<string, (raw: unknown) => unknown> = {
  FEE_RULE: validateFeeRulePayload,
  SHIPPING_POLICY: validateShippingPolicyPayload,
};
