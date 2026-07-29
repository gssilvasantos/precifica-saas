// Publicar anúncio novo em marketplace (Fase 4, benchmark Tiny ERP,
// 28/07/2026) — ver docs/tiny-erp-benchmark-analysis.md, seção 1.7, e
// docs/marketplace-listing-publish-architecture.md. Este arquivo contém só
// o TIPO e o gate de publicação PURO — nenhuma chamada a Prisma ou a
// nenhuma API de marketplace aqui, mesma disciplina do resto do domínio
// nesta base (ex.: fiscal-invoice.entity.ts).

export type ListingPublicationStatus = 'PENDENTE' | 'PUBLICADO' | 'ERRO';

// Registro persistido — append-only-por-tentativa (MESMO padrão de
// FiscalInvoice, Fase 3): cada chamada a ListingPublicationService.publish
// insere uma linha NOVA, nunca sobrescreve uma tentativa anterior. Permite
// reconstituir o histórico completo de tentativas de publicação de um
// produto num canal (inclusive as que falharam), sem perder rastro.
export interface ListingPublication {
  id: string;
  tenantId: string;
  productId: string;
  skuCode: string;
  marketplaceCode: string;
  status: ListingPublicationStatus;
  externalListingId: string | null;
  requestPayload: unknown;
  errorMessage: string | null;
  requestedAt: Date;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListingPublicationCreateData {
  tenantId: string;
  productId: string;
  skuCode: string;
  marketplaceCode: string;
  requestPayload: unknown;
}

export interface GateCheck {
  ok: boolean;
  reason?: string;
}

export interface PublishableProduct {
  name: string;
  photoUrls: string[];
  weightKg: number;
  categoryId: string | null;
}

export interface ChannelCategoryMappingSummary {
  externalCategoryId: string;
  externalCategoryName: string;
}

export interface RequiredAttributeDefinition {
  name: string;
  required: boolean;
}

// Gate de publicação — reúne as validações que o Kyneti consegue fazer
// ANTES de gastar uma chamada de rede com o marketplace: produto com nome,
// pelo menos 1 foto (nenhum marketplace aceita anúncio sem imagem), peso
// informado (obrigatório para o cálculo de frete do canal), categoria
// interna definida E mapeada para o canal de destino, e todo atributo
// marcado como obrigatório pela categoria do MARKETPLACE (consultado ao
// vivo, nunca hardcoded aqui — cada categoria do ML/Shopee tem um conjunto
// diferente) presente no resultado da mescla entre os atributos herdados da
// categoria interna (resolveEffectiveAttributes, product-category.ts) e os
// overrides informados pelo usuário no momento de publicar (ex.: cor varia
// por produto mesmo dentro da mesma categoria).
export function canPublish(params: {
  product: PublishableProduct;
  mapping: ChannelCategoryMappingSummary | null;
  effectiveAttributes: Record<string, string>;
  overrideAttributes: Record<string, string>;
  requiredAttributes: RequiredAttributeDefinition[];
}): GateCheck {
  const { product, mapping, effectiveAttributes, overrideAttributes, requiredAttributes } = params;

  if (!product.name || !product.name.trim()) {
    return { ok: false, reason: 'Produto sem nome — não é possível publicar.' };
  }
  if (product.photoUrls.length === 0) {
    return { ok: false, reason: 'Produto sem nenhuma foto cadastrada — todo marketplace exige ao menos 1 imagem.' };
  }
  if (!product.weightKg || product.weightKg <= 0) {
    return { ok: false, reason: 'Produto sem peso informado — obrigatório para o cálculo de frete do canal.' };
  }
  if (!product.categoryId) {
    return { ok: false, reason: 'Produto sem categoria definida — cadastre a categoria antes de publicar.' };
  }
  if (!mapping) {
    return { ok: false, reason: 'A categoria deste produto ainda não tem mapeamento para este canal — configure o mapeamento antes de publicar.' };
  }

  const merged = { ...effectiveAttributes, ...overrideAttributes };
  const missing = requiredAttributes
    .filter((attr) => attr.required)
    .filter((attr) => !merged[attr.name] || !merged[attr.name].trim())
    .map((attr) => attr.name);

  if (missing.length > 0) {
    return {
      ok: false,
      reason: `Atributos obrigatórios do canal ausentes: ${missing.join(', ')}. Preencha-os no formulário de publicação.`,
    };
  }

  return { ok: true };
}
