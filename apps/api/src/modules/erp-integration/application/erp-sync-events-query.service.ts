import { Inject, Injectable } from '@nestjs/common';
import {
  ERP_SYNC_CHANGE_EVENT_REPOSITORY,
  ErpSyncChangeEventRepository,
} from './ports/erp-sync-change-event-repository.port';

@Injectable()
export class ErpSyncEventsQueryService {
  constructor(
    @Inject(ERP_SYNC_CHANGE_EVENT_REPOSITORY) private readonly changeEvents: ErpSyncChangeEventRepository,
  ) {}

  findRecent(tenantId: string, limit?: number) {
    return this.changeEvents.findRecent(tenantId, limit);
  }
}
