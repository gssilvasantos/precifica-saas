import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  NovoPerfilTributario,
  TENANT_TAX_PROFILE_REPOSITORY,
  TenantTaxProfileRecord,
  TenantTaxProfileRepository,
} from './ports/tax-repositories.port';
import { validarPerfilTributario } from '../domain/tenant-tax-profile-rules';

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
  ) {}

  // O regime que vale HOJE. null = nunca configurado, e a UI precisa distinguir
  // isso de "configurado e vazio" para mostrar onboarding em vez de erro.
  async obterVigente(tenantId: string): Promise<TenantTaxProfileRecord | null> {
    return this.repository.findVigente(tenantId, new Date());
  }

  async listarHistorico(tenantId: string): Promise<TenantTaxProfileRecord[]> {
    return this.repository.listar(tenantId);
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
