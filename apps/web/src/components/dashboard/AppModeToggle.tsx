import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppMode } from '../../features/app-mode/app-mode-context';
import { fetchAuditStatus, seedAuditData, clearAuditData } from '../../features/app-mode/api';
import { fetchAdsAuditStatus, seedAdsAuditData, clearAdsAuditData } from '../../features/ads/api';
import { Button } from '../ui/button';
import { Separator } from '../ui/separator';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '../ui/dropdown-menu';

// Modo de Demonstração / Audit Mode (ver docs/audit-mode.md) — botão
// DISCRETO, visível/ativo só para Admin (mesma exigência do briefing e dos
// endpoints /audit-mode no backend). Para qualquer outro papel, o componente
// não renderiza nada — nem um botão desabilitado, para não sugerir que a
// funcionalidade existe para quem não pode usá-la.
//
// Migrado de um painel hand-rolled (div absoluta + estado `open` manual, sem
// fechar no Escape/clique fora) para DropdownMenu (Radix) — o CONTEÚDO
// continua o mesmo (status + toggle Real/Demo + ações), só o mecanismo de
// abrir/fechar/foco agora é acessível de verdade. Os controles internos são
// <Button>, não <DropdownMenuItem>, de propósito: um clique em "Semear
// dados" não deve fechar o painel no meio da mutação.
export default function AppModeToggle() {
  const { mode, canToggle, setMode } = useAppMode();
  const queryClient = useQueryClient();

  const statusQuery = useQuery({
    queryKey: ['audit-mode-status'],
    queryFn: fetchAuditStatus,
    enabled: canToggle,
  });

  // Bloco 1 (Dashboard de Ads) — o mesmo botão "Semear dados de
  // demonstração" também popula campanhas/sugestões fictícias do módulo de
  // Ads (AdsAuditSeederService), não só os 10 pedidos de Orders. Um único
  // clique deixa o tenant inteiro pronto pra demonstração, em vez de dois
  // botões separados que alguém pode esquecer de acionar junto.
  const adsStatusQuery = useQuery({
    queryKey: ['ads-audit-mode-status'],
    queryFn: fetchAdsAuditStatus,
    enabled: canToggle,
  });

  const seedMutation = useMutation({
    mutationFn: async () => {
      await Promise.all([seedAuditData(), seedAdsAuditData()]);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['audit-mode-status'] });
      void queryClient.invalidateQueries({ queryKey: ['ads-audit-mode-status'] });
      void queryClient.invalidateQueries();
    },
  });

  const clearMutation = useMutation({
    mutationFn: async () => {
      await Promise.all([clearAuditData(), clearAdsAuditData()]);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['audit-mode-status'] });
      void queryClient.invalidateQueries({ queryKey: ['ads-audit-mode-status'] });
      void queryClient.invalidateQueries();
    },
  });

  if (!canToggle) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          title="Modo de Demonstração (Audit Mode) — só Admin"
          className="flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors data-[state=open]:bg-white/10 border-white/20 text-white/60 hover:text-white/90 data-[mode=demo]:border-accent/60 data-[mode=demo]:bg-accent/10 data-[mode=demo]:text-accent"
          data-mode={mode === 'DEMO' ? 'demo' : undefined}
        >
          <span className={cnDot(mode)} />
          {mode === 'DEMO' ? 'Demo' : 'Real'}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-72 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Audit Mode</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {statusQuery.data ? `${statusQuery.data.totalDemoOrders} pedido(s) de demonstração no tenant.` : '—'}
        </p>
        <p className="text-xs text-muted-foreground">
          {adsStatusQuery.data ? `${adsStatusQuery.data.totalDemoCampaigns} campanha(s) de Ads de demonstração.` : '—'}
        </p>

        <div className="mt-3 flex gap-2">
          <Button variant={mode === 'REAL' ? 'default' : 'secondary'} size="sm" className="flex-1" onClick={() => setMode('REAL')}>
            Real
          </Button>
          <Button variant={mode === 'DEMO' ? 'default' : 'secondary'} size="sm" className="flex-1" onClick={() => setMode('DEMO')}>
            Demo
          </Button>
        </div>

        <Separator className="my-3" />

        <div className="flex flex-col gap-1.5">
          <Button variant="outline" size="sm" disabled={seedMutation.isPending} onClick={() => seedMutation.mutate()}>
            {seedMutation.isPending ? 'Semeando…' : 'Semear dados de demonstração (Pedidos + Ads)'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={clearMutation.isPending}
            onClick={() => clearMutation.mutate()}
            className="text-destructive hover:border-destructive hover:bg-destructive/10"
          >
            {clearMutation.isPending ? 'Limpando…' : 'Limpar dados de demonstração'}
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function cnDot(mode: 'REAL' | 'DEMO') {
  return mode === 'DEMO' ? 'h-1.5 w-1.5 rounded-full bg-accent' : 'h-1.5 w-1.5 rounded-full bg-white/40';
}
