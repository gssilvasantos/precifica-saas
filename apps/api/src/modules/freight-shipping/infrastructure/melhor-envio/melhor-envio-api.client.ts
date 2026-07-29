import { Injectable, Logger } from '@nestjs/common';

const BASE_URL = 'https://melhorenvio.com.br/api/v2';
const TIMEOUT_MS = 15000;

export interface MelhorEnvioCredential {
  accessToken: string; // token gerado manualmente no painel Melhor Envio (MVP — sem fluxo OAuth2 completo)
  fromPostalCode: string; // CEP de origem (do vendedor) — Melhor Envio exige em toda cotação/etiqueta
  serviceId?: number; // id do serviço/transportadora (ex.: Correios PAC) — default documentado abaixo
}

// AVISO DE HONESTIDADE: construído a partir da documentação pública da
// Melhor Envio (API v2, fluxo "carrinho -> checkout -> gerar -> imprimir"),
// nunca exercitado contra uma conta real. Simplificação consciente de MVP:
// não cotamos entre serviços/transportadoras antes de gerar (isso exigiria
// um passo de "cálculo de frete" + escolha do usuário) — usamos sempre o
// `serviceId` configurado na conexão (default 1 = Correios PAC, o mais
// comum), documentado para o usuário poder trocar.
const DEFAULT_SERVICE_ID = 1;

@Injectable()
export class MelhorEnvioApiClient {
  private readonly logger = new Logger(MelhorEnvioApiClient.name);

  private async fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  // Sequência completa num único método (em vez de 4 métodos públicos
  // separados) porque nenhum chamador desta base precisa de um passo
  // intermediário isolado — MelhorEnvioFreightProvider é o único consumidor,
  // e sempre quer o resultado final (etiqueta gerada).
  async generateLabel(
    credential: MelhorEnvioCredential,
    input: {
      toPostalCode: string;
      toName: string;
      toDocument?: string;
      toAddress: string;
      toNumber: string;
      toDistrict: string;
      toCity: string;
      toState: string;
      weightKg: number;
      declaredValue: number;
      avisoRecebimento: boolean;
      maoPropria: boolean;
      orderReference: string;
    },
  ): Promise<{ trackingCode?: string; labelUrl?: string }> {
    const headers = {
      Authorization: `Bearer ${credential.accessToken}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Kyneti (contato@kyneti.com.br)', // Melhor Envio exige um User-Agent identificável
    };

    // 1) Adiciona ao carrinho
    const cartResponse = await this.fetchWithTimeout(`${BASE_URL}/me/cart`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        service: credential.serviceId ?? DEFAULT_SERVICE_ID,
        from: { postal_code: credential.fromPostalCode },
        to: {
          name: input.toName,
          document: input.toDocument,
          address: input.toAddress,
          number: input.toNumber,
          district: input.toDistrict,
          city: input.toCity,
          state_abbr: input.toState,
          postal_code: input.toPostalCode,
        },
        products: [{ name: `Pedido ${input.orderReference}`, quantity: 1, unitary_value: input.declaredValue }],
        volumes: [{ weight: input.weightKg }],
        // receipt (aviso de recebimento) e own_hand (mão própria) — Quick
        // Win 6 (benchmark Bling): a API v2 da Melhor Envio já documenta os
        // dois como opcionais do carrinho; antes deste quick win iam
        // sempre hardcoded false, agora refletem o que o operador pediu na
        // geração da etiqueta.
        options: {
          insurance_value: input.declaredValue,
          receipt: input.avisoRecebimento,
          own_hand: input.maoPropria,
          reverse: false,
          non_commercial: false,
        },
      }),
    });
    if (!cartResponse.ok) {
      throw new Error(`Melhor Envio /me/cart retornou HTTP ${cartResponse.status}`);
    }
    const cartData = (await cartResponse.json()) as { id?: string };
    const orderId = cartData.id;
    if (!orderId) {
      throw new Error('Melhor Envio /me/cart não devolveu um id de carrinho.');
    }

    // 2) Fecha pedido (débito do saldo Melhor Envio da conta do tenant)
    const checkoutResponse = await this.fetchWithTimeout(`${BASE_URL}/me/shipment/checkout`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ orders: [orderId] }),
    });
    if (!checkoutResponse.ok) {
      throw new Error(`Melhor Envio /me/shipment/checkout retornou HTTP ${checkoutResponse.status} — verifique o saldo da conta.`);
    }

    // 3) Gera a etiqueta de fato
    const generateResponse = await this.fetchWithTimeout(`${BASE_URL}/me/shipment/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ orders: [orderId] }),
    });
    if (!generateResponse.ok) {
      throw new Error(`Melhor Envio /me/shipment/generate retornou HTTP ${generateResponse.status}`);
    }

    // 4) Resolve a URL de impressão
    const printResponse = await this.fetchWithTimeout(`${BASE_URL}/me/shipment/print?orders[]=${orderId}`, { headers });
    if (!printResponse.ok) {
      this.logger.warn(`Melhor Envio /me/shipment/print retornou HTTP ${printResponse.status} — etiqueta gerada mas sem URL de impressão.`);
      return {};
    }
    const printData = (await printResponse.json()) as { url?: string };
    return { labelUrl: printData.url, trackingCode: orderId };
  }
}
