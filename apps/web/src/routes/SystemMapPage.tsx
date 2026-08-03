import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, CircleDashed, ExternalLink } from 'lucide-react';
import { cn } from '../lib/utils';

// "Visão do Sistema" — o mapa do próprio produto.
//
// POR QUE ESTA TELA EXISTE (02/08/2026): o usuário relatou não conseguir ter
// noção do que existe no projeto. O diagnóstico foi que o backend cresceu
// muito mais rápido que a interface — há capacidade construída e testada que
// não tem nenhuma porta de entrada na tela, e não havia como descobrir isso
// sem ler o código.
//
// A coluna que importa é a de status SEM_TELA: é o inventário do que existe e
// está invisível. Uma tela que só listasse o que já é navegável seria um menu
// duplicado.
//
// MANUTENÇÃO: este mapa é CURADO, não gerado. Um mapa automático (varrendo
// rotas e controllers) diria "existe um endpoint", não "isto está pronto para
// alguém usar" — e é a segunda pergunta que interessa. O custo é que ele
// precisa ser atualizado quando um módulo muda de estado; o benefício é que
// ele pode ser honesto sobre "parcial", que nenhuma varredura consegue.

type Status = 'ATIVO' | 'PARCIAL' | 'SEM_TELA';

interface Capacidade {
  nome: string;
  descricao: string;
  status: Status;
  rota?: string;
  // O que falta, quando não está ATIVO. Escrito para o dono do produto ler,
  // não para o desenvolvedor.
  pendencia?: string;
}

interface Area {
  area: string;
  capacidades: Capacidade[];
}

const MAPA: Area[] = [
  {
    area: 'Catálogo',
    capacidades: [
      {
        nome: 'Produtos',
        descricao:
          'Cadastro completo — identificação, custo e margem, peso e dimensões, e os campos fiscais (NCM, CEST, GTIN e origem) que definem a classificação tributária.',
        status: 'PARCIAL',
        rota: '/catalogo',
        pendencia:
          'O formulário cobre os campos essenciais. Ainda não expõe pela tela: vínculo com fornecedor e embalagem, geração de variações e estrutura de kit — tudo isso existe no servidor.',
      },
      {
        nome: 'Categorias e Publicação',
        descricao:
          'Árvore de categorias própria, vínculo com a categoria de cada canal e importação da árvore do ERP como atalho de migração (com prévia antes de aplicar).',
        status: 'ATIVO',
        rota: '/categorias',
      },
      {
        nome: 'Fornecedores',
        descricao: 'Cadastro de fornecedores e vínculo com produtos.',
        status: 'ATIVO',
        rota: '/fornecedores',
      },
      {
        nome: 'Embalagens',
        descricao: 'Custo unitário por embalagem, com hierarquia kit/individual/padrão.',
        status: 'ATIVO',
        rota: '/embalagens',
      },
      {
        nome: 'Listas de Preço',
        descricao: 'Tabelas de preço por canal ou cliente.',
        status: 'ATIVO',
        rota: '/listas-de-preco',
      },
    ],
  },
  {
    area: 'Vendas',
    capacidades: [
      {
        nome: 'Pedidos',
        descricao: 'Hub multicanal com status unificado, margem por pedido e qualidade do dado.',
        status: 'ATIVO',
        rota: '/pedidos',
      },
      {
        nome: 'Promoções',
        descricao: 'Simulador de margem que valida a viabilidade antes de a promoção existir.',
        status: 'ATIVO',
        rota: '/promocoes',
      },
      {
        nome: 'Ads',
        descricao: 'Investimento por canal e por SKU, com rateio no resultado.',
        status: 'ATIVO',
        rota: '/ads',
      },
      {
        nome: 'Radar de Concorrência',
        descricao: 'Acompanhamento de preço de concorrente por anúncio.',
        status: 'ATIVO',
        rota: '/radar-concorrencia',
      },
      {
        nome: 'Motor de Preço',
        descricao:
          'Piso de preço com comissão importada do canal, faixas de taxa, frete e perfil do vendedor. Bloqueia a decisão quando a taxa não foi importada, em vez de assumir zero.',
        status: 'PARCIAL',
        rota: '/produtos',
        pendencia:
          'Roda por produto, mas ainda usa a alíquota fixa de imposto do tenant em vez do cálculo por regime.',
      },
    ],
  },
  {
    area: 'Suprimentos e Expedição',
    capacidades: [
      {
        nome: 'Abastecimento',
        descricao: 'Sugestão de reposição por giro e cobertura.',
        status: 'ATIVO',
        rota: '/abastecimento',
      },
      {
        nome: 'Ordens de Compra e Produção',
        descricao: 'Compra de fornecedor e produção própria com lista de materiais.',
        status: 'ATIVO',
        rota: '/ordens-de-compra',
      },
      {
        nome: 'Conferência (Hub de Provas)',
        descricao:
          'Nenhuma saída de estoque existe sem evento auditado, com bipagem e vídeo anexado.',
        status: 'ATIVO',
        rota: '/conferencia',
      },
      {
        nome: 'Expedição em Lote',
        descricao: 'Agrupa pedidos já conferidos numa única operação de etiqueta e despacho.',
        status: 'ATIVO',
        rota: '/expedicao-em-lote',
      },
    ],
  },
  {
    area: 'Finanças e Fiscal',
    capacidades: [
      {
        nome: 'DRE por canal',
        descricao:
          'Cascata de receita a resultado operacional, com margem de contribuição, custo de Ads rateado por SKU e despesas fixas rateadas por dia.',
        status: 'PARCIAL',
        rota: '/financeiro',
        pendencia:
          'Os cartões de resumo ainda não viraram cascata vertical, e as deduções usam a alíquota fixa em vez do cálculo por regime.',
      },
      {
        nome: 'Notas Fiscais',
        descricao: 'Emissão de NF-e com destinatário em snapshot imutável.',
        status: 'ATIVO',
        rota: '/notas-fiscais',
      },
      {
        nome: 'Comissão de Vendedores',
        descricao: 'Atribuição por item com alíquota em snapshot e geração de conta a pagar.',
        status: 'ATIVO',
        rota: '/vendedores',
      },
      {
        nome: 'Regimes tributários (Tax Intelligence)',
        descricao:
          'Calcula a alíquota efetiva em vez de perguntar: MEI, Simples Nacional (Anexos I a V, alíquota por RBT12, segregação de ST e monofásico por produto), Lucro Presumido e Lucro Real. Reproduz um extrato oficial do PGDAS-D ao centavo.',
        status: 'SEM_TELA',
        pendencia:
          'Não há onde cadastrar regime, perfil fiscal do produto e faturamento anterior — e sem isso o cálculo bloqueia, que é o comportamento correto mas inutilizável.',
      },
    ],
  },
  {
    area: 'Integrações',
    capacidades: [
      {
        nome: 'Mercado Livre e Shopee',
        descricao: 'Pedidos, anúncios, taxas por categoria e investimento em Ads.',
        status: 'ATIVO',
        rota: '/integracoes',
      },
      {
        nome: 'Importação do ERP Olist',
        descricao:
          'Espelha o catálogo do ERP — nome, custo, estoque, peso, dimensões, fotos e os campos fiscais (NCM, CEST, GTIN e origem). Respeita o limite de requisições e reprocessa em caso de bloqueio.',
        status: 'PARCIAL',
        rota: '/integracoes',
        pendencia:
          'Importa produtos simples e variações (cada variação vira um produto próprio, com custo e estoque dela). Falta trazer a árvore de categorias do ERP.',
      },
      {
        nome: 'Governança de Marketplace',
        descricao: 'Versionamento das regras importadas de cada canal, com saúde do provedor.',
        status: 'ATIVO',
        rota: '/governanca-marketplace',
      },
    ],
  },
];

const ESTILO: Record<Status, { rotulo: string; classe: string; Icone: typeof CheckCircle2 }> = {
  ATIVO: {
    rotulo: 'Em uso',
    classe: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    Icone: CheckCircle2,
  },
  PARCIAL: {
    rotulo: 'Parcial',
    classe: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
    Icone: AlertTriangle,
  },
  SEM_TELA: {
    rotulo: 'Sem tela',
    classe: 'border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400',
    Icone: CircleDashed,
  },
};

function Selo({ status }: { status: Status }) {
  const { rotulo, classe, Icone } = ESTILO[status];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        classe,
      )}
    >
      <Icone className="h-3.5 w-3.5" strokeWidth={2} />
      {rotulo}
    </span>
  );
}

export default function SystemMapPage() {
  const todas = MAPA.flatMap((a) => a.capacidades);
  const contagem = {
    ATIVO: todas.filter((c) => c.status === 'ATIVO').length,
    PARCIAL: todas.filter((c) => c.status === 'PARCIAL').length,
    SEM_TELA: todas.filter((c) => c.status === 'SEM_TELA').length,
  };

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <h1 className="font-serif text-2xl font-semibold text-foreground">Visão do Sistema</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          O que existe no Kyneti hoje, e em que estado. Inclui de propósito o que está construído e
          testado no servidor mas ainda não tem tela — é o que não dá para descobrir navegando.
        </p>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <span className="text-sm text-muted-foreground">{contagem.ATIVO} em uso</span>
          <span className="text-muted-foreground/40">·</span>
          <span className="text-sm text-muted-foreground">{contagem.PARCIAL} parciais</span>
          <span className="text-muted-foreground/40">·</span>
          <span className="text-sm text-muted-foreground">{contagem.SEM_TELA} sem tela</span>
        </div>
      </header>

      {MAPA.map((area) => (
        <section key={area.area} className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
            {area.area}
          </h2>

          <div className="space-y-2">
            {area.capacidades.map((cap) => (
              <article
                key={cap.nome}
                className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-accent/40"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-foreground">{cap.nome}</h3>
                      {cap.rota && (
                        <Link
                          to={cap.rota}
                          className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                        >
                          abrir
                          <ExternalLink className="h-3 w-3" strokeWidth={2} />
                        </Link>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{cap.descricao}</p>
                  </div>
                  <Selo status={cap.status} />
                </div>

                {cap.pendencia && (
                  <p className="mt-3 border-t border-border/60 pt-3 text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">Falta: </span>
                    {cap.pendencia}
                  </p>
                )}
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
