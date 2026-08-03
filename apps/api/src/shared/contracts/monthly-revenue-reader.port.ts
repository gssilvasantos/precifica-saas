// Porta de LEITURA exposta pelo Orders — consumida pelo Tax Intelligence para
// montar o RBT12 (receita bruta acumulada nos 12 meses anteriores ao período
// de apuração), que é a entrada da fórmula do Simples Nacional.
//
// POR QUE UMA PORTA NOVA, E NÃO OrderFinancialsReader.listForPeriod: aquele
// método carrega TODOS os pedidos do período com seus itens, e o próprio
// comentário dele avisa sobre escala. Para somar 12 meses de faturamento
// carregar pedido a pedido é desperdício — aqui a agregação acontece no banco.
//
// DTO autocontido, mesma disciplina das outras portas: o Tax Intelligence não
// conhece Order, OrderItem nem o enum de status do Orders.

export interface MonthlyRevenue {
  // Primeiro dia do mês de competência, em UTC.
  competencia: Date;
  receita: number;
}

export interface MonthlyRevenueReader {
  // Soma da receita bruta por mês no intervalo [from, to]. Meses SEM pedido
  // simplesmente não aparecem no resultado — quem consome decide se a ausência
  // significa "faturamento zero" ou "não temos esse período", porque só o
  // consumidor sabe desde quando a cobertura existe (ver firstOrderAt).
  //
  // Considera apenas dados REAIS (nunca pedidos do Modo de Demonstração):
  // alíquota calculada sobre faturamento fictício produziria preço fictício.
  sumByMonth(tenantId: string, from: Date, to: Date): Promise<MonthlyRevenue[]>;

  // Data do pedido mais antigo do tenant. É o que separa "mês sem venda" de
  // "mês anterior à nossa cobertura" — a distinção que decide entre somar zero
  // (correto) e bloquear pedindo o faturamento informado (também correto).
  // null = o tenant ainda não tem nenhum pedido.
  firstOrderAt(tenantId: string): Promise<Date | null>;
}
