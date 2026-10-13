import { useState } from 'react';
import { motion } from 'framer-motion';
import type { ChannelPerformance } from '../../features/orders/dashboard-metrics';
import { getChannelMeta } from '../../features/orders/channels';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Stagger, RevealItem } from '../motion/Reveal';
import { cn } from '../../lib/utils';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

interface Props {
  channels: ChannelPerformance[];
}

// ROI por canal — barra proporcional à receita bruta do canal, com o %
// líquido (proxy de ROI, ver aviso em dashboard-metrics.ts) ao lado. Ordenado
// por receita desc — o canal que mais vende aparece primeiro, decisão rápida
// em cima da hora (pedido explícito do usuário: "priorizar tomada de decisão
// rápida"). Migrado para Card; a barra em si continua custom (Progress do
// shadcn ainda não foi trazido — ver próximos retrofits).
//
// Linha clicável (pedido do usuário, 13/10/2026: cards/linhas de resumo
// viram controles interativos) — clicar destaca o canal, apagando os
// demais. O Dashboard não tem uma lista de pedidos na mesma tela para
// filtrar de verdade (é só o hero + os cards de KPI), então o efeito aqui é
// destaque visual, não um filtro — não finja uma filtragem que não existe.
export default function ChannelRoiList({ channels }: Props) {
  const maxRevenue = Math.max(1, ...channels.map((c) => c.revenue));
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>ROI por canal</CardTitle>
        <span className="text-[11px] text-muted-foreground">valor líquido / valor bruto</span>
      </CardHeader>
      <CardContent>
        {channels.length === 0 && (
          <p className="rounded-lg bg-muted px-4 py-6 text-center text-xs text-muted-foreground">
            Sem pedidos ainda para calcular performance por canal.
          </p>
        )}

        <Stagger as="ul" className="space-y-4">
          {channels.map((channel) => {
            const meta = getChannelMeta(channel.channelCode);
            const widthPct = (channel.revenue / maxRevenue) * 100;
            const isSelected = selected === channel.channelCode;
            const isDimmed = selected !== null && !isSelected;
            return (
              <RevealItem as="li" key={channel.channelCode}>
                {/* `motion.button`: feedback tátil (leve scale) ao passar o
                    mouse/tocar — pedido do usuário por "motion action" nos
                    controles. A barra cresce de 0 até `widthPct` só na
                    MONTAGEM (gráfico "desenhando-se"), igual a um chart de
                    verdade, em vez de aparecer pronta de supetão. */}
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  onClick={() => setSelected((atual) => (atual === channel.channelCode ? null : channel.channelCode))}
                  aria-pressed={isSelected}
                  title={`Destacar ${meta.label}`}
                  className={cn(
                    'w-full rounded-lg px-2 py-1.5 text-left transition-colors',
                    isSelected ? 'bg-accent/10' : 'hover:bg-muted/50',
                    isDimmed && 'opacity-40 transition-opacity',
                  )}
                >
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 font-medium text-foreground">
                      <span
                        className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold"
                        style={{ backgroundColor: meta.brandColor, color: meta.brandInk }}
                      >
                        {meta.initial}
                      </span>
                      {meta.label}
                    </span>
                    <span className="font-sans text-muted-foreground">
                      {currency.format(channel.revenue)}
                      {channel.marginPct !== null && <span className="ml-1.5 text-xs">({channel.marginPct.toFixed(1)}%)</span>}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <motion.div
                      className="h-full rounded-full bg-accent"
                      initial={{ width: 0 }}
                      animate={{ width: `${widthPct}%` }}
                      transition={{ duration: 0.5, ease: 'easeOut', delay: 0.1 }}
                    />
                  </div>
                </motion.button>
              </RevealItem>
            );
          })}
        </Stagger>
      </CardContent>
    </Card>
  );
}
