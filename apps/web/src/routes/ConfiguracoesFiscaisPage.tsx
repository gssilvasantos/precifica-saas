import { useAuth } from '../features/auth/auth-context';
import RegimeTributarioSection from '../features/tax-regime/components/RegimeTributarioSection';
import FaturamentoAnteriorSection from '../features/tax-regime/components/FaturamentoAnteriorSection';
import TaxProfilesSection from '../features/tax-profiles/components/TaxProfilesSection';
import DefaultMarginsForm from '../features/catalog-settings/components/DefaultMarginsForm';
import FinancialPolicyForm from '../features/catalog-settings/components/FinancialPolicyForm';
import FiscalSettingsForm from '../features/fiscal-settings/components/FiscalSettingsForm';
import NaturezasOperacaoSection from '../features/fiscal-settings/components/NaturezasOperacaoSection';
import FiscalIntermediariesSection from '../features/fiscal-settings/components/FiscalIntermediariesSection';

// Bloco 3 do sprint de Layout/UI — CRUD real sobre contratos que já
// existiam por inteiro no backend (TaxProfile + as duas rotas de
// CatalogSettings). Leitura aberta a qualquer papel; escrita ADMIN-only em
// todos os três recursos, mesmo gate do backend (@Roles(ADMIN) em todo
// endpoint de escrita).
export default function ConfiguracoesFiscaisPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'ADMIN';

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-foreground">Configurações Fiscais</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Perfis fiscais por regime, margens padrão, piso financeiro global e os dados do emitente (CNPJ, CFOP,
          intermediador de marketplace) usados na emissão de NF-e.
        </p>
        {!canEdit && (
          <p className="mt-2 text-xs text-muted-foreground">
            Você tem acesso somente leitura — edição é restrita ao papel Administrador.
          </p>
        )}
      </div>

      {/* Primeiro na página de propósito: sem regime configurado, o piso de
          preço e o DRE bloqueiam, e todo o resto desta tela fica secundário. */}
      <RegimeTributarioSection canEdit={canEdit} />
      {/* Logo abaixo do regime: no Simples, a alíquota depende desta janela, e
          sem ela o cálculo bloqueia mesmo com o regime configurado. */}
      <FaturamentoAnteriorSection canEdit={canEdit} />
      <TaxProfilesSection canEdit={canEdit} />
      <DefaultMarginsForm canEdit={canEdit} />
      <FinancialPolicyForm canEdit={canEdit} />
      <FiscalSettingsForm canEdit={canEdit} />
      <NaturezasOperacaoSection canEdit={canEdit} />
      <FiscalIntermediariesSection canEdit={canEdit} />
    </div>
  );
}
