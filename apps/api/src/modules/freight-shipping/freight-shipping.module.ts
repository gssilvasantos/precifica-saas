import { Module } from '@nestjs/common';
import { PrismaModule } from '../../shared/prisma/prisma.module';
import { FREIGHT_PROVIDER_CONNECTION_REPOSITORY } from './application/ports/freight-provider-connection-repository.port';
import { PrismaFreightProviderConnectionRepository } from './infrastructure/prisma-freight-provider-connection.repository';
import { FreightProviderConnectionService } from './application/freight-provider-connection.service';
import { FreightProviderRegistry } from './application/freight-provider-registry.service';
import { FREIGHT_LABEL_PROVIDERS } from './application/freight-label-provider.contract';
import { MelhorEnvioApiClient } from './infrastructure/melhor-envio/melhor-envio-api.client';
import { MelhorEnvioFreightProvider } from './infrastructure/melhor-envio/melhor-envio-freight.provider';
import { CorreiosApiClient } from './infrastructure/correios/correios-api.client';
import { CorreiosFreightProvider } from './infrastructure/correios/correios-freight.provider';
import { FrenetApiClient } from './infrastructure/frenet/frenet-api.client';
import { FrenetFreightProvider } from './infrastructure/frenet/frenet-freight.provider';
import { FreightConnectionsController } from './interface/controllers/freight-connections.controller';
import { CARRIER_REPOSITORY } from './application/ports/carrier-repository.port';
import { CARRIER_SERVICE_REPOSITORY } from './application/ports/carrier-service-repository.port';
import { PrismaCarrierRepository } from './infrastructure/prisma-carrier.repository';
import { PrismaCarrierServiceRepository } from './infrastructure/prisma-carrier-service.repository';
import { CarrierCatalogService } from './application/carrier-catalog.service';
import { CarriersController } from './interface/controllers/carriers.controller';

// Etiqueta de envio avulsa (Fase 5, benchmark Tiny ERP, 29/07/2026) — ver
// docs/dispatch-batch-architecture.md. Módulo PRÓPRIO (não dentro de
// logistics-fulfillment) porque a conexão/credencial de transportadora é uma
// responsabilidade de infraestrutura de terceiro, mesmo racional de
// marketplace-intelligence guardar a conexão OAuth2 de cada marketplace
// separado do módulo que CONSOME essa conexão (orders, marketplace-publishing).
// Consumido por logistics-fulfillment (DispatchBatchService) via
// FreightProviderRegistry, nunca importando as classes concretas.
@Module({
  imports: [PrismaModule],
  controllers: [FreightConnectionsController, CarriersController],
  providers: [
    { provide: FREIGHT_PROVIDER_CONNECTION_REPOSITORY, useClass: PrismaFreightProviderConnectionRepository },
    FreightProviderConnectionService,
    { provide: CARRIER_REPOSITORY, useClass: PrismaCarrierRepository },
    { provide: CARRIER_SERVICE_REPOSITORY, useClass: PrismaCarrierServiceRepository },
    CarrierCatalogService,
    MelhorEnvioApiClient,
    MelhorEnvioFreightProvider,
    CorreiosApiClient,
    CorreiosFreightProvider,
    FrenetApiClient,
    FrenetFreightProvider,
    {
      provide: FREIGHT_LABEL_PROVIDERS,
      useFactory: (melhorEnvio: MelhorEnvioFreightProvider, correios: CorreiosFreightProvider, frenet: FrenetFreightProvider) => [
        melhorEnvio,
        correios,
        frenet,
      ],
      inject: [MelhorEnvioFreightProvider, CorreiosFreightProvider, FrenetFreightProvider],
    },
    FreightProviderRegistry,
  ],
  exports: [FreightProviderRegistry, FreightProviderConnectionService, CarrierCatalogService],
})
export class FreightShippingModule {}
