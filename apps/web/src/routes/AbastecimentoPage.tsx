import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchReplenishmentTable,
  fetchWarehouses,
  updateWarehouseLeadTime,
  type ReplenishmentRow,
  type ReplenishmentStatus,
} from '../features/logistics-fulfillment/api';
import { ORDER_CHANNELS } from '../features/orders/channels';

const LEAD_TIME_PRESETS = [3, 7, 15];

const STATUS_META: Record<ReplenishmentStatus, { label: string; className: string }> = {
  CRITICO: { label: 'Crítico', className: 'bg-margin-danger/15 text-margin-danger' },
  ATENCAO: { label: 'Atenção', className: 'bg-margin-warning/15 text-margin-warning' },
  OK: { label: 'OK', className: 'bg-margin-good/15 text-margin-good' },
  SEM_GIRO: { label: 'Sem giro', className: 'bg-ink-300/40 text-ink-500' },
};

const numberFormatter = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

// Painel de comando de abastecimento (Sprint 25) — cruza giro real de venda
// (Orders) com os saldos do Hub de Provas (Sprint 24) para sugerir quanto
// transferir do físico para o CD Full de cada canal. Ordenado por urgência
// pelo próprio backend (ReplenishmentAdvisorService) — o que precisa de
// atenção agora já aparece no topo.
export default function AbastecimentoPage() {
  const [channelCode, setChannelCode] = useState('NUVEMSHOP');
  const queryClient = useQueryClient();

  const tableQuery = useQuery({
    queryKey: ['replenishment-table', channelCode],
    queryFn: () => fetchReplenishmentTable(channelCode),
  });

  const warehousesQuery = useQuery({
    queryKey: ['warehouses'],
    queryFn: fetchWarehouses,
  });

  const fullWarehouse = useMemo(
    () => warehousesQuery.data?.find((w) => w.type === 'VIRTUAL_FULL' && w.channelCode === channelCode),
    [warehousesQuery.data, channelCode],
  );

  const leadTimeMutation = useMutation({
    mutationFn: (leadTimeDays: number) => {
      if (!fullWarehouse) throw new Error('Depósito Full ainda não existe para este canal.');
      return updateWarehouseLeadTime(fullWarehouse.id, leadTimeDays);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['warehouses'] });
      queryClient.invalidateQueries({ queryKey: ['replenishment-table', channelCode] });
    },
  });

  const rows = tableQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-ink-900">Inteligência de Abastecimento</h1>
          <p className="mt-1 text-sm text-ink-500">
            Giro real de venda cruzado com o saldo do Full — a sugestão de envio do físico já considera o lead time
            configurado abaixo. Ordenado do mais urgente para o menos urgente.
          </p>
        </div>

        <select
          value={channelCode}
          onChange={(e) => setChannelCode(e.target.value)}
          className="rounded-lg border border-ink-300 bg-surface px-3 py-1.5 text-sm text-ink-900 focus:border-neon focus:outline-none focus:ring-1 focus:ring-neon"
        >
          {ORDER_CHANNELS.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label}
              {!c.implemented ? ' (em breve)' : ''}
            </option>
          ))}
        </select>
      </div>

      <LeadTimeConfig
        currentLeadTimeDays={fullWarehouse?.leadTimeDays}
        onChange={(days) => leadTimeMutation.mutate(days)}
        isSaving={leadTimeMutation.isPending}
      />

      <div className="overflow-x-auto rounded-2xl bg-surface shadow-card">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead>
            <tr className="border-b border-ink-300/60 text-xs uppercase tracking-wide text-ink-500">
              <th className="px-5 py-3 font-medium">SKU</th>
              <th className="px-5 py-3 font-medium">Curva ABC</th>
              <th className="px-5 py-3 font-medium text-right">
                Giro na Plataforma {ORDER_CHANNELS.find((c) => c.code === channelCode)?.label ?? channelCode}
              </th>
              <th className="px-5 py-3 font-medium text-right">Saldo Atual no Full</th>
              <th className="px-5 py-3 font-medium text-right">Saldo no Físico</th>
              <th className="px-5 py-3 font-medium text-right">Sugestão de Envio do Físico</th>
              <th className="px-5 py-3 font-medium">Status de Abastecimento</th>
            </tr>
          </thead>
          <tbody>
            {tableQuery.isLoading && (
              <tr>
                <td colSpan={7} className="px-5 py-8 text-center text-ink-500">
                  Calculando sugestões de reposição…
                </td>
              </tr>
            )}

            {!tableQuery.isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-8 text-center text-ink-500">
                  Nenhum SKU com venda ou saldo neste canal ainda.
                </td>
              </tr>
            )}

            {rows.map((row) => (
              <ReplenishmentRowView key={row.skuCode} row={row} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LeadTimeConfig({
  currentLeadTimeDays,
  onChange,
  isSaving,
}: {
  currentLeadTimeDays: number | undefined;
  onChange: (days: number) => void;
  isSaving: boolean;
}) {
  const [customValue, setCustomValue] = useState('');

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-surface px-5 py-4 shadow-card">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Lead time do CD Full</p>
        <p className="text-xs text-ink-500">
          Dias entre despachar do físico e o estoque ficar disponível para venda neste depósito.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {LEAD_TIME_PRESETS.map((days) => (
          <button
            key={days}
            type="button"
            disabled={isSaving}
            onClick={() => onChange(days)}
            className={[
              'rounded-full px-3 py-1 text-xs font-medium transition disabled:opacity-50',
              currentLeadTimeDays === days ? 'bg-ink-900 text-white' : 'bg-canvas text-ink-700 hover:bg-ink-300/40',
            ].join(' ')}
          >
            {days} dias
          </button>
        ))}

        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            const parsed = Number(customValue);
            if (Number.isInteger(parsed) && parsed > 0) onChange(parsed);
          }}
        >
          <input
            type="number"
            min={1}
            max={90}
            placeholder="outro"
            value={customValue}
            onChange={(e) => setCustomValue(e.target.value)}
            className="w-20 rounded-lg border border-ink-300 bg-surface px-2 py-1 text-xs text-ink-900 focus:border-neon focus:outline-none focus:ring-1 focus:ring-neon"
          />
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-lg border border-ink-300 px-2.5 py-1 text-xs font-medium text-ink-700 hover:bg-canvas disabled:opacity-50"
          >
            Aplicar
          </button>
        </form>

        {currentLeadTimeDays !== undefined && (
          <span className="text-xs text-ink-500">
            Atual: <strong className="text-ink-900">{currentLeadTimeDays} dias</strong>
          </span>
        )}
      </div>
    </div>
  );
}

function ReplenishmentRowView({ row }: { row: ReplenishmentRow }) {
  const statusMeta = STATUS_META[row.status];

  return (
    <tr className="border-b border-ink-300/30 last:border-0 hover:bg-canvas/60">
      <td className="px-5 py-3 font-sans font-medium text-ink-900">{row.skuCode}</td>
      <td className="px-5 py-3">
        <span className="rounded-full bg-ink-300/30 px-2 py-0.5 text-[10px] font-semibold text-ink-700">
          {row.abcClass}
        </span>
      </td>
      <td className="px-5 py-3 text-right font-sans text-ink-700">{numberFormatter.format(row.giroDiario)}/dia</td>
      <td className="px-5 py-3 text-right font-sans text-ink-700">{numberFormatter.format(row.saldoFull)}</td>
      <td className="px-5 py-3 text-right font-sans text-ink-700">{numberFormatter.format(row.saldoFisico)}</td>
      <td className="px-5 py-3 text-right font-sans font-semibold text-ink-900">
        {row.sugestaoEnvio > 0 ? numberFormatter.format(row.sugestaoEnvio) : '—'}
        {row.physicalShortfall && (
          <span className="ml-1.5 rounded-full bg-margin-warning/15 px-1.5 py-0.5 text-[9px] font-medium text-margin-warning">
            físico insuficiente
          </span>
        )}
      </td>
      <td className="px-5 py-3">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusMeta.className}`}>
          {statusMeta.label}
        </span>
      </td>
    </tr>
  );
}
