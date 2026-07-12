import { createHash } from 'node:crypto';

// Hash determinístico de um payload normalizado — usado por qualquer
// pipeline de sincronização (Marketplace Intelligence, ERP Integration) para
// saber se um candidato é igual ao último estado conhecido, evitando versões
// novas / eventos de mudança gerados à toa. Ordena as chaves antes de
// serializar para que a mesma informação sempre gere o mesmo hash,
// independente da ordem em que os campos chegaram do provider.
//
// Promovido de marketplace-intelligence/domain/content-hash.ts na Etapa 5:
// o ERP Integration precisa exatamente da mesma função — duplicar seria
// quebrar DRY por um acidente de organização de pastas, não por um motivo
// de arquitetura real.
export function computeContentHash(payload: unknown): string {
  const normalized = JSON.stringify(sortKeysDeep(payload));
  return createHash('sha256').update(normalized).digest('hex');
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}
