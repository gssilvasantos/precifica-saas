import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { TagRepository } from '../application/ports/tag-repository.port';
import { Tag, TagCreateData } from '../domain/tag.entity';

@Injectable()
export class PrismaTagRepository implements TagRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Tag | null> {
    const record = await this.prisma.tag.findUnique({ where: { id } });
    return record ? this.toDomain(record) : null;
  }

  async findAllByTenant(tenantId: string): Promise<Tag[]> {
    const records = await this.prisma.tag.findMany({ where: { tenantId }, orderBy: { name: 'asc' } });
    return records.map((r) => this.toDomain(r));
  }

  async create(data: TagCreateData): Promise<Tag> {
    const record = await this.prisma.tag.create({
      data: { tenantId: data.tenantId, name: data.name, color: data.color ?? null },
    });
    return this.toDomain(record);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.tag.delete({ where: { id } });
  }

  private toDomain(record: { id: string; tenantId: string; name: string; color: string | null; createdAt: Date }): Tag {
    return { ...record };
  }
}
