import { Module } from '@nestjs/common';
import { VendedorService } from './application/vendedor.service';
import { CommissionService } from './application/commission.service';
import { PrismaVendedorRepository } from './infrastructure/prisma-vendedor.repository';
import { VENDEDOR_REPOSITORY } from './application/ports/vendedor-repository.port';
import { VendedoresController } from './interface/controllers/vendedores.controller';
import { CommissionsController } from './interface/controllers/commissions.controller';
import { SELLER_READER } from '../../shared/contracts/seller-reader.port';
import { OrdersModule } from '../orders/orders.module';
import { FinancialIntelligenceModule } from '../financial-intelligence/financial-intelligence.module';

// Vendedores + Comissão (Projeto Estruturante 3, benchmark Bling ERP,
// 29/07/2026). Ver docs/sellers-architecture.md. Bounded context PRÓPRIO
// (schema Postgres "sellers"), mesmo racional de production/procurement.
//
// CommissionService mora AQUI (não no Orders) por causa de um risco de
// dependência circular: FinancialIntelligenceModule já importa OrdersModule
// (para ORDER_FINANCIALS_READER/DRE). Se CommissionService morasse em
// Orders e precisasse de ACCOUNTS_PAYABLE_WRITER, OrdersModule teria que
// importar FinancialIntelligenceModule de volta — ciclo. Sellers importa os
// dois (Orders via ORDER_COMMISSION_WRITER, Financial via
// ACCOUNTS_PAYABLE_WRITER); nenhum dos dois importa Sellers de volta — o
// grafo de módulos continua acíclico.
@Module({
  imports: [OrdersModule, FinancialIntelligenceModule],
  controllers: [VendedoresController, CommissionsController],
  providers: [
    VendedorService,
    CommissionService,
    { provide: VENDEDOR_REPOSITORY, useClass: PrismaVendedorRepository },
    // Exporta a PORTA (token) — hoje sem consumidor cross-módulo real (o
    // único consumo de "vendedor por id" é intra-módulo, via
    // CommissionService injetando VendedorService direto), mas mantida pelo
    // mesmo racional de PRODUCT_STRUCTURE_READER/PRODUCT_LOT_READER: se um
    // módulo futuro precisar resolver vendedor por id sem conhecer Sellers,
    // a porta já existe.
    { provide: SELLER_READER, useExisting: VendedorService },
  ],
  exports: [SELLER_READER],
})
export class SellersModule {}
