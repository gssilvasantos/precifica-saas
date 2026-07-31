import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { bulkImportMapPrice } from '../api';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';

// Painel de importação em massa da Política de Preço Mínimo (MAP) — CSV
// (sku_code,map_price) lido no navegador via FileReader e enviado como texto
// cru no corpo (mesma convenção de ImportSettlementDto no backend: este
// projeto evita multipart/FileInterceptor de propósito). Política
// tudo-ou-nada do backend (BulkMapPriceImportService): qualquer linha com
// erro bloqueia a importação inteira — a UI mostra a lista de erros exatamente
// como veio, sem tentar "consertar" nada no cliente.
export default function MapBulkImportPanel() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);

  const importMutation = useMutation({
    mutationFn: () => bulkImportMapPrice(fileContent ?? ''),
    onSuccess: (result) => {
      if (result.errors.length === 0) {
        void queryClient.invalidateQueries({ queryKey: ['products'] });
      }
    },
  });

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    importMutation.reset();
    const reader = new FileReader();
    reader.onload = () => setFileContent(String(reader.result ?? ''));
    reader.readAsText(file);
  };

  return (
    <Card className="p-5">
      <h2 className="font-serif text-base font-semibold text-foreground">Importação em massa (CSV)</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Colunas <code className="rounded bg-muted px-1 py-0.5">sku_code,map_price</code>. Política tudo-ou-nada: se
        qualquer linha tiver erro, nada é aplicado — corrija a planilha e reenvie.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
          Escolher arquivo
        </Button>
        <span className="text-xs text-muted-foreground">{fileName ?? 'Nenhum arquivo selecionado'}</span>
        <Button size="sm" className="ml-auto" onClick={() => importMutation.mutate()} disabled={!fileContent || importMutation.isPending}>
          {importMutation.isPending ? 'Importando…' : 'Importar'}
        </Button>
      </div>

      {importMutation.data && importMutation.data.errors.length === 0 && (
        <p className="mt-3 rounded-lg bg-margin-good/10 px-3 py-2 text-xs font-medium text-margin-good">
          {importMutation.data.updated} SKU(s) atualizado(s), {importMutation.data.unchanged} sem mudança, de{' '}
          {importMutation.data.totalRows} linha(s).
        </p>
      )}

      {importMutation.data && importMutation.data.errors.length > 0 && (
        <div className="mt-3 rounded-lg bg-margin-danger/10 px-3 py-2 text-xs text-margin-danger">
          <p className="font-medium">Importação bloqueada — nenhuma linha foi aplicada:</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            {importMutation.data.errors.map((err, i) => (
              <li key={i}>
                Linha {err.rowNumber}: {err.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {importMutation.isError && (
        <p className="mt-3 rounded-lg bg-margin-danger/10 px-3 py-2 text-xs text-margin-danger">
          Não foi possível importar — tente novamente.
        </p>
      )}
    </Card>
  );
}
