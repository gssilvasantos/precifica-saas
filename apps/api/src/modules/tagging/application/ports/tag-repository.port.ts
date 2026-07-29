import { Tag, TagCreateData } from '../../domain/tag.entity';

export interface TagRepository {
  findById(id: string): Promise<Tag | null>;
  findAllByTenant(tenantId: string): Promise<Tag[]>;
  create(data: TagCreateData): Promise<Tag>;
  // Cascade em TagAssignment é responsabilidade do banco (onDelete: Cascade,
  // ver schema.prisma) — o repositório não precisa apagar assignments à parte.
  delete(id: string): Promise<void>;
}

export const TAG_REPOSITORY = Symbol('TAG_REPOSITORY');
