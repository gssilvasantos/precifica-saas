import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsIn, IsInt, IsOptional, IsPositive, IsString, ValidateNested } from 'class-validator';

// Cria um lote de despacho para o Full de um canal — o físico é sempre a
// origem (resolvido pelo backend via WarehouseService, nunca informado pelo
// chamador), o destino é o CD virtual daquele canal (criado sob demanda se
// ainda não existir, mesmo racional do RETAIL_SHIPMENT automático do
// listener). `orderIds` pode vir vazio: um lote de reabastecimento
// preventivo do CD não é motivado por nenhum pedido específico.
export class CreateFullDispatchDto {
  @IsString()
  channelCode!: string;

  @IsArray()
  @IsOptional()
  orderIds?: string[];

  @IsString()
  @IsOptional()
  invoiceNumber?: string;
}

export class AttachMediaDto {
  @IsString()
  contentBase64!: string;

  @IsString()
  contentType!: string; // ex.: "image/jpeg", "video/mp4"

  @IsIn(['PHOTO', 'VIDEO'])
  mediaType!: 'PHOTO' | 'VIDEO';
}

export class AuditEventLineDto {
  @IsString()
  skuCode!: string;

  @IsInt()
  @IsPositive()
  quantity!: number;
}

export class ApproveAuditEventDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => AuditEventLineDto)
  lines!: AuditEventLineDto[];
}

export class MarkDivergentDto {
  @IsString()
  divergenceNotes!: string;
}

// Sprint 27 (Pick & Pack) — corpo da bipagem de um SKU do checklist. Nunca
// aceita quantidade do chamador (sempre +1, ver StockMovementAuditEventService.scanItem);
// só o SKU lido (código de barras ou digitação manual) é informado.
export class ScanItemDto {
  @IsString()
  skuCode!: string;
}

// Cada chunk chega com sua própria sequência (0, 1, 2, ...) — é o que
// permite ao servidor detectar retransmissão (idempotência) ou lacuna de
// rede sem precisar de nenhum estado do lado do cliente além de "qual o
// próximo número". Ver VideoCaptureService.appendChunk / canAcceptChunk.
export class VideoChunkDto {
  @IsInt()
  sequence!: number;

  @IsString()
  contentBase64!: string;
}
