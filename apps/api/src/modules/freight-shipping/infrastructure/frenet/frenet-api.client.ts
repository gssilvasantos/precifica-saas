import { Injectable } from '@nestjs/common';

const BASE_URL = 'https://api.frenet.com.br';
const TIMEOUT_MS = 15000;

export interface FrenetCredential {
  token: string; // "Frenet-Token" — chave de API da conta Frenet
  fromPostalCode: string;
}

// AVISO DE HONESTIDADE: a Frenet é fundamentalmente um AGREGADOR DE COTAÇÃO
// (várias transportadoras/regras num único endpoint) — a emissão de etiqueta
// em si acontece do lado de CADA transportadora contratada dentro do painel
// Frenet, não há um endpoint público único e padronizado de "gerar etiqueta"
// documentado da mesma forma que Melhor Envio ou Correios. Por isso este
// client só implementa COTAÇÃO; FrenetFreightProvider.generateLabel (ver
// arquivo irmão) é honesto sobre essa limitação em vez de fingir suportar
// emissão direta.
@Injectable()
export class FrenetApiClient {
  private async fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  async getQuote(
    credential: FrenetCredential,
    input: { toPostalCode: string; weightKg: number; declaredValue: number },
  ): Promise<{ carrierName: string; price: number; deliveryDays: number }[]> {
    const response = await this.fetchWithTimeout(`${BASE_URL}/shipping/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', token: credential.token },
      body: JSON.stringify({
        SellerCEP: credential.fromPostalCode,
        RecipientCEP: input.toPostalCode,
        ShipmentInvoiceValue: input.declaredValue,
        ShippingItemArray: [{ Weight: input.weightKg, Length: 20, Height: 10, Width: 15, Quantity: 1 }],
      }),
    });
    if (!response.ok) {
      throw new Error(`Frenet /shipping/quote retornou HTTP ${response.status}`);
    }
    const data = (await response.json()) as { ShippingSevicesArray?: { Carrier?: string; ShippingPrice?: string; DeliveryTime?: string; Error?: boolean }[] };
    const services = data.ShippingSevicesArray ?? [];
    return services
      .filter((s) => !s.Error && s.Carrier && s.ShippingPrice)
      .map((s) => ({ carrierName: s.Carrier!, price: Number(s.ShippingPrice), deliveryDays: Number(s.DeliveryTime ?? 0) }));
  }
}
