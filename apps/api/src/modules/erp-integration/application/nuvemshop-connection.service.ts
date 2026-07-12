import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  NUVEMSHOP_CONNECTION_REPOSITORY,
  NuvemshopConnectionRepository,
} from './ports/nuvemshop-connection-repository.port';
import { CredentialEncryptionService } from '../../../shared/security/credential-encryption.service';
import { NuvemshopApiClient } from '../infrastructure/nuvemshop/nuvemshop-api.client';

export interface NuvemshopConnectionStatus {
  connected: boolean;
  isActive: boolean;
  lastSyncedAt: Date | null;
}

@Injectable()
export class NuvemshopConnectionService {
  constructor(
    @Inject(NUVEMSHOP_CONNECTION_REPOSITORY) private readonly connections: NuvemshopConnectionRepository,
    private readonly credentials: CredentialEncryptionService,
    private readonly client: NuvemshopApiClient,
  ) {}

  async connect(tenantId: string, storeId: string, accessToken: string): Promise<void> {
    if (!storeId?.trim() || !accessToken?.trim()) {
      throw new BadRequestException('storeId e accessToken são obrigatórios.');
    }
    const isValid = await this.client.healthCheck(storeId, accessToken);
    if (!isValid) {
      throw new BadRequestException(
        'Não foi possível validar as credenciais com a API da Nuvemshop. Confira storeId e access_token ' +
          '(Configurações > Meus Aplicativos > Criar app privado, no painel da Nuvemshop).',
      );
    }
    const accessTokenEnc = this.credentials.encrypt(accessToken);
    await this.connections.upsert(tenantId, storeId, accessTokenEnc);
  }

  async disconnect(tenantId: string): Promise<void> {
    const existing = await this.connections.findByTenant(tenantId);
    if (!existing) throw new NotFoundException('Nenhuma conexão com a Nuvemshop encontrada para esta conta.');
    await this.connections.deactivate(tenantId);
  }

  async getStatus(tenantId: string): Promise<NuvemshopConnectionStatus> {
    const existing = await this.connections.findByTenant(tenantId);
    if (!existing) return { connected: false, isActive: false, lastSyncedAt: null };
    return { connected: true, isActive: existing.isActive, lastSyncedAt: existing.lastSyncedAt };
  }

  async getDecryptedCredentials(tenantId: string): Promise<{ storeId: string; accessToken: string } | null> {
    const existing = await this.connections.findByTenant(tenantId);
    if (!existing || !existing.isActive) return null;
    return { storeId: existing.storeId, accessToken: this.credentials.decrypt(existing.accessTokenEnc) };
  }
}
