import axios from 'axios';

const TOKEN_STORAGE_KEY = 'precifica.accessToken';

// Cliente único para toda a aplicação — baseURL relativa (/api) para
// funcionar tanto atrás do proxy do Vite em dev quanto atrás do mesmo
// domínio em produção, sem precisar de env var por ambiente.
export const apiClient = axios.create({ baseURL: '/api' });

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export function saveAccessToken(token: string): void {
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

export function clearAccessToken(): void {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
}

export function getAccessToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}
