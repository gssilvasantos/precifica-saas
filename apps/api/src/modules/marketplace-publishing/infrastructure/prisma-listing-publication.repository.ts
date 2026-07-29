import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { ListingPublicationRepository } from '../application/ports/listing-publication-repository.port';
import { ListingPublication, ListingPublicationCreateData } from '../domain/listing-publication.entity';

type PrismaListingPublicationRecord = {
  id: string;
  tenantId: string;
  productId: string;
  skuCode: string;
  marketplaceCode: string;
  status: string;
  externalListingId: string | null;
  requestPayload: unknown;
  errorMessage: string | null;
  requestedAt: Date;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class PrismaListingPublicationRepository implements ListingPublicationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: ListingPublicationCreateData): Promise<ListingPublication> {
    const record = await this.prisma.listingPublication.create({
      data: {
        tenantId: data.tenantId,
        productId: data.productId,
        skuCode: data.skuCode,
        marketplaceCode: data.marketplaceCode,
        requestPayload: data.requestPayload as never,
      },
    });
    return this.toDomain(record as never);
  }

  async findById(tenantId: string, id: string): Promise<ListingPublication | null> {
    const record = await this.prisma.listingPublication.findFirst({ where: { id, tenantId } });
    return record ? this.toDomain(record as never) : null;
  }

  async findAllByProduct(tenantId: string, productId: string): Promise<ListingPublication[]> {
    const records = await this.prisma.listingPublication.findMany({
      where: { tenantId, productId },
      orderBy: { requestedAt: 'desc' },
    });
    return records.map((r) => this.toDomain(r as never));
  }

  async markPublished(id: string, externalListingId: string): Promise<ListingPublication> {
    const record = await this.prisma.listingPublication.update({
      where: { id },
      data: { status: 'PUBLICADO' as never, externalListingId, publishedAt: new Date() },
    });
    return this.toDomain(record as never);
  }

  async markError(id: string, errorMessage: string): Promise<ListingPublication> {
    const record = await this.prisma.listingPublication.update({
      where: { id },
      data: { status: 'ERRO' as never, errorMessage },
    });
    return this.toDomain(record as never);
  }

  private toDomain(record: PrismaListingPublicationRecord): ListingPublication {
    return {
      id: record.id,
      tenantId: record.tenantId,
      productId: record.productId,
      skuCode: record.skuCode,
      marketplaceCode: record.marketplaceCode,
      status: record.status as ListingPublication['status'],
      externalListingId: record.externalListingId,
      requestPayload: record.requestPayload,
      errorMessage: record.errorMessage,
      requestedAt: record.requestedAt,
      publishedAt: record.publishedAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
