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
  Building2,
  Users,
  FileText,
  Factory,
  Boxes,
  Receipt,
  Layers3,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuth } from '../features/auth/auth-context';
import type { ModuleCode } from '../lib/module-codes';

// Ícones lucide-react (mesmo pacote já trazido pela fundação shadcn/ui) no
// lugar dos SVGs desenhados à mão — conjunto abstrato/técnico de propósito
// (grid, prancheta, gráfico de barras...), nunca imagens de carrinho de
// compra, etiqueta de preço com "$" ou vitrine: identidade "Dashboard de
// Inteligência", não varejo.
//
// `module` é opcional de propósito: Dashboard agrega dado de vários módulos
// (sem controller próprio pra travar), então fica sempre visível — mesmo
// racional documentado em module-code.ts do backend.
const NAV_ITEMS: { to: string; label: string; icon: typeof LayoutGrid; module?: ModuleCode }[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutGrid },
  { to: '/pedidos', label: 'Pedidos', icon: ClipboardList, module: 'ORDERS' },
  { to: '/ads', label: 'Ads', icon: Megaphone, module: 'ADS' },
  { to: '/catalogo', label: 'Produtos', icon: Package, module: 'CATALOG' },
  { to: '/governanca-map', label: 'Governança MAP', icon: ShieldCheck, module: 'CATALOG' },
  { to: '/fornecedores', label: 'Fornecedores', icon: Factory, module: 'CATALOG' },
  { to: '/embalagens', label: 'Embalagens', icon: Boxes, module: 'CATALOG' },
  { to: '/listas-de-preco', label: 'Listas de Preço', icon: Receipt, module: 'CATALOG' },
  { to: '/promocoes', label: 'Promoções', icon: Tag, module: 'PROMOTIONS' },
  { to: '/financeiro', label: 'Financeiro', icon: BarChart3, module: 'FINANCE' },
  { to: '/abastecimento', label: 'Abastecimento', icon: Truck, module: 'REPLENISHMENT' },
  { to: '/lotes', label: 'Lotes', icon: Layers3, module: 'REPLENISHMENT' },
  { to: '/conferencia', label: 'Conferência', icon: ListChecks, module: 'CONFERENCE' },
  { to: '/integracoes', label: 'Integrações', icon: Plug, module: 'INTEGRATIONS' },
  { to: '/notas-fiscais', label: 'Notas Fiscais', icon: FileText, module: 'FISCAL_SETTINGS' },
  { to: '/configuracoes-fiscais', label: 'Configurações Fiscais', icon: Settings, module: 'FISCAL_SETTINGS' },
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
  const { user } = useAuth();

  // ADMIN (papel de tenant) sempre vê tudo, mesmo racional do backend
  // (ModuleAccessGuard libera ADMIN sem checar moduleAccess) — evita que o
  // dono da conta se tranque fora de um módulo por engano. Para os demais
  // papéis, o item some se o módulo não estiver em user.moduleAccess; isto é
  // só UX (a proteção de verdade é o @RequireModule no backend).
  const isTenantAdmin = user?.role === 'ADMIN';
  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.module || isTenantAdmin || user?.moduleAccess?.includes(item.module),
  );

  const navItems = [
    ...visibleItems,
    ...(isTenantAdmin ? [{ to: '/equipe', label: 'Equipe', icon: Users }] : []),
    ...(user?.isPlatformAdmin ? [{ to: '/admin', label: 'Administração', icon: Building2 }] : []),
  ];

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
          {navItems.map((item) => (
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
