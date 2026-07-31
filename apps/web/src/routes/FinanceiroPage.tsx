import { useQuery } from '@tanstack/react-query';
import { fetchDreReport } from '../features/financial-intelligence/api';
import type { DreOrderLine } from '../features/financial-intelligence/api';
import { useAppMode } from '../features/app-mode/app-mode-context';
import ChannelBadge from '../components/orders/ChannelBadge';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { cn } from '../lib/utils';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });

// Draft do DRE (Fase de Conexão Real, Sprint 23) — primeira visualização de
// frontend do FinancialOrchestrator/dre-report.ts em nível de PEDIDO
// individual (não só o agregado por canal do Dashboard). Reaproveita o
// mesmo endpoint GET /financial-intelligence/dre (Etapa 20) — a extensão
// aditiva `orderLines` é a única coisa nova aqui, consumida diretamente,
// sem endpoint novo.
export default function FinanceiroPage() {
  const { mode } = useAppMode();

  const dreQuery = useQuery({
    queryKey: ['dre-report', mode],
    queryFn: () => fetchDreReport({ mode }),
  });

  const report = dreQuery.data;
  const orderLines = report?.orderLines ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-foreground">DRE por pedido</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cada pedido reconhecido no período, com o mesmo cálculo financeiro do DRE por canal — pronto para conferir
          a inteligência do sistema pedido a pedido, em tempo real.
        </p>
      </div>

      {mode === 'DEMO' && (
        <Badge variant="accent" className="w-full justify-start gap-2 rounded-lg px-4 py-2 text-xs font-medium normal-case">
          Modo Demonstração ativo — os pedidos abaixo são fictícios (AuditSeederService), nunca dados reais.
        </Badge>
      )}

      {report && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard label="Receita bruta" value={currency.format(report.receitaBruta)} />
          <SummaryCard label="Deduções" value={currency.format(report.deducoes)} />
          <SummaryCard label="Custos variáveis" value={currency.format(report.custosVariaveis)} />
          <SummaryCard
            label="Margem de contribuição"
            value={currency.format(report.margemContribuicao)}
            caption={report.margemContribuicaoPct !== null ? `${report.margemContribuicaoPct.toFixed(1)}%` : undefined}
            highlight
          />
        </div>
      )}

      {report?.dataQuality === 'INCOMPLETE' && (
        <div className="rounded-lg border border-margin-warning/40 bg-margin-warning/10 px-4 py-2 text-xs font-medium text-foreground">
          Alguns pedidos abaixo têm custo desconhecido ou comissão não confirmada — a margem deles é uma aproximação
          (ver coluna "Qualidade").
        </div>
      )}

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3 font-medium">Pedido</th>
                <th className="px-5 py-3 font-medium">Canal</th>
                <th className="px-5 py-3 font-medium">Data</th>
                <th className="px-5 py-3 font-medium text-right">Valor Total</th>
                <th className="px-5 py-3 font-medium text-right">Taxas</th>
                <th className="px-5 py-3 font-medium text-right">CMV</th>
                <th className="px-5 py-3 font-medium text-right">Margem Líquida</th>
                <th className="px-5 py-3 font-medium">Qualidade</th>
              </tr>
            </thead>
            <tbody>
              {dreQuery.isLoading && (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-muted-foreground">
                    Calculando DRE…
                  </td>
                </tr>
              )}

              {!dreQuery.isLoading && orderLines.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-muted-foreground">
                    Nenhum pedido reconhecido no período ainda. Conecte um marketplace em Integrações ou semeie os
                    dados de demonstração.
                  </td>
                </tr>
              )}

              {orderLines.map((line) => (
                <OrderLineRow key={line.orderId} line={line} />
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  caption,
  highlight = false,
}: {
  label: string;
  value: string;
  caption?: string;
  highlight?: boolean;
}) {
  return (
    <Card className={cn('p-4', highlight ? 'bg-ink-900 text-white border-ink-900' : 'text-foreground')}>
      <p className={`text-xs font-medium uppercase tracking-wide ${highlight ? 'text-white/60' : 'text-muted-foreground'}`}>
        {label}
      </p>
      <p className="mt-1 font-serif text-xl font-semibold">{value}</p>
      {caption && <p className={`mt-0.5 text-xs ${highlight ? 'text-neon' : 'text-muted-foreground'}`}>{caption}</p>}
    </Card>
  );
}

function OrderLineRow({ line }: { line: DreOrderLine }) {
  const marginClass = line.margemLiquida < 0 ? 'text-margin-danger' : 'text-margin-good';

  return (
    <tr className="border-b border-border/60 last:border-0 hover:bg-muted/40">
      <td className="px-5 py-3 font-sans font-medium text-foreground">{line.externalOrderId}</td>
      <td className="px-5 py-3">
        <ChannelBadge channelCode={line.channelCode} size="sm" />
      </td>
      <td className="px-5 py-3 font-sans text-foreground">{dateFormatter.format(new Date(line.orderedAt))}</td>
      <td className="px-5 py-3 text-right font-sans text-foreground">{currency.format(line.totalAmount)}</td>
      <td className="px-5 py-3 text-right font-sans text-foreground">{currency.format(line.feeAmount)}</td>
      <td className="px-5 py-3 text-right font-sans text-foreground">{currency.format(line.cmv)}</td>
      <td className={`px-5 py-3 text-right font-sans font-semibold ${marginClass}`}>
        {currency.format(line.margemLiquida)}
      </td>
      <td className="px-5 py-3">
        {line.dataQuality === 'INCOMPLETE' ? (
          <span className="rounded-full bg-margin-warning/15 px-2 py-0.5 text-[10px] font-medium text-margin-warning">
            Aproximado
          </span>
        ) : (
          <span className="rounded-full bg-margin-good/15 px-2 py-0.5 text-[10px] font-medium text-margin-good">
            Completo
          </span>
        )}
      </td>
    </tr>
  );
}
