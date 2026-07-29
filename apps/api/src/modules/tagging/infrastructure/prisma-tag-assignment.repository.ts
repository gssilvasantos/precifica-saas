import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { TagAssignmentRepository } from '../application/ports/tag-assignment-repository.port';
import { TagAssignment, TaggableEntityType } from '../domain/tag.entity';

@Injectable()
export class PrismaTagAssignmentRepository implements TagAssignmentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async assign(tenantId: string, tagId: string, entityType: TaggableEntityType, entityId: string): Promise<TagAssignment> {
    // upsert em vez de create: atribuir a mesma tag duas vezes à mesma
    // entidade é um no-op idempotente, nunca um erro de unique constraint.
    const record = await this.prisma.tagAssignment.upsert({
      where: { tenantId_tagId_entityType_entityId: { tenantId, tagId, entityType, entityId } },
      create: { tenantId, tagId, entityType, entityId },
      update: {},
    });
    return this.toDomain(record);
  }

  async unassign(tenantId: string, tagId: string, entityType: TaggableEntityType, entityId: string): Promise<void> {
    // deleteMany (não delete) — idempotente: desatribuir algo que já não
    // estava atribuído não lança erro (0 linhas afetadas é um resultado
    // válido, não uma falha).
    await this.prisma.tagAssignment.deleteMany({ where: { tenantId, tagId, entityType, entityId } });
  }

  async findByEntity(tenantId: string, entityType: TaggableEntityType, entityId: string): Promise<TagAssignment[]> {
    const records = await this.prisma.tagAssignment.findMany({
      where: { tenantId, entityType, entityId },
      orderBy: { createdAt: 'asc' },
    });
    return records.map((r) => this.toDomain(r));
  }

  private toDomain(record: {
    id: string;
    tenantId: string;
    tagId: string;
    entityType: string;
    entityId: string;
    createdAt: Date;
  }): TagAssignment {
    return { ...record, entityType: record.entityType as TaggableEntityType };
  }
}
