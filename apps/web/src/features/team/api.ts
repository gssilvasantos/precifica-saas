import { apiClient } from '../../lib/api-client';
import type { ModuleCode } from '../../lib/module-codes';
import type { UserRole } from '../auth/api';

// Espelha apps/api/src/modules/identity-access/interface/controllers/team.controller.ts
// — tenant-scoped de propósito (nunca cross-tenant, diferente de
// platform-admin): só o ADMIN da própria conta convida/edita/bloqueia
// colegas da MESMA conta. Proteção real é o backend (RolesGuard, checa
// role fresco do JWT), isto aqui é só UX/roteamento.
export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  moduleAccess: ModuleCode[];
  isActive: boolean;
}

export interface InviteTeamMemberInput {
  name: string;
  email: string;
  password: string;
  role: UserRole;
  moduleAccess: ModuleCode[];
}

export interface UpdateTeamMemberInput {
  role?: UserRole;
  moduleAccess?: ModuleCode[];
}

export async function fetchTeam(): Promise<TeamMember[]> {
  const { data } = await apiClient.get<TeamMember[]>('/team');
  return data;
}

export async function inviteTeamMember(input: InviteTeamMemberInput): Promise<TeamMember> {
  const { data } = await apiClient.post<TeamMember>('/team', input);
  return data;
}

export async function updateTeamMember(id: string, input: UpdateTeamMemberInput): Promise<TeamMember> {
  const { data } = await apiClient.patch<TeamMember>(`/team/${id}`, input);
  return data;
}

export async function blockTeamMember(id: string): Promise<TeamMember> {
  const { data } = await apiClient.patch<TeamMember>(`/team/${id}/block`);
  return data;
}

export async function unblockTeamMember(id: string): Promise<TeamMember> {
  const { data } = await apiClient.patch<TeamMember>(`/team/${id}/unblock`);
  return data;
}
