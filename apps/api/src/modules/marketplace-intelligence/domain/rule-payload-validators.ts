import { FeeRulePayload } from './marketplace-rule.entity';

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

export function validateFeeRulePayload(raw: unknown): FeeRulePayload {
  if (typeof raw !== 'object' || raw === null) {
    throw new InvalidRulePayloadError('payload precisa ser um objeto');
  }
  const candidate = raw as Record<string, unknown>;

  if (typeof candidate.commissionPct !== 'number' || candidate.commissionPct < 0 || candidate.commissionPct > 100) {
    throw new InvalidRulePayloadError('commissionPct precisa ser um número entre 0 e 100');
  }
  if (typeof candidate.fixedFeeAmount !== 'number' || candidate.fixedFeeAmount < 0) {
    throw new InvalidRulePayloadError('fixedFeeAmount precisa ser um número >= 0');
  }
  if (candidate.referencePrice !== undefined && typeof candidate.referencePrice !== 'number') {
    throw new InvalidRulePayloadError('referencePrice, quando presente, precisa ser número');
  }
  if (candidate.listingTypeId !== undefined && typeof candidate.listingTypeId !== 'string') {
    throw new InvalidRulePayloadError('listingTypeId, quando presente, precisa ser string');
  }

  return {
    commissionPct: candidate.commissionPct,
    fixedFeeAmount: candidate.fixedFeeAmount,
    referencePrice: candidate.referencePrice as number | undefined,
    listingTypeId: candidate.listingTypeId as string | undefined,
  };
}

// Registro simples ruleType -> validador. Novo ruleType = nova entrada aqui,
// nunca uma tabela nova (a tabela MarketplaceRule já é genérica).
export const RULE_PAYLOAD_VALIDATORS: Record<string, (raw: unknown) => unknown> = {
  FEE_RULE: validateFeeRulePayload,
};
