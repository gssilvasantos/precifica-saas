import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  RECEIVABLE_RECORD_REPOSITORY,
  ReceivableRecordRepository,
} from './ports/receivable-record-repository.port';
import { ReceivableRecordCreateData, ReceivableStatus } from '../domain/receivable-record.entity';

// Camada de aplicação do "A Receber". Criação/consulta manual (ex.: um
// registro criado à mão para um pedido que ainda não tem repasse previsto
// via sync automático); a mudança para PAID nunca acontece aqui — sempre via
// ReceivableReconciliationService, para que exista um único caminho que marca
// um repasse como pago (nunca dois lugares divergentes fazendo a mesma coisa).
@Injectable()
export class ReceivablesService {
  constructor(
    @Inject(RECEIVABLE_RECORD_REPOSITORY) private readonly receivables: ReceivableRecordRepository,
  ) {}

  create(tenantId: string, input: Omit<ReceivableRecordCreateData, 'tenantId'>) {
    return this.receivables.create({ tenantId, ...input });
  }

  async findOne(tenantId: string, id: string) {
    const receivable = await this.receivables.findById(tenantId, id);
    if (!receivable) throw new NotFoundException('Registro de contas a receber não encontrado.');
    return receivable;
  }

  findByStatus(tenantId: string, status: ReceivableStatus) {
    return this.receivables.findByStatus(tenantId, status);
  }
}
