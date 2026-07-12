import { IsInt, Min } from 'class-validator';

export class UpdateLogisticsSettingsDto {
  @IsInt()
  @Min(1)
  cubicWeightFactor!: number;
}
