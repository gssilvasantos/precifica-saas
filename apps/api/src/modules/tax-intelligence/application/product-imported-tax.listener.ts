import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ERP_PRODUCT_EVENTS, ErpProductImportedEvent } from '../../erp-integration/domain/erp-product-events';
import { ProductTaxProfileService } from './product-tax-profile.service';
import { TenantContextStore } from '../../../shared/prisma/tenant-context';

// Classifica fiscalmente o produto assim que ele é importado do ERP
// (13/08/2026).
//
// O Olist entrega NCM em 100% dos produtos. Sem isto, o lojista teria que
// reclassificar centenas de SKUs à mão — e o motor de preço bloquearia cada um
// deles até lá, tornando a integração inútil na prática.
//
// POR QUE LISTENER E NÃO CHAMADA DIRETA: o ErpIntegration não pode importar
// este módulo (ciclo via OrdersModule — ver erp-product-events.ts). O
// importador anuncia o fato; quem sabe de norma fiscal reage.
@Injectable()
export class ProductImportedTaxListener {
  private readonly logger = new Logger(ProductImportedTaxListener.name);

  constructor(private readonly perfis: ProductTaxProfileService) {}

  @OnEvent(ERP_PRODUCT_EVENTS.IMPORTED)
  async handle(event: ErpProductImportedEvent): Promise<void> {
    // Handler de evento roda FORA do contexto da requisição que o originou —
    // o EventEmitter2 não propaga AsyncLocalStorage de forma garantida através
    // do `emit`. Sem reabrir, toda query Prisma daqui falharia com "consulta
    // sem contexto de tenant" (ver prisma.service.ts).
    //
    // Contexto do TENANT do evento, nunca runAsService: isto é operação de
    // conta, não rotina de plataforma, e o RLS tem que valer.
    await TenantContextStore.run(event.tenantId, async () => {
      try {
        const classificou = await this.perfis.classificarDoErp({
          tenantId: event.tenantId,
          productId: event.productId,
          ncm: event.ncm,
          at: new Date(),
        });

        if (classificou) {
          this.logger.log(`Perfil fiscal derivado do NCM para ${event.skuCode} (tenant ${event.tenantId}).`);
        }
      } catch (erro) {
        // Falha aqui NÃO pode derrubar a importação — o produto já está no
        // catálogo, e classificar é passo seguinte, não pré-requisito. Sem
        // classificação o piso bloqueia aquele SKU, que é recuperável; perder
        // a importação não seria.
        //
        // O `emit` do EventEmitter2 é síncrono e não trata rejeição: uma
        // exceção escapando daqui viraria unhandled rejection no processo.
        this.logger.warn(
          `Não foi possível classificar fiscalmente ${event.skuCode}: ${(erro as Error).message}`,
        );
      }
    });
  }
}
