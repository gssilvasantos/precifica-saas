import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createProduct, updateProduct, type Product, type ProductWriteInput } from '../api';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';

// Cadastro de produto — criar e editar.
//
// POR QUE ESTE ARQUIVO EXISTE (02/08/2026): o backend tem CRUD completo de
// produto desde sempre (POST, PATCH, DELETE, variações, estrutura, lotes — 14
// endpoints), mas o frontend só sabia LER a lista e alterar três campos
// isolados (preço MAP, controla lote, categoria). Não havia como cadastrar um
// produto pela interface: ou vinha do sync do ERP, ou não existia.
//
// Os campos fiscais (NCM, CEST, GTIN, origem) são o motivo imediato: são a
// chave da classificação tributária, porque substituição tributária e
// tributação monofásica são definidas pelo NCM, não pelo SKU. Sem NCM no
// catálogo não há como classificar em massa, e classificar SKU a SKU não é
// viável num catálogo de centenas de itens.

const ORIGENS_FISCAIS = [
  { codigo: 0, rotulo: '0 — Nacional' },
  { codigo: 1, rotulo: '1 — Estrangeira, importação direta' },
  { codigo: 2, rotulo: '2 — Estrangeira, adquirida no mercado interno' },
  { codigo: 3, rotulo: '3 — Nacional, importação entre 40% e 70%' },
  { codigo: 4, rotulo: '4 — Nacional, processos produtivos básicos' },
  { codigo: 5, rotulo: '5 — Nacional, importação até 40%' },
  { codigo: 6, rotulo: '6 — Estrangeira, sem similar nacional' },
  { codigo: 7, rotulo: '7 — Estrangeira, adquirida no país, sem similar' },
  { codigo: 8, rotulo: '8 — Nacional, importação superior a 70%' },
];

interface Props {
  produto?: Product; // ausente = criação
  onClose: () => void;
}

type Campos = Record<string, string>;

function valoresIniciais(produto?: Product): Campos {
  return {
    skuCode: produto?.skuCode ?? '',
    name: produto?.name ?? '',
    internalCategory: produto?.internalCategory ?? '',
    costPrice: produto ? String(produto.costPrice) : '',
    desiredMarginPct: produto ? String(produto.desiredMarginPct) : '20',
    minimumMarginPct: produto ? String(produto.minimumMarginPct) : '8',
    weightKg: produto ? String(produto.weightKg) : '',
    packagingWeightKg: produto ? String(produto.packagingWeightKg) : '',
    lengthCm: produto ? String(produto.lengthCm) : '',
    widthCm: produto ? String(produto.widthCm) : '',
    heightCm: produto ? String(produto.heightCm) : '',
    ncm: produto?.ncm ?? '',
    cest: produto?.cest ?? '',
    gtin: produto?.gtin ?? '',
    fiscalOriginCode: produto?.fiscalOriginCode !== null && produto?.fiscalOriginCode !== undefined
      ? String(produto.fiscalOriginCode)
      : '',
  };
}

// String vazia vira `null`, não `undefined`: no backend `null` explícito
// LIMPA o campo, enquanto ausência significa "não mexa". Quem apaga o NCM na
// tela está pedindo para apagar.
const texto = (v: string): string | null => (v.trim() === '' ? null : v.trim());

export default function ProductForm({ produto, onClose }: Props) {
  const queryClient = useQueryClient();
  const editando = produto !== undefined;
  const [campos, setCampos] = useState<Campos>(() => valoresIniciais(produto));
  const [erro, setErro] = useState<string | null>(null);

  const set = (nome: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setCampos((atual) => ({ ...atual, [nome]: e.target.value }));

  const montarPayload = (): ProductWriteInput => ({
    skuCode: campos.skuCode.trim(),
    name: campos.name.trim(),
    internalCategory: texto(campos.internalCategory),
    costPrice: Number(campos.costPrice),
    desiredMarginPct: Number(campos.desiredMarginPct),
    minimumMarginPct: Number(campos.minimumMarginPct),
    weightKg: Number(campos.weightKg),
    ...(campos.packagingWeightKg.trim() !== '' ? { packagingWeightKg: Number(campos.packagingWeightKg) } : {}),
    lengthCm: Number(campos.lengthCm),
    widthCm: Number(campos.widthCm),
    heightCm: Number(campos.heightCm),
    ncm: texto(campos.ncm),
    cest: texto(campos.cest),
    gtin: texto(campos.gtin),
    fiscalOriginCode: campos.fiscalOriginCode.trim() === '' ? null : Number(campos.fiscalOriginCode),
  });

  const mutation = useMutation({
    mutationFn: () => (editando ? updateProduct(produto.id, montarPayload()) : createProduct(montarPayload())),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      onClose();
    },
    onError: (e: unknown) => {
      // A mensagem do backend costuma ser específica ("margem mínima maior que
      // a desejada", "SKU já existe") — vale mais que um "erro ao salvar".
      const resposta = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
      setErro(Array.isArray(resposta) ? resposta.join('. ') : (resposta ?? 'Não foi possível salvar o produto.'));
    },
  });

  const numeroValido = (v: string) => v.trim() !== '' && Number(v) > 0;
  const podeSalvar =
    campos.skuCode.trim() !== '' &&
    campos.name.trim() !== '' &&
    numeroValido(campos.costPrice) &&
    numeroValido(campos.weightKg) &&
    numeroValido(campos.lengthCm) &&
    numeroValido(campos.widthCm) &&
    numeroValido(campos.heightCm) &&
    Number(campos.minimumMarginPct) <= Number(campos.desiredMarginPct);

  const campo = (nome: string, rotulo: string, extras: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="text-xs font-medium text-foreground">
      {rotulo}
      <input
        value={campos[nome]}
        onChange={set(nome)}
        className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
        {...extras}
      />
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-background/70 p-4 backdrop-blur-sm">
      <Card className="my-8 w-full max-w-3xl p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-serif text-xl font-semibold text-foreground">
              {editando ? 'Editar produto' : 'Novo produto'}
            </h2>
            {editando && produto.sourceSystem === 'ERP_OLIST' && (
              <p className="mt-1 text-sm text-muted-foreground">
                Produto espelhado do Olist. Campos físicos e comerciais são mantidos pelo ERP e voltam ao valor
                dele no próximo sync — os campos fiscais são editáveis aqui.
              </p>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Fechar
          </Button>
        </div>

        <div className="mt-6 space-y-6">
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
              Identificação
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {campo('skuCode', 'SKU *', { disabled: editando, placeholder: 'ABC-123' })}
              {campo('name', 'Nome *', { placeholder: 'Batom matte vermelho 4g' })}
              {campo('internalCategory', 'Categoria interna', { placeholder: 'Maquiagem / Lábios' })}
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
              Custo e margem
            </h3>
            <div className="grid gap-3 sm:grid-cols-3">
              {campo('costPrice', 'Custo de compra (R$) *', { type: 'number', step: '0.01', min: '0' })}
              {campo('desiredMarginPct', 'Margem desejada (%) *', { type: 'number', step: '0.1', min: '0' })}
              {campo('minimumMarginPct', 'Margem mínima (%) *', { type: 'number', step: '0.1', min: '0' })}
            </div>
            {Number(campos.minimumMarginPct) > Number(campos.desiredMarginPct) && (
              <p className="text-sm text-amber-600 dark:text-amber-400">
                A margem mínima não pode ser maior que a desejada.
              </p>
            )}
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
              Peso e dimensões
            </h3>
            <p className="text-sm text-muted-foreground">
              Usados no cálculo de peso cubado, que define o frete em quase todos os canais.
            </p>
            <div className="grid gap-3 sm:grid-cols-5">
              {campo('weightKg', 'Peso (kg) *', { type: 'number', step: '0.001', min: '0' })}
              {campo('packagingWeightKg', 'Peso da embalagem (kg)', { type: 'number', step: '0.001', min: '0' })}
              {campo('lengthCm', 'Compr. (cm) *', { type: 'number', step: '0.1', min: '0' })}
              {campo('widthCm', 'Largura (cm) *', { type: 'number', step: '0.1', min: '0' })}
              {campo('heightCm', 'Altura (cm) *', { type: 'number', step: '0.1', min: '0' })}
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">Fiscal</h3>
            <p className="text-sm text-muted-foreground">
              O NCM define a classificação tributária do produto — é ele que determina se há substituição
              tributária e se a tributação de PIS/Cofins é monofásica, não o SKU. Também é obrigatório para
              emitir NF-e e para publicar anúncio em marketplace.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {campo('ncm', 'NCM', { placeholder: '3304.99.90', maxLength: 10 })}
              {campo('cest', 'CEST', { placeholder: '20.063.00', maxLength: 10 })}
              {campo('gtin', 'GTIN / EAN', { placeholder: '7891234567890', maxLength: 14 })}
              <label className="text-xs font-medium text-foreground">
                Origem da mercadoria
                <select
                  value={campos.fiscalOriginCode}
                  onChange={set('fiscalOriginCode')}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
                >
                  <option value="">Não informada</option>
                  {ORIGENS_FISCAIS.map((o) => (
                    <option key={o.codigo} value={o.codigo}>
                      {o.rotulo}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {!editando && (
              <p className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
                Ao gerar variações a partir deste produto, os quatro campos fiscais são copiados
                automaticamente para cada variação — mesma classificação, um cadastro só.
              </p>
            )}
          </section>

          {erro && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {erro}
            </p>
          )}

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button onClick={() => mutation.mutate()} disabled={!podeSalvar || mutation.isPending}>
              {mutation.isPending ? 'Salvando...' : editando ? 'Salvar alterações' : 'Cadastrar produto'}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
