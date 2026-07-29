import { DispatchBatch, DispatchBatchStatus } from '../../domain/dispatch-batch.entity';

export interface DispatchBatchCreateData {
  tenantId: string;
  formaEnvio: string;
  requestedByUserId?: string | null;
  notes?: string | null;
}

export interface DispatchBatchRepository {
  create(data: DispatchBatchCreateData): Promise<DispatchBatch>;
  findById(tenantId: string, id: string): Promise<DispatchBatch | null>;
  findAllByTenant(tenantId: string, status?: DispatchBatchStatus): Promise<DispatchBatch[]>;
  updateStatus(id: string, status: DispatchBatchStatus, concludedAt?: Date | null): Promise<DispatchBatch>;
}

export const DISPATCH_BATCH_REPOSITORY = Symbol('DISPATCH_BATCH_REPOSITORY');
