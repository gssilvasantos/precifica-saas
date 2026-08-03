export interface OlistConnectionRecord {
  tenantId: string;
  apiTokenEnc: string; // sempre criptografado nesta camada — decrypt só acontece no OlistConnectionService
  isActive: boolean;
  lastSyncedAt: Date | null;
  lastSyncStatus: string | null; // SUCCESS | FAILED — ver comentário na migração 20260731160000
  lastSyncError: string | null;
}

export interface OlistConnectionRepository {
  findByTenant(tenantId: string): Promise<OlistConnectionRecord | null>;
  findAllActive(): Promise<OlistConnectionRecord[]>;
  upsert(tenantId: string, apiTokenEnc: string): Promise<OlistConnectionRecord>;
  deactivate(tenantId: string): Promise<void>;
  markSynced(tenantId: string, syncedAt: Date): Promise<void>;
  // Contraparte de markSynced no caminho de erro — ErpSyncOrchestrator chama
  // uma OU outra ao final de cada tentativa, nunca as duas.
  // Sucesso PARCIAL (02/08/2026): sincronizou e importou, mas parte do
  // catálogo ficou de fora (cadastro incompleto no Olist, ou produto que a
  // API não devolveu). Estado próprio porque nem SUCCESS nem FAILED contam
  // a verdade — ver comentário na implementação Prisma.
  markSyncedWithWarning(tenantId: string, syncedAt: Date, warning: string): Promise<void>;
  markSyncFailed(tenantId: string, error: string): Promise<void>;
}

export const OLIST_CONNECTION_REPOSITORY = Symbol('OLIST_CONNECTION_REPOSITORY');
