import { IsBoolean } from 'class-validator';

export class SetCarrierServiceActiveDto {
  @IsBoolean()
  isActive!: boolean;
}
