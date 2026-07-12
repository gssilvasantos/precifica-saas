import { apiClient } from '../../lib/api-client';

export type UserRole = 'ADMIN' | 'PRICING_EDITOR' | 'VIEWER';

export interface AuthUser {
  id: string;
  tenantId: string;
  role: UserRole;
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
