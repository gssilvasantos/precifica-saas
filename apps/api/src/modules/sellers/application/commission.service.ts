import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { VendedorService } from './vendedor.service';
import { ORDER_COMMISSION_WRITER, OrderCommissionWriter, CommissionLineDto } from '../../../shared/contracts/order-commission-writer.port';
import { ACCOUNTS_PAYABLE_WRITER, AccountsPayableWriter } from '../../../shared/contracts/accounts-payable-writer.port';
import { computeCommission } from '../domain/vendedor.entity';

export interface GeneratePayoutResult {
  accountsPayableId: string;
  amount: number;
  itemCount: number;
}

// Vendedores + Comissão (Projeto Estruturante 3, benchmark Bling ERP,
// 29/07/2026, docs/sellers-architecture.md) — mora no Sellers, não no
// Orders: precisa consumir ACCOUNTS_PAYABLE_WRITER (Financial Intelligence)
// E OrderCommissionWriter (Orders); FinancialIntelligenceModule já importa
// OrdersModule (para ORDER_FINANCIALS_READER/DRE) — se este service morasse
// em Orders e o módulo Orders importasse FinancialIntelligenceModule
// também, seria uma dependência circular (Orders -> Financial -> Orders).
// Sellers importa os dois, nenhum dos dois importa Sellers de volta — grafo
// continua acíclico. VendedorService é injetado DIRETO (mesmo módulo,
// nunca via porta) — SELLER_READER só existe para consumo CROSS-módulo.
@Injectable()
export class CommissionService {
  constructor(
    private readonly vendedores: VendedorService,
    @Inject(ORDER_COMMISSION_WRITER) private readonly orderCommissions: OrderCommissionWriter,
    @Inject(ACCOUNTS_PAYABLE_WRITER) private readonly accountsPayableWriter: AccountsPayableWriter,
  ) {}

  // Atribuição manual explícita (Safety Lock) — nunca inferida
  // automaticamente do canal/pedido. Resolve o vendedor (findOne já lança
  // NotFoundException se não existir), calcula a comissão SNAPSHOT (base =
  // OrderItem.totalPrice, alíquota = Vendedor.aliquotaComissaoPct NESTE
  // momento) e persiste no item via a porta do Orders.
  async assignVendedor(tenantId: string, orderId: string, itemId: string, vendedorId: string): Promise<{ id: string; totalPrice: number }> {
    const vendedor = await this.vendedores.findOne(tenantId, vendedorId);
    if (!vendedor.isActive) {
      throw new BadRequestException(`Vendedor "${vendedor.name}" está inativo — ative-o antes de atribuir a uma venda.`);
    }

    const item = await this.orderCommissions.findItemForCommission(tenantId, orderId, itemId);
    if (!item) {
      throw new BadRequestException(`Item ${itemId} não encontrado no pedido ${orderId}.`);
    }

    const comissaoValor = computeCommission(item.totalPrice, vendedor.aliquotaComissaoPct);
    const updated = await this.orderCommissions.assignVendedorToItem(tenantId, orderId, itemId, {
      vendedorId,
      comissaoAliquotaPct: vendedor.aliquotaComissaoPct,
      comissaoValor,
    });
    if (!updated) {
      throw new BadRequestException(`Item ${itemId} não encontrado no pedido ${orderId}.`);
    }
    return updated;
  }

  // Relatório de leitura — todas as linhas de comissão de um vendedor num
  // período (inclui já pagas — útil para conferência histórica).
  async listCommissions(tenantId: string, vendedorId: string, dateFrom?: Date, dateTo?: Date): Promise<CommissionLineDto[]> {
    await this.vendedores.findOne(tenantId, vendedorId); // valida existência/tenant, lança NotFoundException
    return this.orderCommissions.findCommissionLines(tenantId, vendedorId, { dateFrom, dateTo });
  }

  // Geração de conta a pagar (Safety Lock — ação explícita, nunca
  // automática): soma toda comissão AINDA NÃO PAGA do vendedor num período,
  // cria UMA AccountsPayable (mesmo padrão de PurchaseOrderService.receive),
  // e só então marca os itens como pagos — nunca o inverso, para nunca
  // marcar pago sem a conta ter sido criada de fato.
  async generatePayout(tenantId: string, vendedorId: string, dateFrom: Date, dateTo: Date, dueDate: Date): Promise<GeneratePayoutResult> {
    const vendedor = await this.vendedores.findOne(tenantId, vendedorId);

    const lines = await this.orderCommissions.findCommissionLines(tenantId, vendedorId, { dateFrom, dateTo, onlyPending: true });
    if (lines.length === 0) {
      throw new BadRequestException(`Nenhuma comissão pendente para "${vendedor.name}" no período informado.`);
    }

    const totalAmount = Math.round(lines.reduce((sum, line) => sum + line.valor, 0) * 100) / 100;

    const payable = await this.accountsPayableWriter.createSingle(tenantId, {
      amount: totalAmount,
      description: `Comissão de vendas — ${vendedor.name} (${lines.length} item(ns))`,
      dueDate,
      notes: `Período: ${dateFrom.toISOString().slice(0, 10)} a ${dateTo.toISOString().slice(0, 10)}.`,
    });

    await this.orderCommissions.markCommissionsPaid(
      tenantId,
      lines.map((line) => line.orderItemId),
      new Date(),
    );

    return { accountsPayableId: payable.id, amount: payable.amount, itemCount: lines.length };
  }
}
