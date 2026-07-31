import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppMode } from '../features/app-mode/app-mode-context';
import ChannelBadge from '../components/orders/ChannelBadge';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { cn } from '../lib/utils';
import { extractErrorMessage } from '../lib/extract-error-message';
import {
  fetchDreReport,
  fetchAccountsPayable,
  createAccountsPayable,
  markAccountsPayablePaid,
  cancelAccountsPayable,
  resolveAccountsPayableEffectiveStatus,
  fetchFixedExpenses,
  createFixedExpense,
  deleteFixedExpense,
  fetchReceivables,
  importSettlement,
  type DreOrderLine,
  type AccountsPayable,
  type AccountsPayableOccurrence,
  type FixedExpenseRecurrence,
  type ReceivableStatus,
} from '../features/financial-intelligence/api';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });

type Tab = 'dre' | 'payable' | 'expenses' | 'receivables';

const TABS: { id: Tab; label: string }[] = [
  { id: 'dre', label: 'DRE por pedido' },
  { id: 'payable', label: 'Contas a Pagar' },
  { id: 'expenses', label: 'Despesas Fixas' },
  { id: 'receivables', label: 'Recebíveis' },
];

export default function FinanceiroPage() {
  const [tab, setTab] = useState<Tab>('dre');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-foreground">Financeiro</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          DRE por pedido, contas a pagar, despesas fixas e recebíveis dos marketplaces.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-border pb-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
              tab === t.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent/10 hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'dre' && <DreTab />}
      {tab === 'payable' && <AccountsPayableTab />}
      {tab === 'expenses' && <FixedExpensesTab />}
      {tab === 'receivables' && <ReceivablesTab />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DRE por pedido — conteúdo original da página, só movido para uma aba.
// ---------------------------------------------------------------------------
function DreTab() {
  const { mode } = useAppMode();

  const dreQuery = useQuery({
    queryKey: ['dre-report', mode],
    queryFn: () => fetchDreReport({ mode }),
  });

  const report = dreQuery.data;
  const orderLines = report?.orderLines ?? [];

  return (
    <div className="space-y-6">
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

// ---------------------------------------------------------------------------
// Contas a Pagar
// ---------------------------------------------------------------------------
const OCCURRENCE_LABEL: Record<AccountsPayableOccurrence, string> = {
  UNICA: 'Única',
  SEMANAL: 'Semanal',
  MENSAL: 'Mensal',
  TRIMESTRAL: 'Trimestral',
  PARCELADA: 'Parcelada',
};

function AccountsPayableTab() {
  const queryClient = useQueryClient();
  const [isCreating, setIsCreating] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);

  const query = useQuery({ queryKey: ['accounts-payable'], queryFn: () => fetchAccountsPayable() });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['accounts-payable'] });

  const createMutation = useMutation({ mutationFn: createAccountsPayable, onSuccess: () => { invalidate(); setIsCreating(false); } });
  const payMutation = useMutation({ mutationFn: (args: { id: string; input: Parameters<typeof markAccountsPayablePaid>[1] }) => markAccountsPayablePaid(args.id, args.input), onSuccess: () => { invalidate(); setPayingId(null); } });
  const cancelMutation = useMutation({ mutationFn: cancelAccountsPayable, onSuccess: invalidate });

  const items = query.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {!isCreating && <Button size="sm" onClick={() => setIsCreating(true)}>Nova conta</Button>}
      </div>

      {isCreating && (
        <CreatePayableForm
          isSubmitting={createMutation.isPending}
          error={createMutation.error ? extractErrorMessage(createMutation.error) : null}
          onCancel={() => { createMutation.reset(); setIsCreating(false); }}
          onSubmit={(input) => createMutation.mutate(input)}
        />
      )}

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3 font-medium">Descrição</th>
                <th className="px-5 py-3 font-medium">Categoria</th>
                <th className="px-5 py-3 font-medium">Vencimento</th>
                <th className="px-5 py-3 font-medium text-right">Valor</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {query.isLoading && (
                <tr><td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">Carregando…</td></tr>
              )}
              {!query.isLoading && items.length === 0 && (
                <tr><td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">Nenhuma conta lançada ainda.</td></tr>
              )}
              {items.map((item) => (
                <PayableRow
                  key={item.id}
                  item={item}
                  isPaying={payingId === item.id}
                  onStartPay={() => setPayingId(item.id)}
                  onCancelPay={() => setPayingId(null)}
                  onConfirmPay={(input) => payMutation.mutate({ id: item.id, input })}
                  isPayPending={payMutation.isPending}
                  onCancelPayable={() => cancelMutation.mutate(item.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function PayableRow({
  item,
  isPaying,
  onStartPay,
  onCancelPay,
  onConfirmPay,
  isPayPending,
  onCancelPayable,
}: {
  item: AccountsPayable;
  isPaying: boolean;
  onStartPay: () => void;
  onCancelPay: () => void;
  onConfirmPay: (input: { interestAmount?: number; discountAmount?: number; feeAmount?: number }) => void;
  isPayPending: boolean;
  onCancelPayable: () => void;
}) {
  const effectiveStatus = resolveAccountsPayableEffectiveStatus(item);
  const [interest, setInterest] = useState('');
  const [discount, setDiscount] = useState('');
  const [fee, setFee] = useState('');

  return (
    <>
      <tr className="border-b border-border/60 last:border-0 hover:bg-muted/40">
        <td className="px-5 py-3 font-medium text-foreground">{item.description}</td>
        <td className="px-5 py-3 text-muted-foreground">{item.category ?? '—'}</td>
        <td className="px-5 py-3 text-foreground">{dateFormatter.format(new Date(item.dueDate))}</td>
        <td className="px-5 py-3 text-right text-foreground">{currency.format(item.amount)}</td>
        <td className="px-5 py-3"><StatusBadge status={effectiveStatus} /></td>
        <td className="px-5 py-3 text-right">
          {item.status === 'PENDING' && (
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={onStartPay}>Dar baixa</Button>
              <Button variant="outline" size="sm" onClick={onCancelPayable}>Cancelar</Button>
            </div>
          )}
        </td>
      </tr>
      {isPaying && (
        <tr className="border-b border-border/60 bg-muted/20">
          <td colSpan={6} className="px-5 py-4">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Juros</label>
                <input className="w-28 rounded-lg border border-border bg-background px-2 py-1 text-sm" value={interest} onChange={(e) => setInterest(e.target.value)} placeholder="0,00" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Desconto</label>
                <input className="w-28 rounded-lg border border-border bg-background px-2 py-1 text-sm" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0,00" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Tarifa</label>
                <input className="w-28 rounded-lg border border-border bg-background px-2 py-1 text-sm" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="0,00" />
              </div>
              <Button
                size="sm"
                disabled={isPayPending}
                onClick={() =>
                  onConfirmPay({
                    interestAmount: interest ? Number(interest) : undefined,
                    discountAmount: discount ? Number(discount) : undefined,
                    feeAmount: fee ? Number(fee) : undefined,
                  })
                }
              >
                {isPayPending ? 'Confirmando…' : 'Confirmar baixa'}
              </Button>
              <Button variant="outline" size="sm" onClick={onCancelPay}>Cancelar</Button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variant = status === 'PAID' ? 'success' : status === 'OVERDUE' ? 'danger' : status === 'CANCELLED' ? 'danger' : 'accent';
  const label = status === 'PAID' ? 'Pago' : status === 'OVERDUE' ? 'Vencido' : status === 'CANCELLED' ? 'Cancelado' : 'Pendente';
  return <Badge variant={variant}>{label}</Badge>;
}

function CreatePayableForm({
  onSubmit,
  onCancel,
  isSubmitting,
  error,
}: {
  onSubmit: (input: { amount: number; description: string; category?: string; supplierId?: string; dueDate: string; occurrence: AccountsPayableOccurrence; notes?: string; totalInstallments?: number }) => void;
  onCancel: () => void;
  isSubmitting: boolean;
  error: string | null;
}) {
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [occurrence, setOccurrence] = useState<AccountsPayableOccurrence>('UNICA');
  const [totalInstallments, setTotalInstallments] = useState('2');
  const [notes, setNotes] = useState('');

  const canSubmit = description.trim().length > 0 && Number(amount) > 0 && dueDate.length > 0;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      description: description.trim(),
      amount: Number(amount),
      category: category.trim() || undefined,
      dueDate,
      occurrence,
      notes: notes.trim() || undefined,
      totalInstallments: occurrence === 'PARCELADA' ? Number(totalInstallments) : undefined,
    });
  }

  return (
    <Card className="p-5">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Descrição</label>
            <input className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Valor</label>
            <input className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Categoria</label>
            <input className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={category} onChange={(e) => setCategory(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Vencimento</label>
            <input type="date" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Recorrência</label>
            <select className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={occurrence} onChange={(e) => setOccurrence(e.target.value as AccountsPayableOccurrence)}>
              {Object.entries(OCCURRENCE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          {occurrence === 'PARCELADA' && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Número de parcelas</label>
              <input type="number" min={2} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={totalInstallments} onChange={(e) => setTotalInstallments(e.target.value)} />
            </div>
          )}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Observações</label>
          <input className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {error && <p className="text-sm text-margin-danger">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={!canSubmit || isSubmitting}>{isSubmitting ? 'Salvando…' : 'Lançar conta'}</Button>
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>Cancelar</Button>
        </div>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Despesas Fixas
// ---------------------------------------------------------------------------
const RECURRENCE_LABEL: Record<FixedExpenseRecurrence, string> = {
  MONTHLY: 'Mensal',
  WEEKLY: 'Semanal',
  YEARLY: 'Anual',
  ONE_TIME: 'Única',
};

function FixedExpensesTab() {
  const queryClient = useQueryClient();
  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [recurrenceType, setRecurrenceType] = useState<FixedExpenseRecurrence>('MONTHLY');
  const [dueDay, setDueDay] = useState('');

  const query = useQuery({ queryKey: ['fixed-expenses'], queryFn: fetchFixedExpenses });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['fixed-expenses'] });

  const createMutation = useMutation({
    mutationFn: createFixedExpense,
    onSuccess: () => { invalidate(); setIsCreating(false); setName(''); setAmount(''); setDueDay(''); },
  });
  const deleteMutation = useMutation({ mutationFn: deleteFixedExpense, onSuccess: invalidate });

  const items = query.data ?? [];
  const canSubmit = name.trim().length > 0 && Number(amount) > 0;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {!isCreating && <Button size="sm" onClick={() => setIsCreating(true)}>Nova despesa</Button>}
      </div>

      {isCreating && (
        <Card className="p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Nome</label>
              <input className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Valor</label>
              <input className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Recorrência</label>
              <select className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={recurrenceType} onChange={(e) => setRecurrenceType(e.target.value as FixedExpenseRecurrence)}>
                {Object.entries(RECURRENCE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Dia de vencimento (opcional)</label>
              <input type="number" min={0} max={31} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={dueDay} onChange={(e) => setDueDay(e.target.value)} />
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Button
              size="sm"
              disabled={!canSubmit || createMutation.isPending}
              onClick={() =>
                createMutation.mutate({
                  name: name.trim(),
                  amount: Number(amount),
                  recurrenceType,
                  dueDay: dueDay ? Number(dueDay) : undefined,
                })
              }
            >
              {createMutation.isPending ? 'Salvando…' : 'Adicionar'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setIsCreating(false)}>Cancelar</Button>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3 font-medium">Nome</th>
                <th className="px-5 py-3 font-medium">Recorrência</th>
                <th className="px-5 py-3 font-medium">Dia venc.</th>
                <th className="px-5 py-3 font-medium text-right">Valor</th>
                <th className="px-5 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {query.isLoading && (
                <tr><td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">Carregando…</td></tr>
              )}
              {!query.isLoading && items.length === 0 && (
                <tr><td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">Nenhuma despesa fixa cadastrada.</td></tr>
              )}
              {items.map((item) => (
                <tr key={item.id} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                  <td className="px-5 py-3 font-medium text-foreground">{item.name}</td>
                  <td className="px-5 py-3 text-muted-foreground">{RECURRENCE_LABEL[item.recurrenceType]}</td>
                  <td className="px-5 py-3 text-foreground">{item.dueDay ?? '—'}</td>
                  <td className="px-5 py-3 text-right text-foreground">{currency.format(item.amount)}</td>
                  <td className="px-5 py-3 text-right">
                    <Button variant="outline" size="sm" onClick={() => deleteMutation.mutate(item.id)}>Remover</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recebíveis / Reconciliação
// ---------------------------------------------------------------------------
function ReceivablesTab() {
  const [status, setStatus] = useState<ReceivableStatus>('PENDING');
  const [isImporting, setIsImporting] = useState(false);
  const [marketplaceCode, setMarketplaceCode] = useState('NUVEMSHOP');
  const [format, setFormat] = useState<'JSON' | 'CSV'>('JSON');
  const [fileContent, setFileContent] = useState('');
  const [result, setResult] = useState<{ matched: number; alreadyReconciled: number; unmatchedReferences: string[] } | null>(null);

  const query = useQuery({ queryKey: ['receivables', status], queryFn: () => fetchReceivables(status) });
  const importMutation = useMutation({
    mutationFn: importSettlement,
    onSuccess: (data) => { setResult(data); },
  });

  const items = query.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <select className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm" value={status} onChange={(e) => setStatus(e.target.value as ReceivableStatus)}>
          <option value="PENDING">Pendentes</option>
          <option value="PAID">Pagos</option>
          <option value="OVERDUE">Vencidos</option>
          <option value="CANCELLED">Cancelados</option>
        </select>
        <Button variant="outline" size="sm" onClick={() => setIsImporting((v) => !v)}>
          {isImporting ? 'Fechar' : 'Importar relatório de repasse'}
        </Button>
      </div>

      {isImporting && (
        <Card className="p-5">
          <p className="mb-3 text-sm text-muted-foreground">
            Cole o conteúdo do relatório de repasse do marketplace (JSON ou CSV) para conciliar com os recebíveis
            pendentes.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Marketplace</label>
              <input className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={marketplaceCode} onChange={(e) => setMarketplaceCode(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Formato</label>
              <select className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={format} onChange={(e) => setFormat(e.target.value as 'JSON' | 'CSV')}>
                <option value="JSON">JSON</option>
                <option value="CSV">CSV</option>
              </select>
            </div>
          </div>
          <div className="mt-3">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Conteúdo do arquivo</label>
            <textarea className="h-32 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono" value={fileContent} onChange={(e) => setFileContent(e.target.value)} />
          </div>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              disabled={!fileContent.trim() || importMutation.isPending}
              onClick={() => importMutation.mutate({ marketplaceCode, format, fileContent })}
            >
              {importMutation.isPending ? 'Reconciliando…' : 'Reconciliar'}
            </Button>
          </div>
          {result && (
            <p className="mt-3 text-sm text-foreground">
              {result.matched} casado(s), {result.alreadyReconciled} já reconciliado(s) antes
              {result.unmatchedReferences.length > 0 && `, ${result.unmatchedReferences.length} sem match`}.
            </p>
          )}
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3 font-medium">Origem</th>
                <th className="px-5 py-3 font-medium">Referência</th>
                <th className="px-5 py-3 font-medium">SKU</th>
                <th className="px-5 py-3 font-medium">Previsto para</th>
                <th className="px-5 py-3 font-medium text-right">Valor</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {query.isLoading && (
                <tr><td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">Carregando…</td></tr>
              )}
              {!query.isLoading && items.length === 0 && (
                <tr><td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">Nenhum recebível neste status.</td></tr>
              )}
              {items.map((item) => (
                <tr key={item.id} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                  <td className="px-5 py-3 font-medium text-foreground">{item.marketplaceSource}</td>
                  <td className="px-5 py-3 text-muted-foreground">{item.externalReference ?? '—'}</td>
                  <td className="px-5 py-3 text-muted-foreground">{item.skuCode ?? '—'}</td>
                  <td className="px-5 py-3 text-foreground">{dateFormatter.format(new Date(item.expectedDate))}</td>
                  <td className="px-5 py-3 text-right text-foreground">{currency.format(item.amount)}</td>
                  <td className="px-5 py-3"><StatusBadge status={item.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
