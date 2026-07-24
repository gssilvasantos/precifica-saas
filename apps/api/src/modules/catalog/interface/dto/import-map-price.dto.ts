import { IsString } from 'class-validator';

// Mesma simplificação consciente de ImportSettlementDto
// (financial-intelligence): recebe o conteúdo do CSV como texto no corpo
// da requisição, não como multipart/form-data — este projeto evita
// FileInterceptor de propósito (ver main.ts) em favor de payloads JSON
// simples, mesmo para "upload de arquivo". O cliente (frontend) lê o
// arquivo local (input[type=file] + FileReader) e manda o texto aqui.
export class ImportMapPriceDto {
  @IsString()
  fileContent!: string;
}
