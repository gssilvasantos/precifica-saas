import { apiClient } from '../../lib/api-client';

export type UserRole = 'ADMIN' | 'PRICING_EDITOR' | 'VIEWER';

export interface AuthUser {
  id: string;
  tenantId: string;
  // Nome da conta (13/08/2026). OPCIONAL de propósito: o objeto do usuário é
  // persistido em localStorage, e quem já estava logado antes desta mudança
  // tem uma sessão salva SEM este campo. Marcar como obrigatório mentiria para
  // o compilador e quebraria na primeira leitura do storage antigo — o valor
  // só aparece depois do próximo login.
  tenantName?: string;
  role: UserRole;
  isPlatformAdmin: boolean;
  moduleAccess: string[];
}

export interface AuthResponse {
  accessToken: string;
  user: AuthUser;
}

export interface LoginInput {
  email: string;
  password: string;
  tenantId?: string;
}

export interface SignupInput {
  tenantName: string;
  tenantDocument?: string;
  name: string;
  email: string;
  password: string;
}

export async function login(input: LoginInput): Promise<AuthResponse> {
  const { data } = await apiClient.post<AuthResponse>('/auth/login', input);
  return data;
}

export async function signup(input: SignupInput): Promise<AuthResponse> {
  const { data } = await apiClient.post<AuthResponse>('/auth/signup', input);
  return data;
}
