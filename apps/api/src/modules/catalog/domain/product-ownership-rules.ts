import { ProductSourceSystem } from './product.entity';

// Regra de domínio pura (Etapa 5 — docs/erp-integration-architecture.md,
// seção 2): quando um produto é espelhado de um ERP externo, os campos
// físicos/comerciais deixam de ser editáveis manualmente — só o próximo
// sync do ERP os muda. Margem, perfil fiscal e categoria interna continuam
// sempre editáveis, em qualquer sourceSystem, porque são configuração que só
// existe no Precifica.
export const ERP_OWNED_FIELDS = [
  'name',
  'costPrice',
  'weightKg',
  'packagingWeightKg',
  'lengthCm',
  'widthCm',
  'heightCm',
] as const;

export type ErpOwnedField = (typeof ERP_OWNED_FIELDS)[number];

export class LockedFieldEditError extends Error {
  constructor(public readonly fields: string[]) {
    super(
      `Campo(s) espelhado(s) do Olist não podem ser editados manualmente: ${fields.join(', ')}. ` +
        'Eles são atualizados automaticamente no próximo sync com o ERP.',
    );
    this.name = 'LockedFieldEditError';
  }
}

export function assertEditableFields(
  sourceSystem: ProductSourceSystem,
  attemptedChanges: Record<string, unknown>,
): void {
  if (sourceSystem !== 'ERP_OLIST') return; // MANUAL: tudo editável, sempre
  const locked = ERP_OWNED_FIELDS.filter((field) => attemptedChanges[field] !== undefined);
  if (locked.length > 0) {
    throw new LockedFieldEditError(locked);
  }
}
