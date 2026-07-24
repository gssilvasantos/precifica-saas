import { NavLink } from 'react-router-dom';
import {
  LayoutGrid,
  ClipboardList,
  Megaphone,
  Package,
  ShieldCheck,
  Tag,
  BarChart3,
  Truck,
  ListChecks,
  Plug,
  Settings,
} from 'lucide-react';
import { cn } from '../lib/utils';

// Ícones lucide-react (mesmo pacote já trazido pela fundação shadcn/ui) no
// lugar dos SVGs desenhados à mão — conjunto abstrato/técnico de propósito
// (grid, prancheta, gráfico de barras...), nunca imagens de carrinho de
// compra, etiqueta de preço com "$" ou vitrine: identidade "Dashboard de
// Inteligência", não varejo.
const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutGrid },
  { to: '/pedidos', label: 'Pedidos', icon: ClipboardList },
  { to: '/ads', label: 'Ads', icon: Megaphone },
  { to: '/catalogo', label: 'Produtos', icon: Package },
  { to: '/governanca-map', label: 'Governança MAP', icon: ShieldCheck },
  { to: '/promocoes', label: 'Promoções', icon: Tag },
  { to: '/financeiro', label: 'Financeiro', icon: BarChart3 },
  { to: '/abastecimento', label: 'Abastecimento', icon: Truck },
  { to: '/conferencia', label: 'Conferência', icon: ListChecks },
  { to: '/integracoes', label: 'Integrações', icon: Plug },
  { to: '/configuracoes-fiscais', label: 'Configurações Fiscais', icon: Settings },
];

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

// Sidebar persistente no desktop (md+); no mobile vira um painel deslizante
// com backdrop, controlado pelo AppLayout via isOpen/onClose. Tokens
// semânticos (bg-card/border-border/bg-primary) em vez dos nomeados
// diretamente (bg-surface/border-ink-300) — resolve sozinho para o tema
// certo (Light/Dark) sem lógica condicional aqui.
export default function Sidebar({ isOpen, onClose }: Props) {
  return (
    <>
      {isOpen && <div className="fixed inset-0 z-30 bg-background/70 backdrop-blur-sm md:hidden" onClick={onClose} />}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 w-64 shrink-0 border-r border-border bg-card transition-transform md:static md:translate-x-0',
          isOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-16 items-center gap-2 border-b border-border px-6">
          <span className="font-serif text-xl font-semibold text-foreground">
            Kyneti<span className="text-accent">.</span>
          </span>
        </div>

        <nav className="space-y-1 p-3">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onClose}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent/10 hover:text-foreground',
                )
              }
            >
              <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.8} />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
    </>
  );
}
