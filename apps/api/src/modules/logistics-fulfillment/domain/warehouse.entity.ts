// Depósito único, tipado — o físico (galpão do próprio vendedor, sempre um
// por tenant) e cada CD virtual do Full (um por marketplace com Full
// habilitado) são a MESMA entidade, distinguida só por `type`/`channelCode`.
// Nunca duas tabelas separadas — o saldo de qualquer um dos dois vem da
// mesma fonte (StockLedgerEntry), então tratá-los como o mesmo conceito
// evita duplicar toda a lógica de ledger/transferência.
export type WarehouseType = 'PHYSICAL' | 'VIRTUAL_FULL';

export interface Warehouse {
  id: string;
  tenantId: string;
  code: string; // "FISICO_SP", "CD_FULL_ML", "CD_FULL_SHOPEE"
  type: WarehouseType;
  // Preenchido só quando type = VIRTUAL_FULL — qual canal esse CD
  // representa. Nulo em PHYSICAL (o galpão não pertence a canal nenhum).
  channelCode: string | null;
  isActive: boolean;
  // Dias entre despachar do físico e o estoque ficar disponível para venda
  // NESTE depósito — configurável por depósito (Sprint 25), nunca uma
  // constante no código. Consumido por ReplenishmentAdvisorService.
  leadTimeDays: number;
  // Custo operacional deste depósito (picking/armazenagem no Full, manuseio
  // no Físico) — Sprint 26. NÃO inclui embalagem (isso vem do módulo de
  // embalagens, via LogisticsCostReader) — ver
  // docs/promotion-intelligence-architecture.md. Editável via PATCH
  // /logistics-fulfillment/warehouses/:id/logistics-cost.
  logisticsCostPerUnit: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface WarehouseUpsertData {
  tenantId: string;
  code: string;
  type: WarehouseType;
  channelCode?: string | null;
}

// Ponto de partida confirmado com o usuário — usado só na CRIAÇÃO do
// depósito (upsert); depois disso, o valor real vem sempre do banco,
// nunca desta constante (ver updateLeadTimeDays).
export const DEFAULT_LEAD_TIME_DAYS = 15;

// Validação do valor editável via PATCH /warehouses/:id/lead-time — inteiro
// positivo, com um teto largo (90 dias) só para pegar erro de digitação
// óbvio (ex.: 1500), não uma lista fechada de opções: a UI sugere 3/7/15
// como atalhos, mas o usuário pediu controle total sobre a agressividade
// da reposição, não uma escolha travada em 3 valores fixos.
export function isValidLeadTimeDays(days: number): boolean {
  return Number.isInteger(days) && days > 0 && days <= 90;
}

// Validação do valor editável via PATCH /warehouses/:id/logistics-cost
// (Sprint 26) — só exige não-negativo; sem teto arbitrário porque o custo
// operacional real varia muito entre operações (armazenagem de itens
// grandes pode ser bem mais caro que um envelope pequeno).
export function isValidLogisticsCostPerUnit(cost: number): boolean {
  return Number.isFinite(cost) && cost >= 0;
}
