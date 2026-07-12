// Regra de domínio pura: margem mínima nunca pode ser maior que a margem
// desejada — ela é o piso de segurança, não a meta (PRD, seção 1.2). Isolada
// aqui porque é regra de negócio real, testável sem Nest nem Prisma.
export class InconsistentMarginError extends Error {
  constructor() {
    super(
      'A margem mínima aceitável não pode ser maior que a margem desejada — ela é o piso, não a meta.',
    );
    this.name = 'InconsistentMarginError';
  }
}

export function assertMarginsAreConsistent(desiredMarginPct: number, minimumMarginPct: number): void {
  if (minimumMarginPct > desiredMarginPct) {
    throw new InconsistentMarginError();
  }
}
