import { apiClient } from '../../lib/api-client';

// Espelha 1:1 apps/api/src/modules/tagging/domain/tag.entity.ts — mesmo
// racional de duplicação intencional do resto do frontend. Conjunto fechado
// de tipos marcáveis — cada novo tipo é uma decisão de produto (migration),
// nunca dado externo.
export type TaggableEntityType = 'PRODUCT' | 'ORDER' | 'FIXED_EXPENSE' | 'ACCOUNTS_PAYABLE';

export const TAGGABLE_ENTITY_TYPES: readonly TaggableEntityType[] = ['PRODUCT', 'ORDER', 'FIXED_EXPENSE', 'ACCOUNTS_PAYABLE'];

export interface Tag {
  id: string;
  tenantId: string;
  name: string;
  color: string | null;
  createdAt: string;
}

export interface TagAssignment {
  id: string;
  tenantId: string;
  tagId: string;
  entityType: TaggableEntityType;
  entityId: string;
  createdAt: string;
}

export async function fetchTags(): Promise<Tag[]> {
  const { data } = await apiClient.get<Tag[]>('/tags');
  return data;
}

export async function createTag(name: string, color?: string): Promise<Tag> {
  const { data } = await apiClient.post<Tag>('/tags', { name, color });
  return data;
}

export async function removeTag(id: string): Promise<void> {
  await apiClient.delete(`/tags/${id}`);
}

export async function assignTag(tagId: string, entityType: TaggableEntityType, entityId: string): Promise<TagAssignment> {
  const { data } = await apiClient.put<TagAssignment>(`/tags/${tagId}/assignments/${entityType}/${entityId}`, {});
  return data;
}

export async function unassignTag(tagId: string, entityType: TaggableEntityType, entityId: string): Promise<void> {
  await apiClient.delete(`/tags/${tagId}/assignments/${entityType}/${entityId}`);
}

export async function fetchTagAssignmentsForEntity(entityType: TaggableEntityType, entityId: string): Promise<TagAssignment[]> {
  const { data } = await apiClient.get<TagAssignment[]>(`/tags/entity/${entityType}/${entityId}`);
  return data;
}
