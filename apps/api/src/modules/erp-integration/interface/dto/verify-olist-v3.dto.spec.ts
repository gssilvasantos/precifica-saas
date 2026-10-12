import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { VerifyOlistV3Dto } from './verify-olist-v3.dto';

async function check(payload: unknown) {
  return validate(plainToInstance(VerifyOlistV3Dto, payload));
}

describe('VerifyOlistV3Dto', () => {
  it('aceita 1 a 3 SKUs válidos', async () => {
    expect(await check({ skus: ['RM0001-1'] })).toHaveLength(0);
    expect(await check({ skus: ['RM0001', 'RM0002-1', 'rm 3.a/b'] })).toHaveLength(0);
  });

  it('rejeita lista vazia, ausente e acima de 3', async () => {
    expect(await check({ skus: [] })).not.toHaveLength(0);
    expect(await check({})).not.toHaveLength(0);
    expect(await check({ skus: ['A', 'B', 'C', 'D'] })).not.toHaveLength(0);
  });

  it('rejeita item que não é string, muito longo ou com caracteres inválidos', async () => {
    expect(await check({ skus: [123] })).not.toHaveLength(0);
    expect(await check({ skus: ['A'.repeat(61)] })).not.toHaveLength(0);
    expect(await check({ skus: ["A'; DROP TABLE x;--"] })).not.toHaveLength(0);
    expect(await check({ skus: ['A&limit=999'] })).not.toHaveLength(0);
  });

  it('normaliza espaços nas pontas antes de validar', async () => {
    const dto = plainToInstance(VerifyOlistV3Dto, { skus: ['  RM0001  '] });
    expect(dto.skus[0]).toBe('RM0001');
    expect(await validate(dto)).toHaveLength(0);
  });
});
