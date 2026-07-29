import { IsBoolean } from 'class-validator';

export class SetNaturezaOperacaoActiveDto {
  @IsBoolean()
  isActive!: boolean;
}
