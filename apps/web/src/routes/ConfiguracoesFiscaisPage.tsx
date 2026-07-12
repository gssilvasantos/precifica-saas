import ComingSoonPage from '../components/ComingSoonPage';

export default function ConfiguracoesFiscaisPage() {
  return (
    <ComingSoonPage
      title="Configurações Fiscais"
      description="O backend já tem TaxProfile (regime, alíquota estimada) e CatalogSettings (margem padrão de produto importado) prontos — falta só a tela de CRUD para editar sem curl."
    />
  );
}
