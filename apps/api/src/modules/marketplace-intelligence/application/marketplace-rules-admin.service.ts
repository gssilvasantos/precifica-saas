import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MARKETPLACE_REPOSITORY, MarketplaceRepository } from './ports/marketplace-repository.port';
import { MARKETPLACE_RULE_REPOSITORY, MarketplaceRuleRepository } from './ports/marketplace-rule-repository.port';
import { CHANGE_EVENT_REPOSITORY, ChangeEventRepository } from './ports/change-event-repository.port';
import { computeContentHash } from '../../../shared/domain/content-hash';
import { RULE_PAYLOAD_VALIDATORS } from '../domain/rule-payload-validators';
import { RuleType } from '../domain/marketplace-rule.entity';

export interface CreateManualRuleInput {
  marketplaceCode: string;
  ruleType: RuleType;
  scopeKey: string;
  payload: unknown;
  tenantId?: string;
}

// Operações de governança descritas na seção 6 do documento de arquitetura
// do módulo: revisar pendências, aprovar/rejeitar, pin/unpin, cadastro manual.
@Injectable()
export class MarketplaceRulesAdminService {
  constructor(
    @Inject(MARKETPLACE_REPOSITORY) private readonly marketplaces: MarketplaceRepository,
    @Inject(MARKETPLACE_RULE_REPOSITORY) private readonly rules: MarketplaceRuleRepository,
    @Inject(CHANGE_EVENT_REPOSITORY) private readonly changeEvents: ChangeEventRepository,
    private readonly events: EventEmitter2,
  ) {}

  async listPending(marketplaceCode?: string) {
    let marketplaceId: string | undefined;
    if (marketplaceCode) {
      const marketplace = await this.marketplaces.findByCode(marketplaceCode);
      if (!marketplace) throw new NotFoundException('Marketplace não encontrado.');
      marketplaceId = marketplace.id;
    }
    return this.rules.findByStatus('PENDENTE_VALIDACAO', marketplaceId);
  }

  async approve(ruleId: string, adminUserId: string) {
    const rule = await this.getRuleOrThrow(ruleId);
    const updated = await this.rules.updateStatus(ruleId, 'VALIDADA', adminUserId);
    this.events.emit('marketplace-rule.validated', {
      marketplaceId: rule.marketplaceId,
      ruleType: rule.ruleType,
      scopeKey: rule.scopeKey,
      tenantId: rule.tenantId,
      ruleId: rule.id,
    });
    return updated;
  }

  reject(ruleId: string) {
    return this.getRuleOrThrow(ruleId).then(() => this.rules.updateStatus(ruleId, 'OBSOLETA'));
  }

  setPinned(ruleId: string, pinned: boolean) {
    return this.getRuleOrThrow(ruleId).then(() => this.rules.setPinned(ruleId, pinned));
  }

  async createManual(input: CreateManualRuleInput, adminUserId: string) {
    const marketplace = await this.marketplaces.findByCode(input.marketplaceCode);
    if (!marketplace) throw new BadRequestException('Marketplace inválido.');

    const validator = RULE_PAYLOAD_VALIDATORS[input.ruleType];
    if (!validator) throw new BadRequestException(`ruleType ${input.ruleType} não suportado ainda.`);
    const normalizedPayload = validator(input.payload);

    const latestVersion = await this.rules.findLatestVersion(
      marketplace.id,
      input.ruleType,
      input.scopeKey,
      input.tenantId ?? null,
    );
    const nextVersion = (latestVersion?.version ?? 0) + 1;

    const created = await this.rules.create({
      marketplaceId: marketplace.id,
      ruleType: input.ruleType,
      scopeKey: input.scopeKey,
      payload: normalizedPayload,
      version: nextVersion,
      status: 'VALIDADA', // é o próprio humano confirmando a informação
      sourceType: 'MANUAL',
      sourceProviderCode: `MANUAL_ENTRY_${adminUserId}`,
      sourceFetchedAt: new Date(),
      contentHash: computeContentHash(normalizedPayload),
      tenantId: input.tenantId,
    });

    await this.changeEvents.create({
      marketplaceId: marketplace.id,
      ruleType: input.ruleType,
      scopeKey: input.scopeKey,
      newRuleId: created.id,
      changeSummary: 'Cadastro manual por administrador.',
      detectedByProvider: 'MANUAL',
      resolutionStatus: 'APPLIED_MANUALLY',
    });

    this.events.emit('marketplace-rule.validated', {
      marketplaceId: marketplace.id,
      ruleType: input.ruleType,
      scopeKey: input.scopeKey,
      tenantId: input.tenantId ?? null,
      ruleId: created.id,
    });

    return created;
  }

  private async getRuleOrThrow(ruleId: string) {
    const rule = await this.rules.findById(ruleId);
    if (!rule) throw new NotFoundException('Regra não encontrada.');
    return rule;
  }
}
