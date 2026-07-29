import { IsBoolean, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString } from 'class-validator';

// Endereço/peso manuais — só usados quando a forma de envio do lote resolve
// para GENERIC_FREIGHT (transportadora avulsa). Ver AVISO DE HONESTIDADE em
// freight-label-provider.contract.ts: nenhum canal entrega isso de forma
// estruturada, então o operador informa na hora de gerar a etiqueta.
export class RecipientAddressDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() document?: string;
  @IsString() @IsNotEmpty() street!: string;
  @IsString() @IsNotEmpty() number!: string;
  @IsOptional() @IsString() complement?: string;
  @IsString() @IsNotEmpty() neighborhood!: string;
  @IsString() @IsNotEmpty() city!: string;
  @IsString() @IsNotEmpty() state!: string;
  @IsString() @IsNotEmpty() postalCode!: string;
}

export class GenerateDispatchLabelDto {
  @IsOptional()
  @IsNumber()
  packageWeightKg?: number;

  @IsOptional()
  @IsNumber()
  declaredValue?: number;

  @IsOptional()
  @IsObject()
  recipientAddress?: RecipientAddressDto;

  // Quick Win 6 (benchmark Bling, docs/bling-erp-benchmark-analysis.md,
  // seção 1.6/2 — `LogisticasObjetosDadosDTO`) — ver racional completo em
  // FreightLabelInput (freight-label-provider.contract.ts).
  @IsOptional()
  @IsBoolean()
  avisoRecebimento?: boolean;

  @IsOptional()
  @IsBoolean()
  maoPropria?: boolean;
}
