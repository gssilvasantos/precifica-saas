// Trilha de auditoria de campos de GOVERNANÇA do Product — ver comentário no
// model ProductAuditLog (prisma/schema.prisma) para o racional completo de
// por que este mecanismo é NOVO (não existia nenhum equivalente genérico no
// projeto antes da Política de Preço Mínimo).
export type ProductAuditSource = 'MANUAL' | 'BULK_IMPORT';

// Campos de GOVERNANÇA do Product que precisam de trilha de auditoria —
// hoje só mapPrice (Política de Preço Mínimo). Deliberadamente uma lista
// pequena e explícita, não "audita qualquer campo alterado": os demais
// campos do Product (nome, peso, dimensões, margens...) já têm seus
// próprios mecanismos de proveniência (ver product-ownership-rules.ts,
// ERP_OWNED_FIELDS) e não precisam de uma trilha "quem mudou, quando" —
// mapPrice precisa porque uma mudança aqui tem implicação
// contratual/legal direta com o fornecedor, não só operacional interna.
export const GOVERNANCE_AUDITED_FIELDS = ['mapPrice'] as const;
export type GovernanceAuditedField = (typeof GOVERNANCE_AUDITED_FIELDS)[number];

export interface ProductAuditEntryInput {
  productId: string;
  skuCode: string;
  field: GovernanceAuditedField;
  oldValue: number | null;
  newValue: number | null;
}

// Função pura: dado o produto ANTES do update e o input recebido, devolve
// as entradas de auditoria que precisam ser gravadas — vazio se nenhum
// campo de governança mudou de fato. Comparação por VALOR (não por
// presença da chave no input): reenviar o MESMO mapPrice não gera um
// registro de auditoria vazio/ruidoso. `input.mapPrice === undefined`
// significa "campo não tocado neste update" (semântica de PATCH parcial já
// usada em todo o resto do projeto) — só `undefined` é ignorado; `null`
// explícito (limpar o MAP) é uma mudança real quando o valor anterior não
// era null.
export function diffGovernanceFields(
  current: { id: string; skuCode: string; mapPrice: number | null },
  input: { mapPrice?: number | null },
): ProductAuditEntryInput[] {
  const entries: ProductAuditEntryInput[] = [];

  if (input.mapPrice !== undefined && input.mapPrice !== current.mapPrice) {
    entries.push({
      productId: current.id,
      skuCode: current.skuCode,
      field: 'mapPrice',
      oldValue: current.mapPrice,
      newValue: input.mapPrice,
    });
  }

  return entries;
}
