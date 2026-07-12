import { Inject, Injectable } from '@nestjs/common';
import { CHANGE_EVENT_REPOSITORY, ChangeEventRepository } from './ports/change-event-repository.port';

// Serviço fino — existe para o controller não injetar um repositório
// diretamente (mantém a regra "interface fala com application", mesmo
// quando o caso de uso é um simples "listar").
@Injectable()
export class ChangeEventsQueryService {
  constructor(@Inject(CHANGE_EVENT_REPOSITORY) private readonly changeEvents: ChangeEventRepository) {}

  list(marketplaceId?: string, limit?: number) {
    return this.changeEvents.findRecent(marketplaceId, limit);
  }
}
