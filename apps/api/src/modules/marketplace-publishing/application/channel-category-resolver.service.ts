import { Injectable } from '@nestjs/common';
import { ChannelCategoryResolver } from '../../../shared/contracts/channel-category-resolver.port';
import { ChannelCategoryMappingService } from './channel-category-mapping.service';

// Adaptador fino: expõe o mapeamento categoria interna -> categoria do canal
// (que já existia para publicar anúncio) como a porta pública
// CHANNEL_CATEGORY_RESOLVER, para o Pricing Intelligence resolver a
// comissão correta por categoria sem conhecer ChannelCategoryMapping nem a
// tabela por trás — mesma disciplina de portas do resto da plataforma
// (docs/platform-architecture.md, seção 3).
//
// Deliberadamente NÃO reexporta o ChannelCategoryMappingService inteiro: o
// Pricing precisa de exatamente um método (traduzir a categoria), não de
// buscar/salvar/remover mapeamento. Interface Segregation — o consumidor
// não fica acoplado a operações de escrita que nunca vai usar.
@Injectable()
export class ChannelCategoryResolverService implements ChannelCategoryResolver {
  constructor(private readonly mappings: ChannelCategoryMappingService) {}

  async resolveExternalCategoryId(
    tenantId: string,
    internalCategoryId: string,
    marketplaceCode: string,
  ): Promise<string | null> {
    const mapping = await this.mappings.findMapping(tenantId, internalCategoryId, marketplaceCode);
    return mapping?.externalCategoryId ?? null;
  }
}
