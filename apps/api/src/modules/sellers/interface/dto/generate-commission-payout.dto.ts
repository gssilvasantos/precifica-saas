import { Type } from 'class-transformer';
import { IsDate } from 'class-validator';

export class GenerateCommissionPayoutDto {
  @Type(() => Date)
  @IsDate()
  dateFrom!: Date;

  @Type(() => Date)
  @IsDate()
  dateTo!: Date;

  @Type(() => Date)
  @IsDate()
  dueDate!: Date;
}
