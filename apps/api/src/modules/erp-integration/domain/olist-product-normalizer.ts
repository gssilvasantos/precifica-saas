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
  // false = o cadastro no Olist está sem peso ou sem dimensões. O produto é
  // importado assim mesmo (ver o comentário longo em normalizeOlistProduct);
  // este sinal existe para o sync avisar o usuário e para o motor de preço
  // saber que não pode estimar frete deste SKU.
  hasCompleteDimensions: boolean;
  photoUrls: string[]; // URLs ORIGINAIS do Olist — ainda não espelhadas (isso é papel do ProductPhotoMirrorService)

  // Campos fiscais (02/08/2026). Ausentes até aqui, o que deixava o catálogo
  // importado sem NCM — e sem NCM não há como classificar o produto para fins
  // tributários (substituição tributária e monofásico são definidos pelo NCM,
  // não pelo SKU), nem emitir NF-e, nem publicar anúncio.
  //
  // null é resultado LEGÍTIMO: cadastro incompleto no Olist é comum, e um
  // produto sem NCM lá não deve ser rejeitado por isso — diferente de peso e
  // dimensões, que quebram o cálculo de frete e por isso rejeitam. O produto
  // entra sem NCM e aparece marcado na tela do catálogo.
  ncm: string | null;
  cest: string | null;
  gtin: string | null;
  fiscalOriginCode: number | null;

  // Caminho da categoria no ERP, já quebrado em níveis:
  // `ROSTO > BASE > BASE LÍQUIDA` vira `['ROSTO', 'BASE', 'BASE LÍQUIDA']`.
  //
  // A categoria do Kyneti é do USUÁRIO — ele organiza como quiser, e essa
  // estrutura não tem por que espelhar a do ERP. Por isso o sync apenas
  // REGISTRA o caminho de origem (em Product.internalCategory, texto livre);
  // transformar isso na árvore estruturada de ProductCategory é uma ação
  // separada e explícita, oferecida como conveniência de migração.
  // Ver OlistCategoryImportService.
  categoryPath: string[];
}

// Referência a uma variação, extraída do detalhe do produto PAI.
//
// No Olist a variação não aparece em produtos.pesquisa.php — só o pai aparece,
// com a lista de variações dentro do próprio detalhe. Cada variação tem id
// próprio e é buscável por produto.obter.php como qualquer produto.
//
// Isto é o que explica os "340 produtos" da tela do ERP contra as ~937 SKUs
// reais: a contagem "variações 135" conta PAIS que têm variação, não as
// variações. Ver docs/olist-import-design.md, seção 5.1.
export interface OlistVariationRef {
  externalId: string;
  skuCode: string;
  // Atributos que distinguem esta variação (Cor, Tamanho, Volume...).
  variantAttributes: Record<string, string>;
}

export class InvalidOlistProductError extends Error {
  constructor(externalId: string, reason: string) {
    super(`Produto Olist ${externalId} rejeitado pelo normalizador: ${reason}`);
    this.name = 'InvalidOlistProductError';
  }
}

// Lê o primeiro apelido PRESENTE, não o primeiro que dá número diferente de
// zero. A distinção importa: uma medida legitimamente cadastrada como 0 no ERP
// deve ficar 0, e não cair no apelido seguinte procurando um valor melhor.
// Só a AUSÊNCIA do campo (undefined/null) faz seguir para o próximo nome.
function primeiroNumero(raw: Record<string, unknown>, apelidos: string[]): number {
  for (const apelido of apelidos) {
    const valor = raw[apelido];
    if (valor === undefined || valor === null || valor === '') continue;
    return toNumber(valor, 0) ?? 0;
  }
  return 0;
}

function toNumber(value: unknown, fallback: number | null = null): number | null {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

// Texto opcional vindo do ERP: string vazia e espaço em branco viram null.
// Guardar "" como se fosse um NCM preenchido esconderia o produto do filtro de
// "sem NCM", que é justamente onde o usuário vai procurar o que falta.
function toOptionalText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const texto = String(value).trim();
  return texto === '' ? null : texto;
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

// A `grade` de uma variação chega em duas formas conhecidas na V2: objeto
// simples (`{"Cor": "Vermelho"}`) ou lista de pares
// (`[{"chave": "Cor", "valor": "Vermelho"}]`). Aceita as duas — errar a forma
// aqui produziria variações sem atributo nenhum, indistinguíveis entre si na
// tela.
function normalizeGrade(grade: unknown): Record<string, string> {
  const atributos: Record<string, string> = {};

  if (Array.isArray(grade)) {
    for (const item of grade) {
      const par = (item as { variacao?: Record<string, unknown> })?.variacao ?? (item as Record<string, unknown>);
      const chave = toOptionalText(par?.chave ?? par?.tipo);
      const valor = toOptionalText(par?.valor);
      if (chave && valor) atributos[chave] = valor;
    }
    return atributos;
  }

  if (grade && typeof grade === 'object') {
    for (const [chave, valor] of Object.entries(grade as Record<string, unknown>)) {
      const texto = toOptionalText(valor);
      if (texto) atributos[chave] = texto;
    }
  }

  return atributos;
}

// A categoria chega como texto (`"ROSTO > BASE > BASE LÍQUIDA"`) na maioria
// das contas, e como objeto com `caminhoCompleto`/`descricao` em outras.
// Separadores observados: ` > ` e ` >> `.
//
// Nível vazio é descartado: `"ROSTO >  > BASE"` vira dois níveis, não três com
// um buraco no meio — um nó sem nome quebraria a árvore de ProductCategory.
export function parseCategoryPath(categoria: unknown): string[] {
  const bruto =
    typeof categoria === 'object' && categoria !== null
      ? ((categoria as Record<string, unknown>).caminhoCompleto ??
        (categoria as Record<string, unknown>).descricao ??
        (categoria as Record<string, unknown>).nome)
      : categoria;

  const texto = toOptionalText(bruto);
  if (!texto) return [];

  return texto
    .split(/\s*>+\s*/)
    .map((nivel) => nivel.trim())
    .filter((nivel) => nivel !== '');
}

export function extractVariationRefs(rawEnvelope: unknown): OlistVariationRef[] {
  const raw = (rawEnvelope as { produto?: Record<string, unknown> })?.produto ?? (rawEnvelope as Record<string, unknown>);
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.variacoes)) return [];

  return raw.variacoes
    .map((item) => {
      // Envelope `{ variacao: {...} }` é a forma documentada; alguns retornos
      // trazem o objeto direto.
      const v = ((item as { variacao?: Record<string, unknown> })?.variacao ?? item) as Record<string, unknown>;
      const externalId = toOptionalText(v?.id);
      const skuCode = toOptionalText(v?.codigo);
      if (!externalId || !skuCode) return null;
      return { externalId, skuCode, variantAttributes: normalizeGrade(v.grade ?? v.variacoes) };
    })
    .filter((v): v is OlistVariationRef => v !== null);
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

  // CAUSA RAIZ DAS 1.803 REJEIÇÕES (11/08/2026).
  //
  // Estes três campos eram lidos como `comprimento`, `largura` e `altura`.
  // Esses nomes NÃO EXISTEM no retorno de produto.obter.php: a API do
  // Tiny/Olist nomeia as medidas com o sufixo de embalagem. Confirmado na
  // documentação oficial de dois endpoints:
  //   tiny.com.br/api-docs/api2-produtos-obter
  //   tiny.com.br/api-docs/api2-produtos-incluir
  //
  // Era um zero silencioso, exatamente o modo de falha que o cabeçalho deste
  // arquivo já avisava ser possível: `raw.comprimento` é undefined, toNumber
  // devolve o fallback 0, e o produto parece ter dimensão zero. Foi o que
  // rejeitou 1.803 de 1.804 SKUs no sync de 03/08 — o peso vinha certo
  // (peso_liquido está em snake_case e é lido corretamente), as três medidas
  // vinham zeradas. Os produtos nunca estiveram incompletos.
  //
  // POR QUE LER VÁRIOS APELIDOS: as duas páginas oficiais divergem na grafia
  // — `alturaEmbalagem` em obter, `altura_embalagem` em incluir. Em vez de
  // apostar numa, lê as duas, e mantém o nome isolado como último recurso
  // (barato, e cobre qualquer conta/endpoint que realmente o devolva). A
  // ordem importa: camelCase primeiro, porque obter é o endpoint que este
  // normalizador consome.
  const lengthCm = primeiroNumero(raw, ['comprimentoEmbalagem', 'comprimento_embalagem', 'comprimento']);
  const widthCm = primeiroNumero(raw, ['larguraEmbalagem', 'largura_embalagem', 'largura']);
  const heightCm = primeiroNumero(raw, ['alturaEmbalagem', 'altura_embalagem', 'altura']);

  // DIMENSÃO/PESO FALTANDO NÃO REJEITA MAIS O PRODUTO (03/08/2026).
  //
  // Até aqui isto lançava InvalidOlistProductError. O primeiro sync real
  // contra a conta mostrou o custo dessa escolha: das 1.804 SKUs encontradas,
  // 1.803 foram rejeitadas — o Olist tem o peso preenchido e as dimensões
  // zeradas. A integração importava ZERO.
  //
  // O raciocínio original não era absurdo (dimensão alimenta peso cubado, que
  // define frete), mas a conclusão era: jogar fora custo, estoque, NCM,
  // categoria e SKU por causa de um campo que talvez nem seja usado naquele
  // canal é pior do que importar o produto marcado como incompleto.
  //
  // É a mesma correção de filosofia já aplicada ao NCM e ao perfil fiscal:
  // falta de informação vira SINAL, não descarte. Quem deve bloquear é o motor
  // de preço, no momento em que a dimensão faz falta — não o importador.
  const hasCompleteDimensions = weightKg > 0 && lengthCm > 0 && widthCm > 0 && heightCm > 0;

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
    hasCompleteDimensions,
    photoUrls: extractPhotoUrls(raw),
    // Nomes conforme produto.obter.php da API V2 do Olist/Tiny. Vale aqui o
    // mesmo aviso de honestidade do topo do arquivo: se algum vier com nome
    // diferente numa conta real, o efeito é o campo ficar null e o produto
    // aparecer marcado como "sem NCM" no catálogo — nunca um valor errado
    // gravado silenciosamente.
    ncm: toOptionalText(raw.ncm),
    cest: toOptionalText(raw.cest),
    // A V2 usa `gtin` na maioria das contas; algumas respostas trazem `ean`.
    gtin: toOptionalText(raw.gtin ?? raw.ean),
    fiscalOriginCode: toNumber(raw.origem),
    categoryPath: parseCategoryPath(raw.categoria),
  };
}
