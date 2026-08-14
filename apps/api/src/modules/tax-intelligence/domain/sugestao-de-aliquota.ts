// Sugestão de reajuste da alíquota mantida à mão (13/08/2026).
//
// O CASO REAL. O lojista acompanha o próprio faturamento e mantém uma alíquota
// um pouco ACIMA da calculada, de propósito: errar imposto para cima subestima
// lucro no DRE e sobe o piso de preço — a direção segura. Ele reajusta sozinho
// conforme o faturamento cresce.
//
// O PROBLEMA que isto resolve. Um número absoluto só é conservador enquanto o
// calculado estiver abaixo dele. No Simples a alíquota SOBE com o faturamento,
// então o valor digitado inverte de sinal sozinho — vira subestimativa — justo
// quando o negócio cresce, e nada avisa.
//
// A ESCOLHA. Não corrigir automaticamente: sugerir, e deixar o lojista aprovar.
// Mesmo padrão de "Sugestão de ação do anúncio" que já existe no Ads. O número
// só muda se ele mandar.
//
// Função pura: sem Nest, sem banco, sem data. Recebe os dois percentuais e
// devolve a sugestão ou null.

export interface EntradaDeSugestao {
  // O que o lojista usa hoje, em PERCENTUAL (0-100). null = nunca definiu, e
  // então não há folga a preservar nem o que sugerir.
  aliquotaManualPct: number | null;
  // O que o RBT12 diz hoje, no mesmo formato.
  aliquotaCalculadaPct: number;
  // A folga que ele mantinha quando definiu o número — medida, não
  // configurada. Ver `medirFolga`.
  folgaPctPontos: number;
}

export interface SugestaoDeAliquota {
  // O que ele usa hoje.
  atualPct: number;
  // O que o RBT12 diz agora.
  calculadaPct: number;
  // Calculada + a folga que ele já mantinha. É o número do botão "Aplicar".
  sugeridaPct: number;
  folgaPreservadaPctPontos: number;
  // Quanto o número atual está ABAIXO do calculado. Sempre > 0 quando há
  // sugestão — é a exposição de fato, e o que justifica interromper o lojista.
  defasagemPctPontos: number;
}

// Arredondamento para 2 casas, que é a precisão da coluna no banco
// (DECIMAL(5,2)). Sugerir um número que o banco vai truncar produziria uma
// sugestão que, depois de aplicada, não bate com o que foi mostrado.
function duasCasas(valor: number): number {
  return Math.round(valor * 100) / 100;
}

// A folga é MEDIDA do próprio comportamento do lojista: a diferença entre o
// que ele usa e o que era calculado quando ele definiu. Não pedimos que ele
// cadastre "minha folga é 0,09" — ele já expressou isso ao escolher 7,30 sobre
// 7,21.
//
// Negativa vira zero: se o número dele já está abaixo do calculado, não havia
// folga a preservar, e sugerir "calculado menos alguma coisa" seria propor uma
// subestimativa.
export function medirFolga(aliquotaManualPct: number, aliquotaCalculadaPct: number): number {
  return duasCasas(Math.max(0, aliquotaManualPct - aliquotaCalculadaPct));
}

// null = nada a sugerir. Acontece em três casos, todos legítimos:
//   - o lojista nunca definiu alíquota manual (usa a calculada, nada a ajustar);
//   - a folga dele ainda é positiva (o número está acima do calculado, seguro);
//   - a diferença é menor que a precisão que conseguimos representar.
//
// Só interrompe quando o calculado PASSOU do número dele — que é exatamente o
// momento em que a margem de segurança deixou de existir.
export function calcularSugestao(entrada: EntradaDeSugestao): SugestaoDeAliquota | null {
  const { aliquotaManualPct, aliquotaCalculadaPct, folgaPctPontos } = entrada;

  if (aliquotaManualPct === null) return null;

  const defasagem = duasCasas(aliquotaCalculadaPct - aliquotaManualPct);
  if (defasagem <= 0) return null;

  const folga = Math.max(0, folgaPctPontos);
  const sugerida = duasCasas(aliquotaCalculadaPct + folga);

  // Sugerir o mesmo número que já está em uso não é sugestão. Pode acontecer
  // se a folga e a defasagem se cancelarem no arredondamento.
  if (sugerida <= aliquotaManualPct) return null;

  return {
    atualPct: aliquotaManualPct,
    calculadaPct: duasCasas(aliquotaCalculadaPct),
    sugeridaPct: sugerida,
    folgaPreservadaPctPontos: duasCasas(folga),
    defasagemPctPontos: defasagem,
  };
}
