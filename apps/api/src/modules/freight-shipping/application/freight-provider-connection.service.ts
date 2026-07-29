import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { CredentialEncryptionService } from '../../../shared/security/credential-encryption.service';
import {
  FREIGHT_PROVIDER_CONNECTION_REPOSITORY,
  FreightProviderConnectionRecord,
  FreightProviderConnectionRepository,
} from './ports/freight-provider-connection-repository.port';

export type SafeFreightProviderConnection = Omit<FreightProviderConnectionRecord, 'credentialEnc'>;

// Conexão/credencial por tenant de transportadora avulsa (Fase 5) — mesmo
// padrão de FiscalSettingsService (token nunca devolvido em texto puro por
// get/upsert), mas UMA linha POR PROVIDER (upsert por tenantId+providerCode),
// diferente do singleton de FiscalSettings. `credential` é sempre um objeto
// JSON serializado ANTES de criptografar — cada provider define seu próprio
// formato (ver comentário em cada *-freight.provider.ts), nunca campos soltos
// no schema (evitaria migration a cada transportadora nova).
@Injectable()
export class FreightProviderConnectionService {
  constructor(
    @Inject(FREIGHT_PROVIDER_CONNECTION_REPOSITORY) private readonly connections: FreightProviderConnectionRepository,
    private readonly credentials: CredentialEncryptionService,
  ) {}

  async listForTenant(tenantId: string): Promise<SafeFreightProviderConnection[]> {
    const records = await this.connections.findAllByTenant(tenantId);
    return records.map((r) => this.omitCredential(r));
  }

  async upsert(tenantId: string, providerCode: string, credential: Record<string, unknown>): Promise<SafeFreightProviderConnection> {
    const normalizedCode = providerCode.trim().toUpperCase();
    if (!normalizedCode) {
      throw new BadRequestException('providerCode é obrigatório.');
    }
    const credentialEnc = this.credentials.encrypt(JSON.stringify(credential));
    const record = await this.connections.upsert({ tenantId, providerCode: normalizedCode, credentialEnc, isActive: true });
    return this.omitCredential(record);
  }

  async remove(tenantId: string, providerCode: string): Promise<void> {
    await this.connections.remove(tenantId, providerCode.trim().toUpperCase());
  }

  // Uso interno (cada *-freight.provider.ts) — decripta a credencial só no
  // momento de montar a chamada HTTP, nunca antes. Lança BadRequestException
  // (não NotFoundException) porque a ausência de configuração é um erro de
  // operação do usuário ("configure antes de gerar etiqueta"), mesmo
  // racional de FiscalSettingsService.requireForEmission.
  async requireCredential<T = Record<string, unknown>>(tenantId: string, providerCode: string): Promise<T> {
    const record = await this.connections.findByTenantAndProvider(tenantId, providerCode.toUpperCase());
    if (!record || !record.isActive) {
      throw new BadRequestException(`Nenhuma conexão ativa com ${providerCode} configurada para este tenant.`);
    }
    return JSON.parse(this.credentials.decrypt(record.credentialEnc)) as T;
  }

  private omitCredential(record: FreightProviderConnectionRecord): SafeFreightProviderConnection {
    const { credentialEnc: _credentialEnc, ...safe } = record;
    return safe;
  }
}
