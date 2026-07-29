import { IsBoolean, IsInt, IsNumber, IsObject, IsOptional, IsPositive, IsString, Max, Min } from 'class-validator';

// Só os campos que o usuário de fato preenche. packedWeightKg, cubicWeightKg
// e shippingWeightKg NÃO entram aqui — são calculados pelo ProductsService
// (ver product-weight.util.ts) e não podem ser sobrescritos pelo cliente.
export class CreateProductDto {
  @IsString()
  skuCode!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  internalCategory?: string;

  // Árvore de categoria (Fase 4, benchmark Tiny ERP) — id de
  // catalog.ProductCategory, usado para publicar anúncio em marketplace
  // (resolve atributos herdados + mapeamento de categoria do canal). Aceita
  // `null` explícito para desvincular, mesmo racional de mapPrice/ncm/gtin.
  @IsOptional()
  @IsString()
  categoryId?: string | null;

  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsString()
  taxProfileId?: string;

  // Packaging Intel — vínculo opcional a uma embalagem cadastrada. Quando
  // presente, custo efetivo e peso cubado passam a considerar a embalagem
  // (ver ProductsService.resolvePackaging / CatalogReaderService.findBySku).
  @IsOptional()
  @IsString()
  packagingId?: string;

  // Controle de Lote/Validade (Projeto Estruturante 2, benchmark Bling ERP,
  // docs/bling-erp-benchmark-analysis.md, seção 1.2) — quando true, este SKU
  // passa a aceitar cadastro de lote (ver ProductLotService). Default false
  // no schema quando omitido.
  @IsOptional()
  @IsBoolean()
  controlaLote?: boolean;

  // Produto Pai + Variação (benchmark Tiny ERP,
  // docs/tiny-erp-benchmark-analysis.md, seção 2.3) — id de outro produto
  // deste tenant que vira o "pai". Aceita `null` explícito para desvincular
  // (mesmo racional de mapPrice/ncm/gtin acima). Obrigatório vir acompanhado
  // de variantAttributes com ao menos um par chave/valor — ver ProductsService.
  @IsOptional()
  @IsString()
  parentProductId?: string | null;

  // Grade de atributos que diferencia esta variação (ex.: {"Cor": "Azul",
  // "Tamanho": "P"}) — só faz sentido junto de parentProductId.
  @IsOptional()
  @IsObject()
  variantAttributes?: Record<string, string> | null;

  @IsNumber()
  @IsPositive()
  costPrice!: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  desiredMarginPct!: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  minimumMarginPct!: number;

  // Modo operação do PricingStrategist (docs/pricing-intelligence-architecture.md,
  // seção 7) — opt-in por SKU, default false no schema quando omitido.
  @IsOptional()
  @IsBoolean()
  autoRepricingEnabled?: boolean;

  // Política de Preço Mínimo Anunciado (MAP) — piso definido pelo
  // fornecedor/marca, ver docs/map-price-governance-architecture.md.
  // Aceita `null` explícito para limpar a restrição (ver product-audit.ts,
  // diffGovernanceFields) — @IsOptional() do class-validator trata `null`
  // como valor "vazio" e pula as demais validações desta propriedade,
  // deixando o `null` passar direto para o service.
  @IsOptional()
  @IsNumber()
  @IsPositive()
  mapPrice?: number | null;

  @IsNumber()
  @IsPositive()
  weightKg!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  packagingWeightKg?: number;

  @IsNumber()
  @IsPositive()
  lengthCm!: number;

  @IsNumber()
  @IsPositive()
  widthCm!: number;

  @IsNumber()
  @IsPositive()
  heightCm!: number;

  // Campos fiscais (benchmark Tiny ERP, docs/tiny-erp-benchmark-analysis.md,
  // seções 1.1/2.1) — pré-requisito para NF-e (Fase 3) e publicação de
  // anúncio em marketplace (Fase 4). Aceitam `null` explícito pra limpar o
  // campo, mesmo racional de mapPrice acima.
  @IsOptional()
  @IsString()
  ncm?: string | null;

  @IsOptional()
  @IsString()
  gtin?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(8)
  fiscalOriginCode?: number | null;

  // CEST (benchmark Bling, docs/bling-erp-benchmark-analysis.md, seção 2) —
  // obrigatório na NF-e de item sujeito a Substituição Tributária. Aceita
  // `null` explícito para limpar, mesmo racional de ncm/gtin acima.
  @IsOptional()
  @IsString()
  cest?: string | null;
}
