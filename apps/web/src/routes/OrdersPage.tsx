import OrderTable from '../components/orders/OrderTable';

export default function OrdersPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-ink-900">Pedidos</h1>
        <p className="mt-1 text-sm text-ink-500">
          Worklist unificada dos 7 canais do hub — cada pedido chega aqui já traduzido para o mesmo formato,
          independente do marketplace de origem.
        </p>
      </div>

      <OrderTable />
    </div>
  );
}
