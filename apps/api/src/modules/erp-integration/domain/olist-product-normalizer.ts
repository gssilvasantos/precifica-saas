// Normaliza a resposta de produto.obter.php (API V2 do Olist/Tiny) para o
// formato interno que o pipeline de sync consome. Espelha o papel do
// RulePayloadValidator no Marketplace Intelligence: rejeita (lança) em vez
// de persistir um payload malformado.
//
// AVISO DE HONESTIDADE (mesmo padrão usado no client do Mercado Livre):
// não foi possível validar os nomes exatos de campo contra uma resposta real
// e autenticada neste ambiente (mcp__workspace__web_fetch não retorna corpo
// de chamadas de API autenticadas — só documentação HTML). Os nomes abaixo
// vêm do conhecimento geral, bem documentado publicamente, da API V2 do
// Tiny/Olist. Antes de ativar isto contra uma conta real, rode um sync de
// teste e confira os logs de warning — qualquer campo ausente ou com nome
// diferente do esperado aparece ali em vez de silenciosamente virar 0/null.
export interface NormalizedOlistProduct {
  externalId: string;
  skuCode: string;
  name: string;
  costPrice: number;
  erpSalePrice: number | null;
  stockQuantity: number;
  weightKg: number;
  packagingWeightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  photoUrls: string[]; // URLs ORIGINAIS do Olist — ainda não espelhadas (isso é papel do ProductPhotoMirrorService)
}

export class InvalidOlistProductError extends Error {
  constructor(externalId: string, reason: string) {
    super(`Produto Olist ${externalId} rejeitado pelo normalizador: ${reason}`);
    this.name = 'InvalidOlistProductError';
  }
}

function toNumber(value: unknown, fallback: number | null = null): number | null {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

function extractPhotoUrls(raw: Record<string, unknown>): string[] {
  // A V2 expõe fotos como `anexos` (array de {anexo: url}) na maioria das
  // contas — algumas respostas trazem `imagens`/`imagem` em vez disso.
  // Tenta as variantes conhecidas e filtra só o que parece URL.
  const candidates: unknown[] = [];
  if (Array.isArray(raw.anexos)) candidates.push(...raw.anexos);
  if (Array.isArray(raw.imagens)) candidates.push(...raw.imagens);

  const urls = candidates
    .map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        return (obj.anexo ?? obj.url ?? obj.imagem) as string | undefined;
      }
      return undefined;
    })
    .filter((url): url is string => typeof url === 'string' && /^https?:\/\//.test(url));

  return Array.from(new Set(urls));
}

export function normalizeOlistProduct(rawEnvelope: unknown, stockOverride?: number): NormalizedOlistProduct {
  const raw = (rawEnvelope as { produto?: Record<string, unknown> })?.produto ?? (rawEnvelope as Record<string, unknown>);
  if (!raw || typeof raw !== 'object') {
    throw new InvalidOlistProductError('desconhecido', 'payload vazio ou não é um objeto.');
  }

  const externalId = String(raw.id ?? '');
  if (!externalId) throw new InvalidOlistProductError('desconhecido', 'sem campo "id".');

  const skuCode = String(raw.codigo ?? '').trim();
  if (!skuCode) throw new InvalidOlistProductError(externalId, 'sem campo "codigo" (SKU) — obrigatório para o vínculo com marketplaces.');

  const name = String(raw.nome ?? '').trim();
  if (!name) throw new InvalidOlistProductError(externalId, 'sem campo "nome".');

  const costPrice = toNumber(raw.preco_custo, 0) ?? 0;
  const erpSalePrice = toNumber(raw.preco);

  const stockQuantity = stockOverride ?? toNumber(raw.estoque_atual ?? raw.saldo, 0) ?? 0;

  const weightKg = toNumber(raw.peso_liquido, 0) ?? 0;
  const packedWeightRaw = toNumber(raw.peso_bruto);
  const packagingWeightKg = packedWeightRaw !== null ? Math.max(0, packedWeightRaw - weightKg) : 0;

  const lengthCm = toNumber(raw.comprimento, 0) ?? 0;
  const widthCm = toNumber(raw.largura, 0) ?? 0;
  const heightCm = toNumber(raw.altura, 0) ?? 0;

  if (lengthCm <= 0 || widthCm <= 0 || heightCm <= 0 || weightKg <= 0) {
    throw new InvalidOlistProductError(
      externalId,
      `dimensões/peso inválidos (peso=${weightKg}, L=${lengthCm}, W=${widthCm}, H=${heightCm}) — ` +
        'confira se o cadastro no Olist está completo para este SKU.',
    );
  }

  return {
    externalId,
    skuCode,
    name,
    costPrice,
    erpSalePrice,
    stockQuantity,
    weightKg,
    packagingWeightKg,
    lengthCm,
    widthCm,
    heightCm,
    photoUrls: extractPhotoUrls(raw),
  };
}
