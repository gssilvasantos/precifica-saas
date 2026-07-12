// Abstração de "leitura de relatório financeiro de marketplace" — mesmo
// racional de ICompetitionRadar (shared/contracts/competition-radar.contract.ts):
// o sistema não pode saber, a priori, se o repasse chega como um CSV
// exportado manualmente do painel do marketplace, um JSON de uma API oficial
// de liquidação, ou (futuro) um webhook. `SettlementReportParser` isola essa
// variação atrás de um contrato único; `ReceivableReconciliationService`
// (financial-intelligence) só enxerga `RawSettlementEntry`, nunca o formato
// bruto do arquivo.

export type SettlementFileFormat = 'JSON' | 'CSV';

// Uma linha normalizada de repasse, já sem nenhum detalhe de formato de
// origem — o "dado" que importa para reconciliar contra ReceivableRecord.
export interface RawSettlementEntry {
  externalReference: string; // order id / settlement id no marketplace — chave de match
  amount: number;
  settledAt: Date;
}

export interface SettlementReportParser {
  readonly marketplaceCode: string; // "NUVEMSHOP" | "MERCADO_LIVRE" | ... — mesma convenção de string (não enum) do resto da plataforma
  parse(fileContent: string, format: SettlementFileFormat): RawSettlementEntry[];
}
