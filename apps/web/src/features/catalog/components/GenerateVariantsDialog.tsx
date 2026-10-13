import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  generateVariantCombinations,
  MAX_VARIANT_ATTRIBUTES,
  MAX_VARIANT_COMBINATIONS,
  type Product,
  type VariantAttributeInput,
} from '../api';
import { parseOptions } from '../parse-options';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import ModalShell from '../../../components/motion/ModalShell';

interface Props {
  parent: Product;
  onClose: () => void;
  onCreated: (parentId: string) => void;
}

interface Linha {
  name: string;
  options: string; // opções separadas por vírgula, como o usuário digita
}

export default function GenerateVariantsDialog({ parent, onClose, onCreated }: Props) {
  const queryClient = useQueryClient();
  const [linhas, setLinhas] = useState<Linha[]>([{ name: 'Cor', options: '' }]);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [onClose]);

  const atributos: VariantAttributeInput[] = useMemo(
    () => linhas.map((l) => ({ name: l.name.trim(), options: parseOptions(l.options) })),
    [linhas],
  );
  const nomesRepetidos = new Set(atributos.map((a) => a.name.toLowerCase())).size !== atributos.length;
  const completo = atributos.every((a) => a.name !== '' && a.options.length > 0);
  const total = atributos.reduce((t, a) => t * Math.max(a.options.length, 0), 1);
  const passaDoTeto = total > MAX_VARIANT_COMBINATIONS;
  const podeGerar = completo && !nomesRepetidos && !passaDoTeto && total > 0;

  const mutation = useMutation({
    mutationFn: () => generateVariantCombinations(parent.id, atributos),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      onCreated(parent.id);
      onClose();
    },
    onError: (e: unknown) => {
      // Falha no meio deixa as variações anteriores criadas (geração
      // sequencial); recarregar a lista mostra o que já existe.
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      const resposta = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
      setErro(Array.isArray(resposta) ? resposta.join('. ') : (resposta ?? 'Não foi possível gerar as variações.'));
    },
  });

  const alterar = (i: number, campo: keyof Linha, valor: string) =>
    setLinhas((atual) => atual.map((l, idx) => (idx === i ? { ...l, [campo]: valor } : l)));

  return (
    <ModalShell onClose={onClose} maxWidthClassName="max-w-2xl">
      <Card
        role="dialog"
        aria-modal="true"
        aria-labelledby="gerar-variacoes-titulo"
        className="p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="gerar-variacoes-titulo" className="font-serif text-xl font-semibold text-foreground">
              Gerar variações
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Produto pai: <span className="font-medium text-foreground">{parent.name}</span> ({parent.skuCode}). Cada
              combinação vira um produto novo, com SKU e nome montados a partir do pai, e herda custo, margens,
              dimensões e campos fiscais dele.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Fechar
          </Button>
        </div>

        <div className="mt-6 space-y-3">
          {linhas.map((linha, i) => (
            <div key={i} className="grid gap-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
              <label className="flex flex-col justify-end text-xs font-medium text-foreground">
                Atributo
                <input
                  value={linha.name}
                  onChange={(e) => alterar(i, 'name', e.target.value)}
                  maxLength={60}
                  placeholder="Cor"
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
                />
              </label>
              <label className="flex flex-col justify-end text-xs font-medium text-foreground">
                Opções (separadas por vírgula)
                <input
                  value={linha.options}
                  onChange={(e) => alterar(i, 'options', e.target.value)}
                  placeholder="Rosa, Nude, Vermelho"
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
                />
              </label>
              {linhas.length > 1 && (
                <Button variant="ghost" size="sm" onClick={() => setLinhas((a) => a.filter((_, idx) => idx !== i))}>
                  Remover
                </Button>
              )}
            </div>
          ))}
          {linhas.length < MAX_VARIANT_ATTRIBUTES && (
            <Button variant="outline" size="sm" onClick={() => setLinhas((a) => [...a, { name: '', options: '' }])}>
              Adicionar atributo
            </Button>
          )}
        </div>

        <div className="mt-5 rounded-lg border border-border bg-muted/30 p-3 text-sm" aria-live="polite">
          {nomesRepetidos ? (
            <span className="text-amber-600 dark:text-amber-400">Dois atributos têm o mesmo nome.</span>
          ) : !completo ? (
            <span className="text-muted-foreground">Preencha o nome e ao menos uma opção de cada atributo.</span>
          ) : passaDoTeto ? (
            <span className="text-amber-600 dark:text-amber-400">
              Esta grade geraria {total} variações; o máximo por vez é {MAX_VARIANT_COMBINATIONS}. Reduza as opções.
            </span>
          ) : (
            <span className="text-foreground">
              Serão criados <strong>{total}</strong> {total === 1 ? 'produto' : 'produtos'}. Variações já existentes não
              são alteradas, e um SKU repetido interrompe a geração — as já criadas ficam.
            </span>
          )}
        </div>

        {erro && (
          <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{erro}</p>
        )}

        <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={!podeGerar || mutation.isPending}>
            {mutation.isPending ? 'Gerando...' : podeGerar ? `Gerar ${total} ${total === 1 ? 'variação' : 'variações'}` : 'Gerar variações'}
          </Button>
        </div>
      </Card>
    </ModalShell>
  );
}
