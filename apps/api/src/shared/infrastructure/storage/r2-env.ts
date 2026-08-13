// Leitura de env var obrigatória, específica dos adapters de storage R2 —
// falha alto e cedo (mensagem explícita) em vez de deixar o SDK da AWS
// lançar um erro genérico de credenciais ausentes lá na frente, no meio de
// um upload. Ver docs/deploy-render-supabase-r2.md, seção 3.
//
// VALIDAÇÃO DE FORMA (13/08/2026): checar só a PRESENÇA não bastava, e isso
// custou caro em produção. R2_BUCKET estava preenchido com a URL do endpoint
// em vez do nome do bucket; passou pela verificação (não era vazio) e falhou
// lá no fundo do SDK, com "Bucket name shouldn't contain '/'", uma vez por
// FOTO, em todo sync — silencioso o suficiente para ficar semanas sem
// ninguém ligar os pontos.
//
// Variável presente com a forma errada é um modo de falha diferente de
// variável ausente, e precisa da própria checagem. Cada regra abaixo existe
// porque a confusão que ela pega é fácil de cometer: as quatro variáveis do
// R2 são parecidas e três delas SÃO URLs.

type Validador = { valida: (valor: string) => boolean; comoDeveSer: string };

const FORMA_ESPERADA: Record<string, Validador> = {
  // Nome do bucket, não URL. É o erro cometido em produção.
  R2_BUCKET: {
    valida: (v) => !v.includes('/') && !v.includes(':'),
    comoDeveSer: 'o NOME do bucket (ex.: kyneti-assets), sem barra e sem esquema — não a URL do endpoint',
  },
  // API S3 autenticada da conta.
  R2_ENDPOINT: {
    valida: (v) => /^https:\/\/[^/]+\.r2\.cloudflarestorage\.com\/?$/.test(v),
    comoDeveSer: 'a URL da API S3 (https://<account_id>.r2.cloudflarestorage.com)',
  },
  // URL PÚBLICA de leitura — domínio custom ou pub-*.r2.dev. Nunca o endpoint:
  // aquele é autenticado e não serve GET público, então a foto gravaria com uma
  // URL que devolve 401 para o navegador do lojista.
  R2_PUBLIC_BASE_URL: {
    valida: (v) => /^https?:\/\//.test(v) && !v.includes('.r2.cloudflarestorage.com'),
    comoDeveSer:
      'a URL PÚBLICA de leitura (domínio custom, ou https://pub-xxxx.r2.dev) — nunca o R2_ENDPOINT, que é autenticado',
  },
};

export function requireStorageEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Variável de ambiente ${name} ausente — obrigatória quando STORAGE_DRIVER=r2 (ver docs/deploy-render-supabase-r2.md, seção 3).`,
    );
  }

  const valor = value.trim();
  const forma = FORMA_ESPERADA[name];
  if (forma && !forma.valida(valor)) {
    // Não ecoa o valor inteiro: R2_ENDPOINT contém o account id da Cloudflare.
    // O nome da variável e a forma esperada bastam para corrigir.
    throw new Error(
      `Variável de ambiente ${name} está com a forma errada. Esperado: ${forma.comoDeveSer}. ` +
        'Ver docs/deploy-render-supabase-r2.md, seção 3.',
    );
  }

  return valor;
}
