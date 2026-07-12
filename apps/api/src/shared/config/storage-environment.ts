// Passo 3 do Deploy Demo (Render + Supabase + R2) — decide, em runtime, se os
// adapters de storage (FileStorage e VideoChunkStorage) devem gravar em disco
// local ou no Cloudflare R2 via S3 API. Ver docs/deploy-render-supabase-r2.md,
// seção 3, para o racional completo.
//
// Critério: STORAGE_DRIVER explícito tem prioridade — permite testar o
// adapter R2 a partir de uma máquina de dev (raro, mas útil para depurar
// credenciais antes do primeiro deploy) ou, no sentido oposto, forçar
// 'local' numa produção que ainda não tenha as variáveis do R2 configuradas
// (evita quebrar o boot por falta de env var — vide requireStorageEnv). Na
// ausência de STORAGE_DRIVER, cai para NODE_ENV — é o que o Render seta por
// padrão (NODE_ENV=production) sem precisar de nenhuma variável extra.
export type StorageDriver = 'local' | 'r2';

export function resolveStorageDriver(): StorageDriver {
  const explicit = process.env.STORAGE_DRIVER?.trim().toLowerCase();
  if (explicit === 'r2' || explicit === 'local') return explicit;
  return process.env.NODE_ENV === 'production' ? 'r2' : 'local';
}
