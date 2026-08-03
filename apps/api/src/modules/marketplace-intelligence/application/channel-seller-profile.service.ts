import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import {
  ChannelSellerProfile,
  ChannelSellerProfileReader,
  NEUTRAL_CHANNEL_SELLER_PROFILE,
} from '../../../shared/contracts/channel-seller-profile-reader.port';

// Perfil do vendedor por canal — leitura e escrita. Ver
// docs/marketplace-fee-model-architecture.md, §2.0.
//
// Acessa o Prisma diretamente (sem porta de repositório própria) pelo mesmo
// critério da seção 4 de docs/platform-architecture.md: é cadastro simples,
// sem regra de domínio para testar isoladamente. A tabela pertence a este
// bounded context — nenhum outro módulo a lê, só consomem a porta.
@Injectable()
export class ChannelSellerProfileService implements ChannelSellerProfileReader {
  constructor(private readonly prisma: PrismaService) {}

  // Nunca devolve null: sem configuração, vale o perfil NEUTRO (paga tudo,
  // sem desconto). Assumir o benefício por omissão — "deve ter o plano" —
  // calcularia preço a menor e viraria prejuízo silencioso, exatamente o
  // tipo de erro que a correção de 01/08/2026 existiu para eliminar.
  async getProfile(tenantId: string, channelCode: string): Promise<ChannelSellerProfile> {
    const record = await this.prisma.channelSellerProfile.findUnique({
      where: { tenantId_channelCode: { tenantId, channelCode } },
    });

    if (!record) return { channelCode, ...NEUTRAL_CHANNEL_SELLER_PROFILE };

    return {
      channelCode: record.channelCode,
      professionalPlanActive: record.professionalPlanActive,
      freightDiscountPct: record.freightDiscountPct,
    };
  }

  async upsertProfile(
    tenantId: string,
    channelCode: string,
    data: { professionalPlanActive?: boolean; freightDiscountPct?: number },
  ): Promise<ChannelSellerProfile> {
    if (data.freightDiscountPct !== undefined && (data.freightDiscountPct < 0 || data.freightDiscountPct > 1)) {
      throw new Error(
        `freightDiscountPct precisa ser uma FRAÇÃO entre 0 e 1 (0.7 = 70%) — recebido ${data.freightDiscountPct}.`,
      );
    }

    const record = await this.prisma.channelSellerProfile.upsert({
      where: { tenantId_channelCode: { tenantId, channelCode } },
      create: { tenantId, channelCode, ...data },
      update: data,
    });

    return {
      channelCode: record.channelCode,
      professionalPlanActive: record.professionalPlanActive,
      freightDiscountPct: record.freightDiscountPct,
    };
  }

  listByTenant(tenantId: string): Promise<ChannelSellerProfile[]> {
    return this.prisma.channelSellerProfile
      .findMany({ where: { tenantId }, orderBy: { channelCode: 'asc' } })
      .then((records) =>
        records.map((r) => ({
          channelCode: r.channelCode,
          professionalPlanActive: r.professionalPlanActive,
          freightDiscountPct: r.freightDiscountPct,
        })),
      );
  }
}
