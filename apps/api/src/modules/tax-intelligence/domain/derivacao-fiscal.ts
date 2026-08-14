// Derivação da classificação fiscal a partir do NCM importado do ERP
// (13/08/2026).
//
// POR QUE EXISTE. O Olist já traz NCM, CEST e origem de todo produto. Pedir ao
// lojista que reclassifique 249 SKUs à mão, um por um, seria refazer à mão um
// dado que a fonte da verdade do catálogo já entrega.
//
// O QUE NÃO USAMOS, E POR QUÊ. O CEST NÃO entra na inferência. Ele é um campo
// que existe no cadastro do produto, não uma declaração de que a substituição
// tributária se aplica — o lojista preenche porque o campo está lá. Derivar
// `icmsSt = true` da presença do CEST retiraria a parcela de ICMS da partilha
// do DAS (ver `removidoIcmsSt` em tax-rate-resolver.port.ts), produzindo
// alíquota MENOR: imposto subestimado, margem superestimada — a direção de
// erro mais cara, e exatamente a que este módulo existe para evitar.
//
// Quem decide ST é o NCM combinado com a UF e a data, porque ST é regime
// ESTADUAL e muda por portaria.

import { isUf } from './tenant-tax-profile-rules';

// Lei 10.147/2000: PIS/Cofins monofásicos para perfumaria, cosméticos e
// higiene pessoal. Regra NACIONAL — não varia por estado nem por portaria
// estadual, o que a torna segura de derivar em qualquer UF.
const CAPITULOS_MONOFASICOS = ['3303', '3304', '3305', '3306', '3307'];

// Portaria SRE 94/2025: São Paulo retirou perfumaria e higiene pessoal do
// regime de substituição tributária a partir de 01/04/2026.
//
// Só SP está codificado, de propósito. A ST dos outros 26 estados é uma tabela
// por unidade federativa que muda por portaria; inventar isso seria pior que
// não ter. Fora de SP, esta função não afirma ST — devolve `null` e o produto
// segue sem classificação derivada, com o motor bloqueando até alguém
// classificar com fonte.
const SAIDA_DA_ST_SP = new Date(Date.UTC(2026, 3, 1)); // 01/04/2026

export interface EntradaDeDerivacao {
  // NCM do produto, como veio do ERP. Aceita com ou sem pontuação.
  ncm: string | null;
  // UF do estabelecimento — ST é regime estadual.
  uf: string;
  // Data de referência: a mesma classificação muda antes e depois de uma
  // portaria.
  at: Date;
}

export interface PerfilFiscalDerivado {
  icmsSt: boolean;
  monofasico: boolean;
  // A norma que fundamenta. Nunca 'MANUAL' — isto não foi decisão de ninguém,
  // foi aplicação de regra, e a resposta a "por que este SKU?" precisa ser a
  // lei.
  fonte: string;
}

function apenasDigitos(ncm: string): string {
  return ncm.replace(/\D/g, '');
}

// null = não há regra aplicável com fonte, e o produto NÃO recebe
// classificação derivada. É diferente de "classificado como não-ST": o motor
// continua bloqueando, e alguém decide com conhecimento de causa.
//
// Acontece quando: falta NCM, a UF não é SP (ver comentário de SAIDA_DA_ST_SP),
// ou o NCM não é de um capítulo que sabemos classificar.
export function derivarPerfilFiscal(entrada: EntradaDeDerivacao): PerfilFiscalDerivado | null {
  const { ncm, uf, at } = entrada;

  if (!ncm) return null;

  const digitos = apenasDigitos(ncm);
  if (digitos.length !== 8) return null;

  const ufNormalizada = uf.trim().toUpperCase();
  if (!isUf(ufNormalizada)) return null;

  const capitulo = digitos.slice(0, 4);
  const ehCosmetico = CAPITULOS_MONOFASICOS.includes(capitulo);
  if (!ehCosmetico) return null;

  // Monofásico é nacional e vale independentemente da UF.
  const monofasico = true;

  // ST: só afirmamos para SP, e só depois da portaria que tirou o segmento do
  // regime. Antes dela, ou em qualquer outra UF, não temos fonte para afirmar
  // nada — e afirmar `true` sem fonte seria justamente o erro que baixa a
  // alíquota.
  if (ufNormalizada !== 'SP') return null;
  if (at < SAIDA_DA_ST_SP) return null;

  return {
    icmsSt: false,
    monofasico,
    fonte: 'PORTARIA_SRE_94_2025',
  };
}
