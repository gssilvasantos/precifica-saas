import { getChannelMeta } from '../../features/orders/channels';

interface Props {
  channelCode: string;
  size?: 'sm' | 'md';
}

// Badge dinâmico por canal — pedido explícito do usuário. Cor vem 100% dos
// metadados de features/orders/channels.ts; nenhuma cor fixa por
// componente, então adicionar um canal novo (ou trocar a cor de um
// existente) nunca toca este arquivo.
export default function ChannelBadge({ channelCode, size = 'md' }: Props) {
  const meta = getChannelMeta(channelCode);
  const dims = size === 'sm' ? 'h-5 w-5 text-[9px]' : 'h-6 w-6 text-[10px]';

  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`flex shrink-0 items-center justify-center rounded-full font-bold ${dims}`}
        style={{ backgroundColor: meta.brandColor, color: meta.brandInk }}
      >
        {meta.initial}
      </span>
      <span className="text-sm font-medium text-ink-900">{meta.label}</span>
      {!meta.implemented && (
        <span className="rounded-full bg-ink-300/40 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-ink-500">
          em breve
        </span>
      )}
    </span>
  );
}
