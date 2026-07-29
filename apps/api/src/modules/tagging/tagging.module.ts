import { Module } from '@nestjs/common';
import { TaggingService } from './application/tagging.service';
import { PrismaTagRepository } from './infrastructure/prisma-tag.repository';
import { PrismaTagAssignmentRepository } from './infrastructure/prisma-tag-assignment.repository';
import { TagsController } from './interface/controllers/tags.controller';
import { TAG_REPOSITORY } from './application/ports/tag-repository.port';
import { TAG_ASSIGNMENT_REPOSITORY } from './application/ports/tag-assignment-repository.port';

// Benchmark Tiny ERP (28/07/2026, docs/tiny-erp-benchmark-analysis.md, seção
// 4/Fase 0) — sistema de marcadores genérico, polimórfico desde já
// (Produtos+Pedidos+Contas, decisão explícita do usuário). Módulo
// independente, sem dependência de nenhum outro módulo de domínio — a
// referência à entidade marcada é sempre solta (entityId), nunca uma FK.
@Module({
  controllers: [TagsController],
  providers: [
    TaggingService,
    { provide: TAG_REPOSITORY, useClass: PrismaTagRepository },
    { provide: TAG_ASSIGNMENT_REPOSITORY, useClass: PrismaTagAssignmentRepository },
  ],
})
export class TaggingModule {}
