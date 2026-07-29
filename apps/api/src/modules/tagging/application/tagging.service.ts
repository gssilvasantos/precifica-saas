import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
// Mesmo racional do import direto em catalog/application/products.service.ts
// (comentário lá explica o porquê: sandboxes onde `prisma generate` às
// vezes não roda, deixando `Prisma.PrismaClientKnownRequestError`
// inacessível via o namespace `Prisma` do client gerado).
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { TAG_REPOSITORY, TagRepository } from './ports/tag-repository.port';
import { TAG_ASSIGNMENT_REPOSITORY, TagAssignmentRepository } from './ports/tag-assignment-repository.port';
import { isValidTagColor, isValidTagName, isValidTaggableEntityType, Tag, TagAssignment, TaggableEntityType } from '../domain/tag.entity';

@Injectable()
export class TaggingService {
  constructor(
    @Inject(TAG_REPOSITORY) private readonly tags: TagRepository,
    @Inject(TAG_ASSIGNMENT_REPOSITORY) private readonly assignments: TagAssignmentRepository,
  ) {}

  listTags(tenantId: string): Promise<Tag[]> {
    return this.tags.findAllByTenant(tenantId);
  }

  async createTag(tenantId: string, name: string, color?: string | null): Promise<Tag> {
    if (!isValidTagName(name)) {
      throw new BadRequestException('name deve ser um texto não vazio de até 50 caracteres.');
    }
    if (color != null && !isValidTagColor(color)) {
      throw new BadRequestException('color deve ser um hex válido (ex.: "#00F0FF" ou "#0FC").');
    }
    try {
      return await this.tags.create({ tenantId, name: name.trim(), color: color ?? null });
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Já existe uma tag com esse nome nesta conta.');
      }
      throw error;
    }
  }

  async deleteTag(tenantId: string, tagId: string): Promise<void> {
    await this.assertTagBelongsToTenant(tenantId, tagId);
    await this.tags.delete(tagId);
  }

  async assign(tenantId: string, tagId: string, entityType: string, entityId: string): Promise<TagAssignment> {
    this.assertValidEntityType(entityType);
    await this.assertTagBelongsToTenant(tenantId, tagId);
    return this.assignments.assign(tenantId, tagId, entityType, entityId);
  }

  async unassign(tenantId: string, tagId: string, entityType: string, entityId: string): Promise<void> {
    this.assertValidEntityType(entityType);
    await this.assertTagBelongsToTenant(tenantId, tagId);
    await this.assignments.unassign(tenantId, tagId, entityType, entityId);
  }

  // Reverse lookup — não precisa validar posse de tag nenhuma (lista as
  // tags de UMA ENTIDADE, não de UMA TAG); o filtro por tenantId já é
  // suficiente (mesmo padrão de qualquer outra leitura por tenant nesta base).
  async listForEntity(tenantId: string, entityType: string, entityId: string): Promise<TagAssignment[]> {
    this.assertValidEntityType(entityType);
    return this.assignments.findByEntity(tenantId, entityType, entityId);
  }

  // entityType chega via path param (nunca passa por class-validator, ao
  // contrário de campos de @Body()) — validado aqui, uma vez, antes de
  // qualquer um dos três métodos acima tocar o repositório.
  private assertValidEntityType(entityType: string): asserts entityType is TaggableEntityType {
    if (!isValidTaggableEntityType(entityType)) {
      throw new BadRequestException(`entityType inválido: "${entityType}".`);
    }
  }

  private async assertTagBelongsToTenant(tenantId: string, tagId: string): Promise<void> {
    const tag = await this.tags.findById(tagId);
    if (!tag || tag.tenantId !== tenantId) {
      throw new NotFoundException(`Tag ${tagId} não encontrada.`);
    }
  }
}
