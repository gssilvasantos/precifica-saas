import { ListingPublication, ListingPublicationCreateData } from '../../domain/listing-publication.entity';

// Append-only-por-tentativa (MESMO padrão de FiscalInvoiceRepository, Fase
// 3): create() sempre insere uma linha nova; markPublished/markError
// transicionam a MESMA linha (nunca criam outra) — a máquina de estados de
// uma tentativa é PENDENTE -> (PUBLICADO | ERRO), terminal nos dois casos.
export interface ListingPublicationRepository {
  create(data: ListingPublicationCreateData): Promise<ListingPublication>;
  findById(tenantId: string, id: string): Promise<ListingPublication | null>;
  findAllByProduct(tenantId: string, productId: string): Promise<ListingPublication[]>;
  markPublished(id: string, externalListingId: string): Promise<ListingPublication>;
  markError(id: string, errorMessage: string): Promise<ListingPublication>;
}

export const LISTING_PUBLICATION_REPOSITORY = Symbol('LISTING_PUBLICATION_REPOSITORY');
