// Catálogo de Transportador/Serviço (Projeto Estruturante 5, benchmark Bling
// ERP, 29/07/2026 — ver docs/carrier-catalog-architecture.md). Funções PURAS
// de normalização e matching de alias, para resolver qual CarrierService
// corresponde a um `formaEnvio` (hoje texto livre gravado em
// DispatchBatch.formaEnvio) — nenhuma chamada a Prisma/HTTP aqui, mesmo
// racional de tax-code-resolver.ts (Projeto Estruturante 4).

import { KNOWN_FORMA_ENVIO_CODES } from '../../logistics-fulfillment/domain/dispatch-batch.entity';

export interface CarrierServiceForMatching {
  id: string;
  carrierId: string;
  name: string;
  aliases: string[];
  isActive: boolean;
}

export interface CarrierServiceMatch {
  carrierServiceId: string;
  carrierId: string;
  matchedBy: 'NAME' | 'ALIAS';
  matchedValue: string;
}

// Normaliza texto para comparação tolerante a maiúsc/minúsc, acentos e
// espaços extras — mesmo tipo de texto livre já gravado em
// DispatchBatch.formaEnvio (ex.: "Correios", "CORREIOS", " correios ").
export function normalizeCarrierAlias(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_');
}

// Busca o CarrierService cujo NOME (prioridade) ou algum ALIAS bate com o
// formaEnvio informado, após normalização. Serviços inativos são sempre
// ignorados — nunca resolvidos automaticamente. Retorna null se nada bater:
// forma de envio sem correspondência cadastrada é um estado válido (só não
// ganha enriquecimento), nunca lança erro.
export function matchCarrierServiceByFormaEnvio(
  formaEnvio: string,
  services: CarrierServiceForMatching[],
): CarrierServiceMatch | null {
  const target = normalizeCarrierAlias(formaEnvio);

  for (const service of services) {
    if (!service.isActive) continue;
    if (normalizeCarrierAlias(service.name) === target) {
      return {
        carrierServiceId: service.id,
        carrierId: service.carrierId,
        matchedBy: 'NAME',
        matchedValue: service.name,
      };
    }
  }

  for (const service of services) {
    if (!service.isActive) continue;
    const aliasHit = service.aliases.find((alias) => normalizeCarrierAlias(alias) === target);
    if (aliasHit) {
      return {
        carrierServiceId: service.id,
        carrierId: service.carrierId,
        matchedBy: 'ALIAS',
        matchedValue: aliasHit,
      };
    }
  }

  return null;
}

// String a gravar em DispatchBatch.formaEnvio quando o lote é criado a partir
// de um CarrierService cadastrado — usa o NOME normalizado do serviço, o que
// mantém compatibilidade com resolveLabelStrategy caso o nome coincida com um
// código conhecido (ex.: serviço cadastrado como "Correios").
export function resolveFormaEnvioForService(service: Pick<CarrierServiceForMatching, 'name'>): string {
  return normalizeCarrierAlias(service.name);
}

// automationCode é opcional e, quando preenchido, deve ser um dos códigos que
// resolveLabelStrategy (logistics-fulfillment/domain/dispatch-batch.entity.ts)
// já sabe traduzir — nunca um valor livre, que criaria uma automação
// fantasma. Serviço sem automationCode é válido (só não tem automação de
// etiqueta associada, permanece NONE).
export function isValidAutomationCode(automationCode: string | null | undefined): boolean {
  if (automationCode == null || automationCode === '') return true;
  return KNOWN_FORMA_ENVIO_CODES.includes(automationCode.toUpperCase());
}
