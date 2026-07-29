// Expedição em lote (Fase 5, benchmark Tiny ERP, 29/07/2026) — ver
// docs/tiny-erp-benchmark-analysis.md, seção 1.2, e
// docs/dispatch-batch-architecture.md. Só o TIPO e as funções PURAS que
// decidem o que é permitido fazer — nenhuma chamada a Prisma/HTTP aqui,
// mesmo racional de stock-movement-audit-event.entity.ts.
export type DispatchBatchStatus = 'ABERTO' | 'ETIQUETADO' | 'DESPACHADO' | 'CANCELADO';
export type DispatchBatchOrderStatus = 'PENDENTE' | 'ETIQUETADO' | 'ERRO';

export interface DispatchBatch {
  id: string;
  tenantId: string;
  formaEnvio: string;
  status: DispatchBatchStatus;
  requestedByUserId: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  concludedAt: Date | null;
}

export interface DispatchBatchOrder {
  id: string;
  tenantId: string;
  dispatchBatchId: string;
  orderId: string;
  status: DispatchBatchOrderStatus;
  externalLabelId: string | null;
  trackingCode: string | null;
  labelUrl: string | null;
  errorMessage: string | null;
  labeledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GateCheck {
  ok: boolean;
  reason?: string;
}

// "Forma de envio" (mesmo campo único do Olist, ver screenshot de referência
// do usuário, 29/07/2026) — string livre no schema, mas a APLICAÇÃO precisa
// saber, a partir dela, se existe algum provider para chamar automaticamente
// e, se sim, qual capacidade/canal. Esta tabela é o ÚNICO lugar que faz essa
// tradução — nunca um if/else espalhado pelo resto do módulo.
//
// NATIVE_MARKETPLACE: a etiqueta é buscada no PRÓPRIO canal de origem do
// pedido (ShippingLabelCapableProvider, ver marketplace-provider.contract.ts)
// — só funciona se o pedido do lote for DAQUELE canal.
// GENERIC_FREIGHT: etiqueta via transportadora avulsa (FreightLabelProvider,
// módulo freight-shipping) — funciona para pedido de qualquer canal, mas
// exige conexão configurada E dados que o Kyneti hoje não captura de forma
// estruturada (endereço do destinatário) — ver aviso de honestidade em
// docs/dispatch-batch-architecture.md.
// NONE: forma puramente organizacional — o lote é despachado sem nenhuma
// chamada de API (o operador imprime/gera a etiqueta por fora do Kyneti).
export type LabelStrategy = 'NATIVE_MARKETPLACE' | 'GENERIC_FREIGHT' | 'NONE';

export interface LabelStrategyResolution {
  strategy: LabelStrategy;
  // Preenchido só quando strategy = NATIVE_MARKETPLACE — o channelCode que o
  // pedido do lote precisa ter para esta forma de envio fazer sentido.
  requiredChannelCode?: string;
  // Preenchido só quando strategy = GENERIC_FREIGHT — o providerCode a
  // consultar em FreightProviderConnection.
  freightProviderCode?: string;
}

// Tabela de tradução — ver comentário do tipo acima. TIKTOK_SHIPPING/
// MAGALU_ENTREGAS/AMAZON_DBA aparecem no dropdown de referência do Olist mas
// ficam NONE aqui: o Kyneti ainda não tem conexão com esses canais (Ads Fase
// 0 em standby) — não inventamos uma capacidade que não existe. OLIST_ENVIOS/
// NUVEM_ENVIO também ficam NONE: nenhuma API pública de terceiro foi
// encontrada para esses dois produtos (são internos do próprio ERP Olist/
// Nuvemshop) — gap documentado, não um esquecimento.
const LABEL_STRATEGY_BY_FORMA_ENVIO: Record<string, LabelStrategyResolution> = {
  MERCADO_ENVIOS: { strategy: 'NATIVE_MARKETPLACE', requiredChannelCode: 'MERCADO_LIVRE' },
  SHOPEE_ENVIOS: { strategy: 'NATIVE_MARKETPLACE', requiredChannelCode: 'SHOPEE' },
  CORREIOS: { strategy: 'GENERIC_FREIGHT', freightProviderCode: 'CORREIOS' },
  MELHOR_ENVIO: { strategy: 'GENERIC_FREIGHT', freightProviderCode: 'MELHOR_ENVIO' },
  FRENET: { strategy: 'GENERIC_FREIGHT', freightProviderCode: 'FRENET' },
  TRANSPORTADORA: { strategy: 'NONE' },
  RETIRAR_PESSOALMENTE: { strategy: 'NONE' },
  RETIRADO_NO_LOCAL: { strategy: 'NONE' },
  MOTOBOY: { strategy: 'NONE' },
  OLIST_ENVIOS: { strategy: 'NONE' },
  NUVEM_ENVIO: { strategy: 'NONE' },
  TIKTOK_SHIPPING: { strategy: 'NONE' },
  MAGALU_ENTREGAS: { strategy: 'NONE' },
  AMAZON_DBA: { strategy: 'NONE' },
};

// Valor desconhecido (tenant digitou uma forma de envio nova, ainda não
// mapeada) cai em NONE por padrão — nunca lança erro aqui: uma forma de envio
// nova é sempre válida como organização de lote, só não ganha automação até
// alguém adicionar uma linha nesta tabela (ou, no caso de transportadora
// avulsa, cadastrar a FreightProviderConnection e o providerCode bater).
export function resolveLabelStrategy(formaEnvio: string): LabelStrategyResolution {
  return LABEL_STRATEGY_BY_FORMA_ENVIO[formaEnvio.toUpperCase()] ?? { strategy: 'NONE' };
}

// Exportado para o Catálogo de Transportador/Serviço (Projeto Estruturante
// 5, freight-shipping/domain/carrier-catalog.ts) validar o `automationCode`
// de um CarrierService cadastrado — nunca duplicar esta lista noutro lugar.
// Import cross-módulo de FUNÇÃO/CONSTANTE pura (não de classe via DI), mesmo
// racional de ProductionOrderService importando resolveComponentRequirements
// direto do domínio do Catalog.
export const KNOWN_FORMA_ENVIO_CODES: string[] = Object.keys(LABEL_STRATEGY_BY_FORMA_ENVIO);

export function canAddOrderToBatch(
  batch: Pick<DispatchBatch, 'status'>,
  existingActiveLinkForOrder: Pick<DispatchBatchOrder, 'dispatchBatchId'> | null,
): GateCheck {
  if (batch.status !== 'ABERTO') {
    return { ok: false, reason: `Lote já está ${batch.status} — não é possível adicionar pedidos.` };
  }
  if (existingActiveLinkForOrder) {
    return { ok: false, reason: 'Este pedido já está em outro lote de expedição em aberto.' };
  }
  return { ok: true };
}

// Gate de elegibilidade central: um pedido só entra num lote se já tiver
// passado pela conferência do Pick & Pack (StockMovementAuditEvent
// RETAIL_SHIPMENT, conferenceStatus = APROVADO) — nunca antes disso. Isso é
// o que preserva a auditoria por pedido (vídeo + checklist, Sprint 27) como
// pré-requisito da expedição em lote, em vez de substituí-la.
export function canIncludeInDispatchBatch(auditEvent: { eventType: string; conferenceStatus: string } | null): GateCheck {
  if (!auditEvent) {
    return { ok: false, reason: 'Pedido ainda não tem um evento de conferência (RETAIL_SHIPMENT) registrado — passe pelo Pick & Pack antes.' };
  }
  if (auditEvent.eventType !== 'RETAIL_SHIPMENT') {
    return { ok: false, reason: 'Evento de conferência deste pedido não é do tipo RETAIL_SHIPMENT.' };
  }
  if (auditEvent.conferenceStatus !== 'APROVADO') {
    return { ok: false, reason: `Conferência do Pick & Pack ainda está ${auditEvent.conferenceStatus} — aprove antes de incluir no lote.` };
  }
  return { ok: true };
}

export function canGenerateLabelForOrder(link: Pick<DispatchBatchOrder, 'status'>): GateCheck {
  if (link.status === 'ETIQUETADO') {
    return { ok: false, reason: 'Etiqueta já gerada para este pedido — remova do lote e adicione de novo para tentar outra vez.' };
  }
  return { ok: true };
}

// Um lote só pode ser CONCLUÍDO (despachado) quando TODO pedido dele já está
// ETIQUETADO ou quando a própria forma de envio não gera etiqueta real
// (strategy NONE — ver resolveLabelStrategy) e portanto nunca sairia do
// PENDENTE por conta própria; nesse caso o gate aceita PENDENTE também, já
// que a confirmação é inteiramente manual (o operador despachou por fora).
export function canConcludeBatch(
  batch: Pick<DispatchBatch, 'status' | 'formaEnvio'>,
  orders: Pick<DispatchBatchOrder, 'status'>[],
): GateCheck {
  if (batch.status !== 'ABERTO' && batch.status !== 'ETIQUETADO') {
    return { ok: false, reason: `Lote já está ${batch.status} — não pode ser concluído de novo.` };
  }
  if (orders.length === 0) {
    return { ok: false, reason: 'Lote sem nenhum pedido — adicione ao menos um pedido antes de concluir.' };
  }
  const { strategy } = resolveLabelStrategy(batch.formaEnvio);
  if (strategy === 'NONE') {
    return { ok: true };
  }
  const pending = orders.filter((o) => o.status !== 'ETIQUETADO');
  if (pending.length > 0) {
    return { ok: false, reason: `${pending.length} pedido(s) do lote ainda sem etiqueta gerada.` };
  }
  return { ok: true };
}

export function canCancelBatch(batch: Pick<DispatchBatch, 'status'>): GateCheck {
  if (batch.status === 'DESPACHADO' || batch.status === 'CANCELADO') {
    return { ok: false, reason: `Lote já está ${batch.status} — não pode ser cancelado.` };
  }
  return { ok: true };
}
