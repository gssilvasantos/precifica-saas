import { IsIn, IsObject, IsOptional, IsString } from 'class-validator';

export class CreateManualRuleDto {
  @IsString()
  marketplaceCode!: string;

  @IsIn(['FEE_RULE', 'SHIPPING_POLICY', 'CATEGORY_TAXONOMY'])
  ruleType!: 'FEE_RULE' | 'SHIPPING_POLICY' | 'CATEGORY_TAXONOMY';

  @IsString()
  scopeKey!: string;

  @IsObject()
  payload!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  tenantId?: string;
}
