import { Global, Logger, Module, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaService, buildTenantAwareClient } from './prisma.service';

const logger = new Logger('PrismaModule');

// Uma única instância física de PrismaClient para o processo inteiro —
// mesmo racional de sempre, singleton gerenciado pelo módulo, nunca "new
// PrismaClient()" espalhado pelo código. `rawClient` cuida do connect/
// disconnect; o valor efetivamente injetado como `PrismaService` em todo
// repositório é a versão estendida com o contexto de tenant/RLS
// (`tenantAwareClient`) — ver prisma.service.ts para o porquê.
const rawClient = new PrismaClient();
const tenantAwareClient = buildTenantAwareClient(rawClient);

// @Global() para não precisar reimportar PrismaModule em cada módulo de
// negócio. `provide: PrismaService` + `useValue` (não `useClass`) é o que
// permite manter EXATAMENTE a mesma assinatura de injeção
// (`constructor(private readonly prisma: PrismaService)`) em todos os
// repositórios já existentes, sem precisar tocar em nenhum deles — o token
// de DI continua sendo a classe `PrismaService`, só o valor entregue em
// runtime mudou.
@Global()
@Module({
  providers: [{ provide: PrismaService, useValue: tenantAwareClient }],
  exports: [PrismaService],
})
export class PrismaModule implements OnModuleInit, OnApplicationShutdown {
  async onModuleInit() {
    // Conexão explícita no boot (fail-fast: se o Postgres estiver
    // inacessível, o processo cai aqui, não na primeira requisição real).
    await rawClient.$connect();
    logger.log('Conectado ao Postgres.');
  }

  async onApplicationShutdown() {
    await rawClient.$disconnect();
  }
}
