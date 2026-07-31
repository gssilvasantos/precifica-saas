import { useAuth } from '../features/auth/auth-context';
import TaxProfilesSection from '../features/tax-profiles/components/TaxProfilesSection';
import DefaultMarginsForm from '../features/catalog-settings/components/DefaultMarginsForm';
import FinancialPolicyForm from '../features/catalog-settings/components/FinancialPolicyForm';

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
          Perfis fiscais por regime, margens padrão para produtos importados e o piso financeiro global aplicado a
          toda decisão de preço.
        </p>
        {!canEdit && (
          <p className="mt-2 text-xs text-muted-foreground">
            Você tem acesso somente leitura — edição é restrita ao papel Administrador.
          </p>
        )}
      </div>

      <TaxProfilesSection canEdit={canEdit} />
      <DefaultMarginsForm canEdit={canEdit} />
      <FinancialPolicyForm canEdit={canEdit} />
    </div>
  );
}
