import { TaxRegime } from '../../../shared/contracts/tax-rate-resolver.port';
import { SimplesAnexo } from './simples-nacional';

// Regras de coerência do perfil tributário do tenant (11/08/2026).
//
// Vivem no domínio, e não no DTO, porque não são validação de FORMA — são
// invariantes do negócio: quais campos um regime exige depende do regime, e
// errar isso não gera um 400 feio, gera piso de preço errado. O DTO garante
// que "aliquota é um número entre 0 e 100"; aqui garantimos que "Lucro
// Presumido sem presunção de IRPJ não é um cadastro válido".
//
// Função pura: sem Nest, sem Prisma, sem exceção lançada. Devolve a lista de
// problemas para que a fronteira possa reportar TODOS os campos inválidos de
// uma vez (.claude/rules/backend.md), em vez de um por requisição.

export const UFS_BRASIL = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
  'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN',
  'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const;

export type Uf = (typeof UFS_BRASIL)[number];

export function isUf(valor: string): valor is Uf {
  return (UFS_BRASIL as readonly string[]).includes(valor);
}

export interface PerfilTributarioInput {
  uf: string;
  regime: TaxRegime;
  anexo: SimplesAnexo | null;
  vigenciaInicio: Date;
  meiValorFixoMensal: number | null;
  // Percentuais (0–100), na convenção do schema. A conversão para fração
  // acontece no repositório, não aqui.
  icmsAliquotaPct: number | null;
  presuncaoIrpjPct: number | null;
  presuncaoCsllPct: number | null;
}

export interface ProblemaDePerfil {
  campo: string;
  mensagem: string;
}

export function validarPerfilTributario(input: PerfilTributarioInput): ProblemaDePerfil[] {
  const problemas: ProblemaDePerfil[] = [];

  if (!isUf(input.uf)) {
    problemas.push({ campo: 'uf', mensagem: `UF inválida: "${input.uf}".` });
  }

  if (Number.isNaN(input.vigenciaInicio.getTime())) {
    problemas.push({ campo: 'vigenciaInicio', mensagem: 'Data de início da vigência inválida.' });
  }

  switch (input.regime) {
    case 'SIMPLES_NACIONAL':
      // O anexo determina a TABELA de faixas inteira. Sem ele, resolveFaixa
      // não tem o que consultar e o resolver bloqueia com ANEXO_NAO_CONFERIDO.
      if (!input.anexo) {
        problemas.push({ campo: 'anexo', mensagem: 'Simples Nacional exige o anexo (I a V).' });
      }
      // ICMS já está dentro da partilha do DAS — pedir alíquota separada
      // levaria a cobrar o mesmo imposto duas vezes no piso.
      if (input.icmsAliquotaPct !== null) {
        problemas.push({
          campo: 'icmsAliquotaPct',
          mensagem: 'No Simples o ICMS já está na partilha do DAS — não informe alíquota separada.',
        });
      }
      break;

    case 'MEI_SIMEI':
      // Percentual nenhum está certo para MEI: o DAS é valor fixo mensal e não
      // varia com o faturamento até o teto.
      if (input.meiValorFixoMensal === null) {
        problemas.push({
          campo: 'meiValorFixoMensal',
          mensagem: 'MEI exige o valor fixo mensal do DAS (o imposto não é percentual).',
        });
      } else if (input.meiValorFixoMensal <= 0) {
        problemas.push({ campo: 'meiValorFixoMensal', mensagem: 'O DAS do MEI deve ser maior que zero.' });
      }
      if (input.anexo) {
        problemas.push({ campo: 'anexo', mensagem: 'MEI não tem anexo do Simples.' });
      }
      break;

    case 'LUCRO_PRESUMIDO':
    case 'LUCRO_REAL':
      if (input.anexo) {
        problemas.push({ campo: 'anexo', mensagem: 'Anexo do Simples não se aplica ao regime normal.' });
      }
      // Sem ICMS o piso ignoraria o maior tributo da operação.
      if (input.icmsAliquotaPct === null) {
        problemas.push({
          campo: 'icmsAliquotaPct',
          mensagem: 'Regime normal exige a alíquota interna de ICMS da UF.',
        });
      }
      if (input.regime === 'LUCRO_PRESUMIDO') {
        if (input.presuncaoIrpjPct === null) {
          problemas.push({
            campo: 'presuncaoIrpjPct',
            mensagem: 'Lucro Presumido exige o percentual de presunção do IRPJ (8% no comércio).',
          });
        }
        if (input.presuncaoCsllPct === null) {
          problemas.push({
            campo: 'presuncaoCsllPct',
            mensagem: 'Lucro Presumido exige o percentual de presunção da CSLL (12% no comércio).',
          });
        }
      }
      break;
  }

  return problemas;
}
