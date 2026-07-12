// Leitura de env var obrigatória, específica dos adapters de storage R2 —
// falha alto e cedo (mensagem explícita) em vez de deixar o SDK da AWS
// lançar um erro genérico de credenciais ausentes lá na frente, no meio de
// um upload. Ver docs/deploy-render-supabase-r2.md, seção 3.
export function requireStorageEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Variável de ambiente ${name} ausente — obrigatória quando STORAGE_DRIVER=r2 (ver docs/deploy-render-supabase-r2.md, seção 3).`,
    );
  }
  return value;
}
