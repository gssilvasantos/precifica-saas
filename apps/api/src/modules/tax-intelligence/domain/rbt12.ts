// Montagem do RBT12 — a receita bruta acumulada nos 12 meses anteriores ao
// período de apuração, que é a ÚNICA entrada variável da fórmula do Simples
// Nacional (art. 18, §1º-A da LC 123/2006).
//
// Domínio puro: recebe as receitas que alguém já buscou, decide de onde vem
// cada mês e devolve a soma com a procedência. Nenhum I/O.
//
// O PROBLEMA QUE ESTE ARQUIVO RESOLVE, e por que ele não é uma soma trivial:
// existem três estados diferentes para um mês sem receita registrada, e tratar
// os três como "zero" é exatamente o defeito que encontramos num PGDAS-D real.
//
//   1. Mês DENTRO da cobertura do Kyneti, sem pedido  -> faturamento zero, e
//      zero é a resposta certa.
//   2. Mês ANTERIOR à cobertura, com receita informada -> usa o informado.
//   3. Mês ANTERIOR à cobertura, sem nada             -> NÃO SABEMOS. Bloqueia.
//
// O caso 3 é real e comum: empresa que migrou do MEI para o Simples. A receita
// do período MEI conta no RBT12 (o SIMEI é forma de recolhimento DENTRO do
// Simples Nacional), e é o que o quadro de "receitas brutas anteriores" do
// PGDAS-D pede na primeira apuração pós-desenquadramento. Somar o que se tem e
// chamar de RBT12 produz alíquota MENOR que a devida — e imposto subestimado
// superestima margem, a direção de erro mais cara.

export type OrigemReceita = 'INFORMADA' | 'PEDIDOS_KYNETI';

export interface ReceitaMensal {
  competencia: Date; // qualquer data dentro do mês; normalizada internamente
  receita: number;
}

export interface MesResolvido {
  competencia: string; // 'YYYY-MM'
  receita: number;
  origem: OrigemReceita;
}

export interface Rbt12Input {
  // Período de apuração. Os 12 meses considerados são os ANTERIORES a ele —
  // o mês corrente nunca entra no próprio RBT12.
  periodoApuracao: Date;
  receitasDePedidos: ReceitaMensal[];
  // Receita informada pelo usuário/contador (inclusive o período MEI). Tem
  // precedência sobre pedidos: é o número declarado, e uma correção manual
  // precisa poder sobrepor o que o sistema calculou.
  receitasInformadas: ReceitaMensal[];
  // Data do pedido mais antigo do tenant. null = nenhuma cobertura ainda,
  // então TODO mês depende de receita informada.
  inicioDaCobertura: Date | null;
}

export interface Rbt12Result {
  rbt12: number;
  meses: MesResolvido[];
}

export class Rbt12IncompletoError extends Error {
  constructor(readonly mesesFaltantes: string[]) {
    super(
      `RBT12 incompleto: faltam ${mesesFaltantes.length} mês(es) de faturamento anterior à cobertura do Kyneti ` +
        `(${mesesFaltantes.join(', ')}). O cálculo foi BLOQUEADO em vez de assumir zero — ` +
        'somar histórico parcial produz alíquota menor que a devida. ' +
        'Informe o faturamento desses meses (é o mesmo dado do quadro "receitas brutas anteriores" do PGDAS-D).',
    );
    this.name = 'Rbt12IncompletoError';
  }
}

// Chave de mês em UTC. Usamos string 'YYYY-MM' em vez de Date como chave
// porque duas Date do mesmo mês não são iguais por referência nem por valor.
export function chaveDeMes(data: Date): string {
  const ano = data.getUTCFullYear();
  const mes = String(data.getUTCMonth() + 1).padStart(2, '0');
  return `${ano}-${mes}`;
}

function indexarPorMes(receitas: ReceitaMensal[]): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const r of receitas) {
    const chave = chaveDeMes(r.competencia);
    // Soma em vez de sobrescrever: a fonte pode trazer o mesmo mês em mais de
    // uma linha (canais diferentes, por exemplo).
    mapa.set(chave, (mapa.get(chave) ?? 0) + r.receita);
  }
  return mapa;
}

// Os 12 meses anteriores ao período de apuração, do mais antigo ao mais
// recente. PA de 06/2026 -> de 06/2025 a 05/2026.
function mesesAnteriores(periodoApuracao: Date): string[] {
  const chaves: string[] = [];
  for (let i = 12; i >= 1; i--) {
    const d = new Date(
      Date.UTC(periodoApuracao.getUTCFullYear(), periodoApuracao.getUTCMonth() - i, 1),
    );
    chaves.push(chaveDeMes(d));
  }
  return chaves;
}

export function calcularRbt12(input: Rbt12Input): Rbt12Result {
  const informadas = indexarPorMes(input.receitasInformadas);
  const dePedidos = indexarPorMes(input.receitasDePedidos);
  const cobertura = input.inicioDaCobertura ? chaveDeMes(input.inicioDaCobertura) : null;

  const meses: MesResolvido[] = [];
  const faltantes: string[] = [];

  for (const chave of mesesAnteriores(input.periodoApuracao)) {
    const informada = informadas.get(chave);
    if (informada !== undefined) {
      meses.push({ competencia: chave, receita: informada, origem: 'INFORMADA' });
      continue;
    }

    // Comparação de strings 'YYYY-MM' é ordenação cronológica correta — é o
    // motivo de a chave ser zero-padded.
    const dentroDaCobertura = cobertura !== null && chave >= cobertura;
    if (dentroDaCobertura) {
      // Ausência aqui significa mês sem venda, e zero é a resposta certa.
      meses.push({ competencia: chave, receita: dePedidos.get(chave) ?? 0, origem: 'PEDIDOS_KYNETI' });
      continue;
    }

    faltantes.push(chave);
  }

  if (faltantes.length > 0) throw new Rbt12IncompletoError(faltantes);

  return { rbt12: meses.reduce((acc, m) => acc + m.receita, 0), meses };
}
