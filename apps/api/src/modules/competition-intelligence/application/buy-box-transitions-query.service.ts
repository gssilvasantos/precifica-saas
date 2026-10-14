import { Inject, Injectable } from '@nestjs/common';
import {
  BUY_BOX_STATUS_CHANGE_REPOSITORY,
  BuyBoxStatusChangeRecord,
  BuyBoxStatusChangeRepository,
} from './ports/buy-box-status-change-repository.port';
import { BuyBoxStatusValue } from '../domain/status-change-recorder';

export interface ListBuyBoxTransitionsParams {
  tenantId: string;
  newStatus?: BuyBoxStatusValue;
  skuCode?: string;
  detectedSince?: Date;
  limit?: number;
}

// Teto no servidor (.claude/rules/backend.md "Limites e proteção") —
// independente do que o cliente pedir.
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

@Injectable()
export class BuyBoxTransitionsQueryService {
  constructor(
    @Inject(BUY_BOX_STATUS_CHANGE_REPOSITORY) private readonly statusChanges: BuyBoxStatusChangeRepository,
  ) {}

  findByTenant(params: ListBuyBoxTransitionsParams): Promise<BuyBoxStatusChangeRecord[]> {
    const limit = Math.min(params.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    return this.statusChanges.findByTenant({
      tenantId: params.tenantId,
      newStatus: params.newStatus,
      skuCode: params.skuCode,
      detectedSince: params.detectedSince,
      limit,
    });
  }
}
