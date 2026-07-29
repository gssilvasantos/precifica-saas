import { Injectable, Logger } from '@nestjs/common';

const BASE_URL = 'https://api.correios.com.br';
const TIMEOUT_MS = 15000;

export interface CorreiosCredential {
  username: string; // usuário do contrato Correios (Meu Correios Empresas)
  password: string;
  postCardNumber: string; // número do cartão de postagem
  contractNumber: string; // número do contrato
}

// AVISO DE HONESTIDADE: construído a partir da documentação pública da API
// oficial dos Correios (v3, "Autentica" + "Pré-postagem"), nunca exercitado
// contra uma conta real — nem sequer um ambiente de homologação foi testado.
// Simplificação de MVP: assume que o remetente (endereço de origem) é
// resolvido do lado do Correios pelo próprio cartão de postagem informado,
// não reenviado a cada chamada.
@Injectable()
export class CorreiosApiClient {
  private readonly logger = new Logger(CorreiosApiClient.name);

  private async fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async authenticate(credential: CorreiosCredential): Promise<string> {
    const basicAuth = Buffer.from(`${credential.username}:${credential.password}`).toString('base64');
    const response = await this.fetchWithTimeout(`${BASE_URL}/token/v1/autentica/cartaopostagem`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basicAuth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ numero: credential.postCardNumber }),
    });
    if (!response.ok) {
      throw new Error(`Correios /token/v1/autentica retornou HTTP ${response.status} — verifique usuário/senha/cartão de postagem.`);
    }
    const data = (await response.json()) as { token?: string };
    if (!data.token) {
      throw new Error('Correios não devolveu token de autenticação.');
    }
    return data.token;
  }

  async createLabel(
    credential: CorreiosCredential,
    input: {
      toPostalCode: string;
      toName: string;
      toAddress: string;
      toNumber: string;
      toDistrict: string;
      toCity: string;
      toState: string;
      weightKg: number;
      declaredValue: number;
      avisoRecebimento: boolean;
      maoPropria: boolean;
    },
  ): Promise<{ trackingCode?: string; labelUrl?: string }> {
    const token = await this.authenticate(credential);
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    // servicoAdicional (Quick Win 6, benchmark Bling) — AVISO DE HONESTIDADE:
    // códigos "001" (aviso de recebimento) e "002" (mão própria) construídos
    // a partir da documentação pública de Serviços Adicionais dos Correios
    // (correios.com.br/enviar/servicos-adicionais e manuais de integração),
    // nunca exercitados contra uma conta real — igual ao resto deste client.
    // Array vazio quando nenhum dos dois foi pedido (comportamento de antes
    // deste quick win).
    const servicoAdicional: string[] = [];
    if (input.avisoRecebimento) servicoAdicional.push('001');
    if (input.maoPropria) servicoAdicional.push('002');

    const prePostingResponse = await this.fetchWithTimeout(`${BASE_URL}/prepostagem/v1/prepostagens`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        codigoServico: '03220', // PAC contrato — default documentado; trocar exige campo novo na credencial
        remetente: { numeroContrato: credential.contractNumber, numeroCartaoPostagem: credential.postCardNumber },
        destinatario: {
          nome: input.toName,
          endereco: {
            cep: input.toPostalCode.replace(/\D/g, ''),
            logradouro: input.toAddress,
            numero: input.toNumber,
            bairro: input.toDistrict,
            cidade: input.toCity,
            uf: input.toState,
          },
        },
        pesoInformado: Math.round(input.weightKg * 1000), // Correios trabalha em gramas
        valorDeclarado: input.declaredValue,
        ...(servicoAdicional.length > 0 ? { servicoAdicional } : {}),
      }),
    });
    if (!prePostingResponse.ok) {
      throw new Error(`Correios /prepostagem retornou HTTP ${prePostingResponse.status}`);
    }
    const prePostingData = (await prePostingResponse.json()) as { id?: string; codigoObjeto?: string };
    const prePostingId = prePostingData.id;
    const trackingCode = prePostingData.codigoObjeto;
    if (!prePostingId) {
      throw new Error('Correios /prepostagem não devolveu um id de pré-postagem.');
    }

    // Documento da etiqueta — devolvido em base64, convertido para data URI
    // (evita depender de FileStorage/upload para o MVP: o frontend pode
    // abrir o data URI diretamente como PDF).
    const labelResponse = await this.fetchWithTimeout(`${BASE_URL}/prepostagem/v1/prepostagens/${prePostingId}/etiqueta?tipoEtiqueta=U`, { headers });
    if (!labelResponse.ok) {
      this.logger.warn(`Correios /prepostagens/${prePostingId}/etiqueta retornou HTTP ${labelResponse.status} — pré-postagem criada sem etiqueta baixada.`);
      return { trackingCode };
    }
    const labelData = (await labelResponse.json()) as { pdf?: string };
    const labelUrl = labelData.pdf ? `data:application/pdf;base64,${labelData.pdf}` : undefined;
    return { trackingCode, labelUrl };
  }
}
