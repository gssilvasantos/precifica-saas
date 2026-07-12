import { RawSettlementEntry, SettlementFileFormat, SettlementReportParser } from '../../../shared/contracts/settlement-report-parser.contract';

// Implementação de REFERÊNCIA — não um parser dedicado ao formato exato de
// nenhum marketplace específico (nunca vimos ao vivo o CSV/JSON real de
// liquidação da Nuvemshop, Mercado Livre, Shopee etc. neste ambiente, então
// inventar um parser "MercadoLivreSettlementParser" com colunas específicas
// seria fabricar um contrato sem base). Isso serve dois papéis:
//
// 1. Prova de que a arquitetura de registry funciona (é isto que fica
//    registrado sob o marketplaceCode "NUVEMSHOP" por padrão, ver
//    financial-intelligence.module.ts).
// 2. Um parser genuinamente utilizável: se o relatório exportado por um
//    canal já vier (ou puder ser convertido para) este formato simples —
//    JSON: array de { externalReference, amount, settledAt }; CSV: cabeçalho
//    external_reference,amount,settled_at — funciona sem nenhum código novo.
//
// Quando o formato REAL de um marketplace for confirmado (lendo a
// documentação oficial ou um arquivo de exemplo real), a substituição é
// trocar o parser registrado para aquele marketplaceCode — implementar
// SettlementReportParser de novo, sem tocar em ReceivableReconciliationService
// nem no registry.
export class GenericSettlementParser implements SettlementReportParser {
  constructor(public readonly marketplaceCode: string) {}

  parse(fileContent: string, format: SettlementFileFormat): RawSettlementEntry[] {
    return format === 'JSON' ? this.parseJson(fileContent) : this.parseCsv(fileContent);
  }

  private parseJson(fileContent: string): RawSettlementEntry[] {
    let raw: unknown;
    try {
      raw = JSON.parse(fileContent);
    } catch (error) {
      throw new Error(`Relatório de repasse (${this.marketplaceCode}) não é um JSON válido: ${(error as Error).message}`);
    }
    if (!Array.isArray(raw)) {
      throw new Error(`Relatório de repasse (${this.marketplaceCode}) precisa ser um array de registros.`);
    }
    return raw.map((entry, index) => this.toEntry(entry, index));
  }

  // Sem suporte a campos entre aspas/escapados — suficiente para o export
  // simples que a maioria dos painéis de marketplace oferece; se um export
  // real vier com campos entre aspas (ex.: nome de produto com vírgula),
  // este parser precisa de um parser de CSV de verdade (ex.: papaparse), não
  // este split ingênuo. Documentado como limitação honesta.
  private parseCsv(fileContent: string): RawSettlementEntry[] {
    const lines = fileContent
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (lines.length === 0) return [];

    const [header, ...rows] = lines;
    const columns = header.split(',').map((c) => c.trim());
    const externalRefIdx = columns.indexOf('external_reference');
    const amountIdx = columns.indexOf('amount');
    const settledAtIdx = columns.indexOf('settled_at');
    if (externalRefIdx === -1 || amountIdx === -1 || settledAtIdx === -1) {
      throw new Error(
        `CSV de repasse (${this.marketplaceCode}) precisa ter as colunas external_reference,amount,settled_at — recebido: ${header}`,
      );
    }

    return rows.map((row, index) => {
      const cells = row.split(',').map((c) => c.trim());
      return this.toEntry(
        {
          externalReference: cells[externalRefIdx],
          amount: cells[amountIdx],
          settledAt: cells[settledAtIdx],
        },
        index,
      );
    });
  }

  private toEntry(entry: unknown, index: number): RawSettlementEntry {
    const record = entry as Record<string, unknown>;
    const externalReference = record.externalReference;
    const amount = record.amount;
    const settledAt = record.settledAt;

    if (typeof externalReference !== 'string' || externalReference.length === 0) {
      throw new Error(`Registro ${index} do relatório de repasse (${this.marketplaceCode}) sem externalReference válido.`);
    }
    const amountNumber = typeof amount === 'number' ? amount : Number(amount);
    if (Number.isNaN(amountNumber)) {
      throw new Error(`Registro ${index} (${externalReference}) do relatório de repasse (${this.marketplaceCode}) com amount inválido: ${amount}`);
    }
    const settledAtDate = settledAt instanceof Date ? settledAt : new Date(String(settledAt));
    if (Number.isNaN(settledAtDate.getTime())) {
      throw new Error(`Registro ${index} (${externalReference}) do relatório de repasse (${this.marketplaceCode}) com settledAt inválido: ${settledAt}`);
    }

    return { externalReference, amount: amountNumber, settledAt: settledAtDate };
  }
}
