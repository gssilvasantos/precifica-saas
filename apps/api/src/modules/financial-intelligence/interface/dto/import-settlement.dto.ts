import { IsIn, IsString } from 'class-validator';

// Simplificação consciente: recebe o conteúdo do arquivo como texto no corpo
// da requisição, não como multipart/form-data — evita puxar uma dependência
// de upload de arquivo (ex.: @nestjs/platform-express FileInterceptor) só
// para este endpoint administrativo/manual. Trocar para upload de arquivo de
// verdade é uma mudança de controller, não de ReceivableReconciliationService
// (que já recebe só `fileContent: string`).
export class ImportSettlementDto {
  @IsString()
  marketplaceCode!: string;

  @IsIn(['JSON', 'CSV'])
  format!: 'JSON' | 'CSV';

  @IsString()
  fileContent!: string;
}
