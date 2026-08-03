import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
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
  Percent,
  ShoppingCart,
  Cog,
  Route,
  Send,
  FolderTree,
  Rocket,
  Radar,
  ShieldAlert,
  Tags,
  ChevronDown,
  Compass,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuth } from '../features/auth/auth-context';
import type { ModuleCode } from '../lib/module-codes';

// Ícones lucide-react (mesmo pacote já trazido pela fundação shadcn/ui) —
// conjunto abstrato/técnico de propósito (grid, prancheta, gráfico de
// barras...), nunca imagens de carrinho de compra, etiqueta de preço com "$"
// ou vitrine: identidade "Dashboard de Inteligência", não varejo.
//
// AGRUPAMENTO (02/08/2026) — antes disto o menu era uma LISTA PLANA de 28
// itens, do Dashboard às Configurações Fiscais numa coluna só. O usuário
// relatou, com razão, não conseguir formar noção do que existe no produto:
// 28 destinos sem hierarquia não são navegáveis, por mais que cada tela
// individualmente funcione.
//
// A divisão segue o fluxo de trabalho de quem vende (o que eu cadastro / o
// que eu vendo / o que eu compro / o que eu despacho / o que eu apuro), não a
// arquitetura de módulos do backend — o usuário não deveria precisar saber
// que Promoções e Radar de Concorrência são bounded contexts diferentes.

type NavItem = { to: string; label: string; icon: typeof LayoutGrid; module?: ModuleCode };
type NavGroup = { id: string; label: string; items: NavItem[] };

// `module` é opcional de propósito: Dashboard agrega dado de vários módulos
// (sem controller próprio pra travar), então fica sempre visível — mesmo
// racional documentado em module-code.ts do backend.
const HOME: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutGrid },
  { to: '/sistema', label: 'Visão do Sistema', icon: Compass },
];

const NAV_GROUPS: NavGroup[] = [
  {
    id: 'catalogo',
    label: 'Catálogo',
    items: [
      { to: '/catalogo', label: 'Produtos', icon: Package, module: 'CATALOG' },
      { to: '/categorias', label: 'Categorias e Publicação', icon: FolderTree, module: 'CATALOG' },
      { to: '/fornecedores', label: 'Fornecedores', icon: Factory, module: 'CATALOG' },
      { to: '/embalagens', label: 'Embalagens', icon: Boxes, module: 'CATALOG' },
      { to: '/listas-de-preco', label: 'Listas de Preço', icon: Receipt, module: 'CATALOG' },
      { to: '/tags', label: 'Tags', icon: Tags },
    ],
  },
  {
    id: 'vendas',
    label: 'Vendas',
    items: [
      { to: '/pedidos', label: 'Pedidos', icon: ClipboardList, module: 'ORDERS' },
      { to: '/promocoes', label: 'Promoções', icon: Tag, module: 'PROMOTIONS' },
      { to: '/ads', label: 'Ads', icon: Megaphone, module: 'ADS' },
      { to: '/radar-concorrencia', label: 'Radar de Concorrência', icon: Radar, module: 'CATALOG' },
      { to: '/publicar-anuncio', label: 'Publicar Anúncio', icon: Rocket, module: 'CATALOG' },
      { to: '/governanca-map', label: 'Governança MAP', icon: ShieldCheck, module: 'CATALOG' },
    ],
  },
  {
    id: 'suprimentos',
    label: 'Suprimentos',
    items: [
      { to: '/abastecimento', label: 'Abastecimento', icon: Truck, module: 'REPLENISHMENT' },
      { to: '/ordens-de-compra', label: 'Ordens de Compra', icon: ShoppingCart, module: 'REPLENISHMENT' },
      { to: '/ordens-de-producao', label: 'Ordens de Produção', icon: Cog, module: 'REPLENISHMENT' },
      { to: '/lotes', label: 'Lotes', icon: Layers3, module: 'REPLENISHMENT' },
    ],
  },
  {
    id: 'expedicao',
    label: 'Expedição',
    items: [
      { to: '/conferencia', label: 'Conferência', icon: ListChecks, module: 'CONFERENCE' },
      { to: '/expedicao-em-lote', label: 'Expedição em Lote', icon: Send, module: 'CONFERENCE' },
      { to: '/transportadoras', label: 'Transportadoras', icon: Route, module: 'CONFERENCE' },
    ],
  },
  {
    id: 'financas',
    label: 'Finanças',
    items: [
      { to: '/financeiro', label: 'Financeiro', icon: BarChart3, module: 'FINANCE' },
      { to: '/vendedores', label: 'Vendedores', icon: Percent, module: 'FINANCE' },
      { to: '/notas-fiscais', label: 'Notas Fiscais', icon: FileText, module: 'FISCAL_SETTINGS' },
      { to: '/configuracoes-fiscais', label: 'Configurações Fiscais', icon: Settings, module: 'FISCAL_SETTINGS' },
    ],
  },
  {
    id: 'configuracoes',
    label: 'Configurações',
    items: [
      { to: '/integracoes', label: 'Integrações', icon: Plug, module: 'INTEGRATIONS' },
      { to: '/governanca-marketplace', label: 'Governança Marketplace', icon: ShieldAlert, module: 'INTEGRATIONS' },
    ],
  },
];

const STORAGE_KEY = 'kyneti.sidebar.groupsAbertos';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

// Sidebar persistente no desktop (md+); no mobile vira um painel deslizante
// com backdrop, controlado pelo AppLayout via isOpen/onClose. Tokens
// semânticos (bg-card/border-border/bg-primary) em vez dos nomeados
// diretamente — resolve sozinho para o tema certo sem lógica condicional aqui.
export default function Sidebar({ isOpen, onClose }: Props) {
  const { user } = useAuth();
  const { pathname } = useLocation();

  // ADMIN (papel de tenant) sempre vê tudo, mesmo racional do backend
  // (ModuleAccessGuard libera ADMIN sem checar moduleAccess) — evita que o
  // dono da conta se tranque fora de um módulo por engano. Para os demais
  // papéis, o item some se o módulo não estiver em user.moduleAccess; isto é
  // só UX (a proteção de verdade é o @RequireModule no backend).
  const isTenantAdmin = user?.role === 'ADMIN';

  const grupos = useMemo(() => {
    const podeVer = (item: NavItem) =>
      !item.module || isTenantAdmin || user?.moduleAccess?.includes(item.module);

    const base = NAV_GROUPS.map((grupo) => ({ ...grupo, items: grupo.items.filter(podeVer) }))
      // Grupo que ficou sem nenhum item visível não vira cabeçalho órfão.
      .filter((grupo) => grupo.items.length > 0);

    const conta: NavItem[] = [
      ...(isTenantAdmin ? [{ to: '/equipe', label: 'Equipe', icon: Users }] : []),
      ...(user?.isPlatformAdmin ? [{ to: '/admin', label: 'Administração', icon: Building2 }] : []),
    ];

    return conta.length > 0 ? [...base, { id: 'conta', label: 'Conta', items: conta }] : base;
  }, [isTenantAdmin, user?.moduleAccess, user?.isPlatformAdmin]);

  const grupoDaRotaAtual = grupos.find((g) => g.items.some((i) => pathname.startsWith(i.to)))?.id;

  const [abertos, setAbertos] = useState<string[]>(() => {
    try {
      const salvo = localStorage.getItem(STORAGE_KEY);
      if (salvo) return JSON.parse(salvo) as string[];
    } catch {
      // localStorage indisponível (modo privado, storage cheio) não pode
      // derrubar a navegação — cai no default de tudo aberto.
    }
    return NAV_GROUPS.map((g) => g.id);
  });

  // O grupo da rota atual nunca fica fechado: navegar por link direto ou
  // recarregar a página não pode esconder onde o usuário está.
  useEffect(() => {
    if (grupoDaRotaAtual && !abertos.includes(grupoDaRotaAtual)) {
      setAbertos((atual) => [...atual, grupoDaRotaAtual]);
    }
  }, [grupoDaRotaAtual, abertos]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(abertos));
    } catch {
      // ver comentário acima — persistir é conveniência, não requisito.
    }
  }, [abertos]);

  const alternar = (id: string) =>
    setAbertos((atual) => (atual.includes(id) ? atual.filter((g) => g !== id) : [...atual, id]));

  const itemClasses = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
      isActive
        ? 'bg-primary text-primary-foreground'
        : 'text-muted-foreground hover:bg-accent/10 hover:text-foreground',
    );

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 z-30 bg-background/70 backdrop-blur-sm md:hidden" onClick={onClose} />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-border bg-card transition-transform md:static md:translate-x-0',
          isOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-16 shrink-0 items-center gap-2 border-b border-border px-6">
          <span className="font-serif text-xl font-semibold text-foreground">
            Kyneti<span className="text-accent">.</span>
          </span>
        </div>

        {/* overflow-y-auto: com grupos abertos a lista passa da altura da tela */}
        <nav className="flex-1 space-y-4 overflow-y-auto p-3">
          <div className="space-y-1">
            {HOME.map((item) => (
              <NavLink key={item.to} to={item.to} onClick={onClose} className={itemClasses}>
                <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.8} />
                {item.label}
              </NavLink>
            ))}
          </div>

          {grupos.map((grupo) => {
            const aberto = abertos.includes(grupo.id);
            return (
              <div key={grupo.id} className="space-y-1">
                <button
                  type="button"
                  onClick={() => alternar(grupo.id)}
                  aria-expanded={aberto}
                  className="flex w-full items-center justify-between rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 transition-colors hover:text-foreground"
                >
                  {grupo.label}
                  <ChevronDown
                    className={cn('h-3.5 w-3.5 transition-transform', !aberto && '-rotate-90')}
                    strokeWidth={2}
                  />
                </button>

                {aberto &&
                  grupo.items.map((item) => (
                    <NavLink key={item.to} to={item.to} onClick={onClose} className={itemClasses}>
                      <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.8} />
                      {item.label}
                    </NavLink>
                  ))}
              </div>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
