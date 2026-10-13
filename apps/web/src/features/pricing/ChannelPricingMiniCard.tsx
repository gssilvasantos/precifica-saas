import type { ChannelMeta } from './channels';
import { cn } from '../../lib/utils';

// Card de preço por canal no estilo do Mazzei Pro Seller (ferramenta irmã do
// Gui, repositório gssilvasantos/mazzei-pro-seller) — pedido explícito do
// usuário (13/10/2026): "quero os cards exatamente como no mazzei pro
// seller". Reproduz o card "mini" de lá (usado na listagem completa por
// SKU): ponto colorido + nome do canal em caixa alta, preço grande + custo
// pequeno ao lado, barra de margem com faixa de cor (vermelho/amarelo/verde)
// e "Lucro por unidade" abaixo de um traço pontilhado. A tag de ROI do card
// "normal" do Mazzei fica escondida nessa densidade lá também (CSS
// `.card-mini .roi-tag{ display:none }`) — por isso não existe aqui.
//
// Duas diferenças deliberadas em relação ao original (não são imprecisão,
// são respeito a decisões já tomadas neste projeto):
// 1. Cores por token semântico do Kyneti (--margin-danger/warning/good,
//    --gold) em vez dos hexadecimais fixos do Mazzei — funciona nos dois
//    temas (claro/escuro) em vez de só escuro.
// 2. Tipografia do preço em `font-serif` (que no Kyneti resolve para Inter
//    desde a Reestruturação Visual WowDash — ver tailwind.config.js) em vez
//    da serifada Fraunces do Mazzei — reintroduzir uma serifada contrariaria
//    aquela decisão deliberada de design já registrada no projeto.
export interface ChannelMiniPricingData {
  price: number;
  custoTotal: number;
  marginPct: number;
  lucroRs: number;
}

interface Props {
  channel: ChannelMeta;
  isBestMargin: boolean;
  data: ChannelMiniPricingData | null;
  isLoading?: boolean;
  disconnectedMessage?: string;
}

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

// Mesmas faixas do card do Mazzei (<8% ruim, <15% alerta, resto bom) — é uma
// leitura rápida de "dá pra vender nesse canal", deliberadamente mais
// permissiva que o semáforo 10/25 da tela de cenário (MarginBar.tsx), que
// mede outra coisa (ver comentário lá).
function barTone(marginPct: number): string {
  if (marginPct < 8) return 'bg-margin-danger';
  if (marginPct < 15) return 'bg-margin-warning';
  return 'bg-margin-good';
}

export default function ChannelPricingMiniCard({ channel, isBestMargin, data, isLoading, disconnectedMessage }: Props) {
  const barWidth = data ? Math.max(3, Math.min(100, data.marginPct * 2.2)) : 0;

  return (
    <div
      className={cn(
        'relative rounded-xl border bg-card p-3.5 transition-colors',
        isBestMargin ? 'border-gold/60 ring-1 ring-gold/30' : 'border-border',
      )}
    >
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-foreground">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: channel.brandColor, boxShadow: `0 0 6px ${channel.brandColor}` }}
          />
          <span className="truncate">{channel.label}</span>
        </div>
        {isBestMargin && (
          <span className="shrink-0 whitespace-nowrap rounded-full bg-gold/15 px-2 py-0.5 text-[10px] font-semibold text-gold">
            ★ melhor
          </span>
        )}
      </div>

      {isLoading && <p className="rounded-lg bg-muted px-2.5 py-3 text-center text-xs text-muted-foreground">Calculando…</p>}

      {!isLoading && !data && (
        <p className="rounded-lg bg-muted px-2.5 py-3 text-center text-xs text-muted-foreground">
          {disconnectedMessage ?? 'Sem dado de preço ainda'}
        </p>
      )}

      {!isLoading && data && (
        <>
          <div className="flex items-baseline gap-2">
            <span className="font-serif text-lg font-semibold text-foreground">{currency.format(data.price)}</span>
            <span className="font-mono text-[11px] text-muted-foreground">custo {currency.format(data.custoTotal)}</span>
          </div>

          <div className="mt-2.5">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className={cn('h-full rounded-full transition-all', barTone(data.marginPct))} style={{ width: `${barWidth}%` }} />
            </div>
            <div className="mt-1.5 flex items-center justify-between font-mono text-[10.5px] text-muted-foreground">
              <span>margem</span>
              <span className="font-semibold text-foreground">{data.marginPct.toFixed(1)}%</span>
            </div>
          </div>

          <div className="mt-2.5 border-t border-dashed border-border pt-2.5 text-[11px] text-muted-foreground">
            Lucro por unidade: <span className="font-mono font-semibold text-foreground">{currency.format(data.lucroRs)}</span>
          </div>
        </>
      )}
    </div>
  );
}
