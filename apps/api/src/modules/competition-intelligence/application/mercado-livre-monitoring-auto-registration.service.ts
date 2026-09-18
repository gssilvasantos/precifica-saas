import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  MONITORED_LISTING_REPOSITORY,
  MonitoredListingRepository,
} from './ports/monitored-listing-repository.port';
import { SyncedChannelListing } from '../../marketplace-intelligence/domain/channel-listing-events';

// Precisa bater com MercadoLivreCatalogRadar.code
// (infrastructure/radars/mercado-livre-catalog-radar.ts) — não importado
// diretamente de lá para não obrigar este serviço a depender da classe
// concreta do radar (ele já está registrado via COMPETITION_RADARS, essa
// classe só precisa do CÓDIGO, que é dado, não comportamento).
const MERCADO_LIVRE_RADAR_CODE = 'MERCADO_LIVRE_CATALOG_V1';
const CHANNEL_CODE = 'MERCADO_LIVRE';

// "Liga o radar" de verdade (18/09/2026, ver channel-listing-events.ts para
// o racional completo do porquê este passo é necessário): recebe os anúncios
// que acabaram de ser sincronizados em ChannelListing e garante que cada um
// tenha um MonitoredCompetitorListing ativo — sem isso, MercadoLivreCatalogRadar
// nunca é chamado para aqueles SKUs (CompetitionMonitorOrchestrator só itera
// sobre monitoramentos já cadastrados).
//
// Idempotente por natureza: reconcile() é chamado a cada sync bem-sucedido
// (a cada ~30 min, ver MercadoLivreChannelListingSyncSchedulerJob) e só cria
// o que ainda não existe — nunca duplica, nunca reativa algo que o usuário
// desativou deliberadamente pela tela (setActive(false) fica como está,
// listagem de findAllActiveByTenant só traz os ativos, então um listing
// desativado manualmente seria recriado aqui; ver aviso de honestidade no
// método reconcile).
@Injectable()
export class MercadoLivreMonitoringAutoRegistrationService {
  private readonly logger = new Logger(MercadoLivreMonitoringAutoRegistrationService.name);

  constructor(@Inject(MONITORED_LISTING_REPOSITORY) private readonly monitoredListings: MonitoredListingRepository) {}

  // AVISO DE HONESTIDADE: não distingue "nunca cadastrado" de "o usuário
  // desativou este anúncio manualmente pela tela Radar de Concorrência" —
  // MonitoredListingRepository só expõe findAllActiveByTenant (os ATIVOS),
  // então um listing desativado é recriado no próximo sync, como se nunca
  // tivesse sido desligado. Isso é uma simplificação consciente do escopo
  // "só ligar o radar": o MonitoredListingRepository não tem hoje um método
  // "findAllByTenant incluindo inativos" nem um motivo registrado de
  // desativação, e resolver isso direito (silenciar um anúncio específico
  // permanentemente) é uma decisão de produto separada, não implementada
  // aqui.
  async reconcile(tenantId: string, listings: SyncedChannelListing[]): Promise<{ created: number }> {
    if (listings.length === 0) return { created: 0 };

    const existing = await this.monitoredListings.findAllActiveByTenant(tenantId);
    const existingTargetRefs = new Set(
      existing.filter((listing) => listing.channelCode === CHANNEL_CODE).map((listing) => listing.targetRef),
    );

    let created = 0;
    for (const listing of listings) {
      if (existingTargetRefs.has(listing.externalId)) continue;
      try {
        await this.monitoredListings.create({
          tenantId,
          skuCode: listing.skuCode,
          competitorLabel: `Sincronizado automaticamente — SKU ${listing.skuCode}`,
          targetRef: listing.externalId,
          radarCode: MERCADO_LIVRE_RADAR_CODE,
          channelCode: CHANNEL_CODE,
        });
        created++;
      } catch (error) {
        this.logger.warn(
          `Falha ao registrar monitoramento automático para SKU ${listing.skuCode} (anúncio ${listing.externalId}, tenant ${tenantId}): ${(error as Error).message}`,
        );
      }
    }

    if (created > 0) {
      this.logger.log(`Tenant ${tenantId}: ${created} novo(s) monitoramento(s) de concorrência registrado(s) automaticamente para o Mercado Livre.`);
    }

    return { created };
  }
}
