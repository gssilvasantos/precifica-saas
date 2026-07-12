import { IsEnum, IsInt, IsNumber, IsOptional, IsPositive, IsString, Max, Min } from 'class-validator';

export enum FixedExpenseRecurrenceDto {
  MONTHLY = 'MONTHLY',
  WEEKLY = 'WEEKLY',
  YEARLY = 'YEARLY',
  ONE_TIME = 'ONE_TIME',
}

export class CreateFixedExpenseDto {
  @IsString()
  name!: string;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsEnum(FixedExpenseRecurrenceDto)
  recurrenceType!: FixedExpenseRecurrenceDto;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(31)
  dueDay?: number;
}
