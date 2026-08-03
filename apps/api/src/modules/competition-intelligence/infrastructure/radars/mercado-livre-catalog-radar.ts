import { Injectable, Logger } from '@nestjs/common';
import {
  CompetitionFetchContext,
  CompetitionRadar,
  RadarHealthStatus,
  RawCompetitorOffer,
} from '../../../../shared/contracts/competition-radar.contract';
import { MercadoLivreApiClient } from '../../../marketplace-intelligence/infrastructure/providers/mercado-livre/mercado-livre-api.client';

// Radar de concorrência REAL do Mercado Livre (01/08/2026, ver
// docs/revisao-geral-2026-08.md, §4).
//
// POR QUE ELE EXISTE: até esta data o módulo Competition Intelligence tinha
// exatamente UMA implementação de radar — ManualSheetRadar — que devolve
// lista vazia por não ter import de planilha construído. Como o
// PricingDecisionService só decide quando existe `bestCompetitorPrice`, o
// efeito prático era que **todo o loop de repricing dependia de alguém
// preencher uma planilha à mão**. O motor estava correto e testado, mas sem
// combustível.
//
// FONTE: API pública de catálogo do Mercado Livre, sem OAuth
// (developers.mercadolivre.com.br/pt_br/catalogo-competicao). Isso importa:
// é o que torna o radar utilizável hoje, sem depender do fluxo de
// autorização por vendedor que ainda não está implementado — e sem
// scraping, que é frágil e pode ferir os termos de uso.
//
// `targetRef` (de MonitoredCompetitorListing) aceita as duas formas que o
// usuário tem à mão, porque exigir que ele saiba a diferença entre "id de
// anúncio" e "id de produto de catálogo" seria transferir um detalhe da API
// para dentro do cadastro:
//   - id de PRODUTO de catálogo (ex.: MLB19151277) — caminho direto;
//   - id de ANÚNCIO (ex.: MLB3456789012) — o radar descobre a qual produto
//     pertence e então lista os concorrentes.
@Injectable()
export class MercadoLivreCatalogRadar implements CompetitionRadar {
  readonly code = 'MERCADO_LIVRE_CATALOG_V1';
  readonly sourceType = 'PARTNER_API' as const;

  private readonly logger = new Logger(MercadoLivreCatalogRadar.name);

  constructor(private readonly client: MercadoLivreApiClient) {}

  async fetchOffers(ctx: CompetitionFetchContext): Promise<RawCompetitorOffer[]> {
    const targetRef = ctx.targetRef?.trim();
    if (!targetRef) return [];

    const productId = await this.resolveCatalogProductId(targetRef, ctx.skuCode);
    if (!productId) return [];

    const [product, items] = await Promise.all([
      this.client.fetchCatalogProduct(productId).catch(() => null),
      this.client.fetchCatalogProductItems(productId),
    ]);

    const winnerItemId = product?.buy_box_winner?.item_id ?? null;
    const collectedAt = new Date();

    return items
      // Item sem preço não é oferta comparável — descartar é mais honesto
      // que assumir zero, que viraria "concorrente de graça" e puxaria
      // qualquer decisão de preço para o piso.
      .filter((item) => typeof item.price === 'number' && item.price > 0)
      .map((item) => ({
        // O ML não expõe o NOME do vendedor neste endpoint público, só o
        // seller_id. Usar o id é menos legível, mas é o dado real — inventar
        // um rótulo amigável seria pior.
        competitorLabel: item.seller_id ? `Vendedor ${item.seller_id}` : item.item_id,
        price: item.price as number,
        // `winner` vem em algumas respostas; quando não vem, comparar com o
        // buy_box_winner do produto cobre o caso.
        isBuyBoxWinner: item.winner === true || (winnerItemId !== null && item.item_id === winnerItemId),
        collectedAt,
        sourceEvidenceRef: `https://api.mercadolibre.com/products/${productId}/items`,
      }));
  }

  // Aceita id de produto ou de anúncio. Tenta produto primeiro (caminho
  // direto e mais barato); se falhar, trata como anúncio e busca o produto
  // ao qual ele pertence.
  private async resolveCatalogProductId(targetRef: string, skuCode: string): Promise<string | null> {
    try {
      await this.client.fetchCatalogProduct(targetRef);
      return targetRef;
    } catch {
      // Não é um produto de catálogo — segue para a interpretação de anúncio.
    }

    try {
      const item = await this.client.fetchItem(targetRef);
      if (!item.catalog_product_id) {
        // Anúncio fora do catálogo não disputa Buy Box com ninguém: não há
        // concorrência a medir. Log explícito para o usuário entender por
        // que aquele SKU nunca gera oportunidade, em vez de silêncio.
        this.logger.warn(
          `SKU ${skuCode}: anúncio ${targetRef} não pertence a nenhum produto de catálogo do Mercado Livre — ` +
            'sem Buy Box para disputar, nenhuma oferta concorrente a coletar.',
        );
        return null;
      }
      return item.catalog_product_id;
    } catch (error) {
      this.logger.error(
        `SKU ${skuCode}: não foi possível resolver ${targetRef} nem como produto de catálogo nem como anúncio ` +
          `do Mercado Livre: ${(error as Error).message}`,
      );
      return null;
    }
  }

  // Bate num produto de catálogo conhecido e estável para verificar se a
  // API pública está respondendo — mesmo racional do healthCheck do
  // MercadoLivreFeeRuleProvider, que usa fetchTopLevelCategories.
  async healthCheck(): Promise<RadarHealthStatus> {
    try {
      await this.client.fetchTopLevelCategories();
      return { status: 'UP' };
    } catch (error) {
      return { status: 'DOWN', message: (error as Error).message };
    }
  }
}
