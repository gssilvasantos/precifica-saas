import { IsBoolean } from 'class-validator';

export class SetVendedorActiveDto {
  @IsBoolean()
  isActive!: boolean;
}
