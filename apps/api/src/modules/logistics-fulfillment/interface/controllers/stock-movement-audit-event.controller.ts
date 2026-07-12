import { Body, Controller, Get, Inject, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, RolesGuard, Roles, CurrentUser, AuthenticatedUser, UserRole } from '../../../identity-access/public-api';
import { FILE_STORAGE } from '../../../../shared/contracts/tokens';
import { FileStorage } from '../../../../shared/contracts/file-storage.port';
import { StockMovementAuditEventService } from '../../application/stock-movement-audit-event.service';
import { VideoCaptureService } from '../../application/video-capture.service';
import { WarehouseService } from '../../application/warehouse.service';
import {
  AttachMediaDto,
  ApproveAuditEventDto,
  CreateFullDispatchDto,
  MarkDivergentDto,
  ScanItemDto,
  VideoChunkDto,
} from '../dto/create-full-dispatch.dto';

// Hub de Provas — interface HTTP das duas fases do gate. A criação do
// RETAIL_SHIPMENT continua 100% automática (OrderReadyForFulfillmentListener,
// nunca por este controller); aqui só existe o caminho MANUAL de montar um
// lote FULL_DISPATCH, e as ações de conferência (mídia/aprovar/divergente)
// comuns aos dois tipos de evento.
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('logistics-fulfillment/audit-events')
export class StockMovementAuditEventController {
  constructor(
    private readonly auditEvents: StockMovementAuditEventService,
    private readonly warehouses: WarehouseService,
    private readonly videoCapture: VideoCaptureService,
    @Inject(FILE_STORAGE) private readonly fileStorage: FileStorage,
  ) {}

  // Só ADMIN/PRICING_EDITOR montam um lote Full — VIEWER é somente leitura
  // em toda a plataforma (mesmo padrão dos demais controllers de escrita).
  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Post()
  async createFullDispatch(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateFullDispatchDto) {
    const physical = await this.warehouses.ensurePhysicalWarehouse(user.tenantId);
    const destination = await this.warehouses.ensureFullWarehouse(user.tenantId, dto.channelCode);

    return this.auditEvents.createPending({
      tenantId: user.tenantId,
      eventType: 'FULL_DISPATCH',
      sourceWarehouseId: physical.id,
      destinationWarehouseId: destination.id,
      orderIds: dto.orderIds ?? [],
      invoiceNumber: dto.invoiceNumber ?? null,
    });
  }

  // Sprint 27 (Pick & Pack) — fila de trabalho: os eventos PENDENTES do
  // tenant, mais antigos primeiro. É como a tela de conferência descobre
  // QUAL evento abrir sem já saber o ID de antemão.
  @Get('pending')
  getPendingQueue(@CurrentUser() user: AuthenticatedUser) {
    return this.auditEvents.getPendingQueue(user.tenantId);
  }

  @Get(':id')
  async getById(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const event = await this.auditEvents.getById(user.tenantId, id);
    if (!event) throw new NotFoundException(`Evento de auditoria ${id} não encontrado.`);
    return event;
  }

  // Recebe o conteúdo já em base64 no corpo — mesma simplificação
  // consciente de ImportSettlementDto (evita multipart/FileInterceptor só
  // para este endpoint). O controller decodifica, persiste via FILE_STORAGE
  // (adapter de disco local, o mesmo do ProductPhotoMirrorService) e só
  // então chama o serviço com a URL final — o domínio nunca lida com bytes.
  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Post(':id/media')
  async attachMedia(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: AttachMediaDto) {
    const buffer = Buffer.from(dto.contentBase64, 'base64');
    const key = `logistics-fulfillment/audit-events/${id}/${Date.now()}`;
    const stored = await this.fileStorage.upload(key, buffer, dto.contentType);
    return this.auditEvents.attachMedia(user.tenantId, id, stored.url, dto.mediaType);
  }

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Post(':id/approve')
  approve(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: ApproveAuditEventDto) {
    return this.auditEvents.approve(user.tenantId, id, user.userId, dto.lines);
  }

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Post(':id/divergent')
  markDivergent(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: MarkDivergentDto) {
    return this.auditEvents.markDivergent(user.tenantId, id, user.userId, dto.divergenceNotes);
  }

  // Sprint 27 (Pick & Pack) — checklist de bipagem. GET devolve o estado
  // atual (a tela de conferência usa isso para desenhar a lista de itens
  // com foto e decidir se "Finalizar Embalagem" já pode ser liberado no
  // FRONT — a fonte de verdade que efetivamente bloqueia a aprovação
  // continua sendo canApprove no backend, nunca o frontend).
  @Get(':id/checklist')
  getChecklist(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.auditEvents.getChecklist(user.tenantId, id);
  }

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Post(':id/scan')
  scanItem(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: ScanItemDto) {
    return this.auditEvents.scanItem(user.tenantId, id, dto.skuCode);
  }

  // Sprint 27 (Pick & Pack) — captura de vídeo em chunks (ver
  // docs/pick-pack-architecture.md, seção 2). Idempotente por auditEventId:
  // reabrir a tela de conferência (refresh acidental) devolve a MESMA sessão,
  // nunca cria uma segunda gravação para o mesmo evento.
  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Post(':id/video-sessions')
  startVideoSession(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.videoCapture.startSession(user.tenantId, id);
  }

  @Get(':id/video-sessions')
  async getVideoSession(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const session = await this.videoCapture.getByAuditEvent(user.tenantId, id);
    if (!session) throw new NotFoundException(`Nenhuma sessão de captura de vídeo encontrada para o evento ${id}.`);
    return session;
  }

  // Cada chunk chega em base64 dentro do corpo JSON (mesma simplificação
  // consciente de AttachMediaDto) — o controller só decodifica e repassa;
  // toda a lógica de idempotência/ordem (canAcceptChunk) mora no serviço.
  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Post(':id/video-sessions/:sessionId/chunks')
  appendVideoChunk(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId') sessionId: string,
    @Body() dto: VideoChunkDto,
  ) {
    const content = Buffer.from(dto.contentBase64, 'base64');
    return this.videoCapture.appendChunk(user.tenantId, sessionId, dto.sequence, content);
  }

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Post(':id/video-sessions/:sessionId/finalize')
  finalizeVideoSession(@CurrentUser() user: AuthenticatedUser, @Param('sessionId') sessionId: string) {
    return this.videoCapture.finalize(user.tenantId, sessionId);
  }
}
