import { Injectable, Logger } from '@nestjs/common';
import { MercadoLivreConnectionService } from './mercado-livre-connection.service';
import { MercadoLivreApiClient, MlItemDetail } from '../infrastructure/providers/mercado-livre/mercado-livre-api.client';

// Administração direta de anúncio (24/09/2026, a pedido do Gui: "e se
// criarmos um mcp com o mercado livre... leitura e escrita"). Classe
// SEPARADA de MercadoLivreChannelListingSyncService de propósito: aquele
// serviço é o sync AUTOMÁTICO agendado (nunca escreve no Mercado Livre, só
// lê pra popular ChannelListing — ver o aviso de arquitetura naquele
// arquivo); este é acionado por um HUMANO uma ação de cada vez (hoje via
// kyneti-mcp-server, futuramente talvez a própria UI), e é o ÚNICO lugar
// deste módulo que escreve de volta no Mercado Livre um dado de cadastro de
// anúncio (SELLER_SKU) — nunca preço, nunca em lote, nunca automaticamente.
@Injectable()
export class MercadoLivreItemAdminService {
  private readonly logger = new Logger(MercadoLivreItemAdminService.name);

  constructor(
    private readonly connections: MercadoLivreConnectionService,
    private readonly client: MercadoLivreApiClient,
  ) {}

  async getItem(tenantId: string, itemId: string): Promise<MlItemDetail> {
    const accessToken = await this.connections.getValidAccessToken(tenantId);
    return this.client.fetchItemDetail(itemId, accessToken);
  }

  // AUDITORIA deliberada (não incidental): esta é a única escrita deste
  // módulo em dado real de anúncio do vendedor — toda chamada loga
  // tenant+item+SKU anterior+SKU novo, sempre, antes e depois da escrita.
  // Sem isso, um SKU errado aplicado por engano (MCP ou UI futura) não
  // deixaria rastro nenhum em produção.
  async updateItemSku(tenantId: string, itemId: string, skuCode: string): Promise<MlItemDetail> {
    const trimmed = skuCode.trim();
    if (!trimmed) {
      throw new Error('skuCode não pode ser vazio.');
    }

    const accessToken = await this.connections.getValidAccessToken(tenantId);
    const before = await this.client.fetchItemDetail(itemId, accessToken);
    this.logger.warn(
      `Escrita em produção: tenant ${tenantId} vai alterar SELLER_SKU do anúncio Mercado Livre ${itemId} ("${before.title ?? 'sem título'}") de "${before.skuCode ?? '(vazio)'}" para "${trimmed}".`,
    );

    const after = await this.client.updateItemSellerSku(itemId, accessToken, trimmed);
    this.logger.warn(
      `Escrita concluída: anúncio Mercado Livre ${itemId} (tenant ${tenantId}) agora com SELLER_SKU="${after.skuCode ?? '(vazio)'}".`,
    );
    return after;
  }
}
