// Ordem de processamento do ciclo do radar (07/10/2026).
//
// O ciclo percorria os monitoramentos na ordem do banco. Com dois tenants de
// 855 anúncios cada, o cadastrado primeiro ocupava o começo da fila e o ciclo
// raramente chegava ao segundo antes de ser interrompido (reinício ou
// hibernação da instância). Intercalar um item de cada tenant por vez garante
// que todos avancem no mesmo ritmo, mesmo quando o ciclo não termina.
export function interleaveByTenant<T extends { tenantId: string }>(listings: T[]): T[] {
  const byTenant = new Map<string, T[]>();
  for (const listing of listings) {
    const bucket = byTenant.get(listing.tenantId);
    if (bucket) bucket.push(listing);
    else byTenant.set(listing.tenantId, [listing]);
  }

  const buckets = [...byTenant.values()];
  const queue: T[] = [];
  for (let index = 0; queue.length < listings.length; index++) {
    for (const bucket of buckets) {
      if (index < bucket.length) queue.push(bucket[index]);
    }
  }
  return queue;
}
