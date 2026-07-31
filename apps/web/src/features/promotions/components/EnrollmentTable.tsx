import { useQuery } from '@tanstack/react-query';
import { fetchCampaignEnrollments } from '../api';
import { Card } from '../../../components/ui/card';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

const ENROLLMENT_LABEL: Record<string, string> = {
  PENDING: 'Pendente',
  APPROVED: 'Aprovado',
  BLOCKED: 'Bloqueado',
};

// Lista os snapshots de adesão já calculados para a campanha — espelha
// GET .../enrollments (PromotionIntelligenceService.listEnrollments). Como o
// gate nunca deixa nada em PENDING, essa lista só mostra APPROVED ou
// BLOCKED na prática.
export default function EnrollmentTable({ campaignId }: { campaignId: string }) {
  const enrollmentsQuery = useQuery({
    queryKey: ['promotion-campaigns', campaignId, 'enrollments'],
    queryFn: () => fetchCampaignEnrollments(campaignId),
  });

  const enrollments = enrollmentsQuery.data ?? [];

  return (
    <Card className="overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-5 py-3 font-medium">SKU</th>
              <th className="px-5 py-3 font-medium">Preço promocional</th>
              <th className="px-5 py-3 font-medium">Margem líquida</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium">Calculado em</th>
            </tr>
          </thead>
          <tbody>
            {enrollmentsQuery.isLoading && (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">
                  Carregando adesões…
                </td>
              </tr>
            )}

            {!enrollmentsQuery.isLoading && enrollments.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">
                  Nenhum SKU inscrito nesta campanha ainda.
                </td>
              </tr>
            )}

            {enrollments.map((enrollment) => (
              <tr key={enrollment.id} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                <td className="px-5 py-3 font-sans font-medium text-foreground">{enrollment.skuCode}</td>
                <td className="px-5 py-3 font-sans text-foreground">{currency.format(enrollment.promotionalPrice)}</td>
                <td className="px-5 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      enrollment.marginStatus === 'VERDE'
                        ? 'bg-margin-good/15 text-margin-good'
                        : 'bg-margin-danger/15 text-margin-danger'
                    }`}
                  >
                    {currency.format(enrollment.netMarginAmount)}
                  </span>
                </td>
                <td className="px-5 py-3 text-foreground">
                  {ENROLLMENT_LABEL[enrollment.enrollmentStatus] ?? enrollment.enrollmentStatus}
                  {enrollment.enrollmentStatus === 'BLOCKED' && enrollment.blockedReason && (
                    <p className="mt-0.5 text-[11px] text-margin-danger">{enrollment.blockedReason}</p>
                  )}
                </td>
                <td className="px-5 py-3 text-xs text-muted-foreground">{dateFormat.format(new Date(enrollment.computedAt))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
