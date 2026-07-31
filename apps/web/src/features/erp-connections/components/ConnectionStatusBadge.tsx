// Mesmo padrão visual do StatusBadge usado no card do Mercado Livre
// (IntegracoesPage.tsx) — extraído aqui para ser reaproveitado pelos cards
// de Nuvemshop e Olist sem duplicar o markup.
export function ConnectionStatusBadge({ loading, connected }: { loading: boolean; connected: boolean }) {
  if (loading) {
    return <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">Verificando…</span>;
  }
  return (
    <span
      className={[
        'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium',
        connected ? 'bg-margin-good/15 text-margin-good' : 'bg-muted text-muted-foreground',
      ].join(' ')}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-margin-good' : 'bg-ink-500'}`} />
      {connected ? 'Conectado' : 'Desconectado'}
    </span>
  );
}
