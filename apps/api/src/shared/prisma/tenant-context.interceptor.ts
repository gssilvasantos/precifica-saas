import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { TenantContextStore } from './tenant-context';

// Interceptor global (registrado em main.ts) — abre o AsyncLocalStorage que
// a extensão de RLS do Prisma lê a cada consulta (ver prisma.service.ts).
// Roda para TODA requisição HTTP, autenticada ou não: guards (JwtAuthGuard)
// já executaram antes dos interceptors no pipeline do Nest, então
// `request.user` já está populado quando este código roda, se a rota exigir
// autenticação.
//
// Rotas SEM `request.user` (login, signup, webhooks de marketplace, callback
// OAuth do Mercado Livre) caem em `runAsService()` — bypass explícito para a
// requisição inteira. Isto é uma decisão deliberada, não uma brecha: RLS
// existe para impedir que UM tenant autenticado enxergue dado de OUTRO
// tenant autenticado; antes de qualquer autenticação não existe "tenant
// errado" a vazar (login precisa localizar o usuário pelo e-mail SEM ainda
// saber o tenantId — é exatamente o mesmo problema do passo de descoberta
// dos schedulers, ver docs/row-level-security-architecture.md, seção 3.3).
// A partir do momento em que uma rota tem JWT válido, ela SEMPRE roda
// escopada — nunca em bypass.
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      // Defensivo: hoje só existem handlers HTTP neste projeto, mas se um
      // dia entrar um transporte diferente (ex.: microservice), este
      // interceptor não deve tentar ler `getRequest()` de um contexto que
      // não tem.
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const tenantId: string | undefined = request.user?.tenantId;

    return new Observable((subscriber) => {
      // IMPORTANTE: o .subscribe() precisa acontecer DENTRO do callback do
      // AsyncLocalStorage.run(), não depois. `next.handle()` só CONSTRÓI o
      // Observable (lazy) — a execução real (controller -> service ->
      // Prisma) só começa no `.subscribe()`. Se o subscribe rodar fora do
      // `.run()` (como estava antes: `run().subscribe(subscriber)`, com o
      // callback passado a `run` só retornando `next.handle()` sem
      // assinar), o contexto do AsyncLocalStorage não necessariamente
      // acompanha a execução assíncrona real da request — o subscribe
      // precisa estar textualmente dentro do callback para garantir a
      // propagação. Ver: github.com/nestjs/nest/issues/15317.
      const subscribeWithinContext = () => next.handle().subscribe(subscriber);
      if (tenantId) {
        TenantContextStore.run(tenantId, subscribeWithinContext);
      } else {
        TenantContextStore.runAsService(subscribeWithinContext);
      }
    });
  }
}
