// Parser de importação em massa de MAP via planilha — HONESTIDADE TÉCNICA
// (mesmo padrão de GenericSettlementParser, financial-intelligence): aceita
// CSV puro (cabeçalho sku_code,map_price), não faz parsing binário de
// .xlsx — se o fornecedor manda um .xlsx de verdade, o usuário precisa
// exportar/salvar como CSV antes de importar (Excel/Sheets fazem isso em 2
// cliques). Implementar parsing de .xlsx binário exigiria uma dependência
// nova (ex.: pacote `xlsx`) que este projeto não tem hoje — trocar depois é
// uma mudança isolada a este arquivo, sem tocar em BulkMapPriceImportService.
//
// Sem suporte a campos entre aspas/escapados — mesma limitação documentada
// de GenericSettlementParser.parseCsv.
export interface MapPriceImportRow {
  rowNumber: number; // 1-based, contando a partir da primeira linha de DADOS (sem o cabeçalho) — para a mensagem de erro apontar a linha certa na planilha original
  skuCode: string;
  mapPrice: number | null; // null = célula vazia = "limpar o MAP deste SKU"
}

export interface MapPriceImportError {
  rowNumber: number;
  message: string;
}

export interface MapPriceImportParseResult {
  rows: MapPriceImportRow[];
  errors: MapPriceImportError[];
}

const REQUIRED_COLUMNS = ['sku_code', 'map_price'] as const;

// Nunca lança — erros de linha são coletados e devolvidos, nunca abortam o
// parsing das demais linhas (para o usuário ver TODOS os problemas de uma
// vez, não corrigir um erro por vez a cada tentativa). Quem decide se
// aplica algo com erros presentes é BulkMapPriceImportService (política:
// tudo-ou-nada), não este parser.
export function parseMapPriceImportCsv(fileContent: string): MapPriceImportParseResult {
  const lines = fileContent
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return { rows: [], errors: [{ rowNumber: 0, message: 'Arquivo CSV vazio.' }] };
  }

  const [header, ...dataLines] = lines;
  const columns = header.split(',').map((c) => c.trim().toLowerCase());
  const skuIdx = columns.indexOf('sku_code');
  const mapPriceIdx = columns.indexOf('map_price');

  if (skuIdx === -1 || mapPriceIdx === -1) {
    return {
      rows: [],
      errors: [
        {
          rowNumber: 0,
          message: `Cabeçalho do CSV precisa conter as colunas ${REQUIRED_COLUMNS.join(',')} — recebido: ${header}`,
        },
      ],
    };
  }

  const rows: MapPriceImportRow[] = [];
  const errors: MapPriceImportError[] = [];

  dataLines.forEach((line, index) => {
    const rowNumber = index + 1;
    const cells = line.split(',').map((c) => c.trim());
    const skuCode = cells[skuIdx];
    const mapPriceRaw = cells[mapPriceIdx];

    if (!skuCode) {
      errors.push({ rowNumber, message: 'sku_code vazio.' });
      return;
    }

    // Célula vazia = null (limpar MAP) — diferente de um valor presente mas
    // inválido, que é erro. Mesma distinção undefined/null já usada em
    // diffGovernanceFields, só que aqui a "ausência" vem de uma célula
    // vazia na planilha, não de uma chave ausente no JSON.
    if (mapPriceRaw === undefined || mapPriceRaw === '') {
      rows.push({ rowNumber, skuCode, mapPrice: null });
      return;
    }

    const mapPrice = Number(mapPriceRaw);
    if (Number.isNaN(mapPrice) || mapPrice <= 0) {
      errors.push({ rowNumber, message: `map_price inválido para SKU ${skuCode}: "${mapPriceRaw}" (precisa ser um número maior que zero, ou vazio para limpar o MAP).` });
      return;
    }

    rows.push({ rowNumber, skuCode, mapPrice });
  });

  return { rows, errors };
}
