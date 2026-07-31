import OrderTable from '../components/orders/OrderTable';

// Retrofit shadcn/ui (fase pós-Projetos Estruturantes, 29/07/2026) — header
// migrado para os tokens semânticos (foreground/muted-foreground), mesmo
// padrão já aplicado em DashboardPage/Sidebar/AppLayout. O grosso do
// trabalho visual desta tela vive em OrderTable.tsx.
export default function OrdersPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-foreground">Pedidos</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Worklist unificada dos 7 canais do hub — cada pedido chega aqui já traduzido para o mesmo formato,
          independente do marketplace de origem.
        </p>
      </div>

      <OrderTable />
    </div>
  );
}
