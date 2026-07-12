import { Injectable } from '@nestjs/common';
import {
  CompetitionFetchContext,
  CompetitionRadar,
  RadarHealthStatus,
  RawCompetitorOffer,
} from '../../../../shared/contracts/competition-radar.contract';

// Radar de exemplo — ESTRUTURA, não integração real, mesma honestidade já
// aplicada ao MercadoLivreProvider (Etapa "ESTRUTURAÇÃO DO MÓDULO DE
// INTEGRAÇÕES"). sourceType INTERNAL_MONITORING é o caso mais simples e
// realista de implementar sem depender de credencial de terceiro: alguém do
// time cola o preço do concorrente numa exportação/planilha, e esta classe
// só devolve o que já está persistido, sem chamar nenhuma API externa.
//
// Serve dois propósitos: (1) prova que o contrato CompetitionRadar é
// implementável e plugável via COMPETITION_RADARS sem tocar no
// orquestrador; (2) é o adaptador que efetivamente pode ir para produção
// primeiro, porque não depende de scraping (frágil/potencialmente contra
// termos de uso) nem de uma API paga de terceiro (PriceAPI) ainda não
// contratada.
//
// PriceApiRadar (sourceType PARTNER_API) e um radar de scraping
// (sourceType SCRAPING) seguem exatamente a mesma forma — um arquivo novo
// cada, implementando esta mesma interface — quando/se forem contratados.
@Injectable()
export class ManualSheetRadar implements CompetitionRadar {
  readonly code = 'MANUAL_SHEET_IMPORT';
  readonly sourceType = 'INTERNAL_MONITORING' as const;

  async fetchOffers(_ctx: CompetitionFetchContext): Promise<RawCompetitorOffer[]> {
    // Ainda não há import de planilha implementado — retorna vazio em vez
    // de inventar dado. O orquestrador trata "nenhuma oferta" como
    // "nada a processar para este listing", não como erro (ver
    // CompetitionMonitorOrchestrator.processListing).
    return [];
  }

  async healthCheck(): Promise<RadarHealthStatus> {
    return { status: 'UP', message: 'Radar manual — sem dependência externa, sempre disponível.' };
  }
}
