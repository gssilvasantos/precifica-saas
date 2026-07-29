import { IsNotEmpty, IsString } from 'class-validator';

// Grupo G da NF-e (NT 2020.006) — benchmark Bling, seção 1.4. cnpj é da
// PLATAFORMA (marketplace), idCadIntTran é o identificador do PRÓPRIO
// vendedor cadastrado naquela plataforma.
export class UpsertFiscalMarketplaceIntermediaryDto {
  @IsString()
  @IsNotEmpty()
  channelCode!: string;

  @IsString()
  @IsNotEmpty()
  cnpj!: string;

  @IsString()
  @IsNotEmpty()
  idCadIntTran!: string;
}
