import {
  InvalidOlistProductError,
  NormalizedOlistProduct,
  OlistVariationRef,
  parseCategoryPath,
} from './olist-product-normalizer';

// Normaliza GET /produtos/{id} da API v3 do Olist para o MESMO formato interno
// que o pipeline do sync já consome (NormalizedOlistProduct). Assim a gravação
// no catálogo — hash, espelhamento de fotos, evento fiscal — é uma só para v2 e
// v3 (ver ErpSyncOrchestrator.importNormalized).
//
// Os nomes de campo abaixo vêm do OpenAPI 3.1 da v3 (ObterProdutoModelResponse)
// e foram conferidos contra a conta real em 2026-10-12 pela verificação da
// fatia 1 (RM0100 e RM0024-5): custo, peso, dimensões, NCM e GTIN batem com o
// que o Kyneti já tinha importado pela v2. Lição do normalizador v2 (1.803
// rejeições por nome de campo errado): campo ausente vira null/0 SEM rejeitar,
// e quem decide o que é inaceitável é o motor de preço, não o importador.
//
// Diferenças deliberadas em relação à v2:
//  - nome vem em `descricao` (v2: `nome`);
//  - estoque vem em `estoque.quantidade` (a v2 nunca trouxe estoque: exigiria
//    outra chamada, produto.obter.estoque.php — por isso o catálogo inteiro
//    está com estoque 0);
//  - `cest` não existe na v3: vai null. O writer só PREENCHE lacuna, então o
//    CEST já gravado não é apagado.

type Obj = Record<string, unknown>;

function asObj(value: unknown): Obj {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Obj) : {};
}

function num(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function text(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const t = String(value).trim();
  return t === '' ? null : t;
}

function photoUrls(anexos: unknown): string[] {
  if (!Array.isArray(anexos)) return [];
  const urls = anexos
    .map((a) => asObj(a).url)
    .filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u));
  return Array.from(new Set(urls));
}

// `grade` da variação: lista de { chave, valor } (GradeVariacaoRequestModel).
function normalizeGrade(grade: unknown): Record<string, string> {
  const atributos: Record<string, string> = {};
  if (!Array.isArray(grade)) return atributos;
  for (const item of grade) {
    const par = asObj(item);
    const chave = text(par.chave);
    const valor = text(par.valor);
    if (chave && valor) atributos[chave] = valor;
  }
  return atributos;
}

export function normalizeOlistV3Product(raw: unknown): NormalizedOlistProduct {
  const p = asObj(raw);
  const externalId = text(p.id);
  if (!externalId) throw new InvalidOlistProductError('desconhecido', 'sem campo "id".');

  const skuCode = text(p.sku);
  if (!skuCode) {
    throw new InvalidOlistProductError(externalId, 'sem campo "sku" — obrigatório para o vínculo com marketplaces.');
  }

  const name = text(p.descricao);
  if (!name) throw new InvalidOlistProductError(externalId, 'sem campo "descricao" (nome).');

  const precos = asObj(p.precos);
  const dimensoes = asObj(p.dimensoes);
  const estoque = asObj(p.estoque);

  const weightKg = num(dimensoes.pesoLiquido) ?? 0;
  const grossKg = num(dimensoes.pesoBruto);
  const lengthCm = num(dimensoes.comprimento) ?? 0;
  const widthCm = num(dimensoes.largura) ?? 0;
  const heightCm = num(dimensoes.altura) ?? 0;

  return {
    externalId,
    skuCode,
    name,
    costPrice: num(precos.precoCusto) ?? 0,
    erpSalePrice: num(precos.preco),
    stockQuantity: num(estoque.quantidade) ?? 0,
    weightKg,
    packagingWeightKg: grossKg !== null ? Math.max(0, grossKg - weightKg) : 0,
    lengthCm,
    widthCm,
    heightCm,
    hasCompleteDimensions: weightKg > 0 && lengthCm > 0 && widthCm > 0 && heightCm > 0,
    photoUrls: photoUrls(p.anexos),
    ncm: text(p.ncm),
    cest: null,
    gtin: text(p.gtin),
    fiscalOriginCode: num(p.origem),
    categoryPath: parseCategoryPath(p.categoria),
  };
}

// Variações listadas no detalhe do PAI: id, sku e grade. Custo, peso e
// dimensões de cada variação vêm do detalhe dela (GET /produtos/{id}).
export function extractV3VariationRefs(parentDetail: unknown): OlistVariationRef[] {
  const variacoes = asObj(parentDetail).variacoes;
  if (!Array.isArray(variacoes)) return [];
  return variacoes
    .map((item) => {
      const v = asObj(item);
      const externalId = text(v.id);
      const skuCode = text(v.sku);
      return externalId && skuCode ? { externalId, skuCode, variantAttributes: normalizeGrade(v.grade) } : null;
    })
    .filter((v): v is OlistVariationRef => v !== null);
}

// Id do PAI no detalhe de uma variação (campo `produtoPai`).
export function extractV3ParentId(variationDetail: unknown): string | null {
  return text(asObj(asObj(variationDetail).produtoPai).id);
}

export interface OlistV3StockItem {
  externalId: string;
  sku: string | null;
}

// GET /estoque?dataAlteracao=... — só interessa QUEM teve o estoque alterado; o
// valor gravado vem sempre do detalhe do produto (uma fonte só).
export function extractV3StockItems(raw: unknown): OlistV3StockItem[] {
  const itens = asObj(raw).itens;
  if (!Array.isArray(itens)) return [];
  return itens
    .map((i) => {
      const o = asObj(i);
      const externalId = text(o.idProduto);
      return externalId ? { externalId, sku: text(o.sku) } : null;
    })
    .filter((i): i is OlistV3StockItem => i !== null);
}
