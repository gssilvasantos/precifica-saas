import { IsBoolean } from 'class-validator';

export class SetCarrierActiveDto {
  @IsBoolean()
  isActive!: boolean;
}
