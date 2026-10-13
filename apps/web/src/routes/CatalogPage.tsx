import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { fetchProducts, type Product } from '../features/catalog/api';
import ProductForm from '../features/catalog/components/ProductForm';
import GenerateVariantsDialog from '../features/catalog/components/GenerateVariantsDialog';
import { Pagination } from '../components/ui/pagination';
import CatalogRow from '../features/catalog/components/CatalogRow';
import { groupByParent } from '../features/catalog/group-variants';
import { fetchChannelListings } from '../features/channels/api';
import { averageChannelPrice, computeMarginStatus, grossMarginPct } from '../features/catalog/margin-status';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';

const PAGE_SIZE = 50;

// `null` = fechado; `undefined` dentro do estado aberto = criação. Duas
// informações distintas ("está aberto?" e "editando quem?") num estado só,
// para não existir a combinação impossível de fechado-com-produto.
type FormState = { produto?: Product } | null;

export default function CatalogPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(null);
  // Pais expandidos. Começa tudo recolhido: o catálogo lista um pai por linha.
  const [page, setPage] = useState(1);
  const [gerarPara, setGerarPara] = useState<Product | null>(null);
  const [expandidos, setExpandidos] = useState<Set<string>>(() => new Set());
  const alternar = (id: string) =>
    setExpandidos((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  const productsQuery = useQuery({ queryKey: ['products'], queryFn: fetchProducts });
  const listingsQuery = useQuery({ queryKey: ['channel-listings'], queryFn: fetchChannelListings });

  const products = productsQuery.data ?? [];
  const listings = listingsQuery.data ?? [];
  const isLoading = productsQuery.isLoading || listingsQuery.isLoading;

  const rows = products.map((product) => {
    const skuListings = listings.filter((l) => l.skuCode === product.skuCode);
    const avgPrice = averageChannelPrice(skuListings.map((l) => l.currentPrice));
    const marginPct = grossMarginPct(avgPrice, product.costPrice);
    const statusInfo = computeMarginStatus(marginPct, product.minimumMarginPct);
    return { product, avgPrice, marginPct, statusInfo, channelCount: skuListings.length };
  });

  // Um produto PAI por linha, no máximo PAGE_SIZE por página; as variações do pai
  // expandido aparecem logo abaixo dele e não entram na contagem da página.
  // Paginação no cliente: GET /products ainda devolve a lista inteira (dívida
  // conhecida — o agrupamento pai/filho precisa dela completa).
  const groups = groupByParent(rows);
  const totalPages = Math.max(1, Math.ceil(groups.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageGroups = groups.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const firstShown = groups.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const lastShown = Math.min(currentPage * PAGE_SIZE, groups.length);

  // Tiras de resumo (Reestruturação Visual WowDash, 13/10/2026) — contagem
  // real sobre `rows` já calculado acima, nenhum dado novo buscado.
  const semNcmCount = products.filter((p) => !p.ncm).length;
  const margemBaixaOuPrejuizoCount = rows.filter((r) => r.statusInfo.status === 'BAIXA' || r.statusInfo.status === 'PREJUIZO').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-foreground">Catálogo</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Produtos com variações aparecem agrupados: use a seta para expandir. Preço e margem aqui são a média simples entre os canais vinculados, sem taxa de gateway — para o cálculo
            fino por cenário, abra "Editar Precificação".
          </p>
        </div>
        <Button onClick={() => setForm({})}>Novo produto</Button>
      </div>

      {!isLoading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Produtos cadastrados</p>
            <p className="mt-1 text-xl font-semibold text-foreground">{products.length}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Margem baixa ou prejuízo</p>
            <p className={`mt-1 text-xl font-semibold ${margemBaixaOuPrejuizoCount > 0 ? 'text-margin-danger' : 'text-foreground'}`}>
              {margemBaixaOuPrejuizoCount}
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Sem NCM cadastrado</p>
            <p className={`mt-1 text-xl font-semibold ${semNcmCount > 0 ? 'text-margin-warning' : 'text-foreground'}`}>{semNcmCount}</p>
          </Card>
        </div>
      )}

      <Card className="overflow-hidden p-0">
        {/* Sem overflow-x: a tabela cabe na página (table-fixed) e as colunas
            secundárias somem em telas menores, em vez de criar rolagem lateral. */}
        <table className="w-full table-fixed text-left text-sm">
          <thead className="bg-muted/50">
            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-3 font-medium">Produto</th>
              <th className="hidden w-24 px-3 py-3 font-medium md:table-cell">Custo</th>
              <th className="hidden w-32 px-3 py-3 font-medium lg:table-cell">Preço médio</th>
              <th className="w-20 px-3 py-3 font-medium">Margem</th>
              <th className="hidden w-40 px-3 py-3 font-medium sm:table-cell">Status</th>
              <th className="hidden w-24 px-3 py-3 font-medium xl:table-cell">NCM</th>
              <th className="w-14 px-3 py-3 font-medium">
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={7} className="px-5 py-8 text-center text-muted-foreground">
                  Carregando catálogo…
                </td>
              </tr>
            )}

            {!isLoading && groups.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-8 text-center text-muted-foreground">
                  Nenhum produto ainda. Conecte o Olist em Integrações para importar o catálogo, ou rode o seed demo.
                </td>
              </tr>
            )}

            {pageGroups.map(({ item, children }) => {
              const aberto = expandidos.has(item.product.id);
              return (
                <Fragment key={item.product.id}>
                  <CatalogRow
                    row={item}
                    variantCount={children.length}
                    expanded={aberto}
                    onToggle={() => alternar(item.product.id)}
                    onEdit={() => setForm({ produto: item.product })}
                    onPricing={() => navigate(`/produtos/${item.product.id}`)}
                    onGenerateVariants={() => setGerarPara(item.product)}
                  />
                  {aberto &&
                    children.map((child) => (
                      <CatalogRow
                        key={child.product.id}
                        row={child}
                        isChild
                        onEdit={() => setForm({ produto: child.product })}
                        onPricing={() => navigate(`/produtos/${child.product.id}`)}
                      />
                    ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>

        {!isLoading && groups.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
            <p className="text-xs text-muted-foreground">
              Mostrando {firstShown}–{lastShown} de {groups.length} {groups.length === 1 ? 'produto' : 'produtos'}
              {' '}(variações aparecem dentro do produto pai)
            </p>
            <Pagination page={currentPage} totalPages={totalPages} onPageChange={setPage} className="text-xs" />
          </div>
        )}
      </Card>

      {gerarPara && (
        <GenerateVariantsDialog
          parent={gerarPara}
          onClose={() => setGerarPara(null)}
          onCreated={(id) => setExpandidos((atual) => new Set(atual).add(id))}
        />
      )}
      {form && <ProductForm produto={form.produto} onClose={() => setForm(null)} />}
    </div>
  );
}
