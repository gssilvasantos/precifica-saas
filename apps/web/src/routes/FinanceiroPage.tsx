import { useQuery } from '@tanstack/react-query';
import { fetchDreReport } from '../features/financial-intelligence/api';
import type { DreOrderLine } from '../features/financial-intelligence/api';
import { useAppMode } from '../features/app-mode/app-mode-context';
import ChannelBadge from '../components/orders/ChannelBadge';

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
        <h1 className="font-serif text-3xl font-semibold text-ink-900">DRE por pedido</h1>
        <p className="mt-1 text-sm text-ink-500">
          Cada pedido reconhecido no período, com o mesmo cálculo financeiro do DRE por canal — pronto para conferir
          a inteligência do sistema pedido a pedido, em tempo real.
        </p>
      </div>

      {mode === 'DEMO' && (
        <div className="rounded-lg border border-neon/40 bg-neon/10 px-4 py-2 text-xs font-medium text-ink-700">
          Modo Demonstração ativo — os pedidos abaixo são fictícios (AuditSeederService), nunca dados reais.
        </div>
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
        <div className="rounded-lg border border-margin-warning/40 bg-margin-warning/10 px-4 py-2 text-xs font-medium text-ink-700">
          Alguns pedidos abaixo têm custo desconhecido ou comissão não confirmada — a margem deles é uma aproximação
          (ver coluna "Qualidade").
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl bg-surface shadow-card">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead>
            <tr className="border-b border-ink-300/60 text-xs uppercase tracking-wide text-ink-500">
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
                <td colSpan={8} className="px-5 py-8 text-center text-ink-500">
                  Calculando DRE…
                </td>
              </tr>
            )}

            {!dreQuery.isLoading && orderLines.length === 0 && (
              <tr>
                <td colSpan={8} className="px-5 py-8 text-center text-ink-500">
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
    <div
      className={[
        'rounded-2xl p-4 shadow-card',
        highlight ? 'bg-ink-900 text-white' : 'bg-surface text-ink-900',
      ].join(' ')}
    >
      <p className={`text-xs font-medium uppercase tracking-wide ${highlight ? 'text-white/60' : 'text-ink-500'}`}>
        {label}
      </p>
      <p className="mt-1 font-serif text-xl font-semibold">{value}</p>
      {caption && <p className={`mt-0.5 text-xs ${highlight ? 'text-neon' : 'text-ink-500'}`}>{caption}</p>}
    </div>
  );
}

function OrderLineRow({ line }: { line: DreOrderLine }) {
  const marginClass = line.margemLiquida < 0 ? 'text-margin-danger' : 'text-margin-good';

  return (
    <tr className="border-b border-ink-300/30 last:border-0 hover:bg-canvas/60">
      <td className="px-5 py-3 font-sans font-medium text-ink-900">{line.externalOrderId}</td>
      <td className="px-5 py-3">
        <ChannelBadge channelCode={line.channelCode} size="sm" />
      </td>
      <td className="px-5 py-3 font-sans text-ink-700">{dateFormatter.format(new Date(line.orderedAt))}</td>
      <td className="px-5 py-3 text-right font-sans text-ink-700">{currency.format(line.totalAmount)}</td>
      <td className="px-5 py-3 text-right font-sans text-ink-700">{currency.format(line.feeAmount)}</td>
      <td className="px-5 py-3 text-right font-sans text-ink-700">{currency.format(line.cmv)}</td>
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
