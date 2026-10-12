// Resumo de um produto da API v3 do Olist para a verificação somente de
// leitura (ADR 0003). Função pura: recebe o JSON cru de GET /produtos/{id} e
// responde "quais campos o Kyneti precisa vieram, e com que valor?".
//
// Existe porque o OpenAPI da v3 diz uma coisa e a conta real pode devolver
// outra. Antes de qualquer sync v3, este resumo mostra o que chega de fato —
// em especial se uma VARIAÇÃO consultada pelo próprio id traz peso e dimensões.
//
// Nunca devolve URL de foto, observação ou texto livre: só números, contagens
// e nomes de campo.

export interface OlistV3ProductSummary {
  id: string | null;
  sku: string | null;
  tipo: string | null;
  tipoVariacao: string | null;
  campos: {
    precoCusto: number | null;
    preco: number | null;
    estoqueQuantidade: number | null;
    pesoLiquido: number | null;
    pesoBruto: number | null;
    largura: number | null;
    altura: number | null;
    comprimento: number | null;
    ncm: string | null;
    gtin: string | null;
    origem: string | null;
    categoria: string | null;
  };
  fotos: number;
  variacoes: {
    total: number;
    // Nomes das chaves presentes na 1ª variação — mostra se dimensões/anexos vêm dentro dela.
    chavesDaPrimeira: string[];
  };
  // Campos que o sync do Kyneti usa e que NÃO vieram preenchidos neste produto.
  ausentes: string[];
}

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
  return t === '' ? null : t.slice(0, 120);
}

export function summarizeV3Product(raw: unknown): OlistV3ProductSummary {
  const p = asObj(raw);
  const precos = asObj(p.precos);
  const estoque = asObj(p.estoque);
  const dimensoes = asObj(p.dimensoes);
  const categoria = asObj(p.categoria);
  const variacoes = Array.isArray(p.variacoes) ? p.variacoes : [];
  const anexos = Array.isArray(p.anexos) ? p.anexos : [];

  const campos = {
    precoCusto: num(precos.precoCusto),
    preco: num(precos.preco),
    estoqueQuantidade: num(estoque.quantidade),
    pesoLiquido: num(dimensoes.pesoLiquido),
    pesoBruto: num(dimensoes.pesoBruto),
    largura: num(dimensoes.largura),
    altura: num(dimensoes.altura),
    comprimento: num(dimensoes.comprimento),
    ncm: text(p.ncm),
    gtin: text(p.gtin),
    origem: text(p.origem),
    categoria: text(categoria.caminhoCompleto ?? categoria.nome),
  };

  // Mesmos campos que normalizeOlistProduct (v2) exige/usa. Zero em peso/medida
  // conta como ausente: é o que o Kyneti trata como "sem dimensão".
  const ausentes: string[] = [];
  if (campos.precoCusto === null) ausentes.push('precoCusto');
  if (campos.estoqueQuantidade === null) ausentes.push('estoque.quantidade');
  for (const chave of ['pesoLiquido', 'pesoBruto', 'largura', 'altura', 'comprimento'] as const) {
    if (!campos[chave]) ausentes.push(`dimensoes.${chave}`);
  }
  if (campos.ncm === null) ausentes.push('ncm');
  if (campos.gtin === null) ausentes.push('gtin');
  if (campos.origem === null) ausentes.push('origem');
  if (campos.categoria === null) ausentes.push('categoria');
  if (anexos.length === 0) ausentes.push('anexos');

  return {
    id: text(p.id),
    sku: text(p.sku),
    tipo: text(p.tipo),
    tipoVariacao: text(p.tipoVariacao),
    campos,
    fotos: anexos.length,
    variacoes: {
      total: variacoes.length,
      chavesDaPrimeira: variacoes.length > 0 ? Object.keys(asObj(variacoes[0])).sort() : [],
    },
    ausentes,
  };
}

// Item da listagem GET /produtos — só o que a verificação precisa para achar o id do SKU.
export interface OlistV3ListItem {
  id: string;
  sku: string | null;
  tipoVariacao: string | null;
  dataAlteracao: string | null;
}

export function extractListItems(raw: unknown): OlistV3ListItem[] {
  const itens = asObj(raw).itens;
  if (!Array.isArray(itens)) return [];
  return itens
    .map((item) => {
      const o = asObj(item);
      const id = text(o.id);
      return id ? { id, sku: text(o.sku), tipoVariacao: text(o.tipoVariacao), dataAlteracao: text(o.dataAlteracao) } : null;
    })
    .filter((item): item is OlistV3ListItem => item !== null);
}

export function extractListTotal(raw: unknown): number | null {
  return num(asObj(asObj(raw).paginacao).total);
}

// "YYYY-MM-DD HH:mm:ss" em UTC — formato do exemplo do OpenAPI do filtro dataAlteracao.
export function formatOlistV3Date(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
  );
}
