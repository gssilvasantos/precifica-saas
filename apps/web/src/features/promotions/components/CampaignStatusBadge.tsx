import type { PromotionCampaignStatus } from '../api';

const STATUS_META: Record<PromotionCampaignStatus, { label: string; className: string }> = {
  DRAFT: { label: 'Rascunho', className: 'bg-ink-300/40 text-ink-700' },
  ACTIVE: { label: 'Ativa', className: 'bg-margin-good/15 text-margin-good' },
  ENDED: { label: 'Encerrada', className: 'bg-ink-300/40 text-ink-500' },
  CANCELLED: { label: 'Cancelada', className: 'bg-margin-danger/15 text-margin-danger' },
};

export default function CampaignStatusBadge({ status }: { status: PromotionCampaignStatus }) {
  const meta = STATUS_META[status];
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.className}`}>{meta.label}</span>
  );
}
