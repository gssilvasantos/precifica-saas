import { TagAssignment, TaggableEntityType } from '../../domain/tag.entity';

export interface TagAssignmentRepository {
  // Idempotente por (tenantId, tagId, entityType, entityId) — atribuir a
  // mesma tag duas vezes à mesma entidade não gera duas linhas nem erro.
  assign(tenantId: string, tagId: string, entityType: TaggableEntityType, entityId: string): Promise<TagAssignment>;
  // Idempotente também no sentido inverso — desatribuir uma tag que já não
  // estava atribuída não lança erro (mesmo racional de "delete idempotente").
  unassign(tenantId: string, tagId: string, entityType: TaggableEntityType, entityId: string): Promise<void>;
  // Reverse lookup — "quais tags esta entidade tem" (ex.: badge na tela de
  // produto/pedido).
  findByEntity(tenantId: string, entityType: TaggableEntityType, entityId: string): Promise<TagAssignment[]>;
}

export const TAG_ASSIGNMENT_REPOSITORY = Symbol('TAG_ASSIGNMENT_REPOSITORY');
