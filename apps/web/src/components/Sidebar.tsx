import type { SVGProps } from 'react';
import { NavLink } from 'react-router-dom';

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: GridIcon },
  { to: '/pedidos', label: 'Pedidos', icon: OrdersIcon },
  { to: '/catalogo', label: 'Produtos', icon: BoxIcon },
  { to: '/financeiro', label: 'Financeiro', icon: ChartIcon },
  { to: '/abastecimento', label: 'Abastecimento', icon: TruckIcon },
  { to: '/conferencia', label: 'Conferência', icon: CheckboxIcon },
  { to: '/integracoes', label: 'Integrações', icon: PlugIcon },
  { to: '/configuracoes-fiscais', label: 'Configurações Fiscais', icon: GearIcon },
];

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

// Sidebar persistente no desktop (md+); no mobile vira um painel deslizante
// com backdrop, controlado pelo AppLayout via isOpen/onClose. Sem lib nova
// (react-router + Tailwind resolvem isso sozinhos).
export default function Sidebar({ isOpen, onClose }: Props) {
  return (
    <>
      {isOpen && <div className="fixed inset-0 z-30 bg-ink-900/40 md:hidden" onClick={onClose} />}

      <aside
        className={[
          'fixed inset-y-0 left-0 z-40 w-64 shrink-0 border-r border-ink-300/60 bg-surface transition-transform md:static md:translate-x-0',
          isOpen ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        <div className="flex h-16 items-center gap-2 border-b border-ink-300/60 px-6">
          <span className="font-serif text-xl font-semibold text-ink-900">Precifica</span>
        </div>

        <nav className="space-y-1 p-3">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onClose}
              className={({ isActive }) =>
                [
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
                  isActive ? 'bg-ink-900 text-white' : 'text-ink-700 hover:bg-canvas',
                ].join(' ')
              }
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
    </>
  );
}

function GridIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <rect x="2.5" y="2.5" width="6" height="6" rx="1" />
      <rect x="11.5" y="2.5" width="6" height="6" rx="1" />
      <rect x="2.5" y="11.5" width="6" height="6" rx="1" />
      <rect x="11.5" y="11.5" width="6" height="6" rx="1" />
    </svg>
  );
}

function OrdersIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M4 5.5h12M4 10h12M4 14.5h7" strokeLinecap="round" />
      <circle cx="16.5" cy="14.5" r="2" />
    </svg>
  );
}

function BoxIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M10 2.5l7 3.5v8L10 17.5 3 14V6l7-3.5z" strokeLinejoin="round" />
      <path d="M3 6l7 3.5L17 6M10 9.5V17.5" strokeLinejoin="round" />
    </svg>
  );
}

function ChartIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M3.5 16.5h13" strokeLinecap="round" />
      <path d="M6 16.5v-5M10 16.5V4.5M14 16.5v-8" strokeLinecap="round" />
    </svg>
  );
}

function TruckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M2.5 6h8v8h-8z" strokeLinejoin="round" />
      <path d="M10.5 9h3.5l3 3v2h-2" strokeLinejoin="round" />
      <circle cx="5.5" cy="15" r="1.5" />
      <circle cx="14.5" cy="15" r="1.5" />
    </svg>
  );
}

function CheckboxIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <rect x="2.5" y="2.5" width="15" height="15" rx="2" />
      <path d="M6 10.2l2.4 2.4L14 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlugIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M7 2.5v4M13 2.5v4M5 6.5h10v3a5 5 0 01-10 0v-3z" strokeLinejoin="round" />
      <path d="M10 14.5v3" />
    </svg>
  );
}

function GearIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <circle cx="10" cy="10" r="2.6" />
      <path d="M10 3v1.6M10 15.4V17M17 10h-1.6M4.6 10H3M14.8 5.2l-1.1 1.1M6.3 13.7l-1.1 1.1M14.8 14.8l-1.1-1.1M6.3 6.3L5.2 5.2" />
    </svg>
  );
}
