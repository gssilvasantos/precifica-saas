import { S3Client } from '@aws-sdk/client-s3';
import { requireStorageEnv } from './r2-env';

// Cliente S3 único, reaproveitado por TODOS os adapters de storage do R2
// (fotos de produto e chunks de vídeo) — o SDK da AWS mantém um pool de
// conexões HTTP internamente por instância de S3Client; criar um client por
// chamada jogaria fora esse reaproveitamento de conexão (mesmo racional já
// aplicado ao PrismaClient no resto do projeto: uma instância por processo).
//
// R2 é S3-compatible: `region: 'auto'` é o valor documentado pela Cloudflare
// (o SDK exige alguma string, mas o R2 não usa region de verdade — todo o
// roteamento vem do endpoint). R2_ENDPOINT é a URL da API S3 da conta
// (https://<account_id>.r2.cloudflarestorage.com), NUNCA a URL pública de
// leitura do bucket — essa é outra variável (R2_PUBLIC_BASE_URL), ver
// docs/deploy-render-supabase-r2.md, seção 3.1.
let cachedClient: S3Client | null = null;

export function getR2Client(): S3Client {
  if (cachedClient) return cachedClient;

  cachedClient = new S3Client({
    region: 'auto',
    endpoint: requireStorageEnv('R2_ENDPOINT'),
    credentials: {
      accessKeyId: requireStorageEnv('R2_ACCESS_KEY'),
      secretAccessKey: requireStorageEnv('R2_SECRET_KEY'),
    },
  });
  return cachedClient;
}

// Exposto só para testes — permite resetar o singleton entre specs que
// mudam process.env.R2_* (evita vazamento de estado entre `it` blocks).
export function resetR2ClientForTests(): void {
  cachedClient = null;
}
