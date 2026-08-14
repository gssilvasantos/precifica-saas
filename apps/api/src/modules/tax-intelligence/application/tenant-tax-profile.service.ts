import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  NovoPerfilTributario,
  TENANT_TAX_PROFILE_REPOSITORY,
  TenantTaxProfileRecord,
  TenantTaxProfileRepository,
} from './ports/tax-repositories.port';
import { validarPerfilTributario } from '../domain/tenant-tax-profile-rules';
import { SugestaoDeAliquota, calcularSugestao, medirFolga } from '../domain/sugestao-de-aliquota';
import { TAX_RATE_RESOLVER } from '../../../shared/contracts/tokens';
import { TaxRateResolver, TaxRateUnavailableError } from '../../../shared/contracts/tax-rate-resolver.port';

// Caso de uso do cadastro de regime tributário (11/08/2026).
//
// Existe para tirar do ar a condição que deixava o módulo inteiro inútil: o
// Tax Intelligence sabia calcular, mas não havia como informar o regime, e o
// resolver bloqueava com REGIME_NAO_CONFIGURADO — comportamento correto e
// inutilizável ao mesmo tempo.
@Injectable()
export class TenantTaxProfileService {
  private readonly logger = new Logger(TenantTaxProfileService.name);

  constructor(
    @Inject(TENANT_TAX_PROFILE_REPOSITORY) private readonly repository: TenantTaxProfileRepository,
    // O próprio resolver do módulo, injetado pelo token como qualquer
    // consumidor. Usado só para a SUGESTÃO — o cálculo continua vivendo lá, e
    // este serviço não reimplementa RBT12.
    @Inject(TAX_RATE_RESOLVER) private readonly taxRates: TaxRateResolver,
  ) {}

  // O regime que vale HOJE. null = nunca configurado, e a UI precisa distinguir
  // isso de "configurado e vazio" para mostrar onboarding em vez de erro.
  async obterVigente(tenantId: string): Promise<TenantTaxProfileRecord | null> {
    return this.repository.findVigente(tenantId, new Date());
  }

  async listarHistorico(tenantId: string): Promise<TenantTaxProfileRecord[]> {
    return this.repository.listar(tenantId);
  }

  // Sugestão de reajuste da alíquota mantida à mão (13/08/2026).
  //
  // Só existe quando o lojista definiu um percentual próprio E o cálculo do
  // RBT12 ultrapassou esse número — ou seja, quando a margem de segurança dele
  // deixou de existir. Ver domain/sugestao-de-aliquota.ts.
  //
  // Devolve null em silêncio nos casos normais (sem regime, sem alíquota
  // manual, folga ainda positiva). Também engole TaxRateUnavailableError: uma
  // sugestão é informação secundária, e não pode derrubar a tela de
  // configuração justamente quando o que falta É a configuração.
  async obterSugestaoDeReajuste(tenantId: string): Promise<SugestaoDeAliquota | null> {
    const vigente = await this.repository.findVigente(tenantId, new Date());
    if (!vigente || vigente.aliquotaManual === null) return null;

    let calculadaPct: number;
    try {
      // `productId` vazio: a sugestão é sobre a alíquota da CONTA, não de um
      // SKU. O resolver ainda exige o perfil do produto para segregar ST e
      // monofásico — quando não consegue, cai no catch abaixo e não sugere.
      const calculada = await this.taxRates.resolve({ tenantId, productId: '', at: new Date() });
      calculadaPct = calculada.breakdown.aliquotaCheia !== undefined
        ? calculada.breakdown.aliquotaCheia * 100
        : calculada.effectiveRate * 100;
    } catch (erro) {
      if (erro instanceof TaxRateUnavailableError) return null;
      throw erro;
    }

    const manualPct = vigente.aliquotaManual * 100;

    return calcularSugestao({
      aliquotaManualPct: manualPct,
      aliquotaCalculadaPct: calculadaPct,
      // A folga é MEDIDA do comportamento dele, não configurada — ver o
      // comentário de medirFolga.
      folgaPctPontos: medirFolga(manualPct, calculadaPct),
    });
  }

  async definirRegime(
    tenantId: string,
    entrada: Omit<NovoPerfilTributario, 'tenantId'>,
  ): Promise<TenantTaxProfileRecord> {
    // Normaliza ANTES de validar, e só o valor normalizado é usado adiante.
    const uf = entrada.uf.trim().toUpperCase();

    const problemas = validarPerfilTributario({
      uf,
      regime: entrada.regime,
      anexo: entrada.anexo,
      vigenciaInicio: entrada.vigenciaInicio,
      meiValorFixoMensal: entrada.meiValorFixoMensal,
      icmsAliquotaPct: entrada.icmsAliquotaPct,
      presuncaoIrpjPct: entrada.presuncaoIrpjPct,
      presuncaoCsllPct: entrada.presuncaoCsllPct,
    });

    if (problemas.length > 0) {
      // Todos os campos inválidos de uma vez, com código estável para a UI
      // decidir comportamento sem depender do texto.
      throw new BadRequestException({
        code: 'PERFIL_TRIBUTARIO_INVALIDO',
        message: 'Configuração tributária inconsistente para o regime escolhido.',
        problemas,
      });
    }

    // Uma vigência nova não pode começar antes da que já existe: isso criaria
    // um passado alternativo para meses já apurados.
    const vigenteHoje = await this.repository.findVigente(tenantId, new Date());
    if (vigenteHoje && entrada.vigenciaInicio <= vigenteHoje.vigenciaInicio) {
      throw new BadRequestException({
        code: 'VIGENCIA_RETROATIVA',
        message:
          'A nova vigência precisa começar depois do início da vigência atual. ' +
          'Recalcular um período já apurado é uma correção contábil, não uma edição de cadastro.',
        problemas: [{ campo: 'vigenciaInicio', mensagem: 'Deve ser posterior ao início da vigência atual.' }],
      });
    }

    const criado = await this.repository.abrirNovaVigencia({ ...entrada, uf, tenantId });

    // Mudança de regime altera piso de preço e DRE do tenant inteiro — é
    // exatamente o tipo de mudança de governança que precisa de rastro.
    this.logger.log(
      `Regime tributário definido para o tenant ${tenantId}: ${criado.regime}` +
        `${criado.anexo ? ` (anexo ${criado.anexo})` : ''}, UF ${criado.uf}, ` +
        `vigente a partir de ${criado.vigenciaInicio.toISOString().slice(0, 10)}.`,
    );

    return criado;
  }
}
