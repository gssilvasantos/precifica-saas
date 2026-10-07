import { interleaveByTenant } from './monitoring-queue';

const item = (tenantId: string, id: string) => ({ tenantId, id });

describe('interleaveByTenant', () => {
  // Caso real de produção (07/10/2026): o tenant demo tinha 855
  // monitoramentos cadastrados antes dos 855 da Rita. O ciclo seguia a
  // ordem do banco e quase nunca chegava na Rita — 20 de 561 SKUs
  // atualizados em 24h contra 124 do demo.
  it('não deixa um tenant cadastrado primeiro monopolizar o começo da fila', () => {
    const queue = interleaveByTenant([item('demo', 'd1'), item('demo', 'd2'), item('demo', 'd3'), item('rita', 'r1'), item('rita', 'r2')]);

    expect(queue.map((l) => l.id)).toEqual(['d1', 'r1', 'd2', 'r2', 'd3']);
  });

  it('preserva a ordem original dentro de cada tenant', () => {
    const queue = interleaveByTenant([item('a', 'a1'), item('b', 'b1'), item('a', 'a2'), item('a', 'a3')]);

    expect(queue.filter((l) => l.tenantId === 'a').map((l) => l.id)).toEqual(['a1', 'a2', 'a3']);
  });

  it('não perde nem duplica itens', () => {
    const input = [item('a', '1'), item('b', '2'), item('c', '3'), item('a', '4'), item('c', '5')];

    const queue = interleaveByTenant(input);

    expect([...queue].sort((x, y) => x.id.localeCompare(y.id))).toEqual([...input].sort((x, y) => x.id.localeCompare(y.id)));
  });

  it('lista vazia devolve lista vazia', () => {
    expect(interleaveByTenant([])).toEqual([]);
  });
});
