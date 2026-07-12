import { Inject, Injectable } from '@nestjs/common';
import { TENANT_REPOSITORY, TenantRepository } from './ports/tenant-repository.port';

@Injectable()
export class TenantsService {
  constructor(@Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository) {}

  create(name: string, document?: string) {
    return this.tenants.create({ name, document });
  }

  findById(id: string) {
    return this.tenants.findById(id);
  }
}
