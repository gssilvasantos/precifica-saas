import { useEffect, useMemo, useRef, useState } from 'react';
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
  ChevronsLeft,
  ChevronsRight,
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
const COLLAPSED_STORAGE_KEY = 'kyneti.sidebar.recolhida';

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

  // Sidebar recolhível (pedido do usuário, 13/10/2026: "não conseguimos
  // diminuir [o menu] para ganhar espaço na exibição dos produtos") — vira
  // uma trilha só de ícones (72px) em vez dos 256px padrão. Persistido como
  // os grupos abertos, mesma chave de storage por aba.
  const [recolhida, setRecolhida] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSED_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_STORAGE_KEY, recolhida ? '1' : '0');
    } catch {
      // ver comentário de `abertos` abaixo — persistir é conveniência.
    }
  }, [recolhida]);

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

  // O grupo da rota atual é aberto automaticamente quando a NAVEGAÇÃO muda
  // de grupo (link direto, F5, clique em outro item) — mas só nesse momento.
  // Antes isto dependia de `abertos` inteiro, então o próprio clique do
  // usuário para FECHAR o grupo da página em que ele já está (ex.: Vendas,
  // estando em /ads) mudava `abertos`, disparava o efeito de novo, via
  // `grupoDaRotaAtual` continuar igual e reabria o grupo na hora — o botão
  // "não fechava". Usar um ref com a última rota-grupo processada faz o
  // efeito agir só na transição de rota, nunca como reação ao toggle manual.
  const ultimoGrupoDaRotaRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (grupoDaRotaAtual && grupoDaRotaAtual !== ultimoGrupoDaRotaRef.current) {
      setAbertos((atual) => (atual.includes(grupoDaRotaAtual) ? atual : [...atual, grupoDaRotaAtual]));
    }
    ultimoGrupoDaRotaRef.current = grupoDaRotaAtual;
  }, [grupoDaRotaAtual]);

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
      recolhida && 'justify-center px-0',
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
          'fixed inset-y-0 left-0 z-40 flex shrink-0 flex-col border-r border-border bg-card transition-[transform,width] duration-200',
          recolhida ? 'md:w-[76px]' : 'md:w-64',
          'w-64 md:static md:translate-x-0',
          isOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div
          className={cn(
            'flex h-16 shrink-0 items-center gap-2 border-b border-border px-6',
            recolhida && 'md:justify-center md:px-0',
          )}
        >
          <span className={cn('font-serif text-xl font-semibold text-foreground', recolhida && 'md:hidden')}>
            Kyneti<span className="text-accent">.</span>
          </span>
          {/* Toggle de recolher (pedido do usuário, 13/10/2026: "não
              conseguimos diminuir [o menu] para ganhar espaço"). Some no
              mobile — lá o menu já é um painel sobreposto, recolher não
              ganha espaço nenhum, só esconde o rótulo sem necessidade. */}
          <button
            type="button"
            onClick={() => setRecolhida((atual) => !atual)}
            aria-label={recolhida ? 'Expandir menu' : 'Recolher menu'}
            title={recolhida ? 'Expandir menu' : 'Recolher menu'}
            className="hidden rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent/10 hover:text-foreground md:ml-auto md:flex"
          >
            {recolhida ? <ChevronsRight className="h-4 w-4" strokeWidth={1.8} /> : <ChevronsLeft className="h-4 w-4" strokeWidth={1.8} />}
          </button>
        </div>

        {/* overflow-y-auto: com grupos abertos a lista passa da altura da tela */}
        <nav className="flex-1 space-y-4 overflow-y-auto p-3">
          <div className="space-y-1">
            {HOME.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={onClose}
                className={itemClasses}
                title={recolhida ? item.label : undefined}
              >
                <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.8} />
                <span className={cn(recolhida && 'md:hidden')}>{item.label}</span>
              </NavLink>
            ))}
          </div>

          {grupos.map((grupo) => {
            // Recolhida: sem rótulo de grupo pra clicar, então todo grupo
            // fica sempre "aberto" — só a trilha de ícones, sem acordeão.
            const aberto = recolhida || abertos.includes(grupo.id);
            return (
              <div key={grupo.id} className="space-y-1">
                <button
                  type="button"
                  onClick={() => alternar(grupo.id)}
                  aria-expanded={aberto}
                  className={cn(
                    'flex w-full items-center justify-between rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 transition-colors hover:text-foreground',
                    recolhida && 'md:hidden',
                  )}
                >
                  {grupo.label}
                  <ChevronDown
                    className={cn('h-3.5 w-3.5 transition-transform', !aberto && '-rotate-90')}
                    strokeWidth={2}
                  />
                </button>

                {aberto &&
                  grupo.items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      onClick={onClose}
                      className={itemClasses}
                      title={recolhida ? item.label : undefined}
                    >
                      <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.8} />
                      <span className={cn(recolhida && 'md:hidden')}>{item.label}</span>
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
