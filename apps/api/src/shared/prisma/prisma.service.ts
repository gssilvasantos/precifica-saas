import { PrismaClient } from '@prisma/client';
import { TenantContextStore } from './tenant-context';

// A classe em si NUNCA é instanciada pelo Nest (ver PrismaModule — o
// provider é fornecido via `useValue`, não `useClass`). Ela existe só para
// dar um tipo estático ao token de injeção: todo repositório continua
// escrevendo `constructor(private readonly prisma: PrismaService) {}`
// exatamente como sempre — zero mudança de import ou assinatura em nenhum
// dos ~30 repositórios Prisma do projeto.
//
// O objeto de verdade entregue em runtime é o client já com a extensão de
// tenant/RLS aplicada (buildTenantAwareClient abaixo) — estruturalmente
// compatível (mesmos `.product`, `.order`, `.$transaction` etc., é assim
// que Prisma Client Extensions são desenhadas para funcionar), só que toda
// consulta passa primeiro por `set_config('app.current_tenant_id', ...)` na
// MESMA transação antes de rodar.
export class PrismaService extends PrismaClient {}

// Extensão isolada em função pura — mais fácil de ler e de citar no doc de
// arquitetura do que enterrada dentro de um decorator. Ver
// docs/row-level-security-architecture.md, seções 2 e 3, para o racional
// completo de por que é `$allOperations` + `$transaction([...])` e nunca um
// `SET` solto: a conexão de produção passa pelo pooler PgBouncer da
// Supabase em modo Transaction (docs/deploy-render-supabase-r2.md), que
// devolve a conexão física ao pool a cada transação — um `SET` de sessão
// comum vazaria o tenant de uma requisição para a próxima que caísse na
// mesma conexão física. `set_config(..., true)` (equivalente a `SET LOCAL`)
// dentro do array-transaction abaixo garante que os dois statements rodam
// na mesma conexão e que o valor nunca sobrevive além dela.
export function buildTenantAwareClient(client: PrismaClient) {
  return client.$extends({
    name: 'tenant-context-rls',
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const tenantId = TenantContextStore.getTenantId();

          if (tenantId === undefined) {
            // Nunca deixa uma consulta rodar "no escuro". undefined
            // significa que ninguém abriu o contexto (TenantContextStore.run
            // ou .runAsService) antes desta consulta — sinal de uma rota
            // HTTP que não passou pelo TenantContextInterceptor, ou de um
            // job/script que esqueceu de abrir o contexto. Falha alto e
            // explícito aqui é preferível a rodar a consulta sem isolamento
            // de tenant e descobrir isso depois.
            throw new Error(
              'Consulta ao Prisma sem contexto de tenant definido (TenantContextStore). ' +
                'Ver docs/row-level-security-architecture.md — toda consulta precisa passar ' +
                'por TenantContextStore.run(tenantId, ...) ou .runAsService(...) antes de rodar.',
            );
          }

          const [, result] = await client.$transaction([
            tenantId === null
              ? client.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`
              : client.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`,
            query(args),
          ]);

          return result;
        },
      },
    },
  });
}
