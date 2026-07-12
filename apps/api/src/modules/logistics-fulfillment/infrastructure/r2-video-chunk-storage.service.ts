import { Injectable, Logger } from '@nestjs/common';
import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getR2Client } from '../../../shared/infrastructure/storage/r2-client.factory';
import { requireStorageEnv } from '../../../shared/infrastructure/storage/r2-env';
import { VideoChunkAppendResult, VideoChunkStorage } from '../application/ports/video-chunk-storage.port';

// Passo 3 do Deploy Demo — adapter R2 do VideoChunkStorage via Multipart
// Upload nativo do S3 (R2 implementa a mesma API). Ver
// docs/pick-pack-architecture.md, seção 2, para o racional original de "cada
// chunk sobrevive de forma independente" — aqui o equivalente é cada "Part"
// do multipart upload sendo enviada assim que acumula bytes suficientes.
//
// ACHADO real (limite do próprio S3/R2, não uma escolha de design): toda
// Part de um multipart upload precisa ter NO MÍNIMO 5 MiB, exceto a última.
// O MediaRecorder do navegador (ConferenciaDetalhePage.tsx) manda chunks bem
// menores que isso — timeslice curto, na casa de KBs/poucas centenas de KB,
// ainda mais depois do videoBitsPerSecond=500_000 já limitado no Item 3
// (análise de carga). Por isso este adapter BUFFERIZA os chunks recebidos em
// memória, por sessão, até acumular >= 5 MiB, e só então sobe uma Part de
// verdade. appendChunk nunca fica bloqueado esperando o buffer encher — grava
// em memória e retorna na hora; o upload real acontece de forma amortizada.
//
// Trade-off assumido, documentado em docs/deploy-render-supabase-r2.md,
// seção 3.3: o estado do multipart upload (uploadId, Parts já commitadas,
// buffer pendente) vive em memória do processo — mesma categoria de risco de
// instância única já sinalizada no inventário de governança pós-Sprint 27
// (FinancialPolicyReaderService, rate limiter por marketplace). Se o
// processo cair no meio de uma gravação, a sessão de vídeo fica órfã no R2
// (upload incompleto, nunca fica visível/completo). Aceitável para a versão
// Demo (uma única instância no Render); recomendação para quando escalar
// para múltiplas instâncias: mover este estado para Redis, ou configurar uma
// lifecycle rule no bucket R2 para abortar multipart uploads incompletos
// automaticamente após alguns dias.
const MIN_PART_SIZE = 5 * 1024 * 1024; // 5 MiB — mínimo do S3/R2 multipart (não se aplica à última Part)

interface MultipartState {
  uploadId: string;
  nextPartNumber: number;
  parts: { ETag: string; PartNumber: number }[];
  buffer: Buffer[];
  bufferedBytes: number;
  totalBytes: number;
}

@Injectable()
export class R2VideoChunkStorageService implements VideoChunkStorage {
  private readonly logger = new Logger(R2VideoChunkStorageService.name);
  private readonly sessions = new Map<string, MultipartState>();

  async createSession(key: string): Promise<void> {
    const bucket = requireStorageEnv('R2_BUCKET');
    const result = await getR2Client().send(
      new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: 'video/webm' }),
    );
    if (!result.UploadId) {
      throw new Error(`R2 não retornou UploadId ao iniciar multipart upload para ${key}.`);
    }
    this.sessions.set(key, {
      uploadId: result.UploadId,
      nextPartNumber: 1,
      parts: [],
      buffer: [],
      bufferedBytes: 0,
      totalBytes: 0,
    });
  }

  async appendChunk(key: string, content: Buffer): Promise<VideoChunkAppendResult> {
    const state = this.requireState(key);
    state.buffer.push(content);
    state.bufferedBytes += content.length;
    state.totalBytes += content.length;

    if (state.bufferedBytes >= MIN_PART_SIZE) {
      await this.flushPart(key, state);
    }

    return { totalBytes: state.totalBytes };
  }

  async finalizeSession(key: string): Promise<string> {
    const state = this.requireState(key);
    const bucket = requireStorageEnv('R2_BUCKET');
    // R2_PUBLIC_BASE_URL: domínio custom vinculado ao bucket no painel R2
    // (ou o "Public Development URL" tipo https://pub-xxxx.r2.dev) — nunca
    // o R2_ENDPOINT, que é só a API S3 autenticada. Ver
    // docs/deploy-render-supabase-r2.md, seção 3.1.
    const publicBaseUrl = requireStorageEnv('R2_PUBLIC_BASE_URL');

    // Garante pelo menos 1 Part mesmo se o vídeo inteiro couber abaixo de
    // 5 MiB (gravação curtíssima) — o restante do buffer vira a Part final,
    // sem violar o mínimo (que não vale para a última Part de um upload).
    if (state.bufferedBytes > 0 || state.parts.length === 0) {
      await this.flushPart(key, state);
    }

    await getR2Client().send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: state.uploadId,
        MultipartUpload: { Parts: state.parts },
      }),
    );

    this.sessions.delete(key);
    const url = `${publicBaseUrl.replace(/\/$/, '')}/${key}`;
    this.logger.log(
      `Vídeo finalizado no R2: ${key} -> ${url} (${state.totalBytes} bytes, ${state.parts.length} parte(s))`,
    );
    return url;
  }

  // Mantido só por compatibilidade com a porta — NÃO confiável antes de
  // finalizeSession ter sido chamado com sucesso (ver comentário na porta).
  getPublicUrl(key: string): string {
    const publicBaseUrl = requireStorageEnv('R2_PUBLIC_BASE_URL');
    return `${publicBaseUrl.replace(/\/$/, '')}/${key}`;
  }

  async delete(key: string): Promise<void> {
    // Retenção de 30 dias — apaga o objeto já completo (finalizeSession já
    // rodou). Sessões abandonadas no meio (nunca finalizadas) não passam por
    // aqui — recomendação: lifecycle rule no bucket para abortar multipart
    // uploads incompletos após alguns dias (seção 3.3 do doc de deploy).
    const bucket = requireStorageEnv('R2_BUCKET');
    await getR2Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    this.sessions.delete(key);
  }

  private async flushPart(key: string, state: MultipartState): Promise<void> {
    if (state.buffer.length === 0) return;
    const bucket = requireStorageEnv('R2_BUCKET');
    const body = Buffer.concat(state.buffer);
    const partNumber = state.nextPartNumber;

    const result = await getR2Client().send(
      new UploadPartCommand({
        Bucket: bucket,
        Key: key,
        UploadId: state.uploadId,
        PartNumber: partNumber,
        Body: body,
      }),
    );
    if (!result.ETag) {
      throw new Error(`R2 não retornou ETag para a Part ${partNumber} de ${key}.`);
    }

    state.parts.push({ ETag: result.ETag, PartNumber: partNumber });
    state.nextPartNumber += 1;
    state.buffer = [];
    state.bufferedBytes = 0;
    this.logger.debug(`Part ${partNumber} enviada ao R2 (${body.length} bytes) — ${key}`);
  }

  private requireState(key: string): MultipartState {
    const state = this.sessions.get(key);
    if (!state) {
      throw new Error(
        `[R2VideoChunkStorageService] sessão ${key} não foi inicializada (createSession não chamado, ou o processo reiniciou no meio da gravação — ver seção 3.3 do doc de deploy).`,
      );
    }
    return state;
  }
}
