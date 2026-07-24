import { isAxiosError } from 'axios';

// Erros de validação/negócio do NestJS (BadRequestException etc.) chegam
// como { message: string | string[] } no corpo da resposta — extrai essa
// mensagem para exibir algo específico (ex.: "storeId e accessToken são
// obrigatórios") em vez de um genérico "algo deu errado".
export function extractErrorMessage(error: unknown, fallback = 'Algo deu errado — tente novamente em instantes.'): string {
  if (isAxiosError(error)) {
    const data = error.response?.data as { message?: string | string[] } | undefined;
    if (Array.isArray(data?.message)) return data.message.join(' ');
    if (typeof data?.message === 'string') return data.message;
  }
  return fallback;
}
