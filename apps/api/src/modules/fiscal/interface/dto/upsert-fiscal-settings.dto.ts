import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class UpsertFiscalSettingsDto {
  @IsString()
  cnpj!: string;

  @IsString()
  razaoSocial!: string;

  @IsOptional()
  @IsString()
  nomeFantasia?: string;

  @IsString()
  inscricaoEstadual!: string;

  // 1=Simples Nacional, 2=Simples Nacional c/ excesso de sublimite, 3=Regime Normal
  @IsOptional()
  @IsInt()
  @IsIn([1, 2, 3])
  regimeTributario?: number;

  @IsString()
  logradouro!: string;

  @IsString()
  numero!: string;

  @IsString()
  bairro!: string;

  @IsString()
  municipio!: string;

  @IsString()
  uf!: string;

  @IsString()
  cep!: string;

  @IsOptional()
  @IsString()
  telefone?: string;

  // Só enviar ao cadastrar pela primeira vez ou ao rotacionar o token —
  // ausente numa atualização mantém o token já salvo.
  @IsOptional()
  @IsString()
  focusNfeToken?: string;

  @IsOptional()
  @IsIn(['HOMOLOGACAO', 'PRODUCAO'])
  environment?: 'HOMOLOGACAO' | 'PRODUCAO';

  @IsOptional()
  @IsBoolean()
  autoEmitOnApproval?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  nfeSerie?: number;

  // Naturezas de Operação (Projeto Estruturante 4, benchmark Bling ERP,
  // 29/07/2026) — id de uma NaturezaOperacao já cadastrada por este tenant.
  // Ausente (campo não enviado) = mantém o valor já salvo; enviar `null`
  // explicitamente remove a natureza padrão.
  @IsOptional()
  @IsString()
  defaultNaturezaOperacaoId?: string | null;
}
