import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  OLIST_CONNECTION_REPOSITORY,
  OlistConnectionRepository,
} from './ports/olist-connection-repository.port';
import { CredentialEncryptionService } from '../../../shared/security/credential-encryption.service';
import { OlistApiClient } from '../infrastructure/olist/olist-api.client';

export interface OlistConnectionStatus {
  connected: boolean;
  isActive: boolean;
  lastSyncedAt: Date | null;
}

// Camada de aplicação que sabe de credenciais em claro — a única do módulo.
// Repositório e schema nunca veem o token descriptografado.
@Injectable()
export class OlistConnectionService {
  constructor(
    @Inject(OLIST_CONNECTION_REPOSITORY) private readonly connections: OlistConnectionRepository,
    private readonly credentials: CredentialEncryptionService,
    private readonly client: OlistApiClient,
  ) {}

  async connect(tenantId: string, apiToken: string): Promise<void> {
    if (!apiToken?.trim()) throw new BadRequestException('Token da API do Olist é obrigatório.');

    // Valida contra a própria API antes de salvar — evita guardar um token
    // inválido e só descobrir no próximo sync agendado.
    const isValid = await this.client.healthCheck(apiToken);
    if (!isValid) {
      throw new BadRequestException(
        'Não foi possível validar o token com a API do Olist. Confira se o token está correto e ativo ' +
          '(Configurações > Preferências > Chave da API, no painel do Olist).',
      );
    }

    const apiTokenEnc = this.credentials.encrypt(apiToken);
    await this.connections.upsert(tenantId, apiTokenEnc);
  }

  async disconnect(tenantId: string): Promise<void> {
    const existing = await this.connections.findByTenant(tenantId);
    if (!existing) throw new NotFoundException('Nenhuma conexão com o Olist encontrada para esta conta.');
    await this.connections.deactivate(tenantId);
  }

  async getStatus(tenantId: string): Promise<OlistConnectionStatus> {
    const existing = await this.connections.findByTenant(tenantId);
    if (!existing) return { connected: false, isActive: false, lastSyncedAt: null };
    return { connected: true, isActive: existing.isActive, lastSyncedAt: existing.lastSyncedAt };
  }

  async getDecryptedToken(tenantId: string): Promise<string | null> {
    const existing = await this.connections.findByTenant(tenantId);
    if (!existing || !existing.isActive) return null;
    return this.credentials.decrypt(existing.apiTokenEnc);
  }
}
