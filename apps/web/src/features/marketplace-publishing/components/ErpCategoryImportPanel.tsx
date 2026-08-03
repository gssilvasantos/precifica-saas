import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import {
  applyErpCategoryImport,
  previewErpCategoryImport,
  type ErpCategoryImportPreview,
  type ErpCategoryImportResult,
} from '../api';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';

// Importar as categorias do ERP — conveniência de MIGRAÇÃO, não sincronização.
//
// A categoria do Kyneti é organizada pelo lojista, do jeito que ele quiser: a
// estrutura do Olist é uma organização particular dele, não uma verdade a ser
// replicada. Por isso isto é um botão, e não parte do sync — quem está saindo
// de outro sistema não precisa recadastrar a árvore à mão, e quem já organizou
// a sua não tem nada mexido.
//
// Prévia antes de aplicar, na mesma disciplina do Safety Lock do resto da
// plataforma: nada é escrito sem o usuário ver exatamente o que vai acontecer.
export default function ErpCategoryImportPanel() {
  const queryClient = useQueryClient();
  const [previa, setPrevia] = useState<ErpCategoryImportPreview | null>(null);
  const [resultado, setResultado] = useState<ErpCategoryImportResult | null>(null);

  const previewMutation = useMutation({
    mutationFn: previewErpCategoryImport,
    onSuccess: (data) => {
      setPrevia(data);
      setResultado(null);
    },
  });

  const applyMutation = useMutation({
    mutationFn: applyErpCategoryImport,
    onSuccess: (data) => {
      setResultado(data);
      setPrevia(null);
      void queryClient.invalidateQueries({ queryKey: ['product-categories'] });
      void queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h2 className="font-serif text-xl font-semibold text-foreground">Importar categorias do ERP</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Recria no Kyneti a árvore de categorias que os produtos já trazem do Olist. Serve para não
            recadastrar tudo à mão na migração — depois disso a árvore é sua, e o sync não mexe mais nela.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => previewMutation.mutate()}
          disabled={previewMutation.isPending || applyMutation.isPending}
        >
          <Download className="mr-2 h-4 w-4" strokeWidth={1.8} />
          {previewMutation.isPending ? 'Analisando…' : 'Ver o que seria importado'}
        </Button>
      </div>

      {previa && (
        <div className="mt-5 space-y-4 border-t border-border pt-4">
          {previa.categoriasACriar.length === 0 && previa.vinculos.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nada a importar. Ou os produtos não têm categoria no ERP, ou tudo já está classificado aqui.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <span className="text-foreground">
                  <strong>{previa.categoriasACriar.length}</strong> categoria(s) a criar
                </span>
                <span className="text-foreground">
                  <strong>{previa.vinculos.length}</strong> produto(s) a vincular
                </span>
                {previa.produtosJaClassificados > 0 && (
                  <span className="text-muted-foreground">
                    {previa.produtosJaClassificados} já classificado(s) — não serão tocados
                  </span>
                )}
                {previa.produtosSemCategoriaNoErp > 0 && (
                  <span className="text-muted-foreground">
                    {previa.produtosSemCategoriaNoErp} sem categoria no ERP
                  </span>
                )}
              </div>

              {previa.categoriasACriar.length > 0 && (
                <div className="max-h-64 overflow-y-auto rounded-lg border border-border bg-muted/20 p-3">
                  <ul className="space-y-1 text-sm">
                    {previa.categoriasACriar.map((c) => (
                      <li key={c.caminho.join('>')} className="text-foreground">
                        {/* Indentação por profundidade: a hierarquia aparece
                            na prévia, não só depois de criada. */}
                        <span style={{ paddingLeft: `${(c.caminho.length - 1) * 16}px` }}>
                          {c.caminho.length > 1 && <span className="text-muted-foreground">└ </span>}
                          {c.name}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex items-center gap-2">
                <Button onClick={() => applyMutation.mutate()} disabled={applyMutation.isPending}>
                  {applyMutation.isPending ? 'Importando…' : 'Importar'}
                </Button>
                <Button variant="ghost" onClick={() => setPrevia(null)} disabled={applyMutation.isPending}>
                  Cancelar
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {resultado && (
        <p className="mt-5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-400">
          {resultado.categoriasCriadas} categoria(s) criada(s) e {resultado.produtosVinculados} produto(s)
          vinculado(s).
          {resultado.produtosJaClassificados > 0 &&
            ` ${resultado.produtosJaClassificados} produto(s) já classificado(s) foram preservados.`}
        </p>
      )}

      {(previewMutation.isError || applyMutation.isError) && (
        <p className="mt-5 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          Não foi possível concluir a importação de categorias.
        </p>
      )}
    </Card>
  );
}
