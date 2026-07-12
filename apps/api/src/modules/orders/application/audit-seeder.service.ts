import { Inject, Injectable, Logger } from '@nestjs/common';
import { ORDER_REPOSITORY, OrderRepository } from './ports/order-repository.port';
import { OrderUpsertData } from '../domain/order.entity';

// Modo de Demonstração / Audit Mode — injeta um conjunto FIXO de 10 pedidos
// fictícios para a auditoria técnica da Shopee e para apresentações do
// sistema (ver docs/audit-mode.md). Cada pedido tem um externalOrderId FIXO
// (DEMO-AUDIT-001..010) e isDemo=true — a mesma chave de negócio
// (tenantId, channelCode, externalOrderId) que o OrderSyncOrchestrator usa
// para upsert idempotente garante que rodar seed() várias vezes NUNCA
// duplica linha, só atualiza as 10 já existentes.
//
// Diferente de um sync real: aqui não existe canal externo nenhum por trás
// (nem OrderCapableProvider, nem OrderSyncOrchestrator) — este serviço fala
// DIRETO com o ORDER_REPOSITORY, com costPrice já vindo como snapshot fixo
// no próprio item (nunca resolvido contra o catálogo real do tenant), para
// que a margem de cada cenário seja determinística e nunca dependa do
// catálogo de produtos verdadeiro da Rita Mazzei Beauty.
export interface AuditSeedResult {
  seeded: number;
  externalOrderIds: string[];
}

export interface AuditClearResult {
  removed: number;
}

export interface AuditStatus {
  totalDemoOrders: number;
}

const DEMO_ORDERED_AT_DAYS_AGO = [20, 18, 16, 14, 12, 3, 25, 9, 7, 1];

function daysAgo(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

@Injectable()
export class AuditSeederService {
  private readonly logger = new Logger(AuditSeederService.name);

  constructor(@Inject(ORDER_REPOSITORY) private readonly orders: OrderRepository) {}

  // As 10 linhas do Audit Mode — cobrem exatamente os cenários pedidos
  // (margem positiva, margem negativa, frete alto, taxas variadas) MAIS um
  // "bônus" de 3 cenários que exercitam a Regra de Ouro de integridade de
  // dados da Etapa 20 (docs/financial-intelligence-architecture.md): um
  // pedido CANCELADO (deve ficar de fora do DRE), um item de custo
  // desconhecido (nunca fabrica margem), e um pedido com taxa zero num
  // canal que normalmente cobra taxa (heurística de suspeita do DRE). Isso
  // dá ao auditor da Shopee uma demonstração completa da disciplina
  // financeira do Kyneti, não só números bonitos.
  private buildScenarios(tenantId: string): OrderUpsertData[] {
    const [d1, d2, d3, d4, d5, d6, d7, d8, d9, d10] = DEMO_ORDERED_AT_DAYS_AGO.map(daysAgo);

    return [
      // 1) Margem POSITIVA alta — Nuvemshop, taxa zero (canal próprio, sem
      // comissão de marketplace), pedido já entregue.
      {
        tenantId,
        channelCode: 'NUVEMSHOP',
        externalOrderId: 'DEMO-AUDIT-001',
        status: 'ENTREGUE',
        externalStatus: 'demo/entregue',
        subtotalAmount: 160,
        shippingAmount: 15,
        discountAmount: 0,
        totalAmount: 175,
        feeAmount: 0,
        netAmount: 175,
        currency: 'BRL',
        orderedAt: d1,
        paidAt: d1,
        shippedAt: daysAgo(17),
        deliveredAt: daysAgo(15),
        items: [
          { skuCode: 'DEMO-SKU-A', externalSku: 'DEMO-SKU-A', productName: 'Sérum Facial Vitamina C (Demo)', quantity: 2, unitPrice: 80, totalPrice: 160, costPrice: 25 },
        ],
      },
      // 2) Margem POSITIVA moderada — Mercado Livre, taxa padrão de
      // marketplace deduzida do repasse.
      {
        tenantId,
        channelCode: 'MERCADO_LIVRE',
        externalOrderId: 'DEMO-AUDIT-002',
        status: 'FATURADO',
        externalStatus: 'demo/paid',
        subtotalAmount: 250,
        shippingAmount: 20,
        discountAmount: 0,
        totalAmount: 270,
        feeAmount: 32,
        netAmount: 238,
        currency: 'BRL',
        orderedAt: d2,
        paidAt: d2,
        items: [
          { skuCode: 'DEMO-SKU-B', externalSku: 'DEMO-SKU-B', productName: 'Kit Skincare Noturno (Demo)', quantity: 1, unitPrice: 250, totalPrice: 250, costPrice: 140 },
        ],
      },
      // 3) Margem NEGATIVA — Shopee, frete subsidiado + cupom + taxa alta
      // corroem a margem até ficar negativa (custo > receita líquida).
      {
        tenantId,
        channelCode: 'SHOPEE',
        externalOrderId: 'DEMO-AUDIT-003',
        status: 'ENTREGUE',
        externalStatus: 'demo/completed',
        subtotalAmount: 90,
        shippingAmount: 25,
        discountAmount: 10,
        totalAmount: 105,
        feeAmount: 18,
        netAmount: 87,
        currency: 'BRL',
        orderedAt: d3,
        paidAt: d3,
        shippedAt: daysAgo(13),
        deliveredAt: daysAgo(10),
        items: [
          { skuCode: 'DEMO-SKU-C', externalSku: 'DEMO-SKU-C', productName: 'Máscara de Argila (Demo)', quantity: 3, unitPrice: 30, totalPrice: 90, costPrice: 35 },
        ],
      },
      // 4) Frete ALTO — Nuvemshop, produto rentável na venda, mas o frete
      // (item volumoso/região remota) domina a narrativa do pedido.
      {
        tenantId,
        channelCode: 'NUVEMSHOP',
        externalOrderId: 'DEMO-AUDIT-004',
        status: 'ENVIADO',
        externalStatus: 'demo/shipped',
        subtotalAmount: 120,
        shippingAmount: 60,
        discountAmount: 0,
        totalAmount: 180,
        feeAmount: 0,
        netAmount: 180,
        currency: 'BRL',
        orderedAt: d4,
        paidAt: d4,
        shippedAt: daysAgo(11),
        items: [
          { skuCode: 'DEMO-SKU-D', externalSku: 'DEMO-SKU-D', productName: 'Kit Presente Grande (Demo)', quantity: 1, unitPrice: 120, totalPrice: 120, costPrice: 70 },
        ],
      },
      // 5) Taxa ALTA/variada — Mercado Livre em anúncio Premium (comissão
      // bem acima da média), corta boa parte da margem bruta.
      {
        tenantId,
        channelCode: 'MERCADO_LIVRE',
        externalOrderId: 'DEMO-AUDIT-005',
        status: 'ENTREGUE',
        externalStatus: 'demo/completed',
        subtotalAmount: 120,
        shippingAmount: 0,
        discountAmount: 0,
        totalAmount: 120,
        feeAmount: 30,
        netAmount: 90,
        currency: 'BRL',
        orderedAt: d5,
        paidAt: d5,
        shippedAt: daysAgo(10),
        deliveredAt: daysAgo(8),
        items: [
          { skuCode: 'DEMO-SKU-E', externalSku: 'DEMO-SKU-E', productName: 'Protetor Solar FPS 60 (Demo)', quantity: 2, unitPrice: 60, totalPrice: 120, costPrice: 35 },
        ],
      },
      // 6) Pedido ainda EM ABERTO — Shopee, mostra a worklist com um pedido
      // "vivo" no Audit Mode, não só histórico já fechado.
      {
        tenantId,
        channelCode: 'SHOPEE',
        externalOrderId: 'DEMO-AUDIT-006',
        status: 'EM_ABERTO',
        externalStatus: 'demo/unpaid',
        subtotalAmount: 200,
        shippingAmount: 10,
        discountAmount: 0,
        totalAmount: 210,
        feeAmount: 40,
        netAmount: 170,
        currency: 'BRL',
        orderedAt: d6,
        items: [
          { skuCode: 'DEMO-SKU-F', externalSku: 'DEMO-SKU-F', productName: 'Perfume Floral 50ml (Demo)', quantity: 1, unitPrice: 200, totalPrice: 200, costPrice: 90 },
        ],
      },
      // 7) CANCELADO — testa a Regra de Ouro de que o DRE (Etapa 20) exclui
      // pedidos cancelados do reconhecimento de receita.
      {
        tenantId,
        channelCode: 'NUVEMSHOP',
        externalOrderId: 'DEMO-AUDIT-007',
        status: 'CANCELADO',
        externalStatus: 'demo/cancelled',
        subtotalAmount: 150,
        shippingAmount: 10,
        discountAmount: 0,
        totalAmount: 160,
        feeAmount: 0,
        netAmount: 160,
        currency: 'BRL',
        orderedAt: d7,
        paidAt: d7,
        cancelledAt: daysAgo(23),
        items: [
          { skuCode: 'DEMO-SKU-G', externalSku: 'DEMO-SKU-G', productName: 'Creme Anti-idade (Demo)', quantity: 1, unitPrice: 150, totalPrice: 150, costPrice: 80 },
        ],
      },
      // 8) Custo DESCONHECIDO — item sem skuCode nem costPrice (SKU nunca
      // resolvido contra o catálogo). Testa que a margem fica UNKNOWN, nunca
      // fabricada em zero (mesma Regra de Ouro da Etapa 19/20).
      {
        tenantId,
        channelCode: 'MERCADO_LIVRE',
        externalOrderId: 'DEMO-AUDIT-008',
        status: 'ENTREGUE',
        externalStatus: 'demo/completed',
        subtotalAmount: 90,
        shippingAmount: 0,
        discountAmount: 0,
        totalAmount: 90,
        feeAmount: 12,
        netAmount: 78,
        currency: 'BRL',
        orderedAt: d8,
        paidAt: d8,
        shippedAt: daysAgo(7),
        deliveredAt: daysAgo(5),
        items: [
          { externalSku: 'DEMO-SKU-NAO-CADASTRADO', productName: 'Produto Novo Sem Cadastro (Demo)', quantity: 1, unitPrice: 90, totalPrice: 90 },
        ],
      },
      // 9) Taxa ZERO suspeita — Shopee normalmente cobra comissão; feeAmount
      // 0 aqui aciona a heurística de suspeita do DRE (isFeeSuspicious),
      // sinalizando qualidade de dados INCOMPLETE mesmo com número "bonito".
      {
        tenantId,
        channelCode: 'SHOPEE',
        externalOrderId: 'DEMO-AUDIT-009',
        status: 'ENTREGUE',
        externalStatus: 'demo/completed',
        subtotalAmount: 100,
        shippingAmount: 0,
        discountAmount: 0,
        totalAmount: 100,
        feeAmount: 0,
        netAmount: 100,
        currency: 'BRL',
        orderedAt: d9,
        paidAt: d9,
        shippedAt: daysAgo(6),
        deliveredAt: daysAgo(4),
        items: [
          { skuCode: 'DEMO-SKU-H', externalSku: 'DEMO-SKU-H', productName: 'Esponja de Silicone (Demo)', quantity: 1, unitPrice: 100, totalPrice: 100, costPrice: 40 },
        ],
      },
      // 10) Dia a dia comum — Nuvemshop, margem saudável e típica, pedido
      // ainda em preparação (mostra a worklist com um status intermediário).
      {
        tenantId,
        channelCode: 'NUVEMSHOP',
        externalOrderId: 'DEMO-AUDIT-010',
        status: 'PREPARANDO_ENVIO',
        externalStatus: 'demo/paid',
        subtotalAmount: 140,
        shippingAmount: 12,
        discountAmount: 5,
        totalAmount: 147,
        feeAmount: 0,
        netAmount: 147,
        currency: 'BRL',
        orderedAt: d10,
        paidAt: d10,
        items: [
          { skuCode: 'DEMO-SKU-I', externalSku: 'DEMO-SKU-I', productName: 'Shampoo Hidratante 300ml (Demo)', quantity: 2, unitPrice: 70, totalPrice: 140, costPrice: 30 },
        ],
      },
    ].map((order) => ({ ...order, isDemo: true }) as OrderUpsertData);
  }

  // Idempotente: chave de negócio fixa (tenantId, channelCode,
  // externalOrderId) garante que rodar de novo só atualiza as mesmas 10
  // linhas, nunca duplica — mesmo comportamento de upsert do
  // OrderSyncOrchestrator, sem precisar reimplementar nada aqui.
  async seed(tenantId: string): Promise<AuditSeedResult> {
    const scenarios = this.buildScenarios(tenantId);
    for (const scenario of scenarios) {
      await this.orders.upsert(scenario);
    }
    this.logger.log(`Audit Mode: ${scenarios.length} pedidos de demonstração semeados para o tenant ${tenantId}.`);
    return { seeded: scenarios.length, externalOrderIds: scenarios.map((s) => s.externalOrderId) };
  }

  // WHERE isDemo = true explícito, dentro de deleteDemoOrders — nunca toca
  // um pedido real do tenant, mesmo por engano (ver aviso no repositório).
  async clear(tenantId: string): Promise<AuditClearResult> {
    const removed = await this.orders.deleteDemoOrders(tenantId);
    this.logger.log(`Audit Mode: ${removed} pedido(s) de demonstração removido(s) do tenant ${tenantId}.`);
    return { removed };
  }

  // Alimenta o toggle do frontend: permite mostrar "10 pedidos de
  // demonstração disponíveis" antes mesmo de trocar para o modo Demo.
  async getStatus(tenantId: string): Promise<AuditStatus> {
    const counts = await this.orders.countByStatus(tenantId, 'DEMO');
    const totalDemoOrders = Object.values(counts).reduce((sum, count) => sum + count, 0);
    return { totalDemoOrders };
  }
}
