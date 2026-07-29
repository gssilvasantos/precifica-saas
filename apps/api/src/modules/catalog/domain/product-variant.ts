// Produto Pai + Variação (Fase 2, benchmark Tiny ERP, 28/07/2026) — ver
// docs/tiny-erp-benchmark-analysis.md, seção 2.3, e
// docs/product-variants-architecture.md. Funções PURAS que decidem a
// hierarquia — nenhuma chamada a Prisma aqui, mesma disciplina de todo
// domínio nesta base (ex.: stock-movement-audit-event.entity.ts).
import { Product } from './product.entity';

export interface GateCheck {
  ok: boolean;
  reason?: string;
}

// Grade de atributos — chave/valor livre (ex.: {"Cor": "Azul", "Tamanho": "P"}).
// Precisa de pelo menos um par: uma variação sem NENHUM atributo não se
// diferencia em nada do pai, o que indica erro de cadastro.
export type VariantAttributes = Record<string, string>;

export function isVariant(product: Pick<Product, 'parentProductId'>): boolean {
  return product.parentProductId !== null;
}

export function isValidVariantAttributes(attributes: VariantAttributes | null | undefined): boolean {
  if (!attributes || typeof attributes !== 'object') return false;
  const entries = Object.entries(attributes);
  if (entries.length === 0) return false;
  return entries.every(([key, value]) => key.trim().length > 0 && typeof value === 'string' && value.trim().length > 0);
}

// A hierarquia é deliberadamente de UM nível só (ver comentário em
// prisma/schema.prisma, model Product) — nenhuma variação pode virar pai, e
// nenhum pai (produto com filhos) pode virar variação. As duas checagens
// exigem dados que só a camada de aplicação tem (o candidato a pai existe? é
// ele mesmo uma variação? o produto que está virando variação já tem
// filhos?) — por isso o service monta o contexto e chama esta função pura
// para decidir, nunca decide sozinho.
export function canSetParent(params: {
  productId: string;
  candidateParentId: string;
  candidateParent: Pick<Product, 'id' | 'parentProductId'> | null;
  productHasChildren: boolean;
}): GateCheck {
  const { productId, candidateParentId, candidateParent, productHasChildren } = params;

  if (productId === candidateParentId) {
    return { ok: false, reason: 'Um produto não pode ser variação de si mesmo.' };
  }
  if (!candidateParent) {
    return { ok: false, reason: `Produto pai ${candidateParentId} não encontrado para este tenant.` };
  }
  if (candidateParent.parentProductId !== null) {
    return {
      ok: false,
      reason: 'O produto escolhido como pai já é uma variação de outro produto — hierarquia limitada a um nível.',
    };
  }
  if (productHasChildren) {
    return {
      ok: false,
      reason: 'Este produto já tem variações vinculadas a ele — não pode virar variação de outro produto.',
    };
  }
  return { ok: true };
}

// Geração automática de combinações de variação (Quick Win 5, benchmark
// Bling, docs/bling-erp-benchmark-analysis.md, seção 1.5 — espelha
// `POST /produtos/variacoes/atributos/gerar-combinacoes`). Em vez de
// cadastrar "Camiseta Azul P", "Camiseta Azul M", ... uma por uma, o
// lojista informa a grade de atributos (nome + lista de opções) e recebe
// o produto cartesiano pronto. Função pura — nenhuma chamada a Prisma, nem
// geração de skuCode aqui (isso mora em buildVariantSkuCode/buildVariantName
// abaixo, também puras).
export interface VariantAttributeDefinition {
  name: string;
  options: string[];
}

export function isValidAttributeDefinitions(
  definitions: VariantAttributeDefinition[] | null | undefined,
): boolean {
  if (!definitions || definitions.length === 0) return false;
  return definitions.every(
    (def) =>
      typeof def.name === 'string' &&
      def.name.trim().length > 0 &&
      Array.isArray(def.options) &&
      def.options.length > 0 &&
      def.options.every((option) => typeof option === 'string' && option.trim().length > 0),
  );
}

// Produto cartesiano das opções de cada atributo, na ordem em que os
// atributos foram informados. Ex.: [{name:"Cor",options:["Azul","Verde"]},
// {name:"Tamanho",options:["P","M"]}] -> 4 combinações (Azul/P, Azul/M,
// Verde/P, Verde/M). Começa de [{}] (uma combinação vazia) e vai
// "multiplicando" um atributo de cada vez via flatMap — é o jeito padrão
// de computar produto cartesiano sem loop aninhado explícito.
export function generateVariantCombinations(
  definitions: VariantAttributeDefinition[],
): VariantAttributes[] {
  return definitions.reduce<VariantAttributes[]>(
    (combinations, def) => combinations.flatMap((combo) => def.options.map((option) => ({ ...combo, [def.name]: option }))),
    [{}],
  );
}

// Normaliza um valor de atributo pra virar pedaço de SKU: sem acento, sem
// espaço, maiúsculo, só A-Z0-9 e hífen. "Azul Marinho" -> "AZUL-MARINHO".
// Faixa Unicode "Combining Diacritical Marks" (U+0300 a U+036F) — construída
// via String.fromCharCode em vez de literal na regex pra evitar qualquer
// ambiguidade de encoding no arquivo-fonte entre editores/SOs diferentes.
const DIACRITIC_MARKS_REGEX = new RegExp(`[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`, 'g');

function slugifyAttributeValue(value: string): string {
  return value
    .normalize('NFD')
    .replace(DIACRITIC_MARKS_REGEX, '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// SKU da variação = SKU do pai + um sufixo por atributo, na mesma ordem das
// definições (garante determinismo — não depende da ordem de iteração de
// chaves do objeto `combo`).
export function buildVariantSkuCode(
  baseSkuCode: string,
  combination: VariantAttributes,
  definitions: VariantAttributeDefinition[],
): string {
  const suffix = definitions.map((def) => slugifyAttributeValue(combination[def.name])).join('-');
  return `${baseSkuCode}-${suffix}`;
}

// Nome da variação = nome do pai + "(Azul / P)".
export function buildVariantName(
  baseName: string,
  combination: VariantAttributes,
  definitions: VariantAttributeDefinition[],
): string {
  const label = definitions.map((def) => combination[def.name]).join(' / ');
  return `${baseName} (${label})`;
}
