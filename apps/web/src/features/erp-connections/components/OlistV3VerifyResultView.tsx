import type { OlistV3SkuVerification, OlistV3VerifyResult } from '../api';

function fmt(value: number | string | null): string {
  return value === null || value === '' ? 'ausente' : String(value);
}

// Resultado da verificação somente leitura (ADR 0003). Mostra, por SKU, os
// campos que o Kyneti precisa para importar e quais NÃO vieram — é a resposta
// à dúvida "a variação consultada pelo próprio id traz peso e dimensões?".
export function OlistV3VerifyResultView({ result }: { result: OlistV3VerifyResult }) {
  const probe = result.incrementalProbe;
  const rl = result.rateLimit;
  return (
    <div className="space-y-3 text-sm" aria-live="polite">
      <p className="text-xs text-muted-foreground">
        {result.callsMade} chamada(s) ao Olist.{' '}
        {rl && rl.limit !== null
          ? `Cota informada: ${fmt(rl.remaining)} restantes de ${fmt(rl.limit)} (renova em ${fmt(rl.resetSeconds)} s).`
          : 'O Olist não informou a cota nos cabeçalhos.'}
      </p>

      <div className="rounded-md border border-border px-3 py-2">
        <p className="font-medium text-foreground">Filtro por data de alteração (últimos {probe.windowDays} dias)</p>
        {probe.error ? (
          <p className="mt-1 text-margin-danger">Falhou: {probe.error}</p>
        ) : (
          <p className="mt-1 text-muted-foreground">
            Alterados desde {probe.since}: {fmt(probe.totalChanged)} (amostra de {probe.returned}).
          </p>
        )}
      </div>

      {result.skus.map((item) => (
        <SkuBlock key={item.sku} item={item} />
      ))}
    </div>
  );
}

function SkuBlock({ item }: { item: OlistV3SkuVerification }) {
  const p = item.produto;
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <p className="font-medium text-foreground">
        {item.sku}{' '}
        <span className="font-normal text-muted-foreground">
          {item.error ? '— erro' : item.found ? `— encontrado (tipo ${fmt(item.tipoVariacao)})` : '— não encontrado na v3'}
        </span>
      </p>
      {item.error && <p className="mt-1 text-margin-danger">{item.error}</p>}
      {p && (
        <>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
            <Field label="Custo" value={p.campos.precoCusto} />
            <Field label="Preço" value={p.campos.preco} />
            <Field label="Estoque" value={p.campos.estoqueQuantidade} />
            <Field label="Peso líq." value={p.campos.pesoLiquido} />
            <Field label="Peso bruto" value={p.campos.pesoBruto} />
            <Field label="Largura" value={p.campos.largura} />
            <Field label="Altura" value={p.campos.altura} />
            <Field label="Comprim." value={p.campos.comprimento} />
            <Field label="NCM" value={p.campos.ncm} />
            <Field label="GTIN" value={p.campos.gtin} />
            <Field label="Fotos" value={p.fotos} />
            <Field label="Variações" value={p.variacoes.total} />
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">
            {p.ausentes.length === 0 ? 'Nenhum campo necessário ficou ausente.' : `Ausentes: ${p.ausentes.join(', ')}.`}
          </p>
        </>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: number | string | null }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{fmt(value)}</dd>
    </div>
  );
}
