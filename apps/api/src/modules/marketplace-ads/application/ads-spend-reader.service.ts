import { Inject, Injectable } from '@nestjs/common';
import { ADS_CAMPAIGN_REPOSITORY, AdsCampaignRepository } from './ports/ads-campaign-repository.port';
import { AdsSpendByChannel, AdsSpendBySku, AdsSpendReader } from '../../../shared/contracts/ads-spend-reader.port';
import { AppDataMode } from '../../../shared/contracts/order-financials-reader.port';
import { CHANNEL_LISTING_READER } from '../../../shared/contracts/tokens';
import { ChannelListingReader } from '../../../shared/contracts/channel-listing-reader.port';

// Implementação de AdsSpendReader — a única porta pela qual o Financial
// Intelligence enxerga o módulo de Ads. Ver
// shared/contracts/ads-spend-reader.port.ts para o racional.
@Injectable()
export class AdsSpendReaderService implements AdsSpendReader {
  constructor(
    @Inject(ADS_CAMPAIGN_REPOSITORY) private readonly campaigns: AdsCampaignRepository,
    // Traduz anúncio do canal -> SKU. O vínculo pertence ao
    // erp-integration; este módulo só consome a porta.
    @Inject(CHANNEL_LISTING_READER) private readonly channelListings: ChannelListingReader,
  ) {}

  async sumSpendByChannel(
    tenantId: string,
    dateFrom?: Date,
    dateTo?: Date,
    dataMode?: AppDataMode,
  ): Promise<AdsSpendByChannel[]> {
    const rows = await this.campaigns.sumSpendByChannel(tenantId, dateFrom, dateTo, dataMode);

    // hasData: true sempre que existiu snapshot para o canal no período —
    // inclusive quando a soma deu zero (campanha pausada gasta R$0, e isso
    // é um dado, não uma ausência). Canal que não aparece na consulta não
    // vira linha aqui; quem monta o DRE trata a ausência como "sem dado",
    // nunca como "gastou zero".
    return rows.map((row) => ({ channelCode: row.channelCode, spend: row.spend, hasData: true }));
  }

  // Gasto por SKU (01/08/2026) — o gasto por ANÚNCIO vem do canal como dado
  // real; aqui ele é traduzido para SKU pelo vínculo que o
  // ChannelListing já mantém. Anúncio sem SKU vinculado é DESCARTADO em vez
  // de somado a um "outros": atribuir gasto a um produto errado é pior que
  // não atribuir, e o total por canal (sumSpendByChannel) continua contando
  // esse dinheiro corretamente no consolidado.
  async sumSpendBySku(
    tenantId: string,
    dateFrom?: Date,
    dateTo?: Date,
    dataMode?: AppDataMode,
  ): Promise<AdsSpendBySku[]> {
    const items = await this.campaigns.sumSpendByItem(tenantId, dateFrom, dateTo, dataMode);
    if (items.length === 0) return [];

    // Agrupa por canal para resolver os vínculos em lote — um lookup por
    // anúncio seria N queries para montar um DRE.
    const byChannel = new Map<string, typeof items>();
    for (const item of items) {
      const group = byChannel.get(item.channelCode) ?? [];
      group.push(item);
      byChannel.set(item.channelCode, group);
    }

    const result = new Map<string, AdsSpendBySku>();

    for (const [channelCode, channelItems] of byChannel) {
      const links = await this.channelListings.findSkusByExternalIds(
        tenantId,
        channelCode,
        channelItems.map((i) => i.externalItemId),
      );
      const skuByExternalId = new Map(links.map((l) => [l.externalId, l.skuCode]));

      for (const item of channelItems) {
        const skuCode = skuByExternalId.get(item.externalItemId);
        if (!skuCode) continue; // anúncio sem vínculo — ver comentário acima

        // Mesmo SKU pode ter mais de um anúncio no canal: soma.
        const key = `${channelCode}::${skuCode}`;
        const current = result.get(key) ?? { skuCode, channelCode, spend: 0, attributedUnits: 0 };
        current.spend += item.spend;
        current.attributedUnits += item.attributedUnits;
        result.set(key, current);
      }
    }

    return Array.from(result.values());
  }
}
