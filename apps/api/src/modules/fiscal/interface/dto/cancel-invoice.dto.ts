import { IsString, Length } from 'class-validator';

export class CancelInvoiceDto {
  @IsString()
  @Length(15, 255)
  justificativa!: string;
}
