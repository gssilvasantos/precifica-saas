// Leitura de env var obrigatória, específica do adapter de IA — mesmo
// padrão de requireStorageEnv (shared/infrastructure/storage/r2-env.ts):
// falha alto e cedo (mensagem explícita) em vez de deixar a chamada HTTP
// estourar um erro genérico de autenticação lá na frente. Ver
// docs/marketplace-ads-ai-fase4-architecture.md, seção 1.5.
export function requireAiEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Variável de ambiente ${name} ausente — obrigatória quando ADS_AI_PROVIDER=anthropic (ver docs/marketplace-ads-ai-fase4-architecture.md, seção 1.5).`,
    );
  }
  return value;
}
