import { Inject, Injectable } from '@nestjs/common';
import {
  MONITORED_LISTING_REPOSITORY,
  MonitoredListingCreateData,
  MonitoredListingRepository,
} from './ports/monitored-listing-repository.port';

// CRUD simples de configuração ("o que monitorar") — não tem lógica de
// domínio própria, por isso não ganhou uma camada extra; se crescer
// (validação de radarCode existente, limite de listings por plano etc.)
// vira candidato a ganhar um serviço de domínio dedicado.
@Injectable()
export class MonitoredListingsAdminService {
  constructor(@Inject(MONITORED_LISTING_REPOSITORY) private readonly listings: MonitoredListingRepository) {}

  create(data: MonitoredListingCreateData) {
    return this.listings.create(data);
  }

  findAllByTenant(tenantId: string) {
    return this.listings.findAllActiveByTenant(tenantId);
  }

  setActive(id: string, tenantId: string, isActive: boolean) {
    return this.listings.setActive(id, tenantId, isActive);
  }
}
