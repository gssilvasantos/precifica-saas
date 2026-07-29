// Benchmark Tiny ERP (28/07/2026, docs/tiny-erp-benchmark-analysis.md, seção
// 4/Fase 0) — sistema de marcadores genérico. Ver prisma/schema.prisma,
// models Tag/TagAssignment, para o racional completo do desenho (schema
// próprio "tagging", referência solta via entityId).
//
// Conjunto fechado — cada novo tipo marcável é uma decisão de produto
// nossa (migration), nunca um dado externo. "FIXED_EXPENSE" cobre despesa
// fixa recorrente (aluguel, folha); "ACCOUNTS_PAYABLE" (28/07/2026,
// benchmark Tiny ERP, Fase 1) cobre o módulo novo de Contas a Pagar
// propriamente dito (fornecedor/vencimento/baixa) — são entidades
// diferentes (ver financial-intelligence/domain/accounts-payable.entity.ts),
// cada uma com seu próprio valor aqui.
export type TaggableEntityType = 'PRODUCT' | 'ORDER' | 'FIXED_EXPENSE' | 'ACCOUNTS_PAYABLE';

// Fonte única de verdade da lista — usada tanto para validar entityType
// recebido via path param (não passa por class-validator, ao contrário de
// campos de @Body()) quanto para qualquer lugar que precise iterar os tipos.
export const TAGGABLE_ENTITY_TYPES: readonly TaggableEntityType[] = [
  'PRODUCT',
  'ORDER',
  'FIXED_EXPENSE',
  'ACCOUNTS_PAYABLE',
];

export function isValidTaggableEntityType(value: string): value is TaggableEntityType {
  return (TAGGABLE_ENTITY_TYPES as readonly string[]).includes(value);
}

export interface Tag {
  id: string;
  tenantId: string;
  name: string;
  color: string | null;
  createdAt: Date;
}

export interface TagCreateData {
  tenantId: string;
  name: string;
  color?: string | null;
}

export interface TagAssignment {
  id: string;
  tenantId: string;
  tagId: string;
  entityType: TaggableEntityType;
  entityId: string;
  createdAt: Date;
}

export function isValidTagName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= 50;
}

// Hex de 3 ou 6 dígitos, com # — validação de FORMA só (nunca bloqueia por
// paleta específica; cor é livre, mesmo racional de location no depósito).
const HEX_COLOR_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isValidTagColor(color: string): boolean {
  return HEX_COLOR_PATTERN.test(color);
}
