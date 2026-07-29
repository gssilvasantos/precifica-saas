// Catálogo de Transportador/Serviço (Projeto Estruturante 5, benchmark Bling
// ERP, 29/07/2026, ver docs/carrier-catalog-architecture.md). Nome
// deliberadamente "CarrierServiceRepository" (mesmo nome do model Prisma
// CarrierService) — CUIDADO para não confundir com serviços de aplicação
// (Injectable) do próprio NestJS, que também terminam em "Service"; este é um
// repositório de dados, não uma classe de domínio de negócio.
export interface CarrierServiceRecord {
  id: string;
  tenantId: string;
  carrierId: string;
  name: string;
  aliases: string[];
  estimativaEntregaDias: number | null;
  automationCode: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type CarrierServiceCreateData = Omit<CarrierServiceRecord, 'id' | 'createdAt' | 'updatedAt'>;

export type CarrierServiceUpdateData = Partial<
  Omit<CarrierServiceRecord, 'id' | 'tenantId' | 'carrierId' | 'createdAt' | 'updatedAt'>
>;

export interface CarrierServiceRepository {
  create(data: CarrierServiceCreateData): Promise<CarrierServiceRecord>;
  findById(tenantId: string, id: string): Promise<CarrierServiceRecord | null>;
  findByNameForCarrier(carrierId: string, name: string): Promise<CarrierServiceRecord | null>;
  findAllByCarrier(tenantId: string, carrierId: string): Promise<CarrierServiceRecord[]>;
  // Usado por matchByFormaEnvio — precisa varrer todos os serviços do tenant
  // (de qualquer transportador) para encontrar o que bate com o formaEnvio.
  findAllByTenant(tenantId: string): Promise<CarrierServiceRecord[]>;
  update(id: string, data: CarrierServiceUpdateData): Promise<CarrierServiceRecord>;
}

export const CARRIER_SERVICE_REPOSITORY = Symbol('CARRIER_SERVICE_REPOSITORY');
