import { AsyncLocalStorage } from 'node:async_hooks';

interface TenantContext {
  // null = bypass explícito, uso restrito (ver runAsService). Nunca
  // undefined dentro do storage — undefined é reservado para "nenhum
  // contexto foi aberto ainda", detectado por getTenantId() e tratado como
  // erro em prisma.service.ts (nunca deixamos uma consulta rodar sem que
  // alguém tenha decidido explicitamente qual tenant ela pertence).
  tenantId: string | null;
}

const storage = new AsyncLocalStorage<TenantContext>();

// Contexto ambiente de "de qual tenant é esta requisição/job" — a ponte
// entre o mundo HTTP (TenantContextInterceptor lê req.user.tenantId) e a
// extensão de Row-Level Security do Prisma (prisma.service.ts), que lê
// getTenantId() a cada consulta para popular a sessão do Postgres via
// set_config antes de rodar a query. Ver docs/row-level-security-architecture.md.
//
// Por que AsyncLocalStorage nativo em vez de uma lib (ex.: nestjs-cls):
// a necessidade aqui é só "guardar uma string pelo tempo de vida de uma
// requisição/job", o caso de uso mais simples que existe para
// AsyncLocalStorage — não precisamos de proxy providers nem de suporte a
// requisições duráveis, então uma dependência a mais não se paga.
export const TenantContextStore = {
  run<T>(tenantId: string, fn: () => T): T {
    return storage.run({ tenantId }, fn);
  },

  // Uso restrito: só para a query de DESCOBERTA dentro de um job interno
  // (ex.: "quais tenants têm sincronização pendente?"). Qualquer leitura ou
  // escrita de dado de negócio que vier depois deve voltar a chamar
  // run(tenantId, ...) por tenant individual — nunca deixar o resto do job
  // rodando em bypass. Ver docs/row-level-security-architecture.md, seção 3.3.
  runAsService<T>(fn: () => T): T {
    return storage.run({ tenantId: null }, fn);
  },

  // undefined = nenhum contexto foi aberto (bug de wiring — rota sem
  // interceptor, ou job que esqueceu de chamar run/runAsService).
  // null = bypass explícito e consciente (runAsService).
  // string = tenant normal.
  getTenantId(): string | null | undefined {
    return storage.getStore()?.tenantId;
  },
};
