import { isAxiosError } from 'axios';

// Erros de validação/negócio do NestJS (BadRequestException etc.) chegam
// como { message: string | string[] } no corpo da resposta — extrai essa
// mensagem para exibir algo específico (ex.: "storeId e accessToken são
// obrigatórios") em vez de um genérico "algo deu errado".
export function extractErrorMessage(error: unknown, fallback = 'Algo deu errado — tente novamente em instantes.'): string {
  if (isAxiosError(error)) {
    const data = error.response?.data as { message?: string | string[]; acao?: string } | undefined;

    // `acao` (12/08/2026) é o próximo passo do usuário, enviado junto com o
    // código estável em erros de CONFIGURAÇÃO — hoje o TAX_RATE_UNAVAILABLE do
    // motor de preço. A regra do projeto manda todo erro oferecer um caminho;
    // sem isto o usuário lê "não foi possível resolver a alíquota" e não tem
    // para onde ir. Concatenado à mensagem para valer em qualquer tela, sem
    // exigir tratamento especial em cada uma.
    const acao = typeof data?.acao === 'string' ? ` ${data.acao}` : '';

    if (Array.isArray(data?.message)) return `${data.message.join(' ')}${acao}`;
    if (typeof data?.message === 'string') return `${data.message}${acao}`;
  }
  return fallback;
}

// Código estável do erro, quando o backend enviou um. A UI decide COMPORTAMENTO
// por ele (ex.: mostrar um atalho para Configurações Fiscais), nunca pelo texto
// da mensagem — que pode mudar sem aviso.
export function extractErrorCode(error: unknown): string | null {
  if (!isAxiosError(error)) return null;
  const data = error.response?.data as { code?: string } | undefined;
  return typeof data?.code === 'string' ? data.code : null;
}
